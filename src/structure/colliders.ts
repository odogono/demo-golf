import type { Vec3 } from "math";
import type { CompoundChild } from "../physics/PhysicsWorld";
import { trimHullPoints } from "./blueprint";
import type { Structure } from "./structure";

/** Thinner than this in any direction, a trimmed piece gets no collider. */
const THIN = 0.05;

/** Each Structure's hull points per trimmed Cell, worked out once: the same arrays are reused so the physics adapter can reuse their shapes. */
const hulls = new WeakMap<Structure, Map<number, number[][]>>();

function hullsOf(structure: Structure): Map<number, number[][]> {
  let cells = hulls.get(structure);
  if (cells) return cells;
  cells = new Map();
  for (const [i, pieces] of structure.trims) {
    const [x, y, z] = structure.coords(i);
    cells.set(i, pieces.map((piece) => trimHullPoints(x, y, z, piece)).filter(thick));
  }
  hulls.set(structure, cells);
  return cells;
}

/**
 * The collider for a Structure's live Cells. Whole Cells become as few boxes
 * as a greedy merge finds: runs of Cells along x, then runs of equal rows
 * along z. A Cell trimmed to its Blueprint's true shape gets a convex hull
 * for each piece, so the ball hits what is drawn (ADR 0002). Positions are
 * relative to the Structure's origin. Bites never change it; only Cells
 * leaving the Structure do. Pass `alive` to collide only some Cells, such as
 * a Fragment's.
 */
export function structureColliders(structure: Structure, alive: Uint8Array = structure.alive): CompoundChild[] {
  const [nx, ny, nz] = structure.size;
  const children: CompoundChild[] = [];
  const box = (i: number) => alive[i] && !structure.trims.has(i);
  for (const [i, pieces] of hullsOf(structure)) {
    if (!alive[i]) continue;
    const [x, y, z] = structure.coords(i);
    for (const points of pieces) {
      children.push({ shape: { kind: "convexHull", points }, position: [x + 0.5, y + 0.5, z + 0.5] });
    }
  }
  for (let y = 0; y < ny; y++) {
    // Runs along x for each row z, as [x0, x1) pairs.
    const rows: number[][] = [];
    for (let z = 0; z < nz; z++) {
      const runs: number[] = [];
      for (let x = 0; x < nx; x++) {
        if (!box(structure.index(x, y, z))) continue;
        const start = x;
        while (x + 1 < nx && box(structure.index(x + 1, y, z))) x++;
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

function thick(points: number[]): boolean {
  if (points.length < 4 * 3) return false;
  for (let k = 0; k < 3; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let p = k; p < points.length; p += 3) {
      lo = Math.min(lo, points[p]!);
      hi = Math.max(hi, points[p]!);
    }
    if (hi - lo < THIN) return false;
  }
  return true;
}

function findRun(runs: number[], x0: number, x1: number): number {
  for (let r = 0; r < runs.length; r += 2) if (runs[r] === x0 && runs[r + 1] === x1) return r;
  return -1;
}
