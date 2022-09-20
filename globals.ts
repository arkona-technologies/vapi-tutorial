import { AT1130 } from "vapi";
import * as fs from "fs";
import { Duration, enforce } from "vscript";

export const VAPI_BLADE: string = fs.readFileSync("./blade_ip").toString() ?? "";
//export const VAPI_BLADE = process.env["BLADE"]?? "";

export const SDI_OUT_INDEX = 6;

export async function calibration_freerun(vm: AT1130.Root) {
   enforce(!!vm.genlock);
   await vm.p_t_p_clock.mode.write("UseInternalOscillator");
   const genlock = vm.genlock.instances.row(0);
   await genlock.t_src.command.write(vm.p_t_p_clock.output);
   const timeout = new Duration(1, "min");
   await genlock.lanes.video_f50_ish.wait_until((x) => x?.state === "Calibrated", {
      timeout,
   });
}
