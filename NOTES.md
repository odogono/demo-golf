# Notes

## Crashcat

- We use the unreleased `dev` branch, pinned to commit `github:isaac-mason/crashcat#e3dcec1`. It isn't on npm, but the built `dist/` is committed to the repo, so Bun installs it with no build step. Bump the pin on purpose and record each bump here.
- It is pure TypeScript with no WASM. The only runtime dependency is `math` (pmndrs). It bundles for the browser with `bun build --target=browser`; with `registerAll()` the unminified bundle is about 0.8 MB.
- Call `registerAll()` before creating any shapes, or nothing collides.
- Never remove a body inside a listener callback. Queue the removal and do it after `updateWorld`.
- Body objects are pooled, so keep `body.id` and look bodies up with `rigidBody.get`.
- In a test drop, a resting box sank about 2 cm into the floor. Watch for this.
- Without CCD, a golf ball (r = 0.021 m) at 60 m/s tunnels through a 0.2 m wall at most wall offsets. With `LINEAR_CAST` it never does (`test/physics/crashcat.test.ts`).

## Workarounds

- **Contact impulse:** Crashcat doesn't report it. Contact listeners run before the solver, and the impulses the solver applies are kept internally. `ContactEvent.impulse` is filled from `estimateCollisionResponse(...).contactImpulse`, called in `onContactAdded`. It is an estimate, not the impulse the solver actually applied.

- **CCD contact normal:** in `onContactAdded`, contacts from the CCD pass (`MotionQuality.LINEAR_CAST`) carry a normal pointing from B to A, the opposite of narrowphase contacts. Left alone, `estimateCollisionResponse` reads the bodies as separating and returns an impulse of 0. The adapter flips the normal when a CCD body is involved and the bodies separate along it. A new contact on a CCD body that really is separating would be flipped wrongly; we haven't seen one. Worth reporting upstream.
- **Settled:** `isSettled()` checks that `world.bodies.activeBodyCount` is 0. That count only includes awake non-static bodies, so it's 0 exactly when every dynamic body sleeps.

## Maths

- `math` (pmndrs) is used for vectors, quaternions and geometry everywhere outside `render/` and `fx/`. Three.js types appear only in `render/` and `fx/`.
- Record any gaps in `math` here.

## Performance

_Not measured yet._
