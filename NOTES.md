# Notes

## Crashcat

- We use the unreleased `dev` branch, pinned to commit `github:isaac-mason/crashcat#e3dcec1`. It isn't on npm, but the built `dist/` is committed to the repo, so Bun installs it with no build step. Bump the pin on purpose and record each bump here.
- It is pure TypeScript with no WASM. The only runtime dependency is `math` (pmndrs). It bundles for the browser with `bun build --target=browser`; with `registerAll()` the unminified bundle is about 0.8 MB.
- Call `registerAll()` before creating any shapes, or nothing collides.
- Never remove a body inside a listener callback. Queue the removal and do it after `updateWorld`.
- Body objects are pooled, so keep `body.id` and look bodies up with `rigidBody.get`.
- In a test drop, a resting box sank about 2 cm into the floor. Watch for this.

## Workarounds

- **Contact impulse:** Crashcat doesn't report it. Contact listeners run before the solver, and the impulses the solver applies are kept internally. `ContactEvent.impulse` is filled from `estimateCollisionResponse(...).contactImpulse`, called in `onContactAdded`. It is an estimate, not the impulse the solver actually applied.

## Maths

- `math` (pmndrs) is used for vectors, quaternions and geometry everywhere outside `render/` and `fx/`. Three.js types appear only in `render/` and `fx/`.
- Record any gaps in `math` here.
- `quickhull2` is exported from `math/geometry`, not the root `math` entry.
- **Gap:** `polygon2` has `containsPoint` but no signed distance from a point to a polygon's edge, nor a way to inset a polygon. The Structure's Tip check needs both for its safety margin, so `src/structure/structure.ts` finds the nearest hull edge itself.

## Performance

_Not measured yet._
