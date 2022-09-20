import { AT1130 } from "vapi";
import { Duration, enforce } from "vscript";

export const VAPI_BLADE = "172.16.233.2";

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
