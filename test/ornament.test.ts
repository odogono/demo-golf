import { expect, test } from "bun:test";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { createCollapse, DEFAULT_COLLAPSE } from "../src/damage/collapse";
import { createDebris } from "../src/damage/debris";
import { buildingMesh } from "../src/fx/building-geometry";
import { ornamentedCells } from "../src/fx/ornament";
import { trimmedCells } from "../src/fx/trim";
import { createCrashcatWorld } from "../src/physics/crashcat";
import type { Ornament } from "../src/structure/blueprint";
import { structureColliders } from "../src/structure/colliders";
import { createStructure, type StructureOptions } from "../src/structure/structure";

const DT = 1 / 60;
const LAMP: Ornament = { kind: "cylinder", centre: [0.5, 0.5], radius: 0.05, bottom: 1, top: 3, colour: 0x222222 };

/** A solid 3 × 4 × 3 block of concrete with a lamp post on the middle of its roof. */
function block(origin: [number, number, number] = [0, 0, 0]): StructureOptions {
  const count = 3 * 4 * 3;
  const top = 1 + 3 * (1 + 3 * 3);
  return {
    origin,
    size: [3, 4, 3],
    cells: {
      alive: new Uint8Array(count).fill(1),
      mass: new Float32Array(count).fill(1),
      integrity: new Float32Array(count).fill(100),
      material: new Uint8Array(count),
      colour: new Uint32Array(count).fill(0x999999),
      ornaments: new Map([[top, [LAMP]]]),
    },
  };
}

const tallest = (m: { position: Float32Array }) => Math.max(...m.position.filter((_, k) => k % 3 === 1));
const meshOf = (s: ReturnType<typeof createStructure>) =>
  buildingMesh({ size: s.size, alive: s.alive, colour: s.colour, cut: trimmedCells(s), ornaments: ornamentedCells(s) });

test("an Ornament is drawn but has no collider", () => {
  const s = createStructure(block());
  const bare = createStructure({ ...block(), cells: { ...block().cells!, ornaments: undefined } });
  expect(structureColliders(s)).toEqual(structureColliders(bare));
  expect(tallest(meshOf(s))).toBeCloseTo(6);
  expect(tallest(meshOf(bare))).toBe(4);
});

test("an Ornament goes when its Cell is destroyed", () => {
  const s = createStructure(block());
  s.applyBlast([1.5, 3.5, 1.5], 0.1, 1e6);
  expect(s.alive[1 + 3 * (1 + 3 * 3)]).toBe(0);
  expect(tallest(meshOf(s))).toBe(4);
});

test("an Ornament on a Cell that Detaches falls with it and stays on the Rubble", () => {
  const world = createCrashcatWorld();
  world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
  const buildings = createBuildings(world, inlineStructures(), [block()]);
  const collapse = createCollapse(world, buildings, createDebris(world, { cap: 150 }), { ...DEFAULT_COLLAPSE });
  const [target] = buildings.list;
  // Cut the second layer away, leaving the top two floating.
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) buildings.blast(target!, { center: [x + 0.5, 1.5, z + 0.5], radius: 0.1, power: 1e6, outward: [0, 1, 0] });
  for (const outcome of buildings.drain()) collapse.apply(outcome);
  const lamp = 1 + 3 * (1 + 3 * 3);
  expect(collapse.fragments.some((f) => f.cells.includes(lamp))).toBe(true);
  for (let n = 0; n < 10 / DT && collapse.moving > 0; n++) {
    world.step(DT);
    collapse.update(DT);
  }
  const rubble = buildings.drainAdded().filter((b) => b.rubble);
  expect([...rubble.flatMap((b) => [...b.structure.ornaments.values()])].flat()).toEqual([LAMP]);
});
