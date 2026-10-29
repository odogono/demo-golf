import { quat, vec3, type Quat, type Vec3 } from "math";
import type { BodyId, CompoundChild, ContactEvent, PhysicsWorld } from "../physics/PhysicsWorld";
import { structureColliders } from "../structure/colliders";
import type { StructureEvent } from "../structure/structure";
import type { BlastOutcome, Building, Buildings } from "./buildings";
import type { Hit } from "./damage";
import type { Debris } from "./debris";

/** Tunable from the debug GUI. */
export type CollapseSettings = {
  /** Radius of the Blast a Fragment's hit on a Neighbour sets off, in metres. */
  hitRadius: number;
  /** Blast power per kg⋅m/s of a Fragment's contact impulse. */
  powerPerImpulse: number;
  /** Fragment contacts softer than this, in kg⋅m/s, do no damage. */
  minImpulse: number;
  /** Radians per second a Tip starts turning at about its pivot edge. */
  tipSpin: number;
  /** Fraction of a Crush's falling speed kept each time a floor lands on the stack. */
  crushImpactKeep: number;
};

export const DEFAULT_COLLAPSE: CollapseSettings = {
  hitRadius: 1.8,
  powerPerImpulse: 0.02,
  minImpulse: 1500,
  tipSpin: 0.4,
  crushImpactKeep: 0.35,
};

/** Seconds after a Fragment's hit before it can cause another. */
const HIT_COOLDOWN = 0.2;
const GRAVITY = 9.81;
/**
 * Most Debris a Crush throws from its pillars, shared between them. More would
 * hit the body cap, which freezes the oldest pieces into Rubble mid-air.
 */
const CRUSH_DEBRIS = 40;

/** A piece of a Building, in the Building's grid. `mask` marks its Cells. */
type Piece = { building: Building; cells: number[]; mask: Uint8Array };

/**
 * A Fragment: Cells that left a Structure in a Detach or Tip, now one dynamic
 * body with a compound collider of boxes. Once it sleeps it becomes Rubble: a
 * new Building where it lies, turned to the nearest upright grid, that takes
 * Blasts like any other.
 */
export type Fragment = Piece & {
  id: BodyId;
  /** The Building's origin relative to the body, so its grid can be drawn on the body. */
  offset: Vec3;
  position: Vec3;
  rotation: Quat;
  lastHit: number;
};

/**
 * A floor of a Crush: a slab and the pillars standing on it, up to the next
 * slab. It falls with the rest of the block until its slab lands `drop`
 * metres down, on the stack below; the impact blows its pillars out.
 */
export type Floor = {
  building: Building;
  slab: Uint8Array;
  pillars: Uint8Array;
  drop: number;
  landed: boolean;
};

/**
 * A Crush, as a scripted chain reaction. The floors above the crushed layer
 * fall as one block. Each time the lowest still falling floor lands on the
 * stack, its pillars blow out and the block above, slowed by the impact,
 * falls on through the gap. When the top floor lands, the stack becomes
 * Rubble: a new Building.
 */
export type Pancake = {
  building: Building;
  /** From the bottom up. */
  floors: Floor[];
  /** Metres the floors still falling have dropped, and their speed downward. */
  fallen: number;
  speed: number;
  /** Debris each blown-out pillar Cell throws, on average. */
  debrisShare: number;
  done: boolean;
};

/** Metres a floor of `pancake` has fallen so far. */
export function floorFall(pancake: Pancake, floor: Floor): number {
  return floor.landed ? floor.drop : pancake.fallen;
}

/**
 * Carries out the events of each Structure (ADR 0001): Detach and Tip split
 * their Cells off into Fragments, Crush blows out the pillars and drops the floors. A Fragment that hits
 * another Building sets off a Blast on its Structure, scaled by the impulse.
 */
export function createCollapse(
  world: PhysicsWorld,
  buildings: Buildings,
  debris: Debris,
  settings: CollapseSettings,
  random = Math.random,
) {
  const fragments: Fragment[] = [];
  const pancakes: Pancake[] = [];
  const bursts: { center: Vec3; outward: Vec3 }[] = [];
  const contacts: ContactEvent[] = [];
  world.onContact((event) => contacts.push(event));
  let time = 0;

  function piece(building: Building, cells: number[]): Piece {
    const mask = new Uint8Array(building.structure.count);
    for (const i of cells) mask[i] = 1;
    return { building, cells, mask };
  }

  function centreOfMass(building: Building, cells: number[]): Vec3 {
    const { structure } = building;
    const com = vec3.create();
    const c = vec3.create();
    let total = 0;
    for (const i of cells) {
      const m = structure.mass[i]!;
      vec3.scaleAndAdd(com, com, structure.cellCenter(c, i), m);
      total += m;
    }
    return vec3.scale(com, com, 1 / total);
  }

  function split(building: Building, event: Extract<StructureEvent, { kind: "detach" | "tip" }>) {
    const p = piece(building, event.cells);
    const com = centreOfMass(building, event.cells);
    const offset = vec3.subtract(vec3.create(), building.structure.origin, com);
    const children: CompoundChild[] = structureColliders(building.structure, p.mask).map((child) => ({
      ...child,
      position: vec3.add(vec3.create(), child.position, offset),
    }));
    if (children.length === 0) return;

    let angularVelocity: Vec3 | undefined;
    let linearVelocity: Vec3 | undefined;
    if (event.kind === "tip") {
      // Start it turning about the pivot edge, away from the layer it stood on.
      const [x0, z0, x1, z1] = event.pivot;
      const pivot: Vec3 = [(x0 + x1) / 2, building.structure.origin[1] + event.layer + 1, (z0 + z1) / 2];
      const out = tipDirection(building, event.layer, event.pivot, com);
      angularVelocity = vec3.scale(vec3.create(), vec3.cross(vec3.create(), [0, 1, 0], out), settings.tipSpin);
      linearVelocity = vec3.cross(vec3.create(), angularVelocity, vec3.subtract(vec3.create(), com, pivot));
    }

    const id = world.addBody({
      shape: { kind: "compound", children },
      motion: "dynamic",
      position: com,
      linearVelocity,
      angularVelocity,
      friction: 0.8,
      restitution: 0.05,
    });
    fragments.push({ ...p, id, offset, position: com, rotation: quat.create(), lastHit: -Infinity });
  }

  /**
   * The horizontal unit direction a Tip falls: across the pivot edge, away
   * from the Cells still standing on its layer, or toward the centre of mass
   * if none are left.
   */
  function tipDirection(building: Building, layer: number, [x0, z0, x1, z1]: [number, number, number, number], com: Vec3): Vec3 {
    const { structure } = building;
    const [nx, , nz] = structure.size;
    const mid: Vec3 = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
    const out: Vec3 = vec3.normalize(vec3.create(), [z1 - z0, 0, x0 - x1]);
    const c = vec3.create();
    const standing = vec3.create();
    let n = 0;
    for (let col = 0; col < nx * nz; col++) {
      const i = col + nx * nz * layer;
      if (!structure.alive[i]) continue;
      vec3.add(standing, standing, structure.cellCenter(c, i));
      n++;
    }
    // With nothing left standing, fall the way the centre of mass leans.
    const from = n > 0 ? vec3.scale(standing, standing, 1 / n) : vec3.subtract(standing, vec3.scale(c, mid, 2), com);
    const away = (from[0] - mid[0]) * out[0] + (from[2] - mid[2]) * out[2];
    return away > 0 ? vec3.negate(out, out) : out;
  }

  /**
   * Makes Rubble of Cells at rest: a new Building whose grid holds them,
   * given each Cell's world centre. Centres must lie on one 1 m lattice. A
   * grid that ends up within half a metre of the ground is set on it.
   */
  function rubble(source: Building, cells: number[], centres: Vec3[]) {
    if (cells.length === 0) return;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    for (const c of centres) for (let k = 0; k < 3; k++) min[k] = Math.min(min[k]!, c[k]! - 0.5);
    const at = centres.map((c) => c.map((v, k) => Math.round(v - 0.5 - min[k]!)) as Vec3);
    const size: Vec3 = [0, 0, 0];
    for (const p of at) for (let k = 0; k < 3; k++) size[k] = Math.max(size[k]!, p[k]! + 1);
    const count = size[0] * size[1] * size[2];
    const grid = { alive: new Uint8Array(count), mass: new Float32Array(count), integrity: new Float32Array(count) };
    const { structure } = source;
    cells.forEach((cell, n) => {
      const [x, y, z] = at[n]!;
      const i = x + size[0] * (z + size[2] * y);
      grid.alive[i] = 1;
      grid.mass[i] = structure.mass[cell]!;
      // The Structure zeroes a Cell's Integrity when it leaves, so Rubble starts whole.
      grid.integrity[i] = structure.fullIntegrity;
    });
    if (min[1] < 0.5) min[1] = 0;
    buildings.addRubble({ ...source.options, origin: min, size, cells: grid });
  }

  /** Turns a sleeping Fragment into Rubble, snapping its rotation to the nearest axis-aligned one. */
  function settleFragment(fragment: Fragment) {
    const turn = nearestUpright(world.getRotation(fragment.id));
    const position = world.getPosition(fragment.id);
    const { structure } = fragment.building;
    const local = vec3.create();
    const centres = fragment.cells.map((i) => {
      vec3.add(local, vec3.subtract(local, structure.cellCenter(local, i), structure.origin), fragment.offset);
      return vec3.add(vec3.create(), position, applyTurn(turn, local));
    });
    world.removeBody(fragment.id);
    rubble(fragment.building, fragment.cells, centres);
  }

  /**
   * Splits a Crush's falling Cells into floors. A layer with at least half as
   * many Cells as the fullest is a slab; the rest are pillars, belonging to
   * the slab below them. Floor `n`, counting up from the lowest, lands with
   * its slab's bottom `n` metres above whatever is left beneath the lowest
   * slab: the crushed layer's bottom, or lower if the Cells under it are gone. Pillars below the
   * lowest slab blow out at once: they gave way in the Crush.
   */
  function pancake(building: Building, layer: number, falling: number[]): Pancake {
    const { structure } = building;
    const byLayer = new Map<number, number[]>();
    for (const i of falling) {
      const y = structure.coords(i)[1];
      byLayer.set(y, [...(byLayer.get(y) ?? []), i]);
    }
    const fullest = Math.max(...[...byLayer.values()].map((cells) => cells.length));
    const slabLayers = [...byLayer.keys()].filter((y) => byLayer.get(y)!.length * 2 >= fullest).sort((a, b) => a - b);
    // The stack lands on the highest Cell left under the lowest slab, or the ground.
    const [nx, , nz] = structure.size;
    let base = 0;
    for (const i of byLayer.get(slabLayers[0]!)!) {
      const col = i % (nx * nz);
      for (let y = Math.min(layer, structure.coords(i)[1]) - 1; y >= base; y--) {
        if (structure.alive[col + nx * nz * y]) {
          base = y + 1;
          break;
        }
      }
    }
    const floors: Floor[] = slabLayers.map((y, n) => {
      const slab = new Uint8Array(structure.count);
      for (const i of byLayer.get(y)!) slab[i] = 1;
      return { building, slab, pillars: new Uint8Array(structure.count), drop: Math.max(0, y - (base + n)), landed: false };
    });
    const loose: number[] = [];
    let pillarCount = 0;
    for (const [y, cells] of byLayer) {
      if (slabLayers.includes(y)) continue;
      pillarCount += cells.length;
      const below = slabLayers.findLastIndex((s) => s < y);
      if (below < 0) loose.push(...cells);
      else for (const i of cells) floors[below]!.pillars[i] = 1;
    }
    const result: Pancake = {
      building,
      floors,
      fallen: 0,
      speed: 0,
      debrisShare: CRUSH_DEBRIS / Math.max(1, pillarCount),
      done: false,
    };
    for (const cell of loose) blowOut(building, cell, result.debrisShare);
    return result;
  }

  function blowOut(building: Building, cell: number, share: number) {
    const { origin, size } = building.structure;
    const centre = building.structure.cellCenter(vec3.create(), cell);
    const out = vec3.normalize(vec3.create(), [
      centre[0] - (origin[0] + size[0] / 2),
      0.2,
      centre[2] - (origin[2] + size[2] / 2),
    ]);
    if (random() < share) debris.spawn(centre, out, 1);
    bursts.push({ center: centre, outward: out });
  }

  /** Turns a landed stack of slabs into Rubble. */
  function settle(pancake: Pancake) {
    const { structure } = pancake.building;
    const cells: number[] = [];
    const centres: Vec3[] = [];
    for (const floor of pancake.floors) {
      floor.slab.forEach((on, i) => {
        if (!on) return;
        cells.push(i);
        const c = structure.cellCenter(vec3.create(), i);
        c[1] -= floor.drop;
        centres.push(c);
      });
    }
    rubble(pancake.building, cells, centres);
  }

  return {
    settings,
    fragments: fragments as readonly Fragment[],
    pancakes: pancakes as readonly Pancake[],
    /** Where pillars have blown out since the last call, for dust. */
    drainBursts() {
      return bursts.splice(0);
    },

    /** Fragments still simulated. */
    get moving() {
      return fragments.length;
    },

    /** Carries out a Structure's events. Run it on each outcome `buildings.drain` returns. */
    apply({ building, reply }: BlastOutcome) {
      for (const event of reply.events) {
        if (event.kind !== "crush") split(building, event);
        else if (event.falling.length > 0) pancakes.push(pancake(building, event.layer, event.falling));
      }
    },

    /** Call after each physics step. Returns the Blasts Fragments set off on other Buildings. */
    update(dt: number): Hit[] {
      time += dt;
      const hits: Hit[] = [];
      for (const event of contacts.splice(0)) {
        if (event.impulse < settings.minImpulse) continue;
        const fragment = fragments.find((f) => f.id === event.a || f.id === event.b);
        if (!fragment || time - fragment.lastHit < HIT_COOLDOWN) continue;
        const target = buildings.ofBody(fragment.id === event.a ? event.b : event.a);
        if (!target || target === fragment.building) continue;
        fragment.lastHit = time;
        // The normal points from a to b; turn it away from the Building that was hit.
        const outward = fragment.id === event.a ? vec3.negate(vec3.create(), event.normal) : vec3.clone(event.normal);
        const blast = {
          center: vec3.clone(event.point),
          radius: settings.hitRadius,
          power: event.impulse * settings.powerPerImpulse,
          outward,
        };
        buildings.blast(target, blast);
        debris.spawn(blast.center, outward, 5 + Math.round(10 * Math.min(1, blast.power / 150)));
        hits.push({ blast, buildings: [target] });
      }

      for (let i = fragments.length - 1; i >= 0; i--) {
        const fragment = fragments[i]!;
        if (!world.hasBody(fragment.id)) {
          fragments.splice(i, 1);
          continue;
        }
        fragment.position = world.getPosition(fragment.id);
        fragment.rotation = world.getRotation(fragment.id);
        if (fragment.position[1] < -20) {
          world.removeBody(fragment.id);
          fragments.splice(i, 1);
        } else if (world.isSleeping(fragment.id)) {
          settleFragment(fragment);
          fragments.splice(i, 1);
        }
      }

      for (let p = pancakes.length - 1; p >= 0; p--) {
        const pancake = pancakes[p]!;
        pancake.speed += GRAVITY * dt;
        pancake.fallen += pancake.speed * dt;
        for (const floor of pancake.floors) {
          if (floor.landed) continue;
          if (pancake.fallen < floor.drop) break;
          // It hits the stack: its pillars give way and the block above slows.
          floor.landed = true;
          floor.pillars.forEach((p, i) => p && blowOut(pancake.building, i, pancake.debrisShare));
          pancake.speed *= settings.crushImpactKeep;
        }
        if (pancake.floors.every((floor) => floor.landed)) {
          pancake.done = true;
          settle(pancake);
          pancakes.splice(p, 1);
        }
      }
      return hits;
    },

    /** True while a Crush is still pancaking. */
    get animating() {
      return pancakes.length > 0;
    },

    /** Removes every Fragment and Crush in progress. Rubble already at rest is a Building; `buildings.reset` removes it. */
    clear() {
      for (const f of fragments) world.removeBody(f.id);
      fragments.length = 0;
      pancakes.length = 0;
      contacts.length = 0;
      bursts.length = 0;
    },
  };
}

export type Collapse = ReturnType<typeof createCollapse>;

/** A rotation that turns each axis onto another, possibly reversed: row k is where axis k goes. */
type Turn = [Vec3, Vec3, Vec3];

/** The axis-aligned rotation nearest `rotation`. */
export function nearestUpright(rotation: Quat): Turn {
  const turned = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((axis) => vec3.transformQuat(vec3.create(), axis, rotation));
  const snap = (v: Vec3, not: number[]): Vec3 => {
    let best = -1;
    for (let k = 0; k < 3; k++) if (!not.includes(k) && (best < 0 || Math.abs(v[k]!) > Math.abs(v[best]!))) best = k;
    const out: Vec3 = [0, 0, 0];
    out[best] = Math.sign(v[best]!) || 1;
    return out;
  };
  // Snap the axis nearest vertical first, so the piece keeps its up.
  const order = [0, 1, 2].sort((a, b) => Math.abs(turned[b]![1]!) - Math.abs(turned[a]![1]!));
  const result: Vec3[] = [];
  const used: number[] = [];
  for (const k of order.slice(0, 2)) {
    result[k] = snap(turned[k]!, used);
    used.push(result[k]!.findIndex((v) => v !== 0));
  }
  const [a, b] = order as [number, number, number];
  const c = order[2]!;
  // The third axis completes a right-handed frame: x × y = z, cyclically.
  const cross = vec3.cross(vec3.create(), result[a]!, result[b]!);
  result[c] = (c - a + 3) % 3 === 2 ? cross : vec3.negate(cross, cross);
  return result as Turn;
}

function applyTurn([x, y, z]: Turn, v: Vec3): Vec3 {
  return [x[0] * v[0] + y[0] * v[1] + z[0] * v[2], x[1] * v[0] + y[1] * v[1] + z[1] * v[2], x[2] * v[0] + y[2] * v[1] + z[2] * v[2]];
}
