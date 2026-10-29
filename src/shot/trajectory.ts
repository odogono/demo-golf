import { vec3, type Vec3 } from "math";
import { STEP } from "../loop";

export type TrajectoryOptions = {
  gravity?: Vec3;
  /** Linear damping, matching the ball type's `drag`. */
  drag?: number;
  /** Simulation step in seconds; the game loop's by default. */
  dt?: number;
  /** Seconds of flight to predict. */
  duration?: number;
  /** The preview stops when the point's height drops below this. */
  floorY?: number;
};

/**
 * Predicts a ball's flight from `origin`, ignoring collisions. It integrates
 * the way the physics does (gravity, then damping, then position) so the preview
 * follows the real ball until it hits something.
 */
export function predictTrajectory(
  origin: Vec3,
  velocity: Vec3,
  { gravity = [0, -9.81, 0], drag = 0, dt = STEP, duration = 4, floorY = 0 }: TrajectoryOptions = {},
): Vec3[] {
  const position = vec3.clone(origin);
  const v = vec3.clone(velocity);
  const points: Vec3[] = [vec3.clone(position)];
  for (let t = 0; t < duration; t += dt) {
    vec3.scaleAndAdd(v, v, gravity, dt);
    vec3.scale(v, v, Math.max(0, 1 - drag * dt));
    vec3.scaleAndAdd(position, position, v, dt);
    if (position[1] < floorY) break;
    points.push(vec3.clone(position));
  }
  return points;
}
