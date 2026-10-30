import * as THREE from "three";
import type { Ornament } from "../structure/blueprint";
import type { Structure } from "../structure/structure";
import type { OrnamentMesh } from "./building-geometry";

/** Sides on an Ornament's cylinder: they are thin, so few are needed. */
const SEGMENTS = 12;

/** Every Ornament on Cell (x, y, z) as one painted triangle list. */
function ornamentMesh(x: number, y: number, z: number, ornaments: Ornament[]): OrnamentMesh {
  const parts = ornaments.map((o) => {
    const geometry =
      o.kind === "box"
        ? new THREE.BoxGeometry(o.max[0] - o.min[0], o.max[1] - o.min[1], o.max[2] - o.min[2]).translate(
            x + (o.min[0] + o.max[0]) / 2,
            y + (o.min[1] + o.max[1]) / 2,
            z + (o.min[2] + o.max[2]) / 2,
          )
        : new THREE.CylinderGeometry(o.radius, o.radius, o.top - o.bottom, SEGMENTS).translate(
            x + o.centre[0],
            y + (o.bottom + o.top) / 2,
            z + o.centre[1],
          );
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    return { geometry: flat, colour: o.colour };
  });
  const length = parts.reduce((n, p) => n + p.geometry.getAttribute("position").count * 3, 0);
  const mesh = { position: new Float32Array(length), normal: new Float32Array(length), colour: new Uint32Array(length / 3) };
  let o = 0;
  for (const { geometry, colour } of parts) {
    const position = geometry.getAttribute("position").array as Float32Array;
    mesh.position.set(position, o);
    mesh.normal.set(geometry.getAttribute("normal").array as Float32Array, o);
    mesh.colour.fill(colour, o / 3, (o + position.length) / 3);
    o += position.length;
    geometry.dispose();
  }
  return mesh;
}

const cache = new WeakMap<Structure, Map<number, OrnamentMesh>>();

/** The triangles of every Cell's Ornaments (ADR 0002), shared by everything that draws a Structure's Cells. */
export function ornamentedCells(structure: Structure): Map<number, OrnamentMesh> {
  let cells = cache.get(structure);
  if (cells) return cells;
  cells = new Map();
  for (const [i, ornaments] of structure.ornaments) cells.set(i, ornamentMesh(...structure.coords(i), ornaments));
  cache.set(structure, cells);
  return cells;
}
