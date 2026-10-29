import type { Quat, Vec3 } from "math";

/**
 * Engine-agnostic physics interface. Game code talks to this, never to a
 * physics engine directly; adapters such as `crashcat/` implement it.
 */
export type BodyId = number;

export type ShapeDesc =
  | { kind: "box"; halfExtents: Vec3 }
  | { kind: "sphere"; radius: number };

export type MotionKind = "static" | "dynamic" | "kinematic";

export type BodyDesc = {
  shape: ShapeDesc;
  motion: MotionKind;
  position?: Vec3;
  rotation?: Quat;
  linearVelocity?: Vec3;
  /** kg; computed from the shape if omitted. */
  mass?: number;
  friction?: number;
  restitution?: number;
  /** Fraction of linear velocity lost per second; the engine default if omitted. */
  linearDamping?: number;
  /** Continuous collision detection, for fast bodies such as the ball. */
  ccd?: boolean;
};

export type ContactEvent = {
  a: BodyId;
  b: BodyId;
  /** World-space contact point. */
  point: Vec3;
  /** World-space normal, pointing from `a` to `b`. */
  normal: Vec3;
  /** Total normal impulse in kg⋅m/s. May be an estimate; see NOTES.md. */
  impulse: number;
};

export type ContactListener = (event: ContactEvent) => void;

export interface PhysicsWorld {
  addBody(desc: BodyDesc): BodyId;
  /** Removals requested during `step` (e.g. from a contact listener) run once the step ends. */
  removeBody(id: BodyId): void;
  hasBody(id: BodyId): boolean;
  /** Advances the simulation by `dt` seconds and then dispatches contact events. */
  step(dt: number): void;
  getPosition(id: BodyId): Vec3;
  getRotation(id: BodyId): Quat;
  getLinearVelocity(id: BodyId): Vec3;
  setLinearVelocity(id: BodyId, velocity: Vec3): void;
  applyImpulse(id: BodyId, impulse: Vec3): void;
  /** Returns a function that unsubscribes the listener. */
  onContact(listener: ContactListener): () => void;
  /** True when every dynamic body is asleep. The settle timeout belongs to the game loop. */
  isSettled(): boolean;
}
