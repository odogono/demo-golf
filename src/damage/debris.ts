import { vec3, type Quat, type Vec3 } from "math";
import type { BodyId, PhysicsWorld } from "../physics/PhysicsWorld";

export type DebrisPiece = { halfExtents: Vec3; position: Vec3; rotation: Quat };
type LivePiece = DebrisPiece & { id: BodyId };

export type DebrisOptions = {
  /** Most dynamic bodies allowed at once, counting `otherBodies`. */
  cap: number;
  /** Dynamic bodies that aren't Debris, such as the ball. */
  otherBodies?: () => number;
  /** Most Rubble kept; the oldest disappears beyond it. */
  rubbleLimit?: number;
  random?: () => number;
};

/**
 * Debris: small chunks a Blast throws off. They collide with the world but
 * never cause a Blast, which `damage.ts` ensures by only reacting to the
 * ball. Once the body cap is reached, the oldest Debris freezes into Rubble:
 * its body is removed and it stays where it lies, drawn but not simulated.
 */
export function createDebris(world: PhysicsWorld, options: DebrisOptions) {
  const { otherBodies = () => 0, rubbleLimit = 400, random = Math.random } = options;
  let cap = options.cap;
  const live: LivePiece[] = [];
  const rubble: DebrisPiece[] = [];
  const range = (min: number, max: number) => min + (max - min) * random();

  function freezeOldest(): boolean {
    const piece = live.shift();
    if (!piece) return false;
    if (world.hasBody(piece.id)) {
      vec3.copy(piece.position, world.getPosition(piece.id));
      piece.rotation = world.getRotation(piece.id);
      world.removeBody(piece.id);
    }
    rubble.push({ halfExtents: piece.halfExtents, position: piece.position, rotation: piece.rotation });
    if (rubble.length > rubbleLimit) rubble.shift();
    return true;
  }

  function makeRoom(): boolean {
    while (live.length + otherBodies() >= cap) if (!freezeOldest()) return false;
    return true;
  }

  return {
    /** Pieces still simulated, oldest first. */
    live: live as readonly DebrisPiece[],
    rubble: rubble as readonly DebrisPiece[],

    get cap() {
      return cap;
    },
    set cap(value: number) {
      cap = value;
      while (live.length > 0 && live.length + otherBodies() > cap) freezeOldest();
    },

    /** Throws `count` chunks from `center`, mostly along `outward`. Returns how many were spawned. */
    spawn(center: Vec3, outward: Vec3, count: number): number {
      let spawned = 0;
      for (let n = 0; n < count; n++) {
        if (!makeRoom()) break;
        const halfExtents: Vec3 = [range(0.06, 0.2), range(0.05, 0.15), range(0.06, 0.2)];
        const position: Vec3 = [
          center[0] + outward[0] * 0.35 + range(-0.25, 0.25),
          center[1] + outward[1] * 0.35 + range(-0.25, 0.25),
          center[2] + outward[2] * 0.35 + range(-0.25, 0.25),
        ];
        const speed = range(2, 7);
        const velocity: Vec3 = [
          outward[0] * speed + range(-2.5, 2.5),
          outward[1] * speed + range(0.5, 3.5),
          outward[2] * speed + range(-2.5, 2.5),
        ];
        const id = world.addBody({
          shape: { kind: "box", halfExtents },
          motion: "dynamic",
          position,
          linearVelocity: velocity,
          friction: 0.8,
          restitution: 0.1,
        });
        live.push({ id, halfExtents, position, rotation: [0, 0, 0, 1] });
        spawned++;
      }
      return spawned;
    },

    /** Reads each live piece's pose for drawing, and drops pieces that fell off the world. */
    update() {
      for (let i = live.length - 1; i >= 0; i--) {
        const piece = live[i]!;
        if (!world.hasBody(piece.id)) {
          live.splice(i, 1);
          continue;
        }
        piece.position = world.getPosition(piece.id);
        piece.rotation = world.getRotation(piece.id);
        if (piece.position[1] < -5) {
          world.removeBody(piece.id);
          live.splice(i, 1);
        }
      }
    },

    clear() {
      for (const piece of live) world.removeBody(piece.id);
      live.length = 0;
      rubble.length = 0;
    },
  };
}

export type Debris = ReturnType<typeof createDebris>;
