// Ten hits in a row on the Target, timed. Run with `bun run bench`.
// The Structure and Bite work run here inline but in workers in the game, so
// they're timed apart from the main thread's share: physics, applying the
// Structure's results and Debris.
import * as THREE from "three";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { createDamage, DEFAULT_DAMAGE } from "../src/damage/damage";
import { createDebris } from "../src/damage/debris";
import { createBiteCutter } from "../src/fx/bite";
import { createBuildingViews } from "../src/fx/building-view";
import { createCrashcatWorld } from "../src/physics/crashcat";
import { BALL_TYPES } from "../src/shot/ball-types";
import { launchBall } from "../src/shot/shot";
import { inlinePort } from "../src/worker-port";

const DT = 1 / 60;
const HITS = 10;
const type = (process.argv[2] ?? "standard") as keyof typeof BALL_TYPES;

const world = createCrashcatWorld();
world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
const buildings = createBuildings(world, inlineStructures(), [
  { origin: [-4, 0, -14], size: [8, 20, 8] },
  { origin: [8, 0, -12], size: [6, 12, 6] },
]);
const debris = createDebris(world, { cap: 150, otherBodies: () => (damage.ball === undefined ? 0 : 1) });
const damage = createDamage(world, buildings, debris, { ...DEFAULT_DAMAGE });
const cutter = createBiteCutter();
const views = createBuildingViews(new THREE.Scene(), inlinePort((r) => cutter.handle(r)));
views.reset(buildings.list);

const frame: number[] = [];
const structure: number[] = [];
const bite: number[] = [];
let blasts = 0;

function step() {
  const start = performance.now();
  let inWorkers = 0;
  for (const outcome of buildings.drain()) {
    structure.push(outcome.reply.ms);
    // The Bite runs inline here, so take its time back out of the frame.
    const before = performance.now();
    views.apply(outcome);
    bite.push(...views.drain());
    inWorkers += performance.now() - before;
  }
  world.step(DT);
  blasts += damage.update(DT).length;
  debris.update();
  frame.push(performance.now() - start - inWorkers);
}

for (let shot = 0; shot < HITS; shot++) {
  // Aim at the Target's front face, across its width and up its lower floors.
  const ball = launchBall(world, BALL_TYPES[type], [0, 0, -BALL_TYPES[type].maxSpeed], [-3 + (shot % 7), 1 + (shot % 4) * 1.5, 0]);
  damage.track(ball, BALL_TYPES[type]);
  for (let n = 0; n < 60; n++) step();
  if (damage.ball !== undefined) world.removeBody(damage.ball);
  damage.track(undefined);
}
for (let n = 0; n < 300; n++) step();

const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return `mean ${(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(2)} ms, p99 ${at(0.99).toFixed(2)}, max ${at(1).toFixed(2)} (n=${xs.length})`;
};
console.log(`${HITS} ${type} shots: ${blasts} Blasts, ${debris.live.length} Debris live, ${debris.rubble.length} Rubble`);
console.log(`main thread per frame: ${stats(frame)}`);
console.log(`structure worker per Blast: ${stats(structure)}`);
console.log(`csg worker per Bite: ${stats(bite)}`);
if (process.env.SLOWEST) console.log(frame.map((t, i) => [i, +t.toFixed(2)]).sort((a, b) => b[1]! - a[1]!).slice(0, 12));
