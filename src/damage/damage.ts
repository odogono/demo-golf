import { vec3, type Vec3 } from "math";
import type { BodyId, ContactEvent, PhysicsWorld } from "../physics/PhysicsWorld";
import type { BallType } from "../shot/ball-types";
import type { Blast, Building, Buildings } from "./buildings";
import type { Debris } from "./debris";

/** A Blast and the Buildings it reached. */
export type Hit = { blast: Blast; buildings: Building[] };

/**
 * Turns the ball's contacts into Blasts (ADR 0001, ADR 0003). Every ball is a
 * bomb: its first touch on a Building sets off its type's Blast, whatever its
 * speed, and uses it up. Anything else it touches, it just bounces and rolls
 * on. Only the ball causes Blasts, so Debris never does.
 */
export function createDamage(world: PhysicsWorld, buildings: Buildings, debris: Debris) {
  const contacts: ContactEvent[] = [];
  world.onContact((event) => contacts.push(event));
  let ball: { id: BodyId; type: BallType } | undefined;

  function blastAt(event: ContactEvent, radius: number, power: number): Blast {
    // The normal points from a to b; turn it away from whatever the ball hit.
    const outward = event.a === ball!.id ? vec3.negate(vec3.create(), event.normal) : vec3.clone(event.normal);
    return { center: vec3.clone(event.point), radius, power, outward };
  }

  function setOff(blast: Blast, reached: Building[]): Hit {
    for (const building of reached) buildings.blast(building, blast);
    if (reached.length > 0) {
      const count = 5 + Math.round(10 * Math.min(1, blast.power / 150));
      debris.spawn(blast.center, blast.outward, count, reached[0]!.structure.materialNear(blast.center)?.debris);
    }
    return { blast, buildings: reached };
  }

  return {
    /** The ball now in flight, whose contacts can cause Blasts. */
    track(id: BodyId | undefined, type?: BallType) {
      ball = id === undefined || !type ? undefined : { id, type };
    },

    get ball() {
      return ball?.id;
    },

    /** Call after each physics step. Returns the Blasts set off during it. */
    update(): Hit[] {
      const hits: Hit[] = [];
      for (const event of contacts.splice(0)) {
        if (!ball || (event.a !== ball.id && event.b !== ball.id)) continue;
        if (!buildings.ofBody(event.a === ball.id ? event.b : event.a)) continue;
        const { radius, power } = ball.type.blast;
        const blast = blastAt(event, radius, power);
        hits.push(setOff(blast, buildings.within(blast.center, blast.radius)));
        world.removeBody(ball.id);
        ball = undefined;
      }
      return hits;
    },
  };
}

export type Damage = ReturnType<typeof createDamage>;
