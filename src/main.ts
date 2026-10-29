import GUI from "lil-gui";
import { vec3, type Vec3 } from "math";
import { createBuildings, type BlastOutcome, type StructurePort } from "./damage/buildings";
import { createCollapse, DEFAULT_COLLAPSE } from "./damage/collapse";
import { createDamage, DEFAULT_DAMAGE } from "./damage/damage";
import { createDebris } from "./damage/debris";
import type { CsgReply, CsgRequest } from "./fx/bite";
import { createBuildingViews } from "./fx/building-view";
import { createCollapseView } from "./fx/collapse-view";
import { createDebrisView } from "./fx/debris-view";
import { createDust } from "./fx/dust";
import { createShotInput } from "./input/shot-input";
import { createFixedLoop } from "./loop";
import { createCrashcatWorld } from "./physics/crashcat";
import { createScene } from "./render/scene";
import { createShotView } from "./render/shot-view";
import { createStructureOverlay } from "./render/structure-overlay";
import { launchVelocity } from "./shot/aim";
import { autoAim } from "./shot/auto-aim";
import { BALL_TYPES, type BallType } from "./shot/ball-types";
import { createPowerMeter } from "./shot/power-meter";
import { TEE, launchBall } from "./shot/shot";
import { predictTrajectory } from "./shot/trajectory";
import type { StructureOptions } from "./structure/structure";
import { startWorker, workerPort } from "./worker-port";

/** Seconds a Shot may run before the next is allowed, even if the ball still moves. */
const SETTLE_TIMEOUT = 8;
/** In auto mode, seconds a Shot may run; it ends sooner once the ball is used up or at rest. */
const AUTO_SHOT_TIMEOUT = 3;

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
const debris = createDebris(world, {
  cap: 150,
  otherBodies: () => (damage.ball === undefined ? 0 : 1) + collapse.moving,
});
const damage = createDamage(world, buildings, debris, { ...DEFAULT_DAMAGE });
const collapse = createCollapse(world, buildings, debris, { ...DEFAULT_COLLAPSE });

const buildingViews = createBuildingViews(rig.scene, workerPort<CsgRequest, CsgReply>(startWorker("csg")));
const debrisView = createDebrisView(rig.scene, debris);
const collapseView = createCollapseView(rig.scene, collapse);
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

// Debug: press G to show the Structure grids, P to toggle auto mode.
window.addEventListener("keydown", (e) => {
  if (e.key === "p") {
    auto.enabled = !auto.enabled;
    for (const c of autoGui.controllersRecursive()) c.updateDisplay();
  }
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

function shoot(power: number) {
  if (inFlight || power <= 0) return;
  previewPower = power;
  const velocity = launchVelocity(vec3.create(), input.aim, power * ballType.maxSpeed);
  damage.track(launchBall(world, ballType, velocity), ballType);
  inFlight = true;
  flightTime = 0;
  strokes++;
}

const input = createShotInput(rig.renderer.domElement, meter, {
  onRelease: shoot,
  onBallType(id) {
    if (inFlight) return;
    ballType = BALL_TYPES[id];
    resetBall();
  },
});
resetBall();

/**
 * Auto mode: once the ball is back on the Tee, waits `delay` seconds, then
 * shoots at a random live Cell of a random standing Building, low floors
 * more likely, sometimes with the explosive ball. Rebuilds the Buildings
 * once every one is down.
 */
const auto = { enabled: false, delay: 0.8, explosiveChance: 0.3, rebuildBelow: 2 };
let autoWait = 0;

function autoShoot() {
  const standing = buildings.list.filter((b) => b.structure.height() >= auto.rebuildBelow);
  if (standing.length === 0) {
    if (!collapse.animating && collapse.moving === 0) rebuild();
    return;
  }
  const { structure } = standing[Math.floor(Math.random() * standing.length)]!;
  const cells: number[] = [];
  for (let i = 0; i < structure.count; i++) {
    // Weight each Cell toward the ground: lower floors bring the building down.
    if (structure.alive[i] && Math.random() < 1 - structure.coords(i)[1] / structure.size[1]) cells.push(i);
  }
  if (cells.length === 0) return;
  ballType = Math.random() < auto.explosiveChance ? BALL_TYPES.explosive : BALL_TYPES.standard;
  resetBall();
  const target = structure.cellCenter(vec3.create(), cells[Math.floor(Math.random() * cells.length)]!);
  const { aim, power } = autoAim(current, target, ballType);
  input.aim = aim;
  shoot(power);
}

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
    collapse.apply(outcome);
    collapseDust(outcome);
  }

  input.update(dt);
  world.step(dt);
  for (const { blast } of [...damage.update(dt), ...collapse.update(dt)]) {
    const big = blast.radius > 2;
    dust.puff(blast.center, blast.outward, big ? 80 : 24, big ? 2.5 : 1);
  }
  debris.update();
  frameWork += performance.now() - start;

  vec3.copy(previous, current);
  if (!inFlight) {
    autoWait = auto.enabled ? autoWait + dt : 0;
    if (autoWait >= auto.delay) {
      autoWait = 0;
      autoShoot();
    }
    return;
  }
  if (damage.ball === undefined) view.setBallVisible(false);
  else vec3.copy(current, world.getPosition(damage.ball));
  flightTime += dt;
  // Auto mode doesn't wait for Debris and Fragments to settle, only for the ball.
  const ballDone =
    auto.enabled &&
    (damage.ball === undefined || world.isSleeping(damage.ball) || flightTime > AUTO_SHOT_TIMEOUT);
  if (ballDone || (world.isSettled() && !collapse.animating) || flightTime > SETTLE_TIMEOUT || current[1] < -5) resetBall();
});

/** A cloud of dust where Cells were crushed, and along the base of a Tip. */
function collapseDust({ building, reply }: BlastOutcome) {
  const centre = vec3.create();
  for (const event of reply.events) {
    const cells = event.kind === "crush" ? event.crushed : event.kind === "tip" ? event.cells : [];
    for (let n = 0; n < Math.min(cells.length, 40); n++) {
      building.structure.cellCenter(centre, cells[Math.floor(Math.random() * cells.length)]!);
      if (event.kind === "tip") centre[1] = building.structure.origin[1] + event.layer + 1;
      dust.puff(centre, [0, -0.5, 0], 4, 2);
    }
  }
}

const tuning = { cellStrength: 100, tipMargin: 0.25 };
function rebuild() {
  if (damage.ball !== undefined) resetBall();
  debris.clear();
  collapse.clear();
  buildings.reset({ integrity: tuning.cellStrength, tipMargin: tuning.tipMargin });
  showBuildings();
}
const gui = new GUI({ title: "Damage" });
gui.add(damage.settings, "hitRadius", 0.3, 4, 0.1).name("Hit Blast radius");
gui.add(damage.settings, "powerPerImpulse", 0, 10, 0.1).name("Hit power / impulse");
gui.add(damage.settings, "explosiveRadius", 0.5, 8, 0.1).name("Explosive radius");
gui.add(damage.settings, "explosivePower", 0, 600, 10).name("Explosive power");
gui.add(tuning, "cellStrength", 10, 500, 10).name("Cell strength").onFinishChange(rebuild);
gui.add(tuning, "tipMargin", 0, 3, 0.05).name("Tipping margin (m)").onFinishChange(rebuild);
gui.add(debris, "cap", 10, 400, 10).name("Body cap");
const collapseGui = gui.addFolder("Collapse");
collapseGui.add(collapse.settings, "powerPerImpulse", 0, 0.1, 0.001).name("Fragment power / impulse");
collapseGui.add(collapse.settings, "hitRadius", 0.5, 4, 0.1).name("Fragment Blast radius");
collapseGui.add(collapse.settings, "tipSpin", 0, 2, 0.05).name("Tip spin (rad/s)");
collapseGui.add(collapse.settings, "crushSeconds", 0.2, 4, 0.1).name("Crush seconds");
gui.add({ rebuild }, "rebuild").name("Rebuild buildings");
const autoGui = gui.addFolder("Auto mode (P)");
autoGui.add(auto, "enabled").name("Fire automatically");
autoGui.add(auto, "delay", 0, 5, 0.1).name("Delay between shots (s)");
autoGui.add(auto, "explosiveChance", 0, 1, 0.05).name("Explosive chance");

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
  collapseView.update();
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
    `${ballType.name} ball · Strokes ${strokes} · A/D or drag: aim · W/S: loft · hold Space: power · 1/2: ball · G: grid · P: auto${auto.enabled ? " (on)" : ""}\n` +
      `${fps.toFixed(0)} fps · physics + Structure ${mean.toFixed(2)} ms/frame (max ${worst.toFixed(2)}) · ` +
      `Debris ${debris.live.length}, Fragments ${collapse.moving}, Rubble ${debris.rubble.length + collapse.fragments.length - collapse.moving} · worker: Structure ${structureMs.toFixed(1)} ms, Bite ${biteMs.toFixed(1)} ms`,
  );

  rig.renderer.render(rig.scene, rig.camera);
});
