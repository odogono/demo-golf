import { vec3, type Vec3 } from "math";
import type { BodyId, PhysicsWorld } from "../physics/PhysicsWorld";
import { structureColliders } from "../structure/colliders";
import { createStructure, type Structure, type StructureOptions } from "../structure/structure";
import { createStructureHost, type StructureReply, type StructureRequest } from "../structure/structure-host";
import { inlinePort, type Port } from "../worker-port";

/** Carries requests to the Structures in `structure.worker.ts`. */
export type StructurePort = Port<StructureRequest, StructureReply>;

/** Runs the Structures on the calling thread, for tests and benchmarks. */
export function inlineStructures(): StructurePort {
  const host = createStructureHost();
  return inlinePort((request) => host.handle(request));
}

/** A single damage event, as set off by a hit. */
export type Blast = {
  center: Vec3;
  radius: number;
  power: number;
  /** Unit direction away from the surface that was hit, for throwing Debris and dust. */
  outward: Vec3;
};

export type Building = {
  id: number;
  options: StructureOptions;
  /** The main thread's copy of the grid, kept in step with the worker's. */
  structure: Structure;
  /** The static collider for its live Cells; undefined once none are left. */
  body: BodyId | undefined;
};

/** A worker reply, ready to apply: the Building it changed and the Blast that caused it. */
export type BlastOutcome = { building: Building; blast: Blast; reply: StructureReply };

/**
 * The Buildings on a Hole. Each one's Structure is evaluated in the worker
 * behind `port`; `drain` applies the replies that have arrived, updating the
 * main thread's copy of the grid and rebuilding the collider when Cells leave.
 */
export function createBuildings(world: PhysicsWorld, port: StructurePort, options: StructureOptions[]) {
  const buildings: Building[] = [];
  const pending = new Map<number, Blast>();
  const arrived: StructureReply[] = [];
  let nextBlast = 0;
  port.onReply((reply) => arrived.push(reply));

  function rebuildBody(building: Building) {
    if (building.body !== undefined) world.removeBody(building.body);
    const children = structureColliders(building.structure);
    building.body =
      children.length === 0
        ? undefined
        : world.addBody({
            shape: { kind: "compound", children },
            motion: "static",
            position: building.structure.origin,
          });
  }

  function create(overrides: Partial<StructureOptions> = {}) {
    for (const building of buildings) if (building.body !== undefined) world.removeBody(building.body);
    buildings.length = 0;
    pending.clear();
    arrived.length = 0;
    options.forEach((o, id) => {
      const opts = { ...o, ...overrides };
      const building: Building = { id, options: opts, structure: createStructure(opts), body: undefined };
      port.send({ type: "create", id, options: opts });
      rebuildBody(building);
      buildings.push(building);
    });
  }
  create();

  return {
    list: buildings as readonly Building[],

    /** Rebuilds every Building undamaged, optionally with new Structure options such as Cell Integrity. */
    reset: create,

    ofBody(body: BodyId): Building | undefined {
      return buildings.find((b) => b.body === body);
    },

    /** Buildings whose bounds come within `radius` of `center`. */
    within(center: Vec3, radius: number): Building[] {
      return buildings.filter(({ structure: { origin, size } }) => {
        let d2 = 0;
        for (let k = 0; k < 3; k++) {
          const v = Math.max(origin[k]! - center[k]!, 0, center[k]! - (origin[k]! + size[k]!));
          d2 += v * v;
        }
        return d2 <= radius * radius;
      });
    },

    /** Sends a Blast to a Building's Structure. Its outcome arrives through `drain`. */
    blast(building: Building, blast: Blast) {
      const id = nextBlast++;
      pending.set(id, blast);
      port.send({ type: "blast", id: building.id, blast: id, center: vec3.clone(blast.center), radius: blast.radius, power: blast.power });
    },

    /** Applies every reply that has arrived since the last call. Run it between physics steps. */
    drain(): BlastOutcome[] {
      const outcomes: BlastOutcome[] = [];
      for (const reply of arrived.splice(0)) {
        const building = buildings[reply.id];
        const blast = pending.get(reply.blast);
        if (!building || !blast) continue;
        pending.delete(reply.blast);
        building.structure.alive.set(reply.alive);
        building.structure.integrity.set(reply.integrity);
        if (reply.removed.length > 0) rebuildBody(building);
        outcomes.push({ building, blast, reply });
      }
      return outcomes;
    },
  };
}

export type Buildings = ReturnType<typeof createBuildings>;
