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
  /**
   * Part of the Foundation: the fixed plinth the building stands on, which is
   * never damaged and isn't counted as Destroyed. Only the ground layer may be,
   * and then all of it.
   */
  foundation?: true;
};

/** Says, for each Cell of a grid of `size`, whether it is empty or what it is made of. */
export type Blueprint = (x: number, y: number, z: number) => BlueprintCell | undefined;

export type BlueprintName = "frame" | "lighthouse" | "car-park" | "glass-office" | "arch-bridge";

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
 * that true shape. The shaft is stone, strong enough that losing one side of
 * a storey doesn't Crush the rest of it, so the tower Tips instead when given
 * a `tipMargin` near 2 (#37). It needs `size` about 9 × 24 × 9.
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
      return [{ material: "stone", colour: Math.floor((y - 1) / 2) % 2 === 0 ? WHITE : RED, pieces: [ring] }];
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

const CORAL = 0xee8a62;
const SLAB = 0xe2ddd2;
const CREAM = 0xf1e4c8;
const RAIL = 0x3556b8;
const CARS = [0xc8402f, 0x3a5fb0, 0xe9e6df, 0x4f7a6a];

/** The nearest and farthest the footprint of Cell (x, z) comes to the vertical axis through `centre`. */
function reach(x: number, z: number, [cx, cz]: [number, number]): { near: number; far: number } {
  return {
    near: Math.hypot(Math.max(x - cx, 0, cx - x - 1), Math.max(z - cz, 0, cz - z - 1)),
    far: Math.hypot(Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx)), Math.max(Math.abs(z - cz), Math.abs(z + 1 - cz))),
  };
}

/**
 * A multi-storey car park on a round-cornered stone plinth. A deck every
 * `floorHeight` metres, its edge Cells banded coral and railed in blue, rests
 * on slender round columns. A hollow round stair tower with a blue dome fills
 * one corner and rises a storey past the roof. Cars are parked on every deck.
 * Railings and cars are Ornaments. It needs `size` about 9 × 15 × 9.
 */
export function carParkBlueprint({ size: [nx, ny, nz], floorHeight }: FrameOptions): Blueprint {
  const corner = 2;
  const radius = 1.5;
  const tower: [number, number] = [radius, radius];
  const towerWall = 0.5;
  const roof = Math.floor((ny - 3) / floorHeight) * floorHeight;
  const columns = [1, Math.floor(nx / 2), nx - 2];
  const deck = (y: number) => y === 0 || (y % floorHeight === 0 && y <= roof);

  /** The deck's outline, a rectangle with rounded corners: undefined outside it, else its trim (empty when whole). */
  function outline(x: number, z: number): Trim[] | undefined {
    const cx = x < corner ? corner : x >= nx - corner ? nx - corner : undefined;
    const cz = z < corner ? corner : z >= nz - corner ? nz - corner : undefined;
    if (cx === undefined || cz === undefined) return [];
    const { near, far } = reach(x, z, [cx, cz]);
    if (near > corner - SLIVER) return undefined;
    return far <= corner ? [] : [{ centre: [cx, cz], outer: corner }];
  }

  /** A railing along each of the Cell's sides that faces out of the deck. */
  function railings(x: number, z: number): Ornament[] {
    const out: Ornament[] = [];
    const rail = (min: [number, number, number], max: [number, number, number]) => out.push({ kind: "box", min, max, colour: RAIL });
    if (x === 0) rail([0.02, 1.85, 0], [0.08, 1.92, 1]);
    if (x === nx - 1) rail([0.92, 1.85, 0], [0.98, 1.92, 1]);
    if (z === 0) rail([0, 1.85, 0.02], [1, 1.92, 0.08]);
    if (z === nz - 1) rail([0, 1.85, 0.92], [1, 1.92, 0.98]);
    if (out.length > 0) {
      const px = x === 0 ? 0.05 : x === nx - 1 ? 0.95 : 0.5;
      const pz = z === 0 ? 0.05 : z === nz - 1 ? 0.95 : 0.5;
      out.push({ kind: "cylinder", centre: [px, pz], radius: 0.03, bottom: 1, top: 1.88, colour: RAIL });
    }
    return out;
  }

  /** A small car parked across Cell (x, z) and the next along x. */
  const car = (colour: number): Ornament[] => [
    { kind: "box", min: [0.15, 1.15, 0.2], max: [1.85, 1.6, 0.85], colour },
    { kind: "box", min: [0.55, 1.6, 0.25], max: [1.45, 1.95, 0.8], colour },
    ...[0.45, 1.55].flatMap((wx) =>
      [0.22, 0.83].map((wz): Ornament => ({ kind: "box", min: [wx - 0.17, 1, wz - 0.05], max: [wx + 0.17, 1.3, wz + 0.05], colour: WINDOW })),
    ),
  ];
  const bays: [number, number][] = [
    [Math.floor(nx / 2) - 2, nz - 3],
    [Math.floor(nx / 2) + 1, nz - 3],
    [Math.floor(nx / 2) + 1, Math.floor(nz / 2) - 2],
  ];

  return (x, y, z) => {
    const { near, far } = reach(x, z, tower);
    // The stair tower: hollow, capped with a dome, and standing free of the
    // decks so that they rest on their columns alone.
    if (y > 0 && near < radius - SLIVER) {
      if (y === roof + 1) return { material: "stone", colour: NAVY, trim: [{ centre: tower, outer: radius + 0.1, outerTop: radius * 0.6 }] };
      if (y === roof + 2) {
        return near < radius * 0.6 - SLIVER ? { material: "stone", colour: NAVY, trim: [{ centre: tower, outer: radius * 0.6, outerTop: 0.1 }] } : undefined;
      }
      if (y > roof + 2 || far <= radius - towerWall + SLIVER) return undefined;
      return { material: "concrete", colour: CREAM, trim: [{ centre: tower, outer: radius, inner: radius - towerWall }] };
    }
    if (y > 0 && near < radius + 1 - SLIVER) return undefined;
    if (deck(y)) {
      const trim = outline(x, z);
      if (!trim) return undefined;
      const edge = x === 0 || z === 0 || x === nx - 1 || z === nz - 1 || trim.length > 0;
      const bay = bays.findIndex(([bx, bz]) => bx === x && bz === z);
      const ornaments = [...(y > 0 && trim.length === 0 ? railings(x, z) : []), ...(bay >= 0 && y < roof ? car(CARS[(bay + y) % CARS.length]!) : [])];
      return {
        material: y === 0 ? "stone" : "concrete",
        colour: y === 0 ? STONE : edge ? CORAL : SLAB,
        trim: trim.length > 0 ? trim : undefined,
        ornaments: ornaments.length > 0 ? ornaments : undefined,
      };
    }
    // Slender columns, weaker than the decks: lose two on a level and the decks above it pancake.
    if (y < roof && columns.includes(x) && columns.includes(z)) {
      return { material: "brick", colour: SLAB, trim: [{ centre: [x + 0.5, z + 0.5], outer: 0.3 }] };
    }
    return undefined;
  };
}

const ROOF_BLUE = 0x5b7db1;
const MULLION = 0xf2e3c6;
const CORE = 0xb9b4aa;

/**
 * A slender office tower on a stone plinth, square in plan with rounded
 * corners and gently bowed faces. A round concrete core rises the full height;
 * a floor plate every `floorHeight` metres reaches out from it past a clear
 * glass curtain wall, as a bold cream band. Chunky cream mullions (Ornaments)
 * divide the glass. The ground storey is a cream colonnade around glass. A
 * flat blue cap overhangs the top, with a vent. The glass hangs between the
 * plates and the core carries most of the load, so a hit sheds glass and
 * leaves the core standing. It needs `size` about 9 × 21 × 9.
 */
export function glassOfficeBlueprint({ size: [nx, ny, nz], floorHeight }: FrameOptions): Blueprint {
  const centre: [number, number] = [nx / 2, nz / 2];
  /** Half the width across the faces, the corners' radius, and the radius the faces bow out on. */
  const half = Math.min(nx, nz) / 2 - 1;
  const cornerRadius = 1.2;
  const faceRadius = 12;
  // Each corner's centre, on the diagonal, where its circle meets the faces' circles tangentially.
  const d = (() => {
    const k = faceRadius - half;
    // d² + (d + k)² = (faceRadius - cornerRadius)²
    const c = k * k - (faceRadius - cornerRadius) ** 2;
    return (-2 * k + Math.sqrt(4 * k * k - 8 * c)) / 4;
  })();
  /** Where the faces give way to the corners, as an angle off each face's middle. */
  const faceSpan = Math.atan2(faceRadius * (d / Math.hypot(d, d + faceRadius - half)), half - faceRadius + (faceRadius * (d + faceRadius - half)) / Math.hypot(d, d + faceRadius - half));

  /** The arc of the plan's outline nearest the direction `angle` from the middle: its centre and radius. */
  function arc(angle: number): { at: [number, number]; radius: number } {
    const quarter = Math.round(angle / (Math.PI / 2));
    const off = angle - quarter * (Math.PI / 2);
    const [ux, uz] = [Math.cos(quarter * (Math.PI / 2)), Math.sin(quarter * (Math.PI / 2))];
    if (Math.abs(off) <= faceSpan) return { at: [centre[0] - ux * (faceRadius - half), centre[1] - uz * (faceRadius - half)], radius: faceRadius };
    const side = Math.sign(off);
    // The corner between this face and the next one round.
    const [vx, vz] = [-uz * side, ux * side];
    return { at: [centre[0] + (ux + vx) * d, centre[1] + (uz + vz) * d], radius: cornerRadius };
  }
  const arcOf = (x: number, z: number) => arc(Math.atan2(z + 0.5 - centre[1], x + 0.5 - centre[0]));

  /** Where the outline, grown by `grow`, crosses the ray from the middle at `angle`. */
  function outlineAt(angle: number, grow: number): [number, number] {
    const { at, radius } = arc(angle);
    const [ux, uz] = [Math.cos(angle), Math.sin(angle)];
    const [ax, az] = [at[0] - centre[0], at[1] - centre[1]];
    const b = ux * ax + uz * az;
    const t = b + Math.sqrt(b * b - (ax * ax + az * az) + (radius + grow) ** 2);
    return [centre[0] + ux * t, centre[1] + uz * t];
  }

  /** Cell (x, z) cut to the outline grown by `outer`, less the outline grown by `inner`, if any of it is left. */
  function band(x: number, z: number, outer: number, inner?: number, piece: Omit<Piece, "outer" | "inner"> = {}): Trim[] | undefined {
    const { at, radius } = arcOf(x, z);
    const { near, far } = reach(x, z, at);
    if (near >= radius + outer - SLIVER) return undefined;
    if (inner !== undefined && far <= radius + inner + SLIVER) return undefined;
    const top = Math.max(piece.outerTop ?? 0, 0);
    if (far <= radius + outer && inner === undefined && piece.top === undefined && top === 0) return [];
    const trim: Trim = { centre: at, outer: radius + outer, ...piece };
    if (piece.outerTop !== undefined) trim.outerTop = radius + piece.outerTop;
    if (inner !== undefined) trim.inner = radius + inner;
    return [trim];
  }
  /** Cell (x, z) cut to a disc of `radius` about the middle. */
  function disc(x: number, z: number, radius: number): Trim[] | undefined {
    const { near, far } = reach(x, z, centre);
    if (near >= radius - SLIVER) return undefined;
    return far <= radius ? [] : [{ centre, outer: radius }];
  }

  const glass = 0.3;
  const posts = (count: number, grow: number) => Array.from({ length: count }, (_, k) => outlineAt(((k + 0.5) / count) * Math.PI * 2, grow));
  const mullions = posts(16, 0.04);
  const columns = posts(12, -0.5 - glass / 2);
  /** Upright cream posts from `points` that stand in Cell (x, z). */
  function postsIn(points: [number, number][], x: number, z: number, radius: number): Ornament[] {
    return points
      .filter(([px, pz]) => px >= x && px < x + 1 && pz >= z && pz < z + 1)
      .map(([px, pz]): Ornament => ({ kind: "cylinder", centre: [px - x, pz - z], radius, bottom: 0, top: 1, colour: MULLION }));
  }

  const cell = (material: MaterialName, colour: number, trim: Trim[], ornaments?: Ornament[]): BlueprintCell => ({
    material,
    colour,
    trim: trim.length > 0 ? trim : undefined,
    ornaments: ornaments && ornaments.length > 0 ? ornaments : undefined,
  });
  const lobby = floorHeight + 1;
  const cap = ny - 2;

  return (x, y, z) => {
    if (y === 0) {
      const trim = band(x, z, 0.8);
      return trim && cell("stone", STONE, trim);
    }
    if (y === cap) {
      const trim = band(x, z, 0.45, undefined, { top: 0.7 });
      return trim && cell("stone", ROOF_BLUE, trim);
    }
    if (y === cap + 1) {
      const middle = x === Math.floor(centre[0]) && z === Math.floor(centre[1]);
      if (!middle) return undefined;
      return {
        material: "concrete",
        colour: MULLION,
        trim: [{ centre, outer: 0.45, top: 0.5 }],
        ornaments: [{ kind: "box", min: [0.1, 0.5, 0.1], max: [0.9, 0.62, 0.9], colour: CORE }],
      };
    }
    if (y > cap) return undefined;
    const core = disc(x, z, 1.6);
    if (core) return cell("concrete", CORE, core);
    // A floor plate, its edge a cream band standing proud of the glass.
    if (y === lobby || (y > lobby && (y - lobby) % floorHeight === 0) || y === cap - 1) {
      const trim = band(x, z, 0.2);
      if (!trim) return undefined;
      const edge = band(x, z, 0.2, -0.6) !== undefined;
      return cell("concrete", edge ? MULLION : CORE, trim);
    }
    // The lobby: glass set back behind a colonnade of thick cream columns.
    if (y < lobby) {
      const trim = band(x, z, -0.5, -0.5 - glass);
      return trim && cell("glass", GLASS, trim, postsIn(columns, x, z, 0.22));
    }
    const trim = band(x, z, 0, -glass);
    return trim && cell("glass", GLASS, trim, postsIn(mullions, x, z, 0.07));
  };
}

const ROAD = 0x7d7a78;
const LAMP = 0x2f4fa8;
const LAMP_GLOW = 0xfff2b0;

/**
 * A stone road bridge, long along x. One smooth semicircular arch spans the
 * middle under a flat road deck, with cream spandrels between them and low
 * cream parapets, rounded on top, along both sides. Round cream pillars on
 * stone footings stand at each end of the deck, and sloping coral abutments
 * run from them down to the ground. Blue lamp posts (Ornaments) stand on the
 * pillars and along the parapets. The arch and abutments curve about the z
 * axis and the parapets' coping about x (ADR 0002). The span is brick, the
 * weakest Material, so that Blasts on both sides of the arch can cut right
 * across it and drop the middle; the pillars and footings are stone. It needs
 * `size` about 24 × 10 × 7.
 */
export function archBridgeBlueprint({ size: [nx, ny, nz] }: FrameOptions): Blueprint {
  const deck = ny - 2;
  const end = 3;
  const springing = 1;
  const intrados = (nx - 2 * end) / 2 - 2.5;
  const arch: [number, number] = [nx / 2, springing];
  // Each abutment slopes from the ground at the grid's end to the deck's top by the pillar.
  const lean = 4;
  const slope = (end * end + deck * deck + 2 * deck * lean) / (2 * end);
  const abutments: [number, number][] = [
    [slope, -lean],
    [nx - slope, -lean],
  ];
  const slopeRadius = Math.hypot(slope, lean);

  /** The nearest and farthest the face of Cell (x, y) comes to the z-axis line through `at`. */
  const side = (x: number, y: number, at: [number, number]) => reach(x, y, at);

  const lamp = (cx: number, cz: number, base: number): Ornament[] => [
    { kind: "cylinder", centre: [cx, cz], radius: 0.07, bottom: base, top: base + 2.2, colour: LAMP },
    { kind: "box", min: [cx - 0.16, base + 2.2, cz - 0.16], max: [cx + 0.16, base + 2.6, cz + 0.16], colour: LAMP_GLOW },
    { kind: "cylinder", centre: [cx, cz], radius: 0.22, bottom: base + 2.6, top: base + 2.72, colour: LAMP },
  ];
  const pillarX = [end, nx - end - 1];
  const lampX = [Math.round(nx / 2 - intrados / 2), Math.round(nx / 2 + intrados / 2) - 1];

  return (x, y, z) => {
    const edge = z === 0 || z === nz - 1;
    // The pillars: round, on stone footings, a little above the parapets.
    if (pillarX.includes(x) && edge) {
      if (y === 0) return { material: "stone", colour: STONE };
      if (y > deck + 1) return undefined;
      const top = y === deck + 1;
      return {
        material: "stone",
        colour: WHITE,
        // Just inside the Cell: a cylinder touching all four sides trips up the CSG that cuts it.
        trim: [{ centre: [x + 0.5, z + 0.5], outer: 0.48, ...(top ? { top: 0.6 } : {}) }],
        ornaments: top ? lamp(0.5, 0.5, 0.6) : undefined,
      };
    }
    // Beyond the pillars, the abutments slope to the ground.
    if (x < end || x > nx - end - 1) {
      if (y > deck) return undefined;
      const at = abutments[x < end ? 0 : 1]!;
      const { near, far } = side(x, y, at);
      if (near >= slopeRadius - SLIVER) return undefined;
      return {
        material: "brick",
        colour: y === 0 ? STONE : CORAL,
        trim: far <= slopeRadius ? undefined : [{ axis: "z", centre: at, outer: slopeRadius }],
      };
    }
    // Parapets along both sides of the road, their coping rounded about x.
    if (y === deck + 1) {
      if (!edge) return undefined;
      return {
        material: "brick",
        colour: WHITE,
        trim: [{ axis: "x", centre: [y + 0.5, z + 0.5], outer: 0.48 }],
        ornaments: lampX.includes(x) ? lamp(0.5, 0.5, 0.95) : undefined,
      };
    }
    if (y === deck) return { material: "brick", colour: edge ? WHITE : ROAD };
    if (y > deck) return undefined;
    // The arch ring, and the spandrels filling up to the deck.
    const { near, far } = side(x, y, arch);
    if (far <= intrados + SLIVER && y >= springing) return undefined;
    if (y < springing) {
      if (near < intrados - SLIVER && x > end && x < nx - end - 1) return undefined;
      return { material: "stone", colour: STONE };
    }
    // Painted one colour, since a Cell can't follow the ring's curve with two.
    return {
      material: "brick",
      colour: WHITE,
      trim: near >= intrados ? undefined : [{ axis: "z", centre: arch, outer: Math.max(nx, ny) * 2, inner: intrados }],
    };
  };
}

/** A Blueprint whose ground layer, its plinth or footings, is a Foundation. */
function onFoundation(make: (options: FrameOptions) => Blueprint): (options: FrameOptions) => Blueprint {
  return (options) => {
    const plan = make(options);
    return (x, y, z) => {
      const cell = plan(x, y, z);
      return cell && y === 0 ? { ...cell, foundation: true } : cell;
    };
  };
}

export const BLUEPRINTS: Record<BlueprintName, (options: FrameOptions) => Blueprint> = {
  frame: frameBlueprint,
  lighthouse: onFoundation(lighthouseBlueprint),
  "car-park": onFoundation(carParkBlueprint),
  "glass-office": onFoundation(glassOfficeBlueprint),
  "arch-bridge": onFoundation(archBridgeBlueprint),
};
