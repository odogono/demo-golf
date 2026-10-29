import { vec3, type Vec3 } from "math";

const DEG = Math.PI / 180;
const UP: Vec3 = [0, 1, 0];

/** Where a camera sits, what it looks at, and its vertical field of view in degrees. */
export type Pose = { position: Vec3; target: Vec3; fov: number };

/** The two perspectives the player can toggle between while aiming. */
export type AimView = "behind" | "raised";

/** Tunable from the debug GUI. Angles are in degrees, distances in metres. */
export type RigSettings = {
  /** AimCam, behind view: low over the golfer's shoulder. */
  behindDistance: number;
  behindHeight: number;
  behindLookAhead: number;
  /** Height of the point it looks at, so tall Targets stay in view with the ball. */
  behindLookHeight: number;
  behindFov: number;
  /** AimCam, raised view: high behind the Tee, looking down the aim line. */
  raisedElevation: number;
  raisedDistance: number;
  raisedLookAhead: number;
  raisedFov: number;
  /** FlightCam: chases the ball from behind and above. */
  flightElevation: number;
  flightDistance: number;
  flightFov: number;
  /** ImpactCam: a wide orbit around the buildings. */
  impactRadius: number;
  impactHeight: number;
  impactLookHeight: number;
  impactOrbitSpeed: number;
  impactFov: number;
  /** Seconds a switch between cameras takes. */
  blendTime: number;
};

export const DEFAULT_RIGS: RigSettings = {
  behindDistance: 6,
  behindHeight: 2.5,
  behindLookAhead: 20,
  behindLookHeight: 3,
  behindFov: 60,
  raisedElevation: 50,
  raisedDistance: 55,
  raisedLookAhead: 18,
  raisedFov: 55,
  flightElevation: 50,
  flightDistance: 14,
  flightFov: 60,
  impactRadius: 40,
  impactHeight: 22,
  impactLookHeight: 6,
  impactOrbitSpeed: 10,
  impactFov: 55,
  blendTime: 0.4,
};

export function createPose(): Pose {
  return { position: vec3.create(), target: vec3.create(), fov: 60 };
}

export function copyPose(out: Pose, a: Pose): Pose {
  vec3.copy(out.position, a.position);
  vec3.copy(out.target, a.target);
  out.fov = a.fov;
  return out;
}

/** The horizontal direction a yaw points in; yaw 0 points down -z, as `Aim` does. */
export function yawDirection(out: Vec3, yaw: number): Vec3 {
  return vec3.set(out, -Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Places a camera `distance` from `target`, back along `dir` and tilted `elevation` degrees down at it. */
function lookDownAt(out: Pose, target: Vec3, dir: Vec3, elevation: number, distance: number, fov: number) {
  vec3.copy(out.target, target);
  vec3.scaleAndAdd(out.position, target, dir, -distance * Math.cos(elevation * DEG));
  vec3.scaleAndAdd(out.position, out.position, UP, distance * Math.sin(elevation * DEG));
  out.fov = fov;
  return out;
}

/** AimCam: behind the golfer, turned with the aim, so the aim line runs up the middle of the screen. */
export function aimPose(out: Pose, tee: Vec3, yaw: number, view: AimView, s: RigSettings): Pose {
  const dir = yawDirection(vec3.create(), yaw);
  if (view === "raised") {
    const target = vec3.scaleAndAdd(vec3.create(), tee, dir, s.raisedLookAhead);
    return lookDownAt(out, target, dir, s.raisedElevation, s.raisedDistance, s.raisedFov);
  }
  vec3.scaleAndAdd(out.position, tee, dir, -s.behindDistance);
  out.position[1] += s.behindHeight;
  vec3.scaleAndAdd(out.target, tee, dir, s.behindLookAhead);
  out.target[1] += s.behindLookHeight;
  out.fov = s.behindFov;
  return out;
}

/** FlightCam: behind and above the ball, along its horizontal heading. */
export function flightPose(out: Pose, ball: Vec3, velocity: Vec3, s: RigSettings): Pose {
  const dir = vec3.set(vec3.create(), velocity[0], 0, velocity[2]);
  if (vec3.length(dir) < 1e-3) vec3.set(dir, 0, 0, -1);
  vec3.normalize(dir, dir);
  return lookDownAt(out, ball, dir, s.flightElevation, s.flightDistance, s.flightFov);
}

/** ImpactCam: on a circle around `centre`, at `angle` radians from +z. */
export function impactPose(out: Pose, centre: Vec3, angle: number, s: RigSettings): Pose {
  vec3.set(
    out.position,
    centre[0] + Math.sin(angle) * s.impactRadius,
    centre[1] + s.impactHeight,
    centre[2] + Math.cos(angle) * s.impactRadius,
  );
  vec3.set(out.target, centre[0], centre[1] + s.impactLookHeight, centre[2]);
  out.fov = s.impactFov;
  return out;
}

/** The angle on ImpactCam's circle nearest a camera at `position`, so the orbit starts where the camera already is. */
export function orbitAngle(centre: Vec3, position: Vec3): number {
  return Math.atan2(position[0] - centre[0], position[2] - centre[2]);
}

export function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  vec3.lerp(out.position, a.position, b.position, t);
  vec3.lerp(out.target, a.target, b.target, t);
  out.fov = a.fov + (b.fov - a.fov) * t;
  return out;
}

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
