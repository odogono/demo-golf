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
  /** Seconds between one floor of a Crush giving way and the next. */
  crushStagger: number;
};

export const DEFAULT_COLLAPSE: CollapseSettings = {
  hitRadius: 1.8,
  powerPerImpulse: 0.02,
  minImpulse: 1500,
  tipSpin: 0.4,
  crushStagger: 0.25,
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

/** A floor slab of a Crush. It falls rigidly from `start`, `drop` metres, onto the slab below. */
export type Slab = { building: Building; mask: Uint8Array; start: number; drop: number };

/**
 * A Crush, as a scripted animation: from the bottom up, each storey's pillars
 * blow out and the slab they held falls onto the stack below, one floor
 * every `crushStagger` seconds. When the last slab lands, the stack becomes
 * Rubble with a static body.
 */
export type Pancake = {
  building: Building;
  slabs: Slab[];
  /** Pillar Cells, each with the time it blows out. */
  pillars: { cell: number; start: number }[];
  time: number;
  done: boolean;
  body: BodyId | undefined;
};

/** Metres a slab has fallen `t` seconds after it starts, landing after `drop`. */
export function slabFall(slab: Slab, t: number): number {
  const s = Math.max(0, t - slab.start);
  return Math.min(slab.drop, 0.5 * GRAVITY * s * s);
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
   * Splits a Crush's falling Cells into slabs and pillars. A layer with at
   * least half as many Cells as the fullest is a slab; the rest are pillars.
   * Slab `n`, counting up from the lowest, lands with its bottom `n` metres
   * above the crushed layer's.
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
    const slabs = slabLayers.map((y, n) => {
      const mask = new Uint8Array(structure.count);
      for (const i of byLayer.get(y)!) mask[i] = 1;
      return { building, mask, start: n * settings.crushStagger, drop: Math.max(0, y - (layer + n)) };
    });
    const pillars: Pancake["pillars"] = [];
    for (const [y, cells] of byLayer) {
      if (slabLayers.includes(y)) continue;
      // A pillar blows out as the slab it holds up starts to fall.
      const above = slabLayers.findIndex((s) => s > y);
      const start = slabs[above < 0 ? slabs.length - 1 : above]?.start ?? 0;
      for (const cell of cells) pillars.push({ cell, start });
    }
    return { building, slabs, pillars, time: 0, done: false, body: undefined };
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
    const children = pancake.slabs.flatMap((slab) =>
      structureColliders(slab.building.structure, slab.mask).map(({ shape, position }) => ({
        shape,
        position: [position[0], position[1] - slab.drop, position[2]] as Vec3,
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
        const before = pancake.time;
        pancake.time += dt;
        for (const { cell, start } of pancake.pillars) {
          if (start >= before && start < pancake.time) {
            blowOut(pancake.building, cell, CRUSH_DEBRIS / pancake.pillars.length);
          }
        }
        if (pancake.slabs.every((slab) => slabFall(slab, pancake.time) >= slab.drop)) {
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
