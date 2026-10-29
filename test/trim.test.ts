import { expect, test } from "bun:test";
import { trimmedCells } from "../src/fx/trim";
import { structureColliders } from "../src/structure/colliders";
import { createStructure } from "../src/structure/structure";

test("a lighthouse's mesh stays inside its round outline", () => {
  const s = createStructure({ size: [9, 24, 9], blueprint: "lighthouse" });
  const cells = trimmedCells(s);
  expect(cells.size).toBeGreaterThan(0);
  let widest = 0;
  for (const { position } of cells.values()) {
    for (let k = 0; k < position.length; k += 3) widest = Math.max(widest, Math.hypot(position[k]! - 4.5, position[k + 2]! - 4.5));
  }
  expect(widest).toBeLessThanOrEqual(4.5 + 1e-3);
});

test("a lighthouse collides as hulls where it is curved and boxes elsewhere", () => {
  const s = createStructure({ size: [9, 24, 9], blueprint: "lighthouse" });
  const kinds = new Set(structureColliders(s).map((c) => c.shape.kind));
  expect(kinds).toEqual(new Set(["box", "convexHull"]));
  // Hull points stay inside the lighthouse's widest part, the gallery lip.
  for (const c of structureColliders(s)) {
    if (c.shape.kind !== "convexHull") continue;
    const p = c.shape.points;
    for (let k = 0; k < p.length; k += 3) {
      expect(Math.hypot(p[k]! + c.position[0] - 4.5, p[k + 2]! + c.position[2] - 4.5)).toBeLessThanOrEqual(3.5 + 1e-6);
    }
  }
});
