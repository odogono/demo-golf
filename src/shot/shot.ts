import type { Vec3 } from "math";
import type { BodyId, PhysicsWorld } from "../physics/PhysicsWorld";
import type { BallType } from "./ball-types";

/** The fixed spot every Shot starts from: the ball's centre rests here. */
export const TEE: Vec3 = [0, 0, 18];

/** Puts a ball of `type` on the Tee and launches it. Returns the ball's body. */
export function launchBall(
  world: PhysicsWorld,
  type: BallType,
  velocity: Vec3,
  tee: Vec3 = TEE,
): BodyId {
  return world.addBody({
    shape: { kind: "sphere", radius: type.radius },
    motion: "dynamic",
    position: [tee[0], tee[1] + type.radius, tee[2]],
    linearVelocity: velocity,
    mass: type.mass,
    friction: type.friction,
    restitution: type.restitution,
    linearDamping: type.drag,
    ccd: true,
  });
}
