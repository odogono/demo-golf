export const STEP = 1 / 60;
const MAX_FRAME = 0.25;

/**
 * Fixed-timestep accumulator. `advance` runs as many whole steps as the
 * elapsed time allows and returns the leftover fraction of a step, for
 * interpolating rendering between the last two states.
 */
export function createFixedLoop(step: (dt: number) => void) {
  let accumulator = 0;
  return {
    advance(elapsed: number): number {
      accumulator += Math.min(elapsed, MAX_FRAME);
      while (accumulator >= STEP) {
        step(STEP);
        accumulator -= STEP;
      }
      return accumulator / STEP;
    },
  };
}
