import { AXIS_FRAME, type Trim } from "./blueprint";
import { createStructure, type Structure, type StructureOptions } from "./structure";

/**
 * A Foundation: the fixed plinth a Structure stands on. It is not part of the
 * Structure and can never be damaged; Rubble rests on it and the ball rolls
 * on it like the ground. It is kept as a one-layer grid only so it can be
 * meshed and collided like any other.
 */
export type Foundation = { structure: Structure };

/**
 * Splits off the Foundation of a Structure whose Blueprint marks its ground
 * layer as one. The Structure then starts a layer up, standing on the
 * Foundation just as it stood on the ground, so nothing about how it fails
 * changes (ADR 0001). Options without a Foundation come back unchanged.
 */
export function splitFoundation(options: StructureOptions): { options: StructureOptions; foundation?: Foundation } {
  if (options.cells) return { options };
  const whole = createStructure(options);
  if (whole.foundation.size === 0) return { options };
  const [nx, ny, nz] = whole.size;
  const layer = nx * nz;
  for (let i = 0; i < layer; i++) {
    if (whole.alive[i] && !whole.foundation.has(i)) throw new Error("a Foundation must take the whole ground layer");
  }
  const [ox, oy, oz] = whole.origin;

  /** Cells `from` to `to`, re-indexed from 0, with their trims moved down by `drop` layers. */
  function cells(from: number, to: number, drop: number): NonNullable<StructureOptions["cells"]> {
    const pick = <T>(map: Map<number, T>, move: (v: T) => T) =>
      new Map([...map].filter(([i]) => i >= from && i < to).map(([i, v]) => [i - from, move(v)] as const));
    return {
      alive: whole.alive.slice(from, to),
      mass: whole.mass.slice(from, to),
      integrity: whole.maxIntegrity.slice(from, to),
      material: whole.material.slice(from, to),
      colour: whole.colour.slice(from, to),
      trims: pick(whole.trims, (pieces) => pieces.map((t) => lower(t, drop))),
      ornaments: pick(whole.ornaments, (o) => o),
    };
  }

  const above: StructureOptions = {
    ...options,
    origin: [ox, oy + 1, oz],
    size: [nx, ny - 1, nz],
    cells: cells(layer, layer * ny, 1),
  };
  const base = createStructure({ ...options, origin: [ox, oy, oz], size: [nx, 1, nz], cells: cells(0, layer, 0) });
  return { options: above, foundation: { structure: base } };
}

/** A trim moved down `drop` layers: only a horizontal axis's centre has a height in it. */
function lower(trim: Trim, drop: number): Trim {
  if (drop === 0) return trim;
  const [u, , v] = AXIS_FRAME[trim.axis ?? "y"];
  return { ...trim, centre: [trim.centre[0] - (u === 1 ? drop : 0), trim.centre[1] - (v === 1 ? drop : 0)] };
}
