import { vec3, type Vec3 } from "math";
import { createShotInput } from "./input/shot-input";
import { createFixedLoop } from "./loop";
import { createCrashcatWorld } from "./physics/crashcat";
import type { BodyId } from "./physics/PhysicsWorld";
import { createScene } from "./render/scene";
import { createShotView } from "./render/shot-view";
import { createStructureOverlay } from "./render/structure-overlay";
import { launchVelocity } from "./shot/aim";
import { BALL_TYPES, type BallType } from "./shot/ball-types";
import { createPowerMeter } from "./shot/power-meter";
import { TEE, launchBall } from "./shot/shot";
import { predictTrajectory } from "./shot/trajectory";
import { createStructure } from "./structure/structure";

/** Seconds a Shot may run before the next is allowed, even if the ball still moves. */
const SETTLE_TIMEOUT = 8;

const rig = createScene(document.body);
const world = createCrashcatWorld();
world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
// The Target stand-in: a static box matching the placeholder mesh in scene.ts.
world.addBody({ shape: { kind: "box", halfExtents: [4, 10, 4] }, motion: "static", position: [0, 10, -10] });

const view = createShotView(rig.scene, document.body, TEE);
const meter = createPowerMeter();
let ballType: BallType = BALL_TYPES.standard;
let ball: BodyId | undefined;
let flightTime = 0;
let previewPower = 0.6;
let strokes = 0;
const previous: Vec3 = [TEE[0], TEE[1] + ballType.radius, TEE[2]];
const current: Vec3 = vec3.clone(previous);
const shown = vec3.create();

function resetBall() {
  if (ball !== undefined) world.removeBody(ball);
  ball = undefined;
  vec3.set(current, TEE[0], TEE[1] + ballType.radius, TEE[2]);
  vec3.copy(previous, current);
  view.setBallType(ballType);
}

const input = createShotInput(rig.renderer.domElement, meter, {
  onRelease(power) {
    if (ball !== undefined || power <= 0) return;
    previewPower = power;
    const velocity = launchVelocity(vec3.create(), input.aim, power * ballType.maxSpeed);
    ball = launchBall(world, ballType, velocity);
    flightTime = 0;
    strokes++;
  },
  onBallType(id) {
    if (ball !== undefined) return;
    ballType = BALL_TYPES[id];
    resetBall();
  },
});
resetBall();

const loop = createFixedLoop((dt) => {
  input.update(dt);
  world.step(dt);
  vec3.copy(previous, current);
  if (ball === undefined) return;
  vec3.copy(current, world.getPosition(ball));
  flightTime += dt;
  if (world.isSettled() || flightTime > SETTLE_TIMEOUT || current[1] < -5) resetBall();
});

// Debug: show the Structure grids. Press G to toggle them.
const structures = [
  createStructure({ origin: [-4, 0, -14], size: [8, 20, 8] }),
  createStructure({ origin: [8, 0, -12], size: [6, 12, 6] }),
];
const overlays = structures.map((s) => createStructureOverlay(s));
for (const overlay of overlays) rig.scene.add(overlay.mesh);
window.addEventListener("keydown", (e) => {
  if (e.key !== "g") return;
  for (const overlay of overlays) overlay.mesh.visible = !overlay.mesh.visible;
});

const previewVelocity = vec3.create();
let last = performance.now();
rig.renderer.setAnimationLoop((now) => {
  const alpha = loop.advance((now - last) / 1000);
  last = now;

  view.setBallPosition(vec3.lerp(shown, previous, current, alpha));
  view.setPower(meter.power);
  if (ball === undefined) {
    const power = meter.held ? meter.power : previewPower;
    launchVelocity(previewVelocity, input.aim, power * ballType.maxSpeed);
    view.setPreview(predictTrajectory(current, previewVelocity, { drag: ballType.drag }));
  } else {
    view.setPreview(undefined);
  }
  view.setLabel(
    `${ballType.name} ball · Strokes ${strokes} · A/D or drag: aim · W/S: loft · hold Space: power · 1/2: ball`,
  );

  rig.renderer.render(rig.scene, rig.camera);
});
