import GUI from "lil-gui";
import { vec3, type Vec3 } from "math";
import { createCameraDirector } from "./camera/director";
import { DEFAULT_CAMERA_FX, createShake, createSlowMotion, hitsSoon, shakeAmount, type Box } from "./camera/fx";
import { DEFAULT_RIGS, type Pose } from "./camera/rigs";
import { createBuildings, type Blast, type BlastOutcome, type StructurePort } from "./damage/buildings";
import { createCollapse, DEFAULT_COLLAPSE } from "./damage/collapse";
import { createDamage } from "./damage/damage";
import { createDebris } from "./damage/debris";
import type { CsgReply, CsgRequest } from "./fx/bite";
import { createBuildingViews } from "./fx/building-view";
import { createCollapseView } from "./fx/collapse-view";
import { createDebrisView } from "./fx/debris-view";
import { createDust } from "./fx/dust";
import { createShotInput } from "./input/shot-input";
import { createFixedLoop } from "./loop";
import { createCrashcatWorld } from "./physics/crashcat";
import { createCameraView } from "./render/camera-view";
import { createScene } from "./render/scene";
import { createShotView } from "./render/shot-view";
import { createStructureOverlay } from "./render/structure-overlay";
import { launchVelocity } from "./shot/aim";
import { autoAim } from "./shot/auto-aim";
import { BALL_TYPES, type BallType } from "./shot/ball-types";
import { createPowerMeter } from "./shot/power-meter";
import { TEE, createRestCheck, launchBall } from "./shot/shot";
import { predictTrajectory } from "./shot/trajectory";
import { DEFAULT_ROUND, createRound, scoreName } from "./game/round";
import { BUILDINGS } from "./hole";
import { scenarioNamed } from "./scenarios";
import { createResultView } from "./render/result-view";
import { startWorker, workerPort } from "./worker-port";

/** In auto mode, seconds a Shot may run; it ends sooner once the ball is used up or at rest. */
const AUTO_SHOT_TIMEOUT = 3;


/** `?scenario=<name>` plays a Scenario's building instead of the Hole's, for `bun run scenarios --gif`. */
const SCENARIO = scenarioNamed(new URLSearchParams(location.search).get("scenario") ?? "");
const HOLE_BUILDINGS = SCENARIO ? [SCENARIO.building] : BUILDINGS;

/** Each Building's whole extent: slow motion starts when the ball is about to enter one. */
const BOXES: Box[] = HOLE_BUILDINGS.map(({ origin = [0, 0, 0], size }) => ({
  min: vec3.clone(origin),
  max: vec3.add(vec3.create(), origin, size),
}));
/** ImpactCam circles the middle of all the Buildings, at ground level. */
const IMPACT_CENTRE: Vec3 = (() => {
  const c = vec3.create();
  for (const b of BOXES) vec3.add(c, c, vec3.lerp(vec3.create(), b.min, b.max, 0.5));
  vec3.scale(c, c, 1 / BOXES.length);
  c[1] = 0;
  return c;
})();

const rig = createScene(document.body);
const director = createCameraDirector({ ...DEFAULT_RIGS });
const cameraFx = { ...DEFAULT_CAMERA_FX };
const shake = createShake(cameraFx);
const slowMotion = createSlowMotion(cameraFx);
const cameraView = createCameraView(rig.camera, rig.renderer.domElement);
const world = createCrashcatWorld();
world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });

const structurePort: StructurePort = workerPort(startWorker("structure"));
const buildings = createBuildings(world, structurePort, HOLE_BUILDINGS);
const debris = createDebris(world, {
  cap: 150,
  otherBodies: () => (damage.ball === undefined ? 0 : 1) + collapse.moving,
});
const damage = createDamage(world, buildings, debris);
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

/** Draws Buildings that Rubble at rest has become since the last call. */
function showRubble() {
  for (const building of buildings.drainAdded()) {
    buildingViews.add(building);
    const overlay = createStructureOverlay(building.structure);
    overlay.mesh.visible = showGrid;
    rig.scene.add(overlay.mesh);
    overlays[building.id] = overlay;
  }
}

// V switches the aiming view. Debug: G shows the Structure grids, P toggles auto mode, O frees the camera to orbit.
window.addEventListener("keydown", (e) => {
  if (e.key === "v") director.toggleView();
  if (e.key === "r" && round.state === "won") replay();
  if (e.key === "o") {
    cameraView.toggleOrbit();
    input.enabled = !cameraView.orbiting;
  }
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
const roundSettings = { ...DEFAULT_ROUND };
/** The Target is the Hole's first Building. */
const target = () => buildings.list[0]!.structure;
let round = createRound(roundSettings, target().cells());
/** The share of the Target Destroyed this Hole, as a whole percentage. */
const destroyedPercent = () => Math.round(round.destroyed(target().cells()) * 100);
const result = createResultView(document.body, replay);
/** Where the next Shot starts, on the ground: the Tee, then wherever the last ball came to rest (ADR 0003). */
const lie: Vec3 = vec3.clone(TEE);
const rest = createRestCheck();
/** The ball in play has come to rest; it stays drawn at the next Lie until the Shot ends. */
let atRest = false;
const previous: Vec3 = [lie[0], lie[1] + ballType.radius, lie[2]];
const current: Vec3 = vec3.clone(previous);
const velocity = vec3.create();
const shown = vec3.create();

function resetBall() {
  if (damage.ball !== undefined) world.removeBody(damage.ball);
  damage.track(undefined);
  inFlight = false;
  vec3.set(current, lie[0], lie[1] + ballType.radius, lie[2]);
  vec3.copy(previous, current);
  view.setBallType(ballType);
  view.setBallVisible(true);
  director.reset();
  slowMotion.reset();
}

function shoot(power: number) {
  if (inFlight || power <= 0 || !round.shoot()) return;
  previewPower = power;
  const velocity = launchVelocity(vec3.create(), input.aim, power * ballType.maxSpeed);
  damage.track(launchBall(world, ballType, velocity, lie), ballType);
  inFlight = true;
  flightTime = 0;
  rest.reset();
  atRest = false;
  director.shoot();
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
  const standing = buildings.list.filter((b) => !b.rubble && b.structure.height() >= auto.rebuildBelow);
  if (standing.length === 0 || round.state === "won") {
    if (!collapse.animating && collapse.moving === 0) replay();
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
  for (const { blast } of [...damage.update(), ...collapse.update(dt)]) {
    const big = blast.radius > 2;
    dust.puff(blast.center, blast.outward, big ? 80 : 24, big ? 2.5 : 1);
    const distance = rig.camera.position.distanceTo({ x: blast.center[0], y: blast.center[1], z: blast.center[2] });
    shake.add(shakeAmount(blast.radius, blast.power, distance, cameraFx));
    director.impact(IMPACT_CENTRE);
  }
  for (const { center, outward } of collapse.drainBursts()) dust.puff(center, outward, 6, 1.5);
  showRubble();
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
  if (damage.ball === undefined) view.setBallVisible(atRest);
  else {
    vec3.copy(current, world.getPosition(damage.ball));
    vec3.copy(velocity, world.getLinearVelocity(damage.ball));
    if (hitsSoon(current, velocity, BOXES, cameraFx.slowLead, ballType.drag)) slowMotion.trigger();
    // A ball at rest is the next Lie (ADR 0003). Auto mode always shoots from the Tee.
    if (rest.update(vec3.length(velocity), dt)) {
      if (!auto.enabled) vec3.set(lie, current[0], current[1] - ballType.radius, current[2]);
      world.removeBody(damage.ball);
      damage.track(undefined);
      atRest = true;
    }
  }
  flightTime += dt;
  // A ball that left the Hole is out of play; nothing else waits on it.
  if (damage.ball !== undefined && current[1] < -5) {
    world.removeBody(damage.ball);
    damage.track(undefined);
  }
  // Auto mode doesn't wait for Debris and Fragments to settle, only for the ball.
  const ballDone =
    auto.enabled &&
    (damage.ball === undefined || world.isSleeping(damage.ball) || flightTime > AUTO_SHOT_TIMEOUT);
  const { over, timedOut } = round.update(dt, world.isSettled() && !collapse.animating && !buildings.waiting);
  if (!ballDone && !over) return;
  if (timedOut) {
    // Whatever still moves freezes into Rubble where it is.
    collapse.freeze();
    debris.freeze();
    showRubble();
  }
  // A ball that exploded, left the Hole or was still rolling at the timeout
  // leaves the Lie where it was: the next Shot goes from the same spot.
  resetBall();
  round.finish(target().cells());
  if (round.state === "won" && !auto.enabled && !SCENARIO) {
    result.show(scoreName(round.strokes, roundSettings.par), `Destroyed ${destroyedPercent()}% in ${round.strokes} · Par ${roundSettings.par}`);
  }
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
  result.hide();
  vec3.copy(lie, TEE);
  resetBall();
  debris.clear();
  collapse.clear();
  buildings.reset({ integrity: tuning.cellStrength, tipMargin: tuning.tipMargin });
  showBuildings();
  round = createRound(roundSettings, target().cells());
}

/** Plays the Hole again from the first Shot. */
function replay() {
  rebuild();
}
const gui = new GUI({ title: "Damage" });
gui.add(BALL_TYPES.standard.blast, "radius", 0.3, 8, 0.1).name("Standard Blast radius");
gui.add(BALL_TYPES.standard.blast, "power", 0, 600, 10).name("Standard Blast power");
gui.add(BALL_TYPES.explosive.blast, "radius", 0.3, 8, 0.1).name("Explosive Blast radius");
gui.add(BALL_TYPES.explosive.blast, "power", 0, 600, 10).name("Explosive Blast power");
gui.add(tuning, "cellStrength", 10, 500, 10).name("Cell strength").onFinishChange(rebuild);
gui.add(tuning, "tipMargin", 0, 3, 0.05).name("Tipping margin (m)").onFinishChange(rebuild);
gui.add(debris, "cap", 10, 400, 10).name("Body cap");
gui.add(rig.ao, "enabled").name("Ambient occlusion");
const collapseGui = gui.addFolder("Collapse");
collapseGui.add(collapse.settings, "powerPerImpulse", 0, 0.1, 0.001).name("Fragment power / impulse");
collapseGui.add(collapse.settings, "hitRadius", 0.5, 4, 0.1).name("Fragment Blast radius");
collapseGui.add(collapse.settings, "tipSpin", 0, 2, 0.05).name("Tip spin (rad/s)");
collapseGui.add(collapse.settings, "crushImpactKeep", 0, 1, 0.05).name("Crush speed kept per floor");
gui.add({ rebuild }, "rebuild").name("Rebuild buildings");
const roundGui = gui.addFolder("Hole");
roundGui.add(roundSettings, "par", 1, 10, 1).name("Par");
roundGui.add(roundSettings, "winDestroyed", 0.1, 1, 0.05).name("Win at Destroyed share");
roundGui.add(roundSettings, "settleTimeout", 1, 20, 0.5).name("Settle timeout (s)");
const autoGui = gui.addFolder("Auto mode (P)");
autoGui.add(auto, "enabled").name("Fire automatically");
autoGui.add(auto, "delay", 0, 5, 0.1).name("Delay between shots (s)");
autoGui.add(auto, "explosiveChance", 0, 1, 0.05).name("Explosive chance");

const camera = gui.addFolder("Camera").close();
const rigs = director.settings;
camera.add(rigs, "behindDistance", 1, 20, 0.5).name("Behind: distance");
camera.add(rigs, "behindHeight", 0.5, 10, 0.1).name("Behind: height");
camera.add(rigs, "behindLookAhead", 5, 60, 1).name("Behind: look ahead");
camera.add(rigs, "behindLookHeight", 0, 15, 0.5).name("Behind: look height");
camera.add(rigs, "behindFov", 30, 90, 1).name("Behind: FOV");
camera.add(rigs, "raisedElevation", 20, 85, 1).name("Raised: angle °");
camera.add(rigs, "raisedDistance", 10, 80, 1).name("Raised: distance");
camera.add(rigs, "raisedLookAhead", 0, 40, 1).name("Raised: look ahead");
camera.add(rigs, "raisedFov", 30, 90, 1).name("Raised: FOV");
camera.add(rigs, "flightElevation", 0, 85, 1).name("Flight: angle °");
camera.add(rigs, "flightDistance", 3, 40, 0.5).name("Flight: distance");
camera.add(rigs, "flightFov", 30, 90, 1).name("Flight: FOV");
camera.add(rigs, "impactRadius", 10, 80, 1).name("Impact: radius");
camera.add(rigs, "impactHeight", 2, 60, 1).name("Impact: height");
camera.add(rigs, "impactOrbitSpeed", 0, 45, 1).name("Impact: orbit °/s");
camera.add(rigs, "impactFov", 30, 90, 1).name("Impact: FOV");
camera.add(rigs, "blendTime", 0, 2, 0.05).name("Blend time (s)");
camera.add(cameraFx, "shakeOffset", 0, 2, 0.05).name("Shake: offset (m)");
camera.add(cameraFx, "shakeReference", 10, 2000, 10).name("Shake: full at r × power");
camera.add(cameraFx, "shakeFalloff", 1, 100, 1).name("Shake: halves at (m)");
camera.add(cameraFx, "shakeDecay", 0.1, 5, 0.1).name("Shake: decay /s");
camera.add(cameraFx, "slowScale", 0.05, 1, 0.05).name("Slow-mo: speed");
camera.add(cameraFx, "slowHold", 0, 2, 0.05).name("Slow-mo: hold (s)");
camera.add(cameraFx, "slowEase", 0, 1, 0.05).name("Slow-mo: ease (s)");
camera.add(cameraFx, "slowLead", 0, 1, 0.05).name("Slow-mo: lead (s)");

const shakeOffset = vec3.create();
const previewVelocity = vec3.create();
let last = performance.now();
let frames = 0;
let fps = 0;
let fpsSince = last;
rig.renderer.setAnimationLoop((now) => {
  const elapsed = (now - last) / 1000;
  last = now;
  frameWork = 0;
  const timeScale = slowMotion.update(elapsed);
  const alpha = loop.advance(elapsed * timeScale);
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
  dust.update(Math.min(elapsed, 0.1) * timeScale);

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
    `Stroke ${round.strokes} · Par ${roundSettings.par} · Destroyed ${destroyedPercent()}% of ${Math.round(roundSettings.winDestroyed * 100)}%\n` +
      `${ballType.name} ball · A/D or drag: aim · W/S: loft · hold Space: power · 1/2: ball · G: grid · V: view · O: orbit · P: auto${auto.enabled ? " (on)" : ""}\n` +
      `${cameraView.orbiting ? "Orbit" : director.mode}${director.mode === "AimCam" ? ` (${director.view})` : ""} · ` +
      `${fps.toFixed(0)} fps · physics + Structure ${mean.toFixed(2)} ms/frame (max ${worst.toFixed(2)}) · ` +
      `Debris ${debris.live.length}, Fragments ${collapse.moving}, Rubble ${debris.rubble.length + buildings.list.filter((b) => b.rubble).length} · worker: Structure ${structureMs.toFixed(1)} ms, Bite ${biteMs.toFixed(1)} ms`,
  );

  const pose = director.update(Math.min(elapsed, 0.1), {
    tee: lie,
    yaw: input.aim.yaw,
    ball: inFlight ? shown : undefined,
    velocity: inFlight ? velocity : undefined,
  });
  cameraView.update(pinnedPose ?? pose, shake.update(shakeOffset, Math.min(elapsed, 0.1)));

  rig.render();
});

/** Set by `__golf.look`: holds the camera still instead of following the director. */
let pinnedPose: Pose | undefined;

function blastDirectly(center: Vec3, radius: number, power: number, building = 0, outward: Vec3 = [1, 0, 0]) {
  const blast: Blast = { center, radius, power, outward };
  buildings.blast(buildings.list[building]!, blast);
  dust.puff(center, outward, 80, 2.5);
}

/**
 * A debug hook for scripted runs: `bun run shoot` (tools/shoot.ts) drives the
 * game through it rather than through the keyboard.
 */
(window as unknown as { __golf: unknown }).__golf = {
  /** Blasts a Building directly, as if a ball had hit `center`. */
  blast: blastDirectly,
  /** Fires the current ball at `power` (0–1) along the current aim. */
  shoot,
  /** Plays step `index` of the `?scenario=` Scenario: its Blast, or its Shot from its own Lie. */
  step(index: number) {
    const step = SCENARIO?.steps[index];
    if (!step) throw new Error(`no step ${index} in this Scenario`);
    if ("blast" in step) {
      blastDirectly(step.blast.center, step.blast.radius, step.blast.power, 0, [0, 0, 1]);
      return;
    }
    // A Scenario plays every step, even after the Hole is won.
    if (round.state === "won") round = createRound(roundSettings, target().cells());
    vec3.copy(lie, step.shot.from);
    ballType = BALL_TYPES[step.shot.ball];
    resetBall();
    const { aim, power } = autoAim(current, step.shot.at, ballType);
    input.aim = aim;
    shoot(power);
  },
  /** True once no Shot is in play and every body is at rest. */
  settled: () => !inFlight && world.isSettled() && !collapse.animating && !buildings.waiting,
  /** Pins the camera at `position` looking at `target`; call with no arguments to release it. */
  look(position?: Vec3, target?: Vec3, fov = 50) {
    pinnedPose = position && target ? { position, target, fov } : undefined;
  },
  /** Hides the debug GUI, for clean frames. */
  hideUi() {
    for (const el of document.querySelectorAll<HTMLElement>(".lil-gui")) el.style.display = "none";
  },
  rebuild,
  /** The Hole so far: whether it is won, and in how many Strokes. */
  round: () => ({ state: round.state, strokes: round.strokes, destroyed: round.destroyed(target().cells()) }),
};
