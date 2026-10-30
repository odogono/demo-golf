import type { Vec3 } from "math";
import type { BodyId, PhysicsWorld } from "../physics/PhysicsWorld";
import type { BallType } from "./ball-types";

/** The fixed spot the first Shot of a Hole starts from, on the ground. Later Shots start from the Lie. */
export const TEE: Vec3 = [0, 0, 18];

/** Puts a ball of `type` on the ground at `from` and launches it. Returns the ball's body. */
export function launchBall(
  world: PhysicsWorld,
  type: BallType,
  velocity: Vec3,
  from: Vec3 = TEE,
): BodyId {
  return world.addBody({
    shape: { kind: "sphere", radius: type.radius },
    motion: "dynamic",
    position: [from[0], from[1] + type.radius, from[2]],
    linearVelocity: velocity,
    mass: type.mass,
    friction: type.friction,
    restitution: type.restitution,
    linearDamping: type.drag,
    angularDamping: type.roll,
    ccd: true,
  });
}

/** Below this speed, in m/s, a ball is coming to rest. */
export const REST_SPEED = 0.3;
/** Seconds a ball must stay below `REST_SPEED` to be at rest, so the top of a lob doesn't count. */
export const REST_TIME = 0.25;

/**
 * Says when a ball in play has come to rest, so its spot can become the next
 * Lie without waiting for the engine to put it to sleep. Feed it the ball's
 * speed every step.
 */
export function createRestCheck() {
  let slow = 0;
  return {
    reset() {
      slow = 0;
    },
    /** Returns true once the ball has been slow for `REST_TIME`. */
    update(speed: number, dt: number): boolean {
      slow = speed < REST_SPEED ? slow + dt : 0;
      return slow >= REST_TIME;
    },
  };
}
