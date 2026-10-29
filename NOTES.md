# Notes

## Crashcat

- We use the unreleased `dev` branch, pinned to commit `github:isaac-mason/crashcat#e3dcec1`. It isn't on npm, but the built `dist/` is committed to the repo, so Bun installs it with no build step. Bump the pin on purpose, record each bump here, and recheck [`docs/crashcat-issues.md`](docs/crashcat-issues.md).
- It is pure TypeScript with no WASM. The only runtime dependency is `math` (pmndrs). It bundles for the browser with `bun build --target=browser`; with `registerAll()` the unminified bundle is about 0.8 MB.
- Call `registerAll()` before creating any shapes, or nothing collides.
- Never remove a body inside a listener callback. Queue the removal and do it after `updateWorld`.
- Body objects are pooled, so keep `body.id` and look bodies up with `rigidBody.get`.
- In a test drop, a resting box sank about 2 cm into the floor. Watch for this.
- Crashcat damps linear velocity by 0.05 per second unless a body sets `linearDamping`. The ball sets it from its type's `drag`, and the trajectory preview applies the same damping so the two agree.
- Without CCD, a golf ball (r = 0.021 m) at 60 m/s tunnels through a 0.2 m wall at most wall offsets. With `LINEAR_CAST` it never does (`test/physics/crashcat.test.ts`).

## Workarounds

- **Contact impulse:** Crashcat doesn't report it. Contact listeners run before the solver, and the impulses the solver applies are kept internally. `ContactEvent.impulse` is filled from `estimateCollisionResponse(...).contactImpulse`, called in `onContactAdded`. It is an estimate, not the impulse the solver actually applied.

- **CCD contact normal:** in `onContactAdded`, contacts from the CCD pass (`MotionQuality.LINEAR_CAST`) carry a normal pointing from B to A, the opposite of narrowphase contacts. Left alone, `estimateCollisionResponse` reads the bodies as separating and returns an impulse of 0. The adapter flips the normal when it points into the CCD body rather than out of it, which assumes CCD bodies are convex. Full write-up in [`docs/crashcat-issues.md`](docs/crashcat-issues.md).
- **Settled:** `isSettled()` checks that `world.bodies.activeBodyCount` is 0. That count only includes awake non-static bodies, so it's 0 exactly when every dynamic body sleeps.

## Maths

- `math` (pmndrs) is used for vectors, quaternions and geometry everywhere outside `render/` and `fx/`. Three.js types appear only in `render/` and `fx/`.
- Record any gaps in `math` here.
- `quickhull2` is exported from `math/geometry`, not the root `math` entry.
- **Gap:** `polygon2` has `containsPoint` but no signed distance from a point to a polygon's edge, nor a way to inset a polygon. The Structure's Tip check needs both for its safety margin, so `src/structure/structure.ts` finds the nearest hull edge itself.

## Damage (M4)

- Bun's bundler doesn't follow `new Worker(new URL(...))`. `workers.ts` lists the workers; `build.ts` bundles each to `dist/<name>.worker.js`, the dev server bundles them on request, and `startWorker` loads them from beside the page.
- `three-mesh-bvh` is pinned to `0.9.10`: from `0.9.11`, `three-bvh-csg@0.0.18` logs a `maxLeafSize` deprecation warning on every cut. Unpin once `three-bvh-csg` passes `targetLeafSize`.
- A Building's mesh is built per Cell. A Bite subtracts its jagged blob from each Cell the Blast damaged, one small CSG operation per Cell, and Cells that leave the Structure simply drop out of the mesh. So a Bite never cuts where the grid hasn't changed, and the cuts are cheap, but each Bite ends in straight lines at the faces of the Cells it touched.
- Each Building collides as one static compound of boxes merged from its live Cells (132 boxes for the 8×20×8 Target), rebuilt whenever Cells leave. Bites never change it.
- The body cap counts dynamic bodies only: Debris and the ball, and Fragments from M5. The static Buildings and ground don't count.

## Collapse (M5)

- `src/damage/collapse.ts` carries out the Structure's events. A Detach or Tip becomes one Fragment: a dynamic compound of the same merged boxes as the Building's collider, built from just its Cells, placed at their centre of mass. Crashcat works out its mass from the boxes, at 1000 kg per Cell, so Fragment impulses run into the tens of thousands of kg⋅m/s; `powerPerImpulse` (0.02) and `minImpulse` (1500) are sized for that.
- A Tip starts turning at `tipSpin` about its pivot edge, away from the Cells still standing on its layer, so it falls the way it leans rather than balancing on the edge.
- A Crush has no physics while it plays: the Cells above fall a storey and squash to 30% of their height over `crushSeconds`, then get a static body of squashed boxes. A Shot waits for it to finish.
- A Fragment freezes into Rubble, a static body in the same pose, only once Crashcat puts it to sleep. Its hits only count against other Buildings, never the one it came from.
- Fragments are drawn from their Cells without the Bites cut into them.
- The tipping margin is a Structure option, so changing it in the GUI rebuilds the Buildings.
- `docs/media/m5-tip.gif` and `m5-crush.gif` show both collapses, recorded with headless Chrome.

## Performance

Measured 2026-10-29 on an Apple M5 MacBook, faster than the mid-range laptop the target is set for.

- **`bun run bench`** (Bun, no rendering): ten shots in a row at the Target. Main-thread physics and Structure work per frame: mean 0.11 ms, p99 1.35 ms. The worst frame, 6.3 ms, is the first hit, while the code is still cold; every later frame stays under 4 ms. In the workers, a Blast's `applyBlast` and `evaluate` take 1.5–3.4 ms and a Bite takes 2–8 ms.
- **In the browser**, the production build in headless Chrome 1248 (Metal), driven by Playwright for ten standard shots and five explosive ones: a steady 60 fps, with physics and Structure work at 0.02–0.2 ms a frame (0.7 ms at worst) and up to 105 Debris. The on-screen label shows these numbers live.
- Not yet measured on a mid-range laptop.
