import { vec3, type Vec3 } from "math";
import { quickhull2 } from "math/geometry";
import { polygon2 } from "math/shapes";
import { BLUEPRINTS, MATERIAL_NAMES, MATERIALS, type BlueprintName, type Ornament, type Trim } from "./blueprint";

/**
 * A Structure is a grid of 1 m Cells indexed by (x, y, z), with y up. Cell
 * (x, y, z) occupies the unit cube whose minimum corner is `origin + (x, y, z)`.
 * It is pure data and logic, with no Three.js or physics, so it can run in a
 * worker (ADR 0001).
 */

export interface StructureOptions {
  /** World position of the grid's minimum corner, on the ground. */
  origin?: Vec3;
  /** Bounding box in whole metres: width (x), height (y), depth (z). */
  size: Vec3;
  /** Which Blueprint lays out its Cells; the default is a frame of slabs and pillars. */
  blueprint?: BlueprintName;
  /** Metres from one floor slab to the next. */
  floorHeight?: number;
  /** Largest gap between pillars, in metres. */
  pillarSpacing?: number;
  slabMass?: number;
  pillarMass?: number;
  /** Integrity of an undamaged Cell. */
  integrity?: number;
  /** Capacity as a multiple of the heaviest load on its layer when undamaged. */
  safetyFactor?: number;
  /** How far, in metres, the centre of mass must sit inside a footprint's hull. */
  tipMargin?: number;
  /**
   * Builds the grid from these Cells, indexed like the Structure's own,
   * instead of from the Blueprint, with `integrity` as each Cell's undamaged
   * Integrity. Rubble uses it to become a Building. `trims` gives Cells their
   * true shapes; Cells without one are whole cubes.
   */
  cells?: {
    alive: Uint8Array;
    mass: Float32Array;
    integrity: Float32Array;
    material: Uint8Array;
    colour: Uint32Array;
    trims?: Map<number, Trim[]>;
    ornaments?: Map<number, Ornament[]>;
  };
}

export interface BlastResult {
  /** Cells that lost Integrity and survived. */
  damaged: number[];
  /** Cells whose Integrity reached zero; they are gone from the Structure. */
  destroyed: number[];
}

export type StructureEvent =
  | { kind: "detach"; cells: number[] }
  | { kind: "crush"; layer: number; crushed: number[]; falling: number[] }
  | {
      kind: "tip";
      layer: number;
      cells: number[];
      /** The hull edge the part above topples over, in world (x, z). */
      pivot: [x0: number, z0: number, x1: number, z1: number];
    };

export type Structure = ReturnType<typeof createStructure>;

export function createStructure(options: StructureOptions) {
  const {
    origin = vec3.create(),
    size,
    blueprint = "frame",
    floorHeight = 4,
    pillarSpacing = 4,
    slabMass = 1,
    pillarMass = 2,
    integrity: fullIntegrity = 100,
    safetyFactor = 2,
    tipMargin = 0.25,
    cells,
  } = options;

  const nx = Math.round(size[0]);
  const ny = Math.round(size[1]);
  const nz = Math.round(size[2]);
  const count = nx * ny * nz;

  const alive = new Uint8Array(count);
  const mass = new Float32Array(count);
  const integrity = new Float32Array(count);
  const maxIntegrity = new Float32Array(count);
  /** Index into `MATERIAL_NAMES`. */
  const material = new Uint8Array(count);
  /** Paint, as 0xRRGGBB. */
  const colour = new Uint32Array(count);
  /** The true shapes of Cells that only partly fill their cubes. */
  const trims = new Map<number, Trim[]>();
  /** Details drawn on Cells, which nothing but the renderer sees (ADR 0002). */
  const ornaments = new Map<number, Ornament[]>();
  /** Cells the Blueprint marks as Foundation, which `splitFoundation` takes away. */
  const foundation = new Set<number>();
  const baseCapacity = new Float32Array(count);
  const layerDamaged = new Uint8Array(ny);

  const index = (x: number, y: number, z: number) => x + nx * (z + nz * y);
  const coords = (i: number): [number, number, number] => {
    const x = i % nx;
    const z = Math.floor(i / nx) % nz;
    const y = Math.floor(i / (nx * nz));
    return [x, y, z];
  };
  const isAlive = (x: number, y: number, z: number) =>
    x >= 0 && x < nx && y >= 0 && y < ny && z >= 0 && z < nz && alive[index(x, y, z)] === 1;

  if (cells) {
    alive.set(cells.alive);
    mass.set(cells.mass);
    integrity.set(cells.integrity);
    maxIntegrity.set(cells.integrity);
    material.set(cells.material);
    colour.set(cells.colour);
    for (const [i, t] of cells.trims ?? []) trims.set(i, t);
    for (const [i, o] of cells.ornaments ?? []) ornaments.set(i, o);
  } else {
    const plan = BLUEPRINTS[blueprint]({ size: [nx, ny, nz], floorHeight, pillarSpacing, slabMass, pillarMass });
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const cell = plan(x, y, z);
          if (!cell) continue;
          const i = index(x, y, z);
          const m = MATERIALS[cell.material];
          alive[i] = 1;
          material[i] = MATERIAL_NAMES.indexOf(cell.material);
          colour[i] = cell.colour;
          if (cell.trim) trims.set(i, cell.trim);
          if (cell.ornaments) ornaments.set(i, cell.ornaments);
          if (cell.foundation) foundation.add(i);
          mass[i] = cell.mass ?? m.mass;
          maxIntegrity[i] = fullIntegrity * m.toughness;
          integrity[i] = maxIntegrity[i]!;
        }
      }
    }
  }

  const capacity = (i: number) => (baseCapacity[i]! * integrity[i]!) / maxIntegrity[i]!;

  /** Groups of Cells on a layer joined side by side, as grid columns. */
  function layerGroups(y: number): number[][] {
    const groups: number[][] = [];
    const seen = new Uint8Array(nx * nz);
    for (let start = 0; start < nx * nz; start++) {
      if (seen[start] || !alive[start + nx * nz * y]) continue;
      const group = [start];
      seen[start] = 1;
      for (let g = 0; g < group.length; g++) {
        const x = group[g]! % nx;
        const z = Math.floor(group[g]! / nx);
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (!isAlive(x + dx, y, z + dz)) continue;
          const next = x + dx + nx * (z + dz);
          if (seen[next]) continue;
          seen[next] = 1;
          group.push(next);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  /**
   * The load each Cell carries: its own mass and everything above it, summed
   * down each column from the top. Cells joined side by side on a layer, such
   * as a slab, act as one rigid piece: they pool their load and share it
   * equally among those standing on a Cell that is held up from below. Cells
   * with nothing holding them up from below, like a pillar stub under a slab,
   * hang their mass on the Cell above.
   */
  function computeLoads(): Float32Array {
    const layerSize = nx * nz;
    const layers = Array.from({ length: ny }, (_, y) => layerGroups(y));

    const held = new Uint8Array(count);
    const hanging = new Float32Array(count);
    for (let y = 0; y < ny; y++) {
      for (const group of layers[y]!) {
        const isHeld = y === 0 || group.some((col) => held[col + layerSize * (y - 1)]);
        for (const col of group) {
          const i = col + layerSize * y;
          held[i] = isHeld ? 1 : 0;
          const below = i - layerSize;
          const stub = y > 0 && alive[below] && !held[below] ? hanging[below]! : 0;
          if (!isHeld) hanging[i] = mass[i]! + stub;
          else if (stub > 0) hanging[i] = stub;
        }
      }
    }

    const load = new Float32Array(count);
    let incoming = new Float32Array(layerSize);
    for (let y = ny - 1; y >= 0; y--) {
      const outgoing = new Float32Array(layerSize);
      for (const group of layers[y]!) {
        if (!held[group[0]! + layerSize * y]) continue;
        let total = 0;
        const bearing: number[] = [];
        for (const col of group) {
          const i = col + layerSize * y;
          load[i] = incoming[col]! + mass[i]! + hanging[i]!;
          total += load[i]!;
          if (y === 0 || held[i - layerSize]) bearing.push(col);
        }
        for (const col of bearing) {
          const i = col + layerSize * y;
          load[i] = total / bearing.length;
          outgoing[col] = load[i]!;
        }
      }
      incoming = outgoing;
    }
    return load;
  }

  // Size each layer's Capacity from its heaviest load when undamaged.
  {
    const load = computeLoads();
    for (let y = 0; y < ny; y++) {
      let peak = 0;
      for (let col = 0; col < nx * nz; col++) peak = Math.max(peak, load[col + nx * nz * y]!);
      for (let col = 0; col < nx * nz; col++) {
        const i = col + nx * nz * y;
        if (alive[i]) baseCapacity[i] = peak * safetyFactor * MATERIALS[MATERIAL_NAMES[material[i]!]!].strength;
      }
    }
  }

  function remove(i: number) {
    alive[i] = 0;
    integrity[i] = 0;
    layerDamaged[coords(i)[1]] = 1;
  }

  const NEIGHBOURS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;

  /** Marks every Cell joined to a ground Cell through face neighbours. */
  function groundConnected(): Uint8Array {
    const seen = new Uint8Array(count);
    const stack: number[] = [];
    for (let col = 0; col < nx * nz; col++) {
      if (alive[col]) {
        seen[col] = 1;
        stack.push(col);
      }
    }
    while (stack.length > 0) {
      const [x, y, z] = coords(stack.pop()!);
      for (const [dx, dy, dz] of NEIGHBOURS) {
        if (!isAlive(x + dx, y + dy, z + dz)) continue;
        const j = index(x + dx, y + dy, z + dz);
        if (seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return seen;
  }

  /** Removes every Cell cut off from the ground, one group per island. */
  function detachIslands(): number[][] {
    const seen = groundConnected();
    const islands: number[][] = [];
    for (let start = 0; start < count; start++) {
      if (!alive[start] || seen[start]) continue;
      const island: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const i = stack.pop()!;
        island.push(i);
        const [x, y, z] = coords(i);
        for (const [dx, dy, dz] of NEIGHBOURS) {
          if (!isAlive(x + dx, y + dy, z + dz)) continue;
          const j = index(x + dx, y + dy, z + dz);
          if (seen[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      island.forEach(remove);
      islands.push(island);
    }
    return islands;
  }

  /**
   * Whether the Cells above `layer` would topple off its footprint. Returns the
   * pivot edge in grid (x, z) if they would.
   */
  function tipPivot(layer: number): [number, number, number, number] | undefined {
    const corners: number[] = [];
    let total = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      const [x, y, z] = coords(i);
      if (y === layer) corners.push(x, z, x + 1, z, x + 1, z + 1, x, z + 1);
      else if (y > layer) {
        total += mass[i]!;
        cx += mass[i]! * (x + 0.5);
        cz += mass[i]! * (z + 0.5);
      }
    }
    if (total === 0 || corners.length === 0) return undefined;
    cx /= total;
    cz /= total;

    const hull = quickhull2(corners);
    const verts = hull.flatMap((h) => [corners[2 * h]!, corners[2 * h + 1]!]);
    const n = hull.length;
    const inside = polygon2.containsPoint(verts, n, [cx, cz]);

    // math has no signed point-to-polygon distance, so find the nearest edge here.
    let nearest = Infinity;
    let pivot: [number, number, number, number] = [0, 0, 0, 0];
    for (let e = 0; e < n; e++) {
      const ax = verts[2 * e]!;
      const az = verts[2 * e + 1]!;
      const bx = verts[(2 * (e + 1)) % (2 * n)]!;
      const bz = verts[(2 * (e + 1) + 1) % (2 * n)]!;
      const d = distanceToSegment(cx, cz, ax, az, bx, bz);
      if (d < nearest) {
        nearest = d;
        pivot = [ax, az, bx, bz];
      }
    }
    return inside && nearest >= tipMargin ? undefined : pivot;
  }

  function cellsAbove(layer: number): number[] {
    const cells: number[] = [];
    for (let i = nx * nz * (layer + 1); i < count; i++) if (alive[i]) cells.push(i);
    return cells;
  }

  return {
    size: [nx, ny, nz] as const,
    origin,
    count,
    alive,
    mass,
    integrity,
    maxIntegrity,
    material,
    colour,
    trims,
    ornaments,
    foundation,
    fullIntegrity,
    index,
    coords,
    capacity,
    computeLoads,

    /** World position of a Cell's centre. */
    cellCenter(out: Vec3, i: number): Vec3 {
      const [x, y, z] = coords(i);
      return vec3.set(out, origin[0] + x + 0.5, origin[1] + y + 0.5, origin[2] + z + 0.5);
    },

    materialOf(i: number) {
      return MATERIALS[MATERIAL_NAMES[material[i]!]!];
    },

    /** The Material of the live Cell nearest `point`, or undefined if none are left. */
    materialNear(point: Vec3) {
      let best = -1;
      let bestD = Infinity;
      const c = vec3.create();
      for (let i = 0; i < count; i++) {
        if (!alive[i]) continue;
        const d = vec3.squaredDistance(this.cellCenter(c, i), point);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best < 0 ? undefined : this.materialOf(best);
    },

    /** Damages Cells within `radius` of `center`, falling off linearly to the edge. */
    applyBlast(center: Vec3, radius: number, power: number): BlastResult {
      const damaged: number[] = [];
      const destroyed: number[] = [];
      const c = vec3.create();
      for (let i = 0; i < count; i++) {
        if (!alive[i]) continue;
        const d = vec3.distance(this.cellCenter(c, i), center);
        if (d > radius) continue;
        integrity[i] = integrity[i]! - power * (1 - d / radius);
        layerDamaged[coords(i)[1]] = 1;
        if (integrity[i]! <= 0) {
          remove(i);
          destroyed.push(i);
        } else damaged.push(i);
      }
      return { damaged, destroyed };
    },

    /**
     * Resolves the Structure after damage. Detach comes first; then each layer,
     * from the ground up, either Tips or Crushes, with Tip winning. Repeats
     * until nothing more fails. Every Cell in an event leaves the Structure.
     */
    evaluate(): StructureEvent[] {
      const events: StructureEvent[] = [];
      for (const cells of detachIslands()) events.push({ kind: "detach", cells });

      layers: for (;;) {
        for (let y = 0; y < ny; y++) {
          if (layerDamaged[y]) {
            const pivot = tipPivot(y);
            if (pivot) {
              const cells = cellsAbove(y);
              cells.forEach(remove);
              const [ax, az, bx, bz] = pivot;
              const [ox, , oz] = origin;
              events.push({
                kind: "tip",
                layer: y,
                cells,
                pivot: [ax + ox, az + oz, bx + ox, bz + oz],
              });
              continue layers;
            }
          }

          // Crush, letting each failure shift load onto the rest of the layer.
          const crushed: number[] = [];
          for (;;) {
            const load = computeLoads();
            const failed: number[] = [];
            for (let i = nx * nz * y; i < nx * nz * (y + 1); i++) {
              if (alive[i] && load[i]! > capacity(i)) failed.push(i);
            }
            if (failed.length === 0) break;
            failed.forEach(remove);
            crushed.push(...failed);
          }
          if (crushed.length > 0) {
            // Only islands wholly above the crushed layer pancake onto it. One
            // reaching down past it, like a slab that hung from the layer, has
            // nothing to land on there, so it falls free as a Detach.
            const falling: number[] = [];
            const free: number[][] = [];
            for (const island of detachIslands()) {
              if (island.every((i) => coords(i)[1] > y)) falling.push(...island);
              else free.push(island);
            }
            events.push({ kind: "crush", layer: y, crushed, falling });
            for (const cells of free) events.push({ kind: "detach", cells });
            continue layers;
          }
        }
        return events;
      }
    },

    /** How many Cells are still in the Structure. */
    cells(): number {
      let n = 0;
      for (let i = 0; i < count; i++) n += alive[i]!;
      return n;
    },

    /** Metres from the ground to the top of the highest Cell still connected to it. */
    height(): number {
      const seen = groundConnected();
      for (let i = count - 1; i >= 0; i--) if (seen[i]) return coords(i)[1] + 1;
      return 0;
    },
  };
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const ex = bx - ax;
  const ez = bz - az;
  const lengthSq = ex * ex + ez * ez;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / lengthSq));
  return Math.hypot(px - (ax + t * ex), pz - (az + t * ez));
}
