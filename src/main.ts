import GUI from "lil-gui";
import { vec3, type Vec3 } from "math";
import { createBuildings, type BlastOutcome, type StructurePort } from "./damage/buildings";
import { createDamage, DEFAULT_DAMAGE } from "./damage/damage";
import { createDebris } from "./damage/debris";
import type { CsgReply, CsgRequest } from "./fx/bite";
import { createBuildingViews } from "./fx/building-view";
import { createDebrisView } from "./fx/debris-view";
import { createDust } from "./fx/dust";
import { createShotInput } from "./input/shot-input";
import { createFixedLoop } from "./loop";
import { createCrashcatWorld } from "./physics/crashcat";
import { createScene } from "./render/scene";
import { createShotView } from "./render/shot-view";
import { createStructureOverlay } from "./render/structure-overlay";
import { launchVelocity } from "./shot/aim";
import { BALL_TYPES, type BallType } from "./shot/ball-types";
import { createPowerMeter } from "./shot/power-meter";
import { TEE, launchBall } from "./shot/shot";
import { predictTrajectory } from "./shot/trajectory";
import type { StructureOptions } from "./structure/structure";
import { startWorker, workerPort } from "./worker-port";

/** Seconds a Shot may run before the next is allowed, even if the ball still moves. */
const SETTLE_TIMEOUT = 8;

/** The Target, then a Neighbour. */
const BUILDINGS: StructureOptions[] = [
  { origin: [-4, 0, -14], size: [8, 20, 8] },
  { origin: [8, 0, -12], size: [6, 12, 6] },
];

const rig = createScene(document.body);
const world = createCrashcatWorld();
world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });

const structurePort: StructurePort = workerPort(startWorker("structure"));
const buildings = createBuildings(world, structurePort, BUILDINGS);
const debris = createDebris(world, { cap: 150, otherBodies: () => (damage.ball === undefined ? 0 : 1) });
const damage = createDamage(world, buildings, debris, { ...DEFAULT_DAMAGE });

const buildingViews = createBuildingViews(rig.scene, workerPort<CsgRequest, CsgReply>(startWorker("csg")));
const debrisView = createDebrisView(rig.scene, debris);
const dust = createDust(rig.scene);
let overlays: ReturnType<typeof createStructureOverlay>[] = [];
let showGrid = false;

function showBuildings() {
  buildingViews.reset(buildings.list);
  for (const overlay of overlays) rig.scene.remove(overlay.mesh);
  overlays = buildings.list.map((b) => createStructureOverlay(b.structure));
  for (const overlay of overlays) {
    overlay.mesh.visible = showGrid;
    rig.scene.add(overlay.mesh);
  }
}
showBuildings();

// Debug: press G to show the Structure grids.
window.addEventListener("keydown", (e) => {
  if (e.key !== "g") return;
  showGrid = !showGrid;
  for (const overlay of overlays) overlay.mesh.visible = showGrid;
});

const view = createShotView(rig.scene, document.body, TEE);
const meter = createPowerMeter();
let ballType: BallType = BALL_TYPES.standard;
let inFlight = false;
let flightTime = 0;
let previewPower = 0.6;
let strokes = 0;
const previous: Vec3 = [TEE[0], TEE[1] + ballType.radius, TEE[2]];
const current: Vec3 = vec3.clone(previous);
const shown = vec3.create();

function resetBall() {
  if (damage.ball !== undefined) world.removeBody(damage.ball);
  damage.track(undefined);
  inFlight = false;
  vec3.set(current, TEE[0], TEE[1] + ballType.radius, TEE[2]);
  vec3.copy(previous, current);
  view.setBallType(ballType);
  view.setBallVisible(true);
}

const input = createShotInput(rig.renderer.domElement, meter, {
  onRelease(power) {
    if (inFlight || power <= 0) return;
    previewPower = power;
    const velocity = launchVelocity(vec3.create(), input.aim, power * ballType.maxSpeed);
    damage.track(launchBall(world, ballType, velocity), ballType);
    inFlight = true;
    flightTime = 0;
    strokes++;
  },
  onBallType(id) {
    if (inFlight) return;
    ballType = BALL_TYPES[id];
    resetBall();
  },
});
resetBall();

// Main-thread milliseconds per frame spent on physics and Structure results, over the last second.
const frameTimes: number[] = [];
let frameWork = 0;
let structureMs = 0;
let biteMs = 0;

const loop = createFixedLoop((dt) => {
  const start = performance.now();
  // Structure results that arrived since the last step: apply them now.
  for (const outcome of buildings.drain()) {
    buildingViews.apply(outcome);
    overlays[outcome.building.id]?.update();
    structureMs = outcome.reply.ms;
    collapseDust(outcome);
  }

  input.update(dt);
  world.step(dt);
  for (const { blast } of damage.update(dt)) {
    const big = blast.radius > 2;
    dust.puff(blast.center, blast.outward, big ? 80 : 24, big ? 2.5 : 1);
  }
  debris.update();
  frameWork += performance.now() - start;

  vec3.copy(previous, current);
  if (!inFlight) return;
  if (damage.ball === undefined) view.setBallVisible(false);
  else vec3.copy(current, world.getPosition(damage.ball));
  flightTime += dt;
  if (world.isSettled() || flightTime > SETTLE_TIMEOUT || current[1] < -5) resetBall();
});

/**
 * Until M5 turns them into Fragments, Cells that leave in a Detach, Crush or
 * Tip vanish. A cloud of dust where they were covers it.
 */
function collapseDust({ building, reply }: BlastOutcome) {
  const gone = reply.removed.slice(reply.result.destroyed.length);
  const centre = vec3.create();
  for (let n = 0; n < Math.min(gone.length, 60); n++) {
    building.structure.cellCenter(centre, gone[Math.floor(Math.random() * gone.length)]!);
    dust.puff(centre, [0, -0.5, 0], 4, 2);
  }
}

const tuning = { cellStrength: 100 };
function rebuild() {
  if (damage.ball !== undefined) resetBall();
  debris.clear();
  buildings.reset(tuning.cellStrength);
  showBuildings();
}
const gui = new GUI({ title: "Damage" });
gui.add(damage.settings, "hitRadius", 0.3, 4, 0.1).name("Hit Blast radius");
gui.add(damage.settings, "powerPerImpulse", 0, 10, 0.1).name("Hit power / impulse");
gui.add(damage.settings, "explosiveRadius", 0.5, 8, 0.1).name("Explosive radius");
gui.add(damage.settings, "explosivePower", 0, 600, 10).name("Explosive power");
gui.add(tuning, "cellStrength", 10, 500, 10).name("Cell strength").onFinishChange(rebuild);
gui.add(debris, "cap", 10, 400, 10).name("Body cap");
gui.add({ rebuild }, "rebuild").name("Rebuild buildings");

const previewVelocity = vec3.create();
let last = performance.now();
let frames = 0;
let fps = 0;
let fpsSince = last;
rig.renderer.setAnimationLoop((now) => {
  const elapsed = (now - last) / 1000;
  last = now;
  frameWork = 0;
  const alpha = loop.advance(elapsed);
  frameTimes.push(frameWork);
  if (frameTimes.length > 60) frameTimes.shift();
  frames++;
  if (now - fpsSince >= 1000) {
    fps = (frames * 1000) / (now - fpsSince);
    frames = 0;
    fpsSince = now;
  }
  for (const ms of buildingViews.drain()) biteMs = ms;
  debrisView.update();
  dust.update(Math.min(elapsed, 0.1));

  view.setBallPosition(vec3.lerp(shown, previous, current, alpha));
  view.setPower(meter.power);
  if (!inFlight) {
    const power = meter.held ? meter.power : previewPower;
    launchVelocity(previewVelocity, input.aim, power * ballType.maxSpeed);
    view.setPreview(predictTrajectory(current, previewVelocity, { drag: ballType.drag }));
  } else {
    view.setPreview(undefined);
  }
  const mean = frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
  const worst = Math.max(0, ...frameTimes);
  view.setLabel(
    `${ballType.name} ball · Strokes ${strokes} · A/D or drag: aim · W/S: loft · hold Space: power · 1/2: ball · G: grid\n` +
      `${fps.toFixed(0)} fps · physics + Structure ${mean.toFixed(2)} ms/frame (max ${worst.toFixed(2)}) · ` +
      `Debris ${debris.live.length}, Rubble ${debris.rubble.length} · worker: Structure ${structureMs.toFixed(1)} ms, Bite ${biteMs.toFixed(1)} ms`,
  );

  rig.renderer.render(rig.scene, rig.camera);
});
