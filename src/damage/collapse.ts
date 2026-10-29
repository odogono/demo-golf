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
  /** Seconds a Crush takes to pancake. */
  crushSeconds: number;
};

export const DEFAULT_COLLAPSE: CollapseSettings = {
  hitRadius: 1.8,
  powerPerImpulse: 0.02,
  minImpulse: 1500,
  tipSpin: 0.4,
  crushSeconds: 1.2,
};

/** Seconds after a Fragment's hit before it can cause another. */
const HIT_COOLDOWN = 0.2;
/** How tall a pancaked stack ends up, as a fraction of its height. */
const SQUASH = 0.3;

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
 * A Crush: the Cells above a crushed layer, pancaking down onto it over
 * `crushSeconds` as a scripted animation. They span grid layers `top` and
 * below, down to `base`, and land on `base - 1`. When it ends they become
 * Rubble with a static body.
 */
export type Pancake = Piece & {
  base: number;
  /** 0 to 1 through the animation. */
  progress: number;
  body: BodyId | undefined;
};

/**
 * Carries out the events of each Structure (ADR 0001): Detach and Tip split
 * their Cells off into Fragments, Crush plays a pancake. A Fragment that hits
 * another Building sets off a Blast on its Structure, scaled by the impulse.
 */
export function createCollapse(world: PhysicsWorld, buildings: Buildings, debris: Debris, settings: CollapseSettings) {
  const fragments: Fragment[] = [];
  const pancakes: Pancake[] = [];
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

  function settle(pancake: Pancake) {
    const height = (y: number) => pancake.base - 1 + (y - pancake.base) * SQUASH;
    const children = structureColliders(pancake.building.structure, pancake.mask).map(({ shape, position }) => {
      if (shape.kind !== "box") throw new Error("expected boxes");
      const [hx, hy, hz] = shape.halfExtents;
      return {
        shape: { kind: "box" as const, halfExtents: [hx, hy * SQUASH, hz] as Vec3 },
        position: [position[0], height(position[1]), position[2]] as Vec3,
      };
    });
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

    /** Fragments still simulated. */
    get moving() {
      return fragments.reduce((n, f) => n + (f.rubble ? 0 : 1), 0);
    },

    /** Carries out a Structure's events. Run it on each outcome `buildings.drain` returns. */
    apply({ building, reply }: BlastOutcome) {
      for (const event of reply.events) {
        if (event.kind !== "crush") split(building, event);
        else if (event.falling.length > 0) {
          const base = Math.min(...event.falling.map((i) => building.structure.coords(i)[1]));
          pancakes.push({ ...piece(building, event.falling), base, progress: 0, body: undefined });
        }
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
        if (pancake.progress >= 1) continue;
        pancake.progress = Math.min(1, pancake.progress + dt / settings.crushSeconds);
        if (pancake.progress === 1) settle(pancake);
      }
      return hits;
    },

    /** True while a Crush is still pancaking. */
    get animating() {
      return pancakes.some((p) => p.progress < 1);
    },

    clear() {
      for (const f of fragments) world.removeBody(f.id);
      for (const p of pancakes) if (p.body !== undefined) world.removeBody(p.body);
      fragments.length = 0;
      pancakes.length = 0;
      contacts.length = 0;
    },
  };
}

/** How far down a pancake has fallen and squashed at `progress`: its base's drop in metres and its height scale. */
export function pancakePose(progress: number): { drop: number; scale: number } {
  // Fall the crushed layer's metre under gravity, then squash the storeys onto each other.
  const fall = Math.min(1, progress / 0.4);
  const squash = Math.max(0, (progress - 0.4) / 0.6);
  return { drop: fall * fall, scale: 1 - (1 - SQUASH) * (1 - (1 - squash) * (1 - squash)) };
}

export type Collapse = ReturnType<typeof createCollapse>;
