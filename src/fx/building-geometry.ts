/**
 * A Building's render mesh, built per Cell in the Structure's local space
 * (Cell (x, y, z) spans x..x+1, and so on). An intact Cell is a unit cube
 * with the faces it shares with other intact Cells left out. A Cell cut by a
 * Bite carries its own triangles. Plain arrays, so the CSG worker and the
 * main thread can both build it.
 */

export type CellMesh = { position: Float32Array; normal: Float32Array };

export type BuildingShape = {
  size: readonly [number, number, number];
  alive: Uint8Array;
  /** Triangles of the Cells Bites have cut; every other live Cell is intact. */
  cut: Map<number, CellMesh>;
};

// Each face: its outward normal and four corners, counter-clockwise from outside.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
] as const;
const QUAD = [0, 1, 2, 0, 2, 3] as const;

/** A unit cube's 12 triangles at Cell (x, y, z). */
export function cellBox(x: number, y: number, z: number): CellMesh {
  const position = new Float32Array(6 * 6 * 3);
  const normal = new Float32Array(6 * 6 * 3);
  let o = 0;
  for (const face of FACES) o = writeFace(position, normal, o, face, x, y, z);
  return { position, normal };
}

function writeFace(
  position: Float32Array,
  normal: Float32Array,
  offset: number,
  face: (typeof FACES)[number],
  x: number,
  y: number,
  z: number,
): number {
  for (const k of QUAD) {
    const corner = face.c[k];
    position[offset] = x + corner[0];
    position[offset + 1] = y + corner[1];
    position[offset + 2] = z + corner[2];
    normal[offset] = face.n[0];
    normal[offset + 1] = face.n[1];
    normal[offset + 2] = face.n[2];
    offset += 3;
  }
  return offset;
}

/** Merges every live Cell into one non-indexed triangle list. */
export function buildingMesh({ size: [nx, ny, nz], alive, cut }: BuildingShape): CellMesh {
  const index = (x: number, y: number, z: number) => x + nx * (z + nz * y);
  const intact = (x: number, y: number, z: number) =>
    x >= 0 && x < nx && y >= 0 && y < ny && z >= 0 && z < nz && alive[index(x, y, z)] === 1 && !cut.has(index(x, y, z));

  let floats = 0;
  for (let i = 0; i < alive.length; i++) {
    if (!alive[i]) continue;
    floats += cut.get(i)?.position.length ?? 6 * 6 * 3;
  }
  const position = new Float32Array(floats);
  const normal = new Float32Array(floats);

  let o = 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = index(x, y, z);
        if (!alive[i]) continue;
        const own = cut.get(i);
        if (own) {
          position.set(own.position, o);
          normal.set(own.normal, o);
          o += own.position.length;
          continue;
        }
        for (const face of FACES) {
          if (intact(x + face.n[0], y + face.n[1], z + face.n[2])) continue;
          o = writeFace(position, normal, o, face, x, y, z);
        }
      }
    }
  }
  return { position: position.slice(0, o), normal: normal.slice(0, o) };
}
