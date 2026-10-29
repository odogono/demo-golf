import { vec3, type Vec3 } from "math";
import {
  aimPose,
  blendPose,
  copyPose,
  createPose,
  flightPose,
  impactPose,
  orbitAngle,
  smoothstep,
  type AimView,
  type Pose,
  type RigSettings,
} from "./rigs";

export type CameraMode = "AimCam" | "FlightCam" | "ImpactCam";

/** What the cameras follow this frame. */
export type CameraInput = {
  tee: Vec3;
  yaw: number;
  /** The ball, while it's in flight. */
  ball?: Vec3;
  velocity?: Vec3;
};

const DEG = Math.PI / 180;

/**
 * Picks the camera for each moment of a Shot and blends between them:
 * AimCam while aiming, FlightCam once the ball is struck, ImpactCam from the
 * first Blast, then AimCam again when the next Shot is ready.
 */
export function createCameraDirector(settings: RigSettings) {
  let mode: CameraMode = "AimCam";
  let view: AimView = "behind";
  const current = createPose();
  const from = createPose();
  const desired = createPose();
  let blend = 1;
  let started = false;
  const impactCentre = vec3.create();
  let impactAngle = 0;
  const lastBall = vec3.create();
  const lastVelocity: Vec3 = [0, 0, -1];

  function switchTo(next: CameraMode) {
    mode = next;
    copyPose(from, current);
    blend = 0;
  }

  return {
    settings,
    get mode() {
      return mode;
    },
    get view() {
      return view;
    },

    /** Switches AimCam between the behind and raised views. Does nothing outside AimCam. */
    toggleView() {
      if (mode !== "AimCam") return;
      view = view === "behind" ? "raised" : "behind";
      switchTo("AimCam");
    },

    /** The ball has been struck. */
    shoot() {
      if (mode === "AimCam") switchTo("FlightCam");
    },

    /**
     * The first Blast of a Shot: orbit `centre`. Later Blasts, and Blasts from
     * falling Fragments while aiming, change nothing.
     */
    impact(centre: Vec3) {
      if (mode !== "FlightCam") return;
      vec3.copy(impactCentre, centre);
      impactAngle = orbitAngle(centre, current.position);
      switchTo("ImpactCam");
    },

    /** The scene has Settled and the next Shot is ready. */
    reset() {
      if (mode !== "AimCam") switchTo("AimCam");
    },

    update(dt: number, input: CameraInput): Pose {
      if (input.ball) vec3.copy(lastBall, input.ball);
      if (input.velocity) vec3.copy(lastVelocity, input.velocity);

      if (mode === "AimCam") aimPose(desired, input.tee, input.yaw, view, settings);
      else if (mode === "FlightCam") flightPose(desired, lastBall, lastVelocity, settings);
      else {
        impactAngle += settings.impactOrbitSpeed * DEG * dt;
        impactPose(desired, impactCentre, impactAngle, settings);
      }

      if (!started) {
        // The first frame has nothing to blend from.
        started = true;
        return copyPose(current, desired);
      }
      blend = Math.min(1, blend + dt / Math.max(1e-3, settings.blendTime));
      blendPose(current, from, desired, smoothstep(blend));
      // FlightCam keeps the ball centred from the start; only its position blends in.
      if (mode === "FlightCam") vec3.copy(current.target, desired.target);
      return current;
    },
  };
}

export type CameraDirector = ReturnType<typeof createCameraDirector>;
