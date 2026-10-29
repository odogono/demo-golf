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
 * body with a compound collider of boxes. It is never evaluated again. Once
 * it sleeps it freezes into Rubble: a static body that stays where it lies.
 */
export type Fragment = Piece & {
  id: BodyId;
  /** The Building's origin relative to the body, so its grid can be drawn on the body. */
  offset: Vec3;
  position: Vec3;
  rotation: Quat;
  rubble: boolean;
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
 * Rubble with a static body.
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
  body: BodyId | undefined;
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
    fragments.push({ ...p, id, offset, position: com, rotation: quat.create(), rubble: false, lastHit: -Infinity });
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

  function freeze(fragment: Fragment) {
    fragment.position = world.getPosition(fragment.id);
    fragment.rotation = world.getRotation(fragment.id);
    const children = structureColliders(fragment.building.structure, fragment.mask).map((child) => ({
      ...child,
      position: vec3.add(vec3.create(), child.position, fragment.offset),
    }));
    world.removeBody(fragment.id);
    fragment.id = world.addBody({
      shape: { kind: "compound", children },
      motion: "static",
      position: fragment.position,
      rotation: fragment.rotation,
    });
    fragment.rubble = true;
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
      body: undefined,
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

  function settle(pancake: Pancake) {
    const children = pancake.floors.flatMap((floor) =>
      structureColliders(floor.building.structure, floor.slab).map(({ shape, position }) => ({
        shape,
        position: [position[0], position[1] - floor.drop, position[2]] as Vec3,
      })),
    );
    if (children.length > 0) {
      pancake.body = world.addBody({
        shape: { kind: "compound", children },
        motion: "static",
        position: pancake.building.structure.origin,
      });
    }
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
      return fragments.reduce((n, f) => n + (f.rubble ? 0 : 1), 0);
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
        const fragment = fragments.find((f) => !f.rubble && (f.id === event.a || f.id === event.b));
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
        if (fragment.rubble) continue;
        if (!world.hasBody(fragment.id)) {
          fragments.splice(i, 1);
          continue;
        }
        fragment.position = world.getPosition(fragment.id);
        fragment.rotation = world.getRotation(fragment.id);
        if (fragment.position[1] < -20) {
          world.removeBody(fragment.id);
          fragments.splice(i, 1);
        } else if (world.isSleeping(fragment.id)) freeze(fragment);
      }

      for (const pancake of pancakes) {
        if (pancake.done) continue;
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
        }
      }
      return hits;
    },

    /** True while a Crush is still pancaking. */
    get animating() {
      return pancakes.some((p) => !p.done);
    },

    clear() {
      for (const f of fragments) world.removeBody(f.id);
      for (const p of pancakes) if (p.body !== undefined) world.removeBody(p.body);
      fragments.length = 0;
      pancakes.length = 0;
      contacts.length = 0;
      bursts.length = 0;
    },
  };
}

export type Collapse = ReturnType<typeof createCollapse>;
