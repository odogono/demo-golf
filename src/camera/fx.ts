import { vec3, type Vec3 } from "math";
import { predictTrajectory } from "../shot/trajectory";

/** Tunable from the debug GUI. */
export type CameraFxSettings = {
  /** Metres the camera moves at full shake. */
  shakeOffset: number;
  /** Shake added by a Blast of radius × power equal to this, at no distance. */
  shakeReference: number;
  /** Metres from the camera at which a Blast's shake halves. */
  shakeFalloff: number;
  /** Shake lost per second. */
  shakeDecay: number;
  /** Time runs this fast during slow motion. */
  slowScale: number;
  /** Real seconds slow motion holds before easing back. */
  slowHold: number;
  /** Real seconds it takes to ease back to full speed. */
  slowEase: number;
  /** Seconds before a predicted hit that slow motion starts. */
  slowLead: number;
};

export const DEFAULT_CAMERA_FX: CameraFxSettings = {
  shakeOffset: 0.6,
  shakeReference: 300,
  shakeFalloff: 30,
  shakeDecay: 1.5,
  slowScale: 0.3,
  slowHold: 0.6,
  slowEase: 0.25,
  slowLead: 0.25,
};

/** How much shake a Blast adds, in [0, 1]: more for bigger Blasts, less the further they are from the camera. */
export function shakeAmount(radius: number, power: number, distance: number, s: CameraFxSettings): number {
  const size = Math.min(1, (radius * power) / s.shakeReference);
  return size / (1 + distance / s.shakeFalloff);
}

/** Camera shake as "trauma": Blasts add to it, it decays, and the offset grows with its square. */
export function createShake(s: CameraFxSettings) {
  let trauma = 0;
  let time = 0;
  return {
    get trauma() {
      return trauma;
    },
    add(amount: number) {
      trauma = Math.min(1, trauma + amount);
    },
    /** Advances by `dt` real seconds and writes this frame's offset. */
    update(out: Vec3, dt: number): Vec3 {
      time += dt;
      trauma = Math.max(0, trauma - s.shakeDecay * dt);
      const k = trauma * trauma * s.shakeOffset;
      return vec3.set(
        out,
        k * Math.sin(time * 47.3) * Math.cos(time * 13.1),
        k * Math.sin(time * 39.7 + 1.3) * Math.cos(time * 17.9),
        k * Math.sin(time * 43.1 + 2.1) * Math.cos(time * 11.3),
      );
    },
  };
}

/** Slow motion just before impact, at most once per Shot. */
export function createSlowMotion(s: CameraFxSettings) {
  let elapsed = 0;
  let state: "ready" | "running" | "spent" = "ready";
  return {
    get active() {
      return state === "running";
    },
    /** Starts slow motion, unless it has already run this Shot. */
    trigger() {
      if (state !== "ready") return;
      state = "running";
      elapsed = 0;
    },
    /** A new Shot may slow down again. */
    reset() {
      state = "ready";
    },
    /** Advances by `dt` real seconds and returns how fast simulated time runs. */
    update(dt: number): number {
      if (state !== "running") return 1;
      elapsed += dt;
      if (elapsed < s.slowHold) return s.slowScale;
      const t = Math.min(1, (elapsed - s.slowHold) / Math.max(1e-3, s.slowEase));
      if (t >= 1) state = "spent";
      return s.slowScale + (1 - s.slowScale) * t;
    },
  };
}

/** An axis-aligned box, such as a Building's footprint and height. */
export type Box = { min: Vec3; max: Vec3 };

/** Whether a ball at `position` moving at `velocity` will reach any box within `lead` seconds. */
export function hitsSoon(position: Vec3, velocity: Vec3, boxes: Box[], lead: number, drag: number): boolean {
  const points = predictTrajectory(position, velocity, { drag, duration: lead, floorY: -Infinity });
  return points.some((p) =>
    boxes.some(
      (b) =>
        p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2],
    ),
  );
}
