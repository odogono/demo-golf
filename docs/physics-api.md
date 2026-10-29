# Physics and maths APIs

How this repo uses Crashcat (physics) and `math` (pmndrs). Read this before digging through `node_modules/crashcat` or `node_modules/math`; add what you learn there to this file.

## Where Crashcat is allowed

Only `src/physics/crashcat/createCrashcatWorld.ts` imports `crashcat`. Everything else talks to the engine-neutral `PhysicsWorld` interface in `src/physics/PhysicsWorld.ts`: `addBody`, `removeBody`, `hasBody`, `step`, `getPosition`, `getRotation`, `getLinearVelocity`, `setLinearVelocity`, `applyImpulse`, `onContact`, `isSleeping` and `isSettled`. To give game code a new physics feature, add it to `BodyDesc`/`ShapeDesc` or the interface, then implement it in the adapter.

## Crashcat

- **Version:** the unreleased `dev` branch, pinned to `github:isaac-mason/crashcat#e3dcec1`. It isn't on npm, but its built `dist/` is committed, so Bun installs it with no build step. Bump the pin on purpose, record each bump here, and recheck [`crashcat-issues.md`](crashcat-issues.md).
- **Where to look:** the types are in `node_modules/crashcat/dist/src/**.d.ts`, the source is in `node_modules/crashcat/src/` (the solver and listeners are in `update.ts`), and `node_modules/crashcat/README.md` is long; search its headings with `rg -n '^#'`.
- **Calls the adapter uses:** `registerAll`, `createWorldSettings`, `addBroadphaseLayer`, `addObjectLayer`, `enableCollision`, `createWorld`, `updateWorld`; the shapes `box`, `sphere`, `compound` and `staticCompound`; `rigidBody.create`, `.get`, `.remove`, `.wake`, `.addImpulse`, `.setLinearVelocity` and `.setAngularVelocity`; `MotionType`, `MotionQuality`; and `estimateCollisionResponse` with `createCollisionEstimationResult` and `getWorldSpaceContactPointOnA`/`B` for contacts.
- It is pure TypeScript with no WASM. Its only runtime dependency is `math`. It bundles with `bun build --target=browser`; with `registerAll()` the unminified bundle is about 0.8 MB.

### Gotchas

- Call `registerAll()` before creating any shapes, or nothing collides.
- Never remove a body inside a listener callback. Queue the removal and do it after `updateWorld`.
- Body objects are pooled, so keep `body.id` and look bodies up with `rigidBody.get`.
- In a test drop, a resting box sank about 2 cm into the floor.
- Linear velocity is damped by 0.05 per second unless a body sets `linearDamping`. The ball sets it from its type's `drag`, and the trajectory preview applies the same damping so the two agree.
- Without CCD, a golf ball (r = 0.021 m) at 60 m/s tunnels through a 0.2 m wall at most wall offsets. With `MotionQuality.LINEAR_CAST` it never does (`test/physics/crashcat.test.ts`).
- Fragment mass comes from the boxes, at 1000 kg per Cell, so Fragment impulses run into the tens of thousands of kg⋅m/s.

### Workarounds in the adapter

- **Contact impulse:** Crashcat doesn't report it. Contact listeners run before the solver, and the impulses the solver applies stay internal. `ContactEvent.impulse` is filled from `estimateCollisionResponse(...).contactImpulse`, called in `onContactAdded`. It is an estimate, not the impulse the solver applied.
- **CCD contact normal:** contacts from the CCD pass carry a normal pointing from B to A, the opposite of narrowphase contacts, so `estimateCollisionResponse` would read the bodies as separating and return 0. The adapter flips the normal when it points into the CCD body, which assumes CCD bodies are convex. Full write-up in [`crashcat-issues.md`](crashcat-issues.md).
- **Settled:** `isSettled()` checks that `world.bodies.activeBodyCount` is 0. That count only includes awake non-static bodies, so it's 0 exactly when every dynamic body sleeps.

## math (pmndrs)

- Vectors, quaternions and geometry use `math` everywhere outside `render/` and `fx/`; Three.js types appear only there. `Vec3` and `Quat` are plain tuples: `[x, y, z]`.
- **Entry points:** `vec3`, `quat` and the `Vec3`/`Quat` types come from `math`. `quickhull2` comes from `math/geometry` and `polygon2` from `math/shapes`, not from the root entry. Types are in `node_modules/math/dist/src/`.
- **Gap:** `polygon2` has `containsPoint` but no signed distance from a point to an edge, and no way to inset a polygon. The Structure's Tip check needs both, so `src/structure/structure.ts` finds the nearest hull edge itself.
