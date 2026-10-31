import type { Vec3 } from "math";
import type { Structure } from "./structure";

/**
 * Where a Rubble Structure's Cells came from: each Cell's index in `source`,
 * and the quarter turn the piece made as it fell, as the columns x, y and z
 * map to. Anything worked out per Cell, slow to build, such as a trimmed
 * Cell's mesh, can be taken from the source and turned instead.
 */
export type Lineage = { source: Structure; cells: Map<number, number>; turn: [Vec3, Vec3, Vec3] };

const lineages = new WeakMap<Structure, Lineage>();

/** Records that `structure`'s Cells came from another Structure's. */
export function inherit(structure: Structure, lineage: Lineage) {
  lineages.set(structure, lineage);
}

/** Where `structure`'s Cells came from, if it was made from another's. */
export function lineageOf(structure: Structure): Lineage | undefined {
  return lineages.get(structure);
}
