import { describe, expect, test } from "bun:test";
import { trimmedCells } from "../src/fx/trim";
import { trimHullPoints, type Trim } from "../src/structure/blueprint";
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

/** One Cell at the grid's corner, trimmed to `trim`. */
function trimmedCell(trim: Trim) {
  return createStructure({
    size: [1, 1, 1],
    cells: {
      alive: new Uint8Array([1]),
      mass: new Float32Array([1]),
      integrity: new Float32Array([100]),
      material: new Uint8Array([0]),
      colour: new Uint32Array([0]),
      trims: new Map([[0, [trim]]]),
    },
  });
}

describe("a trim on a horizontal axis", () => {
  // A quarter round about the z axis through the Cell's lowest edge.
  const arch: Trim = { axis: "z", centre: [0, 0], outer: 1 };

  test("its hull follows the curve across x and y and runs the Cell's length along z", () => {
    const p = trimHullPoints(0, 0, 0, arch);
    const zs = new Set<number>();
    for (let k = 0; k < p.length; k += 3) {
      expect(Math.hypot(p[k]! + 0.5, p[k + 1]! + 0.5)).toBeLessThanOrEqual(1 + 1e-6);
      zs.add(p[k + 2]!);
    }
    expect(zs).toEqual(new Set([-0.5, 0.5]));
    // The curve reaches both the top-left and bottom-right corners.
    expect(p.some((_, k) => k % 3 === 0 && Math.abs(p[k]! + 0.5) < 1e-6 && Math.abs(p[k + 1]! - 0.5) < 1e-6)).toBe(true);
  });

  test("about x, the curve lies across y and z", () => {
    const p = trimHullPoints(0, 0, 0, { axis: "x", centre: [0, 0], outer: 1 });
    for (let k = 0; k < p.length; k += 3) expect(Math.hypot(p[k + 1]! + 0.5, p[k + 2]! + 0.5)).toBeLessThanOrEqual(1 + 1e-6);
  });

  test("its mesh stays inside the curve, with every triangle facing out", () => {
    const { position, normal } = trimmedCells(trimmedCell(arch)).get(0)!;
    expect(position.length).toBeGreaterThan(0);
    for (let k = 0; k < position.length; k += 3) {
      expect(Math.hypot(position[k]!, position[k + 1]!)).toBeLessThanOrEqual(1 + 1e-3);
    }
    for (let t = 0; t < position.length; t += 9) {
      const a = [position[t + 3]! - position[t]!, position[t + 4]! - position[t + 1]!, position[t + 5]! - position[t + 2]!];
      const b = [position[t + 6]! - position[t]!, position[t + 7]! - position[t + 1]!, position[t + 8]! - position[t + 2]!];
      const face = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      if (Math.hypot(...face) < 1e-9) continue;
      expect(face[0]! * normal[t]! + face[1]! * normal[t + 1]! + face[2]! * normal[t + 2]!).toBeGreaterThan(0);
    }
  });
});
