import { AT1130, VM } from "vapi";
import { Duration, enforce, pause } from "vscript";
import { calibration_freerun, VAPI_BLADE } from "./globals.js";
import * as fs from "fs";
import { sh } from "vutil";

const vm = await VM.open({
  ip: VAPI_BLADE,
  towel: "vapi"
  /* we'll place a "towel" so other vapi users with a different towel identifier will be
   * gently discouraged from trying to control the machine at the same time */
});

// vm now holds a view object representing either an at300 (internally called AT1130) or the 40GbE
// model AT1101. The keyword APIs offered by these models are largely similar, but differ in some
// places such as the genlock subsystem. While TypeScript is very good at figuring out the common
// parts and allowing us to control those directly, we'll use vscript's enforce() helper method to
// terminate if the vm in question is not an at300. The TypeScript compiler understands that enforce
// will not return unless its argument is truthy, so in what follows it will correctly deduce that
// vm refers to an at300

enforce(vm instanceof AT1130.Root);
// to interactively explore our keyword api, type "vm.", then hit Command-I (or Control-Space on
// Linux) with the cursor placed right next to vm (i.e., vm.| ) You should see an autocompletion
// menu offering a list of components, some of which may or may not exist, depending on what
// application is currently running on vm (those optional components are marked with a '?').

// vm. <- try this for autocompletion

// One component that is always available is the 'system'
// component, so let's try to use that now to read the system's current uptime

const uptime = await vm.system.sysinfo.uptime.read();

// since uptime refers to a duration-like quantity, it is represented in terms of VScript's Duration
// helper class. Let's stringify and print it:
console.log(`vm's current uptime is ${uptime.toString()}`);

// there's more stuff we can do with keywords; we can 'watch' them, executing a callback every time
// the keyword is being updated by the blade's operating software, we can 'wait_until' some
// condition is fulfilled, or (unless the keyword in case is readonly) we can change it via 'write'.
// Let's wait until the system's uptime, measured in seconds, is divisible by 3:

const uptime_div3 = await vm.system.sysinfo.uptime.wait_until(
  (cur_uptime) => Math.round(cur_uptime.s()) % 3 === 0,
  {
    // wait_until fails if the specified condition doesn't evaluate to true within some finite
    // timeout, so let's better make sure that timeout is longer than 3 seconds
    timeout: new Duration(5, "s"),
  }
);

console.log(`vm's divisible-by-3 uptime is ${uptime_div3.toString()}`);

// to monitor a keyword indefinitely, use watch(). This returns a listener object that can later be
// destroyed to remove the associated listener from node's event loop
const info_watcher = await vm.system.usrinfo.short_desc.watch(
  (new_description) => console.log(`System description: ${new_description}`)
);

// let's now change short_desc and see if info_watcher notices:
await vm.system.usrinfo.short_desc.write(
  `some random number: ${Math.round(100000 * Math.random())}`
);
await pause(new Duration(1, "s"));
// supposedly there was some terminal output along the lines of 'System description: some random
// number: <...>'. Let's get rid of info_watcher now:
info_watcher.unwatch();

await vm.system.usrinfo.short_desc.write(
  `some random number: ${Math.round(100000 * Math.random())}`
);
// this time there should be no more console output
await pause(new Duration(1, "s"));

// let's now assume we want to work with one of the optional components, say video_signal_generator
// and monitoring. At this point, both will evaluate to <component_type> | undefined:
const maybe_monitoring = vm.monitoring;
// because maybe_monitoring might be undefined, TypeScript won't let us use it to access
// monitoring's data members:

// const liveview_illegal_access = maybe_monitoring.live_view; // <- uncomment this line to see a compiler error

// to resolve this, we can either enclose the code we wish to execute in a null-check (TypeScript is
// smart enough to figure out the rest)
if (maybe_monitoring) {
  const liveview = maybe_monitoring.live_view; // this is legal
  void liveview; // this is to silence TypeScript's warning about liveview being unused
}
// alternatively, if we're certain that the component in question exists (say, because we're running
// an AVP_100GbE build and no one is allowed to change that fact) we can again use enforce(). This
// way, we'll be allowed to use all of the guaranteed-to-exist components in the remainder of our
// script without further existence checks:
enforce(!!vm.monitoring /* !! converts to bool, ... */);
// ...alternatively, we could explicitly compare against undefined:
enforce(vm.video_signal_generator !== undefined);
// video signal generation requires a stable genlock, so we'll call a helper method that sets the
// PTP clock to free-run mode, and locks genlock #0 to the ptp clock
console.log("Waiting for genlock #0 to calibrate...");
await calibration_freerun(vm);

// Let's now set the video signal generator to HD1080p50, and have it emit colorbars:
const vsg = vm.video_signal_generator.instances.row(
  0 /* there are 2 independent signal generators on the at300, we'll go with instance #0 */
);
// note that, thanks to TypeScript's support for string enums, the editor will offer us a list of
// available video standards when asked to autocomplete within write's string argument. Entering
// some non-supported value will immediately produce a compiler error
await vsg.standard.command.write("HD1080p50");

// await vsg.standard.command.write("HD1080p70"); // <- TypeScript won't allow this (note the red squiggles if you uncomment this line)

// same here: delete everything within the quotes and press Command-I to autocomplete. You should be
// offered a list of the three available options Colorbars100, Counters and RP198
await vsg.pattern.write("Colorbars100");

// live_view.v_src expects to be given a video essence, so vsg.output will be accepted
await vm.monitoring.live_view.v_src.command.write(vsg.output);

// anything else, such as an audio essence, or a number, will immediately be refused:
// await vm.monitoring.live_view.v_src.command.write(7); // <- shouldn't compile

// to conclude part #0, let's set up a thumbnail listener to receive the JPEG thumbnails generated
// by monitoring.live_view and display them in a floating window. This part is version-agnostic and
// hence not exposed by the (version-specific) VAPI layer, but by the underlying VScript layer and
// its VSocket object representing a WebSocket connection to a blade running some version of our
// operating software. Using vm, we can access the underlying VSocket using vm.raw:

let did_show_thumbnail = false;
const thumbnail_listener = vm.raw.register_thumbnail_listener(
  (jpg_data: Buffer) => {
    // this callback will be invoked for every frame sent out by live_view.monitoring.
    // In other cases we'd probably want to process all of them, but here we'd just receive
    // the same colorbars again and again, so let's do cancel the listener after receiving
    // our first frame:
    thumbnail_listener.unregister();
    // we'll end this demo by saving the file to disk, and having imagemagick show it in a floating
    // window (not pretty, but functional)
    const filename = "/tmp/vapi_0_thumbnail.jpg";
    console.log(`Got thumbnail JPEG, saving to ${filename}...`);
    fs.writeFileSync(filename, jpg_data);
    // sh waits for the invoked process to exit, so once you close the window showing the captured
    // thumbnail image, did_show_thumbnail will be set to true, causing the script to exit at
    // most 50ms later (see below)
    sh(`${process.platform === "linux" ? "display" : "open"} ${filename}`).then(
      () => (did_show_thumbnail = true)
    );
  }
);

// in production code we'd probably turn the above thumbnail listener logic into a promise
// and resolve after sh(...) has completed; here, we'll just poll for a while
while (!did_show_thumbnail) {
  await pause(new Duration(50, "ms"));
}
// close our connection to vm and destroy all active event listeners; this will cause node.js to
// terminate
await vm.close();
