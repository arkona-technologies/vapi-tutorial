import { AT1130, VM } from "vapi";
import { enforce, enforce_nonnull } from "vscript";
import { calibration_freerun, SDI_OUT_INDEX, VAPI_BLADE } from "./globals.js";
import { load_demo_content } from "./utilities.js";

// we'll prepare some demo content for 3_basic_control.ts to use; this time we'll stuff most of our
// logic into an external module (see ./utilities.ts) so it can be reused from within
// 3_basic_control.ts

const vm = await VM.open({
  ip: VAPI_BLADE,
  towel: "vapi",
});

enforce(vm instanceof AT1130.Root);
const io = enforce_nonnull(vm.i_o_module);
await calibration_freerun(vm);
await io.configuration.row(SDI_OUT_INDEX).direction.write("Output", {
  retry_until: {
    criterion: "custom",
    validator: async () => await io.output.is_allocated(SDI_OUT_INDEX)
  }
});
const { testseq_player } = await load_demo_content(vm, true);
await io.output.row(SDI_OUT_INDEX).sdi.v_src.command.write({
  source: testseq_player.output.video,
  switch_time: null
});
console.log("done");
await vm.close();
