import {
  GlobalKeyboardListener,
  IGlobalKeyDownMap,
} from "node-global-key-listener";
import { AT1130, VM } from "vapi";
import { Duration, enforce, enforce_nonnull, pause, same } from "vscript";
import { enumerate } from "vutil";
import { calibration_freerun, SDI_OUT_INDEX, VAPI_BLADE } from "./globals.js";
import { load_demo_content } from "./utilities.js";

const vm = await VM.open({
  ip: VAPI_BLADE,
  towel: "vapi",
});

enforce(vm instanceof AT1130.Root);
enforce(!!vm.color_correction && !!vm.i_o_module && !!vm.genlock);

await calibration_freerun(vm);

// for this demo we'll define a small set of key-triggered commands:
// * switch video source (to 0, 1, 2, 3)
// * increase/decrease hue of currently selected video source
//   (even in the unlikely case that the selected video source isn't yet visible on the SDI output)
// * increase/decrease saturation of currently selected video source
//   (even in the unlikely case that the selected video source isn't yet visible on the SDI output)
//
// we'll populate video sources 0 to 3 using the load_demo_content method used in section 2. This will
// set up two video signal generators, as well as one player holding an animated clip made by the Blender Foundation,
// and one player holding a custom-made test sequence.
const { vsg_colorbars, vsg_counters, blender_player, testseq_player } =
  await load_demo_content(vm, true);

// Each of these video sources will then be routed through a (1D) color correction instance.

const ccs = await vm.color_correction.cc1d.ensure_allocated(4, "exactly");

await ccs[0].v_src.command.write(vsg_colorbars.output);
await ccs[1].v_src.command.write(vsg_counters.output);
await ccs[2].v_src.command.write(blender_player.output.video);
await ccs[3].v_src.command.write(testseq_player.output.video);

for (const cc of ccs) {
  await cc.color_schema.write("BRIGHTNESS_CONTRAST");
  await cc.yuv.active.command.write(true);
  await cc.yuv.saturation.write(0.5);
  await cc.yuv.hue_offset.write(0.0);
}

interface CurrentState {
  i_selected: number;
  source_states: Array<{ hue: number; saturation: number }>;
}

const current_state: CurrentState = {
  i_selected: 0,
  source_states: ccs.map(() => ({ hue: 0, saturation: 0 })), // dummy data
};

const target_state: CurrentState = {
  i_selected: 0,
  source_states: ccs.map(() => ({ hue: 0, saturation: 0 })), // dummy data
};

for (const [i, cc] of enumerate(ccs)) {
  await cc.yuv.hue_offset.watch(
    (new_offset) => (current_state.source_states[i].hue = new_offset)
  );
  await cc.yuv.saturation.watch(
    (new_offset) => (current_state.source_states[i].saturation = new_offset)
  );
}

const io = enforce_nonnull(vm.i_o_module);
await io.configuration.row(SDI_OUT_INDEX).direction.write("Output", {
  retry_until: {
    criterion: "custom",
    validator: async () => await io.output.is_allocated(SDI_OUT_INDEX)
  }
});
const SDI_OUT = io.output.row(SDI_OUT_INDEX);

function index_of(v: AT1130.Video.Essence | null) {
  if (v !== null) {
    for (const [i, cc] of enumerate(ccs)) {
      if (same(v, cc.output)) return i;
    }
  }
  return -1;
}

await SDI_OUT.sdi.t_src.command.write(vm.genlock.instances.row(0).output);
await SDI_OUT.sdi.v_src.status.watch((new_src) => {
  current_state.i_selected = index_of(new_src.source);
});

const SATURATION_BOUNDS = [0.0, 2.0] as const;
const HUE_BOUNDS = [-1.0, 1.0] as const;

let busy_loop_running = false;

// The user will be able to interactively switch between sources 0...3 using the keys 1...4, and to adjust
// the selected source's hue and saturation values using
// e: increase hue
// d: decrease hue
// r: increase saturation
// f: decrease saturation

type Command =
  | { kind: "select-video-source"; i: number }
  | { kind: "change-hue"; dir: "increase" | "decrease" }
  | { kind: "change-saturation"; dir: "increase" | "decrease" };

const STEP_SIZE = 0.01;

function clamp(x: number, bounds: readonly [number, number]) {
  return Math.max(bounds[0], Math.min(bounds[1], x));
}

// typically, our scripts will contain a long series of write() statements, each of which will block
// until its success criterion has been fulfilled.
//
// In this case, we'll be responding to user input that might potentially come in at a higher rate
// than we're able to change our keyword state, so if we were to dispatch a write() call on every
// user input event, we might have several conflicting write() attempts execute concurrently.
//
// We'll thus permanently monitor our keyword state instead, and have a busy-loop dispatch change
// requests until the observed state agrees with the target state

function update_target_state(cmd: Command) {
  switch (cmd.kind) {
    case "select-video-source":
      target_state.i_selected = cmd.i;
      break;
    case "change-hue":
      {
        const delta = cmd.dir === "increase" ? STEP_SIZE : -STEP_SIZE;
        target_state.source_states[target_state.i_selected].hue = clamp(
          target_state.source_states[target_state.i_selected].hue + delta,
          HUE_BOUNDS
        );
      }
      break;
    case "change-saturation":
      {
        const delta = cmd.dir === "increase" ? STEP_SIZE : -STEP_SIZE;
        target_state.source_states[target_state.i_selected].saturation = clamp(
          target_state.source_states[target_state.i_selected].saturation +
            delta,
          SATURATION_BOUNDS
        );
      }
      break;
  }
}

// returns a list of change requests that should be executed to change our current_state to
// target_state
function list_required_operations() {
  const result: Array<() => Promise<void>> = [];
  // write will typically re-issue change requests until some success criterion evaluates to true
  // (typically keyword.status === keyword.command, but this may vary from case to case -- float- or
  // duration-valued keywords accept some finite mismatch by default, some keywords such as player
  // capacities specify custom success criteria). Here we'll override those criteria and have write
  // exit unconditionally after dispatching the first change request
  const exit_immediately = {
    criterion: "custom",
    validator: async () => true,
  } as const;

  const i_target = target_state.i_selected;
  const cc_target = ccs[i_target];
  // if the video source (v_src) currently reported by our sdi output doesn't agree with the source
  // previously selected through one of the keys 1,...,4, we'll send out an untimed switch request
  // (hence the switch_time: null) referring to our target source
  if (current_state.i_selected !== i_target) {
    result.push(() =>
      SDI_OUT.sdi.v_src.command.write(
        { source: cc_target.output, switch_time: null },
        { retry_until: exit_immediately }
      )
    );
  }
  // likewise, if the color correction instance hooked up to our selected video source currently reports
  // a hue value different from our target value, we'll tell it to change accordingly
  if (
    current_state.source_states[i_target].hue !==
    target_state.source_states[i_target].hue
  ) {
    result.push(() =>
      cc_target.yuv.hue_offset.write(target_state.source_states[i_target].hue, {
        retry_until: exit_immediately,
      })
    );
  }
  // same for saturation
  if (
    current_state.source_states[i_target].saturation !==
    target_state.source_states[i_target].saturation
  ) {
    result.push(() =>
      cc_target.yuv.saturation.write(
        target_state.source_states[i_target].saturation,
        { retry_until: exit_immediately }
      )
    );
  }
  return result;
}

async function maybe_start_busy_loop(cmd?: Command) {
  if (cmd) {
    update_target_state(cmd);
  }
  if (busy_loop_running) return; // let concurrently running busyloop update current_state for us
  busy_loop_running = true;
  try {
    // see if there's anything to do
    let required_operations = list_required_operations();
    while (required_operations.length !== 0 /* if yes: ... */) {
      // dispatch all those write operations and wait for them to succeed (which will be near-instantaneous,
      // as we're declaring all write operations successful no matter the outcome)
      await Promise.all(required_operations.map((f) => f()));
      // not elegant, but effective: wait for a short time, then check back if matters have improved
      await pause(new Duration(1, "ms"));
      required_operations = list_required_operations();
    }
  } catch (e) {
    console.log(`Some error occurred: ${e}`);
  } finally {
    // no need to keep running if there's no user input for a long while, so we'll allow this
    // function to terminate
    busy_loop_running = false;
  }
}

// execute once to ensure current_state agrees with target_state
await maybe_start_busy_loop();

// let's use our nominal frame duration; anything below that is rather pointless
const AUTOREPEAT_INTERVAL_MILLISECONDS = 20;

type Key = keyof IGlobalKeyDownMap;

// these timers will autorepeat hue/saturation increase/decrease commands as long as
// the corresponding keys are held pressed
const interval_timers = {
  E: null,
  D: null,
  R: null,
  F: null,
} as Record<Key, NodeJS.Timer | null>;

// enable this for debugging purposes, in case there's a typo in the keycode list or something
const CHECK_HID = (process.env["CHECK_HID"] ?? "false") === "true";

function on_keydown(key: Key) {
  if (CHECK_HID) console.log(`Got keydown event: ${key}`);
  const [cmd, autorepeat] = ((): [cmd: Command, autorepeat: boolean] => {
    switch (key) {
      case "0":
      case "1":
      case "2":
      case "3":
        return [{ kind: "select-video-source", i: parseInt(key) }, false];
      case "E":
        return [{ kind: "change-hue", dir: "increase" }, true];
      case "D":
        return [{ kind: "change-hue", dir: "decrease" }, true];
      case "R":
        return [{ kind: "change-saturation", dir: "increase" }, true];
      case "F":
        return [{ kind: "change-saturation", dir: "decrease" }, true];
    }
    return [{ kind: "select-video-source", i: target_state.i_selected }, false];
  })();
  if (autorepeat) {
    const maybe_timer = interval_timers[key];
    enforce(maybe_timer !== undefined);
    if (maybe_timer === null) {
      // timer already running: nothing do to
      interval_timers[key] = setInterval(
        () => maybe_start_busy_loop(cmd),
        AUTOREPEAT_INTERVAL_MILLISECONDS
      );
    } // if maybe_timer !== null, we'll just leave the previously created timer running
  } else {
    // don't autorepeat: dispatch one-off command
    maybe_start_busy_loop(cmd);
  }
}

function on_keyup(key: Key) {
  if (CHECK_HID) console.log(`Got keyup event: ${key}`);
  const maybe_timer = interval_timers[key];
  if (!!maybe_timer) {
    clearInterval(maybe_timer);
    console.log(`Clear timer for ${key}`);
    interval_timers[key] = null;
  }
}

let prev_keys: Set<Key> = new Set();

const kbd = new GlobalKeyboardListener();

kbd.addListener((_, down) => {
  const keys = new Set() as Set<Key>;
  for (const k in down) {
    const key = k as Key;
    if (down[key]) keys.add(key);
  }
  for (const key of keys) {
    if (!prev_keys.has(key)) on_keydown(key);
  }
  for (const prev_key of prev_keys) {
    if (!keys.has(prev_key)) on_keyup(prev_key);
  }
  prev_keys = keys;
});

console.log("Waiting for input...");
