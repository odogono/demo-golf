import { vec3, type Vec3 } from "math";
import type { BodyId, ContactEvent, PhysicsWorld } from "../physics/PhysicsWorld";
import { BALL_TYPES, type BallType } from "../shot/ball-types";
import type { Blast, Building, Buildings } from "./buildings";
import type { Debris } from "./debris";

/** Tunable from the debug GUI. */
export type DamageSettings = {
  /** A standard ball's Blast radius, in metres. */
  hitRadius: number;
  /** A standard ball's Blast power per kg⋅m/s of contact impulse. */
  powerPerImpulse: number;
  /** Contacts softer than this, in kg⋅m/s, do no damage, so a rolling ball doesn't. */
  minImpulse: number;
  /** An explosive ball's Blast. */
  explosiveRadius: number;
  explosivePower: number;
};

export const DEFAULT_DAMAGE: DamageSettings = {
  hitRadius: 1.2,
  powerPerImpulse: 2.5,
  minImpulse: 4,
  explosiveRadius: BALL_TYPES.explosive.blast.radius,
  explosivePower: BALL_TYPES.explosive.blast.power,
};

/** Seconds after a standard ball's hit before it can cause another. */
const HIT_COOLDOWN = 0.15;

/** A Blast and the Buildings it reached. */
export type Hit = { blast: Blast; buildings: Building[] };

/**
 * Turns the ball's contacts into Blasts (ADR 0001). A standard ball sets off
 * a small Blast on each hard hit on a Building, its power scaled by the
 * contact impulse; an explosive ball sets off its large Blast on its first
 * real contact and is used up. Only the ball causes Blasts, so
 * Debris never does.
 */
export function createDamage(world: PhysicsWorld, buildings: Buildings, debris: Debris, settings: DamageSettings) {
  const contacts: ContactEvent[] = [];
  world.onContact((event) => contacts.push(event));
  let ball: { id: BodyId; type: BallType } | undefined;
  let time = 0;
  let lastHit = -Infinity;

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
    settings,

    /** The ball now in flight, whose contacts can cause Blasts. */
    track(id: BodyId | undefined, type?: BallType) {
      ball = id === undefined || !type ? undefined : { id, type };
      lastHit = -Infinity;
    },

    get ball() {
      return ball?.id;
    },

    /** Call after each physics step. Returns the Blasts set off during it. */
    update(dt: number): Hit[] {
      time += dt;
      const hits: Hit[] = [];
      for (const event of contacts.splice(0)) {
        if (!ball || (event.a !== ball.id && event.b !== ball.id)) continue;
        const other = event.a === ball.id ? event.b : event.a;
        const building = buildings.ofBody(other);

        // Any contact with a Building sets an explosive ball off, but elsewhere only a hard
        // one does: it starts out touching the ground at the Tee.
        if (ball.type.blast && (building || event.impulse >= settings.minImpulse)) {
          const blast = blastAt(event, settings.explosiveRadius, settings.explosivePower);
          hits.push(setOff(blast, buildings.within(blast.center, blast.radius)));
          world.removeBody(ball.id);
          ball = undefined;
          continue;
        }

        if (ball.type.blast || !building || event.impulse < settings.minImpulse || time - lastHit < HIT_COOLDOWN) continue;
        lastHit = time;
        const blast = blastAt(event, settings.hitRadius, event.impulse * settings.powerPerImpulse);
        hits.push(setOff(blast, [building]));
      }
      return hits;
    },
  };
}

export type Damage = ReturnType<typeof createDamage>;
