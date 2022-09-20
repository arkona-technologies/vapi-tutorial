import * as fs from "fs";
import { AT1130, VM } from "vapi";
import { Duration, enforce, enforce_nonnull, pause } from "vscript";
import { sh } from "vutil";
import { calibration_freerun, VAPI_BLADE } from "./globals.js";

const vm = await VM.open({
  ip: VAPI_BLADE,
  towel: "vapi",
});

enforce(vm instanceof AT1130.Root);
await calibration_freerun(vm);

const i_o_module = enforce_nonnull(vm.i_o_module);

// our blade is connected to several SDI sources that we suspect might be out of sync
// (in fact: they are, because the rest of our IBC setup is PTP-synchronized, whereas
// we just configured our API blade to be free-running).
//
// Perhaps we haven't set up a vtelemetry instance yet, or we'd like to perform some custom
// one-off analysis, so a more convenient route might be to explicitly watch a number of
// keywords we are interested in. There are at least 2 convenient routes to do so:
//
// 1. we may use the vapi library to set up a number of watchpoints, and stream out the
//    incoming data; here, we'll be writing tsv files that can conveniently be displayed
//    and analyzed using the free kst2 tool -- this is what we'll do here
//
// 2. alternatively, there's a free command-line tool called vsk that walks the state described by
//    http[s]://<blade-ip>/data/schema.json, and automatically sets up watchpoints for all keywords
//    matching a user-supplied regular expression. This way, one-off monitoring sessions for all of
//    a blade's SDI inputs could be set up as follows: vsk tabulate <blade-ip>
//    'i_o_module.*sdi.*media_clock\.offset\.value' (feel free to try this using the copy of vsk
//    stored at ibc2022/vapi/vsk)

const FILENAME_OUT = "/tmp/sdi-offsets.tsv";

const sdi_input = i_o_module.input.row(0);

const data: Array<[timestamp_s: number, offset_s: number]> = [];

// in this demo we'll be monitoring SDI input 0. Every time a new data point
// arrives...
sdi_input.sdi.output.video.media_clock.offset.watch((maybe_offset) => {
  if (maybe_offset) {
    // ...we'll discard the associated error estimate, and log the estimated
    // value both to stdout...
    console.log("Offset from PTP:", maybe_offset.value.toString("precise"));
    // ...and to an array that we'll later...
    data.push([new Date().valueOf() / 1000, maybe_offset.value.s()]);
  }
});

await pause(new Duration(10, "s"));

// ...save to disk...
fs.writeFileSync(
  FILENAME_OUT,
  "t,sdi_offset\ns,s\n" +
    data.map(([ts, offset]) => `${ts},${offset}`).join("\n")
);

// ...plot using a free data analysis program called kst2 (gnuplot would
// be another fine choice; alternatively, you may want to log your data
// to a timeseries database, as we do with our free vtelemetry package)
const kst_path = await (async () => {
  const default_path = await sh(`which kst2`, { fail_on_error: false });
  if (default_path.err === null) return default_path.stdout.trim();
  return "/Users/arkona/Downloads/kst2.app/Contents/MacOS/kst2";
})();
await sh(`${kst_path} monitoring.kst`);
await vm.close();
