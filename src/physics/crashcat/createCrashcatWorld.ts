import {
  MotionQuality,
  MotionType,
  addBroadphaseLayer,
  addObjectLayer,
  box,
  compound,
  createCollisionEstimationResult,
  createWorld,
  createWorldSettings,
  enableCollision,
  estimateCollisionResponse,
  getWorldSpaceContactPointOnA,
  getWorldSpaceContactPointOnB,
  registerAll,
  rigidBody,
  sphere,
  staticCompound,
  updateWorld,
  type ContactManifold,
  type Listener,
  type RigidBody,
  type Shape,
} from "crashcat";
import { type Quat, type Vec3, vec3 } from "math";
import type {
  BodyDesc,
  BodyId,
  ContactEvent,
  ContactListener,
  MotionKind,
  PhysicsWorld,
  ShapeDesc,
} from "../PhysicsWorld";

let registered = false;

const MOTION: Record<MotionKind, MotionType> = {
  static: MotionType.STATIC,
  dynamic: MotionType.DYNAMIC,
  kinematic: MotionType.KINEMATIC,
};

function createShape(desc: ShapeDesc, motion: MotionKind): Shape {
  switch (desc.kind) {
    case "box":
      return box.create({ halfExtents: [...desc.halfExtents] });
    case "sphere":
      return sphere.create({ radius: desc.radius });
    case "compound": {
      const children = desc.children.map((child) => ({
        shape: createShape(child.shape, motion),
        position: [...child.position] as Vec3,
        quaternion: (child.rotation ? [...child.rotation] : [0, 0, 0, 1]) as Quat,
      }));
      return motion === "static" ? staticCompound.create({ children }) : compound.create({ children });
    }
  }
}

const scratch: Vec3 = [0, 0, 0];

/**
 * Crashcat's CCD pass reports its normal pointing from B to A, the opposite
 * of narrowphase contacts. A correct normal points out of A's surface and into
 * B's, so on a convex CCD body (the ball) it points away from A's centre of
 * mass, or towards B's. See NOTES.md.
 */
function hasReversedCcdNormal(a: RigidBody, b: RigidBody, manifold: ContactManifold) {
  const ccd = (body: RigidBody) =>
    body.motionType === MotionType.DYNAMIC &&
    body.motionProperties.motionQuality === MotionQuality.LINEAR_CAST;
  const n = manifold.worldSpaceNormal;
  if (ccd(a)) {
    getWorldSpaceContactPointOnA(scratch, manifold, 0);
    return vec3.dot(vec3.subtract(scratch, scratch, a.centerOfMassPosition), n) < 0;
  }
  if (ccd(b)) {
    getWorldSpaceContactPointOnB(scratch, manifold, 0);
    return vec3.dot(vec3.subtract(scratch, b.centerOfMassPosition, scratch), n) < 0;
  }
  return false;
}

export function createCrashcatWorld(gravity: Vec3 = [0, -9.81, 0]): PhysicsWorld {
  if (!registered) {
    registerAll();
    registered = true;
  }

  const settings = createWorldSettings();
  settings.gravity = [...gravity];
  const moving = addObjectLayer(settings, addBroadphaseLayer(settings));
  const notMoving = addObjectLayer(settings, addBroadphaseLayer(settings));
  enableCollision(settings, moving, notMoving);
  enableCollision(settings, moving, moving);
  const world = createWorld(settings);

  const listeners = new Set<ContactListener>();
  const pendingEvents: ContactEvent[] = [];
  const pendingRemovals = new Set<BodyId>();
  const estimate = createCollisionEstimationResult();
  let stepping = false;

  const listener: Listener = {
    onContactAdded(bodyA, bodyB, manifold, contact) {
      if (listeners.size === 0) return;
      if (hasReversedCcdNormal(bodyA, bodyB, manifold)) {
        // Crashcat doesn't export a manifold copy, and the original must stay untouched.
        manifold = { ...manifold, worldSpaceNormal: vec3.negate([0, 0, 0], manifold.worldSpaceNormal) };
      }
      estimateCollisionResponse(
        estimate,
        bodyA,
        bodyB,
        manifold,
        contact.combinedFriction,
        contact.combinedRestitution,
      );
      let impulse = 0;
      for (let i = 0; i < estimate.numImpulses; i++) impulse += estimate.contactImpulse[i] ?? 0;
      const point: Vec3 = [0, 0, 0];
      getWorldSpaceContactPointOnA(point, manifold, 0);
      pendingEvents.push({
        a: bodyA.id,
        b: bodyB.id,
        point,
        normal: [...manifold.worldSpaceNormal],
        impulse,
      });
    },
  };

  function body(id: BodyId): RigidBody {
    const found = rigidBody.get(world, id);
    if (!found) throw new Error(`No physics body ${id}`);
    return found;
  }

  function removeNow(id: BodyId) {
    const found = rigidBody.get(world, id);
    if (found) rigidBody.remove(world, found);
  }

  return {
    addBody(desc: BodyDesc): BodyId {
      const created = rigidBody.create(world, {
        shape: createShape(desc.shape, desc.motion),
        motionType: MOTION[desc.motion],
        objectLayer: desc.motion === "static" ? notMoving : moving,
        position: desc.position ? [...desc.position] : undefined,
        quaternion: desc.rotation ? [...desc.rotation] : undefined,
        mass: desc.mass,
        friction: desc.friction,
        restitution: desc.restitution,
        linearDamping: desc.linearDamping,
        motionQuality: desc.ccd ? MotionQuality.LINEAR_CAST : MotionQuality.DISCRETE,
      });
      if (desc.linearVelocity) rigidBody.setLinearVelocity(world, created, [...desc.linearVelocity]);
      if (desc.angularVelocity) rigidBody.setAngularVelocity(world, created, [...desc.angularVelocity]);
      return created.id;
    },
    removeBody(id) {
      if (stepping) pendingRemovals.add(id);
      else removeNow(id);
    },
    hasBody(id) {
      return rigidBody.get(world, id) !== undefined && !pendingRemovals.has(id);
    },
    step(dt) {
      stepping = true;
      try {
        updateWorld(world, listener, dt);
        for (const event of pendingEvents) for (const l of listeners) l(event);
      } finally {
        pendingEvents.length = 0;
        stepping = false;
      }
      for (const id of pendingRemovals) removeNow(id);
      pendingRemovals.clear();
    },
    getPosition(id): Vec3 {
      return [...body(id).position];
    },
    getRotation(id): Quat {
      return [...body(id).quaternion];
    },
    getLinearVelocity(id): Vec3 {
      return [...body(id).motionProperties.linearVelocity];
    },
    setLinearVelocity(id, velocity) {
      const target = body(id);
      rigidBody.setLinearVelocity(world, target, [...velocity]);
      rigidBody.wake(world, target);
    },
    applyImpulse(id, impulse) {
      rigidBody.addImpulse(world, body(id), [...impulse]);
    },
    isSleeping(id) {
      return body(id).sleeping;
    },
    onContact(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isSettled() {
      // Static bodies are never active, so no active bodies means every dynamic body sleeps.
      return world.bodies.activeBodyCount === 0;
    },
  };
}
