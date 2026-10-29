import { vec3, type Vec3 } from "math";

/** Radians. Yaw 0 points down -z, from the Tee toward the Target; positive turns left. */
export type Aim = { yaw: number; loft: number };

const DEG = Math.PI / 180;
export const MAX_YAW = 45 * DEG;
export const MIN_LOFT = 0;
export const MAX_LOFT = 70 * DEG;

export function clampAim(aim: Aim): Aim {
  return {
    yaw: Math.min(MAX_YAW, Math.max(-MAX_YAW, aim.yaw)),
    loft: Math.min(MAX_LOFT, Math.max(MIN_LOFT, aim.loft)),
  };
}

/** The ball's launch velocity for an aim and a speed in m/s. */
export function launchVelocity(out: Vec3, aim: Aim, speed: number): Vec3 {
  const horizontal = Math.cos(aim.loft) * speed;
  return vec3.set(
    out,
    -Math.sin(aim.yaw) * horizontal,
    Math.sin(aim.loft) * speed,
    -Math.cos(aim.yaw) * horizontal,
  );
}
