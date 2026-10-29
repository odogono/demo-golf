import { expect, test } from "bun:test";
import { vec3, type Vec3 } from "math";
import { createCameraDirector } from "../src/camera/director";
import { DEFAULT_CAMERA_FX, createShake, createSlowMotion, hitsSoon, shakeAmount } from "../src/camera/fx";
import { DEFAULT_RIGS, aimPose, createPose, flightPose, impactPose, orbitAngle } from "../src/camera/rigs";

const TEE: Vec3 = [0, 0, 18];
const DEG = Math.PI / 180;

/** Degrees the camera looks below the horizon. */
function pitch(pose: ReturnType<typeof createPose>): number {
  const d = vec3.sub(vec3.create(), pose.target, pose.position);
  return Math.atan2(-d[1], Math.hypot(d[0], d[2])) / DEG;
}

test("the behind view sits behind the Tee and looks down the aim line", () => {
  const pose = aimPose(createPose(), TEE, 0, "behind", DEFAULT_RIGS);
  expect(pose.position[2]).toBeGreaterThan(TEE[2]);
  expect(pose.position[0]).toBeCloseTo(0);
  expect(pose.target[2]).toBeLessThan(TEE[2]);
});

test("the raised view is directly behind the Tee, tilted to its angle", () => {
  const pose = aimPose(createPose(), TEE, 0, "raised", DEFAULT_RIGS);
  expect(pose.position[0]).toBeCloseTo(0);
  expect(pose.position[2]).toBeGreaterThan(TEE[2]);
  expect(pitch(pose)).toBeCloseTo(DEFAULT_RIGS.raisedElevation);
});

test("AimCam turns with the aim", () => {
  const yaw = 30 * DEG;
  const pose = aimPose(createPose(), TEE, yaw, "raised", DEFAULT_RIGS);
  const look = vec3.sub(vec3.create(), pose.target, pose.position);
  // Yaw turns left, toward -x, as `launchVelocity` does.
  expect(Math.atan2(-look[0], -look[2])).toBeCloseTo(yaw);
});

test("FlightCam chases the ball from behind and above", () => {
  const ball: Vec3 = [0, 10, 0];
  const pose = flightPose(createPose(), ball, [10, 5, 0], DEFAULT_RIGS);
  expect(pose.target).toEqual(ball);
  expect(pose.position[0]).toBeLessThan(0);
  expect(pitch(pose)).toBeCloseTo(DEFAULT_RIGS.flightElevation);
  expect(vec3.distance(pose.position, ball)).toBeCloseTo(DEFAULT_RIGS.flightDistance);
});

test("ImpactCam starts its orbit where the camera already is", () => {
  const centre: Vec3 = [2, 0, -13];
  const angle = orbitAngle(centre, [20, 30, 10]);
  const pose = impactPose(createPose(), centre, angle, DEFAULT_RIGS);
  const from = Math.atan2(20 - centre[0], 10 - centre[2]);
  expect(Math.atan2(pose.position[0] - centre[0], pose.position[2] - centre[2])).toBeCloseTo(from);
});

test("the director moves from aiming to flight to impact and back", () => {
  const director = createCameraDirector({ ...DEFAULT_RIGS });
  const input = { tee: TEE, yaw: 0 };
  director.update(0.016, input);
  expect(director.mode).toBe("AimCam");

  director.impact([0, 0, 0]);
  expect(director.mode).toBe("AimCam");

  director.shoot();
  expect(director.mode).toBe("FlightCam");
  director.toggleView();
  expect(director.view).toBe("behind");

  director.impact([0, 0, -13]);
  expect(director.mode).toBe("ImpactCam");
  director.reset();
  expect(director.mode).toBe("AimCam");
});

test("the director blends between cameras and remembers the view", () => {
  const director = createCameraDirector({ ...DEFAULT_RIGS, blendTime: 0.4 });
  const input = { tee: TEE, yaw: 0 };
  const behind = vec3.clone(director.update(0.016, input).position);
  director.toggleView();
  const raised = aimPose(createPose(), TEE, 0, "raised", DEFAULT_RIGS).position;
  const halfway = vec3.clone(director.update(0.2, input).position);
  expect(vec3.distance(halfway, behind)).toBeGreaterThan(0.1);
  expect(vec3.distance(halfway, raised)).toBeGreaterThan(0.1);
  expect(director.update(0.3, input).position).toEqual(raised);

  director.shoot();
  director.reset();
  expect(director.view).toBe("raised");
});

test("shake grows with the Blast and fades with distance", () => {
  const s = DEFAULT_CAMERA_FX;
  expect(shakeAmount(4, 400, 10, s)).toBeGreaterThan(shakeAmount(1, 50, 10, s));
  expect(shakeAmount(1, 50, 5, s)).toBeGreaterThan(shakeAmount(1, 50, 50, s));
  const shake = createShake(s);
  shake.add(0.8);
  expect(vec3.length(shake.update(vec3.create(), 0.01))).toBeGreaterThan(0);
  shake.update(vec3.create(), 2);
  expect(shake.trauma).toBe(0);
});

test("slow motion runs once a Shot, then eases back", () => {
  const s = { ...DEFAULT_CAMERA_FX, slowScale: 0.3, slowHold: 0.6, slowEase: 0.2 };
  const slow = createSlowMotion(s);
  expect(slow.update(0.1)).toBe(1);
  slow.trigger();
  expect(slow.update(0.1)).toBe(0.3);
  expect(slow.update(0.6)).toBeCloseTo(0.3 + 0.7 * 0.5);
  expect(slow.update(0.2)).toBe(1);
  slow.trigger();
  expect(slow.update(0.1)).toBe(1);
  slow.reset();
  slow.trigger();
  expect(slow.update(0.1)).toBe(0.3);
});

test("a hit is foreseen only when it's within the lead time", () => {
  const box = { min: [-4, 0, -14] as Vec3, max: [4, 20, -6] as Vec3 };
  expect(hitsSoon([0, 5, -2], [0, 0, -20], [box], 0.25, 0)).toBe(true);
  expect(hitsSoon([0, 5, 10], [0, 0, -20], [box], 0.25, 0)).toBe(false);
});
