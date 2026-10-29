import * as THREE from "three";
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import type { Trim } from "../structure/blueprint";
import type { Structure } from "../structure/structure";
import { toGeometry } from "./bite";
import { cellBox, type CellMesh } from "./building-geometry";

/** Sides on a trimming frustum: enough that a 9 m tower reads as round. */
const SEGMENTS = 64;

/** Trimmed Cells by position and shape: a Structure rebuilt undamaged reuses them. */
const shapes = new Map<string, CellMesh>();
let evaluator: Evaluator | undefined;

/**
 * A vertical frustum around `centre` from height `y0` to `y1` (grid metres),
 * with radius `r0` at `y0` and `r1` at `y1`.
 */
function frustum(centre: [number, number], y0: number, y1: number, r0: number, r1: number): Brush {
  const geometry = new THREE.CylinderGeometry(Math.max(r1, 1e-3), Math.max(r0, 1e-3), y1 - y0, SEGMENTS).deleteAttribute("uv");
  geometry.translate(centre[0], (y0 + y1) / 2, centre[1]);
  const brush = new Brush(geometry);
  brush.updateMatrixWorld();
  return brush;
}

/** One piece of a Cell's shape: its cube cut to the piece's frustum, less its hollow. */
function trimPiece(x: number, y: number, z: number, trim: Trim): CellMesh {
  if (!evaluator) {
    evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal"];
    evaluator.useGroups = false;
  }
  const { centre, outer, outerTop = outer, inner, innerTop = inner, bottom = 0, top = 1 } = trim;
  const radius = (r0: number, r1: number, h: number) => r0 + (r1 - r0) * h;
  const cube = new Brush(toGeometry(cellBox(x, y, z)));
  cube.updateMatrixWorld();
  const shell = frustum(centre, y + bottom, y + top, radius(outer, outerTop, bottom), radius(outer, outerTop, top));
  let result = evaluator.evaluate(cube, shell, INTERSECTION);
  shell.geometry.dispose();
  if (inner !== undefined) {
    // A little taller than the piece, so it cuts cleanly through its top and bottom.
    const hollow = frustum(centre, y + bottom - 0.01, y + top + 0.01, radius(inner, innerTop!, bottom - 0.01), radius(inner, innerTop!, top + 0.01));
    const kept = result;
    result = evaluator.evaluate(kept, hollow, SUBTRACTION);
    kept.geometry.dispose();
    hollow.geometry.dispose();
  }
  const position = result.geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = result.geometry.getAttribute("normal") as THREE.BufferAttribute;
  const mesh = {
    position: (position.array as Float32Array).slice(0, position.count * 3),
    normal: (normal.array as Float32Array).slice(0, normal.count * 3),
  };
  result.geometry.dispose();
  cube.geometry.dispose();
  return mesh;
}

/** A Cell's shape: the union of its pieces, drawn overlapping. */
function trim(x: number, y: number, z: number, pieces: Trim[]): CellMesh {
  const meshes = pieces.map((p) => trimPiece(x, y, z, p));
  const length = meshes.reduce((n, m) => n + m.position.length, 0);
  const position = new Float32Array(length);
  const normal = new Float32Array(length);
  let o = 0;
  for (const m of meshes) {
    position.set(m.position, o);
    normal.set(m.normal, o);
    o += m.position.length;
  }
  return { position, normal };
}

const cache = new WeakMap<Structure, Map<number, CellMesh>>();

/**
 * The triangles of every Cell that only partly fills its cube, trimmed to its
 * Blueprint's true shape (ADR 0002), so curved parts are drawn curved. Shared
 * by everything that draws a Structure's Cells.
 */
export function trimmedCells(structure: Structure): Map<number, CellMesh> {
  let cells = cache.get(structure);
  if (cells) return cells;
  cells = new Map();
  for (const [i, t] of structure.trims) {
    const [x, y, z] = structure.coords(i);
    const key = `${x},${y},${z},${JSON.stringify(t)}`;
    let mesh = shapes.get(key);
    if (!mesh) shapes.set(key, (mesh = trim(x, y, z, t)));
    cells.set(i, mesh);
  }
  cache.set(structure, cells);
  return cells;
}
