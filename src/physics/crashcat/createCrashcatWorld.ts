import {
  MotionQuality,
  MotionType,
  addBroadphaseLayer,
  addObjectLayer,
  box,
  createCollisionEstimationResult,
  createWorld,
  createWorldSettings,
  enableCollision,
  estimateCollisionResponse,
  getWorldSpaceContactPointOnA,
  registerAll,
  rigidBody,
  sphere,
  updateWorld,
  type ContactManifold,
  type Listener,
  type RigidBody,
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

function createShape(desc: ShapeDesc) {
  switch (desc.kind) {
    case "box":
      return box.create({ halfExtents: [...desc.halfExtents] });
    case "sphere":
      return sphere.create({ radius: desc.radius });
  }
}

/**
 * Crashcat's CCD pass reports its normal pointing from B to A, the opposite
 * of narrowphase contacts. A newly added contact whose bodies separate along
 * the normal, involving a CCD body, came from that pass. See NOTES.md.
 */
function hasReversedCcdNormal(a: RigidBody, b: RigidBody, manifold: ContactManifold) {
  const ccd = (body: RigidBody) =>
    body.motionType === MotionType.DYNAMIC &&
    body.motionProperties.motionQuality === MotionQuality.LINEAR_CAST;
  if (!ccd(a) && !ccd(b)) return false;
  const va = a.motionProperties.linearVelocity;
  const vb = b.motionProperties.linearVelocity;
  const n = manifold.worldSpaceNormal;
  return (vb[0] - va[0]) * n[0] + (vb[1] - va[1]) * n[1] + (vb[2] - va[2]) * n[2] > 0;
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
        shape: createShape(desc.shape),
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
