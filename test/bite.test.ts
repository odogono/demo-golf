import { expect, test } from "bun:test";
import { createBiteCutter } from "../src/fx/bite";
import { buildingMesh } from "../src/fx/building-geometry";

const triangles = (mesh: { position: Float32Array }) => mesh.position.length / 9;

test("an intact building's mesh leaves out the faces between Cells", () => {
  const mesh = buildingMesh({ size: [2, 1, 1], alive: new Uint8Array([1, 1]), colour: new Uint32Array(2), cut: new Map() });
  expect(triangles(mesh)).toBe(10 * 2);
  const one = buildingMesh({ size: [2, 1, 1], alive: new Uint8Array([1, 0]), colour: new Uint32Array(2), cut: new Map() });
  expect(triangles(one)).toBe(6 * 2);
});

/** A 3×3×3 block, bitten at the middle of its top face. */
function bite(cells: number[]) {
  const cutter = createBiteCutter();
  const alive = new Uint8Array(27).fill(1);
  cutter.handle({ type: "create", id: 0, generation: 1, size: [3, 3, 3], alive, colour: new Uint32Array(27) });
  return cutter.handle({
    type: "update",
    id: 0,
    generation: 1,
    alive: alive.slice(),
    bite: { center: [1.5, 3, 1.5], radius: 0.8, seed: 7, cells },
  })!;
}

test("a Bite cuts only the Cells its Blast damaged", () => {
  const top = 1 + 3 * (1 + 3 * 2); // Cell (1, 2, 1)
  const untouched = bite([]);
  const bitten = bite([top]);
  expect(triangles(untouched)).toBe(6 * 9 * 2);
  expect(triangles(bitten)).toBeGreaterThan(triangles(untouched));

  // Every vertex below the bitten Cell is where the intact mesh had one: nothing else was cut.
  const corners = new Set<string>();
  for (let i = 0; i < untouched.position.length; i += 3) corners.add(untouched.position.subarray(i, i + 3).join());
  for (let i = 0; i < bitten.position.length; i += 3) {
    const [x, y, z] = bitten.position.subarray(i, i + 3);
    const inTop = x! >= 1 && x! <= 2 && y! >= 2 && z! >= 1 && z! <= 2;
    if (!inTop) expect(corners.has(`${x},${y},${z}`)).toBe(true);
  }
});

test("Cells that leave the Structure drop out of the mesh", () => {
  const cutter = createBiteCutter();
  const alive = new Uint8Array([1, 1]);
  cutter.handle({ type: "create", id: 0, generation: 1, size: [2, 1, 1], alive, colour: new Uint32Array(2) });
  const reply = cutter.handle({ type: "update", id: 0, generation: 1, alive: new Uint8Array([1, 0]) })!;
  expect(triangles(reply)).toBe(12);
  // Replies for an older generation of the Building are dropped.
  expect(cutter.handle({ type: "update", id: 0, generation: 0, alive })).toBeUndefined();
});
