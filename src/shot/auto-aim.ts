import { vec3, type Vec3 } from "math";
import { clampAim, launchVelocity, MAX_LOFT, MIN_LOFT, type Aim } from "./aim";
import type { BallType } from "./ball-types";
import { predictTrajectory } from "./trajectory";

const DEG = Math.PI / 180;

/**
 * The aim and power, in [0, 1], whose predicted flight from `from` passes
 * closest to `target`. Searches loft and power on a grid, preferring the
 * flatter, harder shot when two come equally close. Ignores collisions, so a
 * shot can still clip something on the way.
 */
export function autoAim(from: Vec3, target: Vec3, type: BallType): { aim: Aim; power: number; miss: number } {
  const yaw = Math.atan2(-(target[0] - from[0]), -(target[2] - from[2]));
  const velocity = vec3.create();
  let best = { aim: clampAim({ yaw, loft: 0 }), power: 1, miss: Infinity };
  for (let loft = MIN_LOFT; loft <= MAX_LOFT; loft += DEG) {
    for (let power = 1; power >= 0.3; power -= 0.05) {
      const aim = clampAim({ yaw, loft });
      launchVelocity(velocity, aim, power * type.maxSpeed);
      const points = predictTrajectory(from, velocity, { drag: type.drag, duration: 5 });
      let miss = Infinity;
      for (const p of points) miss = Math.min(miss, vec3.distance(p, target));
      // Only a clearly closer shot beats a flatter or harder one found earlier.
      if (miss < best.miss - 0.05) best = { aim, power, miss };
    }
  }
  return best;
}
