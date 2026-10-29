import { describe, expect, test } from "bun:test";
import type { Vec3 } from "math";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { createCollapse, DEFAULT_COLLAPSE, floorFall } from "../src/damage/collapse";
import type { Hit } from "../src/damage/damage";
import { createDebris } from "../src/damage/debris";
import { createCrashcatWorld } from "../src/physics/crashcat";

const DT = 1 / 60;

/** The Hole in `main.ts`: the Target, and a Neighbour 4 m off its +x side. */
function setup() {
  const world = createCrashcatWorld();
  world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
  const buildings = createBuildings(world, inlineStructures(), [
    { origin: [-4, 0, -14], size: [8, 20, 8] },
    { origin: [8, 0, -12], size: [6, 12, 6] },
  ]);
  const debris = createDebris(world, { cap: 150 });
  const collapse = createCollapse(world, buildings, debris, { ...DEFAULT_COLLAPSE });
  const [target, neighbour] = buildings.list as [(typeof buildings.list)[0], (typeof buildings.list)[0]];
  return { world, buildings, debris, collapse, target, neighbour };
}

function blastTarget(env: ReturnType<typeof setup>, center: Vec3, radius: number, power: number) {
  env.buildings.blast(env.target, { center, radius, power, outward: [1, 0, 0] });
  for (const outcome of env.buildings.drain()) env.collapse.apply(outcome);
}

/** Steps physics and collapse for `seconds`, applying any Blasts Fragments set off. */
function run(env: ReturnType<typeof setup>, seconds: number): Hit[] {
  const hits: Hit[] = [];
  for (let n = 0; n < seconds / DT; n++) {
    env.world.step(DT);
    hits.push(...env.collapse.update(DT));
    for (const outcome of env.buildings.drain()) env.collapse.apply(outcome);
  }
  return hits;
}

const liveCells = (b: { structure: { alive: Uint8Array } }) => b.structure.alive.reduce((a, c) => a + c, 0);

describe("Tip", () => {
  test("blowing out the lower floors on the Neighbour's side tips the Target into it", () => {
    const env = setup();
    const before = liveCells(env.neighbour);
    blastTarget(env, [3, 2.5, -10], 5, 2000);

    expect(env.collapse.fragments).toHaveLength(1);
    const fragment = env.collapse.fragments[0]!;
    expect(env.world.isSleeping(fragment.id)).toBe(false);
    expect(env.target.structure.height()).toBeLessThan(2);

    const hits = run(env, 3);
    // It falls toward +x, the damaged side, and its hits become Blasts on the Neighbour alone.
    expect(fragment.position[0]).toBeGreaterThan(1);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.buildings).toEqual([env.neighbour]);
    expect(liveCells(env.neighbour)).toBeLessThan(before);
  });

  test("a Fragment freezes into static Rubble only once it is asleep", () => {
    const env = setup();
    blastTarget(env, [3, 2.5, -10], 5, 2000);
    const fragment = env.collapse.fragments[0]!;
    const moving = fragment.id;
    for (let n = 0; n < 20 / DT && !fragment.rubble; n++) {
      env.world.step(DT);
      // Before each update, an awake Fragment must not have frozen.
      const asleep = env.world.isSleeping(moving);
      env.collapse.update(DT);
      expect(fragment.rubble as boolean).toBe(asleep);
    }
    expect(fragment.rubble).toBe(true);
    expect(env.collapse.moving).toBe(0);
    expect(env.world.hasBody(moving)).toBe(false);
    expect(env.world.hasBody(fragment.id)).toBe(true);
  });
});

describe("Crush", () => {
  test("crushing a middle floor drops the floors above into a stack, then leaves Rubble", () => {
    const env = setup();
    blastTarget(env, [3, 10, -10], 5, 2000);
    expect(env.collapse.fragments).toHaveLength(0);
    expect(env.collapse.pancakes).toHaveLength(1);
    const pancake = env.collapse.pancakes[0]!;
    expect(pancake.floors.length).toBeGreaterThan(1);
    expect(env.collapse.animating).toBe(true);

    run(env, 6);
    expect(pancake.done).toBe(true);
    expect(env.collapse.animating).toBe(false);
    expect(pancake.body).toBeDefined();
    // Each floor's slab ends one metre above the one below.
    const { structure } = env.target;
    const bottom = (mask: Uint8Array) => structure.coords(mask.indexOf(1))[1];
    pancake.floors.forEach((floor, n) => {
      expect(floorFall(pancake, floor)).toBe(floor.drop);
      const prev = pancake.floors[n - 1];
      if (prev) expect(bottom(floor.slab) - floor.drop).toBe(bottom(prev.slab) - prev.drop + 1);
    });
  });

  test("each floor's landing blows out its pillars, one floor after another from the bottom", () => {
    const env = setup();
    blastTarget(env, [3, 10, -10], 5, 2000);
    const pancake = env.collapse.pancakes[0]!;
    env.collapse.drainBursts();
    const landedAt: number[] = [];
    for (let step = 0; !pancake.done && step < 600; step++) {
      env.world.step(DT);
      env.collapse.update(DT);
      const bursts = env.collapse.drainBursts().length;
      pancake.floors.forEach((floor, n) => {
        if (floor.landed && landedAt[n] === undefined) landedAt[n] = step;
      });
      // Pillars burst only in a step where a floor landed.
      if (bursts > 0) expect(landedAt).toContain(step);
      // Until a floor lands, it falls with the block above it.
      for (const floor of pancake.floors) if (!floor.landed) expect(floorFall(pancake, floor)).toBe(pancake.fallen);
    }
    expect(landedAt).toHaveLength(pancake.floors.length);
    for (let n = 1; n < landedAt.length; n++) {
      if (pancake.floors[n]!.drop > pancake.floors[n - 1]!.drop) expect(landedAt[n]!).toBeGreaterThan(landedAt[n - 1]!);
    }
  });
});

describe("Detach", () => {
  test("Cells cut off from the ground become a Fragment that falls", () => {
    const env = setup();
    // Cut the Neighbour-side corner pillar out under the roof's overhang, then an island.
    blastTarget(env, [0, 15, -10], 6, 3000);
    const detach = env.collapse.fragments;
    expect(detach.length).toBeGreaterThan(0);
    const start = detach[0]!.position[1];
    run(env, 0.5);
    expect(detach[0]!.position[1]).toBeLessThan(start);
  });
});

test("clear removes every Fragment and pancake body", () => {
  const env = setup();
  blastTarget(env, [3, 2.5, -10], 5, 2000);
  const id = env.collapse.fragments[0]!.id;
  env.collapse.clear();
  expect(env.world.hasBody(id)).toBe(false);
  expect(env.collapse.fragments).toHaveLength(0);
});
