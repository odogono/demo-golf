import { expect, test } from "bun:test";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { createCrashcatWorld } from "../src/physics/crashcat";
import { splitFoundation } from "../src/structure/foundation";
import { createStructure } from "../src/structure/structure";

const LIGHTHOUSE = { origin: [-4.5, 0, -14.5] as [number, number, number], size: [9, 24, 9] as [number, number, number], blueprint: "lighthouse" as const };

test("a Blueprint's plinth becomes a Foundation, and the Structure stands a layer up on it", () => {
  const whole = createStructure(LIGHTHOUSE);
  const { options, foundation } = splitFoundation(LIGHTHOUSE);
  expect(foundation).toBeDefined();
  const above = createStructure(options);
  expect(above.origin[1]).toBe(1);
  expect(above.size[1]).toBe(23);
  expect(foundation!.structure.cells() + above.cells()).toBe(whole.cells());
  // Standing on the Foundation as it stood on the ground: nothing fails.
  expect(above.evaluate()).toEqual([]);
  expect(above.height()).toBe(23);
});

test("a Blueprint without a plinth has no Foundation", () => {
  const options = { size: [8, 20, 8] as [number, number, number], blueprint: "frame" as const };
  expect(splitFoundation(options)).toEqual({ options });
});

test("the arch's curves keep their place when its Structure moves up off the Foundation", () => {
  const bridge = { size: [24, 10, 7] as [number, number, number], blueprint: "arch-bridge" as const };
  const whole = createStructure(bridge);
  const above = createStructure(splitFoundation(bridge).options);
  const i = whole.index(6, 4, 3);
  const [t] = whole.trims.get(i)!;
  const [moved] = above.trims.get(above.index(6, 3, 3))!;
  // About z, the centre is (x, y): one layer lower in the new grid.
  expect(moved!.centre).toEqual([t!.centre[0], t!.centre[1] - 1]);
});

test("a Foundation collides but isn't a Building, so it is never damaged", () => {
  const world = createCrashcatWorld();
  const buildings = createBuildings(world, inlineStructures(), [LIGHTHOUSE]);
  expect(buildings.foundations).toHaveLength(1);
  expect(buildings.list).toHaveLength(1);
  // Blasting the plinth reaches only the Building above it.
  expect(buildings.within([0, 0.5, -10], 0.4)).toEqual([]);
});
