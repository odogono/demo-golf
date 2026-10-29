/**
 * A hold-and-release power meter. While held, power climbs from 0 to 1 over
 * `period` seconds, falls back to 0 over the next `period`, and repeats.
 * Releasing returns the power at that moment.
 */
export function createPowerMeter(period = 1.2) {
  let held = false;
  let time = 0;

  return {
    get held() {
      return held;
    },
    /** Current power in [0, 1]; 0 when not held. */
    get power() {
      if (!held) return 0;
      const t = (time / period) % 2;
      return t <= 1 ? t : 2 - t;
    },
    press() {
      if (held) return;
      held = true;
      time = 0;
    },
    update(dt: number) {
      if (held) time += dt;
    },
    /** Returns the power to shoot with, or undefined if the meter wasn't held. */
    release(): number | undefined {
      if (!held) return undefined;
      const power = this.power;
      held = false;
      return power;
    },
    cancel() {
      held = false;
    },
  };
}

export type PowerMeter = ReturnType<typeof createPowerMeter>;
