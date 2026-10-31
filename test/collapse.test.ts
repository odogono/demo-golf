import { describe, expect, test } from "bun:test";
import type { Vec3 } from "math";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { quat, vec3 } from "math";
import { structureColliders } from "../src/structure/colliders";
import { applyTurn, createCollapse, DEFAULT_COLLAPSE, floorFall, nearestUpright, turnTrim, type Turn } from "../src/damage/collapse";
import { trimHullPoints, type Trim } from "../src/structure/blueprint";
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

  test("a Fragment becomes a Rubble Building only once it is asleep, and takes Blasts", () => {
    const env = setup();
    blastTarget(env, [3, 2.5, -10], 5, 2000);
    const fragment = env.collapse.fragments[0]!;
    const cells = fragment.cells.length;
    for (let n = 0; n < 20 / DT && env.collapse.moving > 0; n++) {
      env.world.step(DT);
      // Before each update, an awake Fragment must not have settled.
      const asleep = env.world.isSleeping(fragment.id);
      env.collapse.update(DT);
      expect(env.collapse.moving === 0).toBe(asleep);
    }
    expect(env.collapse.moving).toBe(0);
    expect(env.world.hasBody(fragment.id)).toBe(false);

    const [rubble] = env.buildings.drainAdded();
    expect(rubble?.rubble).toBe(true);
    expect(liveCells(rubble!)).toBe(cells);
    expect(env.world.hasBody(rubble!.body!)).toBe(true);
    expect(env.buildings.ofBody(rubble!.body!)).toBe(rubble);

    // A Blast on it damages it like any Building.
    const centre = rubble!.structure.cellCenter(vec3.create(), rubble!.structure.alive.indexOf(1));
    env.buildings.blast(rubble!, { center: centre, radius: 1.5, power: 500, outward: [0, 1, 0] });
    const outcome = env.buildings.drain().find((o) => o.building === rubble);
    expect(outcome!.reply.result.destroyed.length).toBeGreaterThan(0);
    expect(liveCells(rubble!)).toBeLessThan(cells);
  });
});

describe("Crush", () => {
  test("crushing a middle floor drops the floors above into a stack, then leaves Rubble", () => {
    const env = setup();
    blastTarget(env, [0, 10, -10], 5, 2000);
    expect(env.collapse.fragments).toHaveLength(0);
    expect(env.collapse.pancakes).toHaveLength(1);
    const pancake = env.collapse.pancakes[0]!;
    expect(pancake.floors.length).toBeGreaterThan(1);
    expect(env.collapse.animating).toBe(true);

    run(env, 6);
    expect(pancake.done).toBe(true);
    expect(env.collapse.animating).toBe(false);
    expect(env.collapse.pancakes).toHaveLength(0);
    // The stack is now Rubble: a Building holding every slab Cell, where the lowest landed.
    const [rubble] = env.buildings.drainAdded();
    const slabCells = pancake.floors.reduce((n, f) => n + f.slab.reduce((a, c) => a + c, 0), 0);
    expect(rubble?.rubble).toBe(true);
    expect(liveCells(rubble!)).toBe(slabCells);
    const lowest = pancake.floors[0]!;
    const landedAt = env.target.structure.coords(lowest.slab.indexOf(1))[1] - lowest.drop;
    expect(rubble!.structure.origin[1]).toBe(env.target.structure.origin[1] + landedAt);
    // Each floor's slab ends one metre above the one below.
    const { structure } = env.target;
    const bottom = (mask: Uint8Array) => structure.coords(mask.indexOf(1))[1];
    pancake.floors.forEach((floor, n) => {
      expect(floorFall(pancake, floor)).toBe(floor.drop);
      const prev = pancake.floors[n - 1];
      if (prev) expect(bottom(floor.slab) - floor.drop).toBe(bottom(prev.slab) - prev.drop + 1);
    });
  });

  test("a lighthouse's Crush stack keeps its round shape as Rubble", () => {
    const world = createCrashcatWorld();
    world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
    const buildings = createBuildings(world, inlineStructures(), [{ origin: [-4.5, 0, -14.5], size: [9, 24, 9], blueprint: "lighthouse" }]);
    const env = { world, buildings, debris: createDebris(world, { cap: 150 }), target: buildings.list[0]!, neighbour: buildings.list[0]! };
    const collapse = createCollapse(world, buildings, env.debris, { ...DEFAULT_COLLAPSE });
    // Weakening the whole ring evenly, from its axis, Crushes it rather than Tipping it.
    blastTarget({ ...env, collapse }, [0, 5, -10], 3, 200);
    expect(collapse.pancakes).toHaveLength(1);
    run({ ...env, collapse }, 8);
    const [rubble] = buildings.drainAdded();
    expect(rubble?.rubble).toBe(true);
    const { trims, origin } = rubble!.structure;
    expect(trims.size).toBeGreaterThan(0);
    // Its round pieces stay round about the lighthouse's own axis.
    for (const pieces of trims.values()) {
      for (const { centre } of pieces) {
        expect(origin[0] + centre[0]).toBeCloseTo(0);
        expect(origin[2] + centre[1]).toBeCloseTo(-10);
      }
    }
  });

  test("each floor's landing blows out its pillars, one floor after another from the bottom", () => {
    const env = setup();
    blastTarget(env, [0, 10, -10], 5, 2000);
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

describe("nearestUpright", () => {
  const turn = (q: ReturnType<typeof quat.create>) => nearestUpright(q);

  test("keeps a slightly tilted piece as it is", () => {
    const q = quat.setAxisAngle(quat.create(), [1, 0, 0], 0.2);
    expect(turn(q)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  test("lays a piece on its side, keeping the frame right-handed", () => {
    const q = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2 - 0.3);
    const [x, y, z] = turn(q);
    expect(x).toEqual([0, 1, 0]);
    expect(y).toEqual([-1, 0, 0]);
    expect(vec3.cross(vec3.create(), x, y)).toEqual(z);
  });
});

describe("Rubble from a turned piece", () => {
  // A quarter turn about z: x goes to y, y to -x.
  const onItsSide: Turn = [
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, 1],
  ];

  test("turns its trims with it, so their hulls are the old hulls turned", () => {
    // Each trim with the centre of a Cell it reaches.
    const trims: [Trim, Vec3][] = [
      [{ centre: [4.5, 4.5], outer: 3.6, outerTop: 3.4, inner: 2.8, bottom: 0.2 }, [1.5, 6.5, 4.5]],
      [{ axis: "z", centre: [12, 1], outer: 7.3, inner: 6.5 }, [6.5, 4.5, 3.5]],
      [{ axis: "x", centre: [3.5, 0.5], outer: 0.48 }, [8.5, 3.5, 0.5]],
    ];
    const to: Vec3 = [5.5, 1.5, 7.5];
    for (const [trim, from] of trims) {
      const turned = turnTrim(trim, { turn: onItsSide, from, to });
      const before = trimHullPoints(from[0] - 0.5, from[1] - 0.5, from[2] - 0.5, trim);
      const after = trimHullPoints(to[0] - 0.5, to[1] - 0.5, to[2] - 0.5, turned);
      const key = (p: number[]) => p.map((v) => v.toFixed(3)).join(",");
      const expected = new Set<string>();
      for (let k = 0; k < before.length; k += 3) expected.add(key(applyTurn(onItsSide, [before[k]!, before[k + 1]!, before[k + 2]!]).map((v) => v + 0)));
      const got = new Set<string>();
      for (let k = 0; k < after.length; k += 3) got.add(key([after[k]!, after[k + 1]!, after[k + 2]!].map((v) => v + 0)));
      // The same shape: every turned hull point is on the new hull's outline, and vice versa.
      expect(got.size).toBeGreaterThan(0);
      for (const p of got) expect(expected.has(p.replace(/-0\.000/g, "0.000"))).toBe(true);
    }
  });

  test("a toppled lighthouse keeps its round shape as Rubble", () => {
    const world = createCrashcatWorld();
    world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
    const buildings = createBuildings(world, inlineStructures(), [{ origin: [-4.5, 0, -14.5], size: [9, 24, 9], blueprint: "lighthouse", tipMargin: 2 }]);
    const debris = createDebris(world, { cap: 150 });
    const collapse = createCollapse(world, buildings, debris, { ...DEFAULT_COLLAPSE });
    const env = { world, buildings, debris, collapse, target: buildings.list[0]!, neighbour: buildings.list[0]! };
    blastTarget(env, [0, 2.5, -7.5], 3, 150);
    expect(collapse.fragments).toHaveLength(1);
    run(env, 12);
    const rubble = buildings.drainAdded().find((b) => b.structure.trims.size > 50);
    expect(rubble).toBeDefined();
    // Lying down, its round pieces now curve about a horizontal axis.
    const axes = new Set([...rubble!.structure.trims.values()].flat().map((t) => t.axis ?? "y"));
    expect(axes.has("x") || axes.has("z")).toBe(true);

    // Its colliders reuse the standing Cells' hulls, rotated: the same shapes as its turned trims.
    const { structure } = rubble!;
    let checked = 0;
    for (const child of structureColliders(structure)) {
      if (child.shape.kind !== "convexHull") continue;
      expect(child.rotation).toBeDefined();
      const [x, y, z] = child.position.map((v) => v - 0.5) as Vec3;
      const want: Vec3[] = [];
      for (const trim of structure.trims.get(structure.index(x, y, z))!) {
        const points = trimHullPoints(x, y, z, trim);
        for (let k = 0; k < points.length; k += 3) want.push([points[k]!, points[k + 1]!, points[k + 2]!]);
      }
      const { points } = child.shape;
      for (let k = 0; k < points.length; k += 3) {
        const p = vec3.transformQuat(vec3.create(), [points[k]!, points[k + 1]!, points[k + 2]!], child.rotation!);
        expect(Math.min(...want.map((w) => vec3.distance(w, p)))).toBeLessThan(1e-3);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
