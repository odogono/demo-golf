/**
 * Blueprints and Materials (ADR 0002). A Blueprint lays out a building's Cells
 * and their Materials; every kind of building differs only in its Blueprint.
 * Blueprints are named in `StructureOptions` so the options can cross to the
 * worker, and resolved to a function here.
 */

export type Material = {
  /** Mass of one Cell. */
  mass: number;
  /** Integrity of an undamaged Cell, as a multiple of the Structure's `integrity`. */
  toughness: number;
  /** Capacity as a multiple of the Structure's usual sizing. */
  strength: number;
  /** Colour of the Debris it throws off. */
  debris: number;
};

export const MATERIALS = {
  concrete: { mass: 1, toughness: 1, strength: 1, debris: 0x9a948a },
  brick: { mass: 1, toughness: 0.4, strength: 0.6, debris: 0xb5523b },
  stone: { mass: 1.5, toughness: 1.2, strength: 1, debris: 0x8f8a80 },
  glass: { mass: 0.4, toughness: 0.3, strength: 0.8, debris: 0xd6eef5 },
} as const satisfies Record<string, Material>;

export type MaterialName = keyof typeof MATERIALS;
/** Materials by index, as stored per Cell in a Structure. */
export const MATERIAL_NAMES = Object.keys(MATERIALS) as MaterialName[];

/**
 * The true shape of a Cell that only partly fills its cube: the part of the
 * cube inside a cylinder or cone of radius `outer` (at the Cell's bottom) to
 * `outerTop` (at its top), outside one of radius `inner` to `innerTop`, and
 * between `bottom` and `top` (0 to 1 within the Cell). The cylinder stands on
 * `axis`, vertical by default; "bottom" and "top" run along it. Radii are
 * around the line through `centre`, given in the other two axes in order:
 * (x, z) about y, (y, z) about x, (x, y) about z. A horizontal axis curves
 * the underside of an arch. The mesh and the collider follow it; the
 * Structure treats the Cell as a whole cube.
 */
export type Trim = {
  axis?: Axis;
  centre: [number, number];
  outer: number;
  outerTop?: number;
  inner?: number;
  innerTop?: number;
  bottom?: number;
  top?: number;
};

export type Axis = "x" | "y" | "z";

/**
 * Which world axis plays each part of a Trim's own frame: across (the first
 * of `centre`), along the axis, and across again (the second of `centre`).
 */
export const AXIS_FRAME: Record<Axis, readonly [number, number, number]> = { y: [0, 1, 2], x: [1, 0, 2], z: [0, 2, 1] };

/** Points around a circle when tracing a curved edge. */
const ARC_SEGMENTS = 64;

/**
 * The outline, in the Cell's (x, z), of the part of the unit square at
 * (`x`, `z`) between radii `inner` and `outer` around `centre`. For an
 * annulus the inner arc is replaced by its chord, so the outline is convex.
 */
export function trimOutline(x: number, z: number, centre: [number, number], outer: number, inner = 0): [number, number][] {
  const [cx, cz] = centre;
  const points: [number, number][] = [];
  const within = (px: number, pz: number) => {
    const d = Math.hypot(px - cx, pz - cz);
    return d <= outer + 1e-9 && d >= inner - 1e-9 && px >= x - 1e-9 && px <= x + 1 + 1e-9 && pz >= z - 1e-9 && pz <= z + 1 + 1e-9;
  };
  for (const [px, pz] of [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]] as const) if (within(px, pz)) points.push([px, pz]);
  for (const r of inner > 0 ? [outer, inner] : [outer]) {
    for (let k = 0; k < ARC_SEGMENTS; k++) {
      const a = (k / ARC_SEGMENTS) * Math.PI * 2;
      const px = cx + r * Math.cos(a);
      const pz = cz + r * Math.sin(a);
      if (within(px, pz)) points.push([px, pz]);
    }
    // Where the circle crosses the square's edges.
    for (const ex of [x, x + 1]) {
      const h = r * r - (ex - cx) ** 2;
      if (h >= 0) for (const pz of [cz - Math.sqrt(h), cz + Math.sqrt(h)]) if (within(ex, pz)) points.push([ex, pz]);
    }
    for (const ez of [z, z + 1]) {
      const h = r * r - (ez - cz) ** 2;
      if (h >= 0) for (const px of [cx - Math.sqrt(h), cx + Math.sqrt(h)]) if (within(px, ez)) points.push([px, ez]);
    }
  }
  return points;
}

/** Points whose convex hull is a trimmed Cell's collider, relative to the Cell's centre. */
export function trimHullPoints(x: number, y: number, z: number, trim: Trim): number[] {
  const { axis = "y", centre, outer, outerTop = outer, inner = 0, innerTop = inner, bottom = 0, top = 1 } = trim;
  const [u, a, v] = AXIS_FRAME[axis];
  const cell = [x, y, z];
  const out: number[] = [];
  const point = [0, 0, 0];
  for (const [h, ro, ri] of [
    [bottom, outer + (outerTop - outer) * bottom, inner + (innerTop - inner) * bottom],
    [top, outer + (outerTop - outer) * top, inner + (innerTop - inner) * top],
  ] as const) {
    for (const [pu, pv] of trimOutline(cell[u]!, cell[v]!, centre, ro, ri)) {
      point[u] = pu - cell[u]! - 0.5;
      point[a] = h - 0.5;
      point[v] = pv - cell[v]! - 0.5;
      out.push(...point);
    }
  }
  return out;
}

/**
 * A detail drawn on a Cell that the game otherwise ignores: no mass, no
 * collider, no damage. It moves with its Cell and goes when the Cell does.
 * Positions are metres from the Cell's lowest corner and may reach past it,
 * like a lamp post standing on a deck. A box spans `min` to `max`; a cylinder
 * stands upright on `centre` (x, z) from `bottom` to `top`.
 */
export type Ornament =
  | { kind: "box"; min: [number, number, number]; max: [number, number, number]; colour: number }
  | { kind: "cylinder"; centre: [number, number]; radius: number; bottom: number; top: number; colour: number };

/** A Cell in a Blueprint. `colour` is paint only and never affects physics. */
export type BlueprintCell = {
  material: MaterialName;
  colour: number;
  mass?: number;
  /** The Cell's true shape, as the union of these pieces; a whole cube if absent. */
  trim?: Trim[];
  ornaments?: Ornament[];
};

/** Says, for each Cell of a grid of `size`, whether it is empty or what it is made of. */
export type Blueprint = (x: number, y: number, z: number) => BlueprintCell | undefined;

export type BlueprintName = "frame" | "lighthouse";

export type FrameOptions = {
  size: readonly [number, number, number];
  floorHeight: number;
  pillarSpacing: number;
  slabMass: number;
  pillarMass: number;
};

const FRAME_COLOUR = 0xb0aaa0;

/** A slab on every floor and a roof, held up by pillars on the edges and at most `pillarSpacing` apart. */
export function frameBlueprint({ size: [nx, ny, nz], floorHeight, pillarSpacing, slabMass, pillarMass }: FrameOptions): Blueprint {
  const pillarLines = (n: number) => {
    const lines = new Set([0, n - 1]);
    const gaps = Math.ceil((n - 1) / pillarSpacing);
    for (let g = 1; g < gaps; g++) lines.add(Math.round((g * (n - 1)) / gaps));
    return lines;
  };
  const pillarsX = pillarLines(nx);
  const pillarsZ = pillarLines(nz);
  return (x, y, z) => {
    const slab = y % floorHeight === 0 || y === ny - 1;
    const pillar = pillarsX.has(x) && pillarsZ.has(z);
    if (!slab && !pillar) return undefined;
    return { material: "concrete", colour: FRAME_COLOUR, mass: pillar ? pillarMass : slabMass };
  };
}

const RED = 0xc8402f;
const WHITE = 0xf1ece0;
const STONE = 0x9a958c;
const NAVY = 0x2f3f6b;
const GLASS = 0xd6eef5;
const ROOF = 0xb8362a;
const WINDOW = 0x1c2433;

/** Below this, a Cell's overlap with a piece is too thin to be worth a Cell. */
const SLIVER = 0.1;

/** A round piece of a Blueprint, shaped as a `Trim` without its centre. */
type Piece = Omit<Trim, "centre">;

/**
 * A striped round lighthouse. A stone plinth carries a hollow, tapering brick
 * shaft with a floor every `floorHeight` metres, recessed dark windows and a door, in
 * red and white bands two metres tall. On top sit a gallery with a lip and a
 * railing, a glass lantern, a red cone roof and a spike. Every part is round
 * about the vertical axis through the middle of `size`, and its Cells carry
 * that true shape. It needs `size` about 9 × 24 × 9.
 */
export function lighthouseBlueprint({ size: [nx, ny, nz], floorHeight }: FrameOptions): Blueprint {
  const centre: [number, number] = [nx / 2, nz / 2];
  const lip = Math.min(nx, nz) / 2 - 1;
  const galleryY = ny - 7;
  const shaftBase = lip - 0.5;
  const shaftTop = lip - 1.1;
  const wall = 0.9;
  /** The shaft's radius at height `h` in metres. */
  const shaft = (h: number) => shaftBase + ((shaftTop - shaftBase) * (h - 1)) / (galleryY - 1);
  const lantern = shaftTop - 0.4;

  /** The pieces making up layer `y`, with their Material and colour. */
  function layer(y: number): { material: MaterialName; colour: number; pieces: Piece[] }[] {
    if (y === 0) return [{ material: "stone", colour: STONE, pieces: [{ outer: lip }] }];
    if (y < galleryY) {
      const ring: Piece = { outer: shaft(y), outerTop: shaft(y + 1) };
      if (y % floorHeight !== 0) Object.assign(ring, { inner: shaft(y) - wall, innerTop: shaft(y + 1) - wall });
      return [{ material: "brick", colour: Math.floor((y - 1) / 2) % 2 === 0 ? WHITE : RED, pieces: [ring] }];
    }
    if (y === galleryY) return [{ material: "stone", colour: NAVY, pieces: [{ outer: shaftTop }, { outer: lip, bottom: 0.6 }] }];
    if (y < galleryY + 4) {
      return [
        { material: "glass", colour: GLASS, pieces: [{ outer: lantern, inner: lantern - 0.5 }] },
        ...(y === galleryY + 1 ? [{ material: "stone" as const, colour: NAVY, pieces: [{ outer: lip, inner: lip - 0.25, top: 0.7 }] }] : []),
      ];
    }
    if (y === galleryY + 4) return [{ material: "stone", colour: ROOF, pieces: [{ outer: lantern + 0.3, outerTop: 1.2 }] }];
    if (y === galleryY + 5) return [{ material: "stone", colour: ROOF, pieces: [{ outer: 1.2, outerTop: 0.15 }] }];
    return [{ material: "stone", colour: NAVY, pieces: [{ outer: 0.15, top: 0.8 }] }];
  }

  /** Windows up the front of the shaft and a door at its foot, facing +z. */
  const opening = (x: number, y: number, z: number) =>
    x === Math.floor(centre[0]) && z > centre[1] && (y === 1 || y === 2 || (y < galleryY && y % floorHeight === 2));

  return (x, y, z) => {
    // The nearest and farthest the Cell's footprint comes to the axis.
    const near = Math.hypot(Math.max(x - centre[0], 0, centre[0] - x - 1), Math.max(z - centre[1], 0, centre[1] - z - 1));
    const far = Math.hypot(
      Math.max(Math.abs(x - centre[0]), Math.abs(x + 1 - centre[0])),
      Math.max(Math.abs(z - centre[1]), Math.abs(z + 1 - centre[1])),
    );
    for (const part of layer(y)) {
      let { material, colour, pieces } = part;
      // An opening is the wall set back and glazed dark.
      if (opening(x, y, z)) {
        material = "glass";
        colour = WINDOW;
        pieces = pieces.map((p) => ({ ...p, outer: p.outer - 0.2, outerTop: (p.outerTop ?? p.outer) - 0.2 }));
      }
      const overlapping = pieces.filter((p) => {
        const outer = Math.max(p.outer, p.outerTop ?? p.outer);
        const inner = Math.min(p.inner ?? 0, p.innerTop ?? p.inner ?? 0);
        return near < outer - SLIVER && far > inner + SLIVER;
      });
      if (overlapping.length === 0) continue;
      // A Cell wholly inside a full-height piece is a plain cube.
      const whole = overlapping.some(
        (p) =>
          far <= Math.min(p.outer, p.outerTop ?? p.outer) &&
          near >= Math.max(p.inner ?? 0, p.innerTop ?? 0) &&
          (p.bottom ?? 0) === 0 &&
          (p.top ?? 1) === 1,
      );
      return { material, colour, trim: whole ? undefined : overlapping.map((p) => ({ centre, ...p })) };
    }
    return undefined;
  };
}

export const BLUEPRINTS: Record<BlueprintName, (options: FrameOptions) => Blueprint> = {
  frame: frameBlueprint,
  lighthouse: lighthouseBlueprint,
};
