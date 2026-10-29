import type { Vec3 } from "math";
import type { CompoundChild } from "../physics/PhysicsWorld";
import type { Structure } from "./structure";

/**
 * The collider for a Structure's live Cells, as few boxes as a greedy merge
 * finds: runs of Cells along x, then runs of equal rows along z. Positions are
 * relative to the Structure's origin. Bites never change it; only Cells
 * leaving the Structure do.
 */
export function structureColliders(structure: Structure): CompoundChild[] {
  const [nx, ny, nz] = structure.size;
  const children: CompoundChild[] = [];
  for (let y = 0; y < ny; y++) {
    // Runs along x for each row z, as [x0, x1) pairs.
    const rows: number[][] = [];
    for (let z = 0; z < nz; z++) {
      const runs: number[] = [];
      for (let x = 0; x < nx; x++) {
        if (!structure.alive[structure.index(x, y, z)]) continue;
        const start = x;
        while (x + 1 < nx && structure.alive[structure.index(x + 1, y, z)]) x++;
        runs.push(start, x + 1);
      }
      rows.push(runs);
    }
    for (let z = 0; z < nz; z++) {
      const runs = rows[z]!;
      for (let r = 0; r < runs.length; r += 2) {
        const x0 = runs[r]!;
        const x1 = runs[r + 1]!;
        if (x0 < 0) continue; // already merged into a box from an earlier row
        let z1 = z + 1;
        while (z1 < nz) {
          const next = rows[z1]!;
          const match = findRun(next, x0, x1);
          if (match < 0) break;
          next[match] = -1;
          z1++;
        }
        const half: Vec3 = [(x1 - x0) / 2, 0.5, (z1 - z) / 2];
        children.push({ shape: { kind: "box", halfExtents: half }, position: [x0 + half[0], y + 0.5, z + half[2]] });
      }
    }
  }
  return children;
}

function findRun(runs: number[], x0: number, x1: number): number {
  for (let r = 0; r < runs.length; r += 2) if (runs[r] === x0 && runs[r + 1] === x1) return r;
  return -1;
}
