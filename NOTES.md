# Notes

Decisions and gotchas that the code doesn't show. Physics and maths library notes are in [`docs/physics-api.md`](docs/physics-api.md). Keep each section true of the current code: when a change makes a line wrong, fix or delete it in the same PR.

## Bundling and workers

- Bun's bundler doesn't follow `new Worker(new URL(...))`. `workers.ts` lists the workers; `build.ts` bundles each to `dist/<name>.worker.js`, the dev server bundles them on request, and `startWorker` loads them from beside the page.
- `three-mesh-bvh` is pinned to `0.9.10`: from `0.9.11`, `three-bvh-csg@0.0.18` logs a `maxLeafSize` deprecation warning on every cut. Unpin once `three-bvh-csg` passes `targetLeafSize`.

## Buildings and damage

- A Building's mesh is built per Cell. A Bite subtracts its jagged blob from each Cell the Blast damaged, one small CSG operation per Cell, and Cells that leave the Structure drop out of the mesh. So a Bite never cuts where the grid hasn't changed, and the cuts are cheap, but each Bite ends in straight lines at the faces of the Cells it touched.
- Each Building collides as one static compound of boxes merged from its live Cells (132 boxes for the 8×20×8 Target), rebuilt whenever Cells leave. Bites never change it.
- The body cap counts dynamic bodies only: Debris, the ball and Fragments. The static Buildings and ground don't count.
- The tipping margin is a Structure option, so changing it in the GUI rebuilds the Buildings.

## Collapse

- `src/damage/collapse.ts` carries out the Structure's events. A Detach or Tip becomes one Fragment: a dynamic compound of the same merged boxes as the Building's collider, built from just its Cells, placed at their centre of mass. `powerPerImpulse` (0.02) and `minImpulse` (1500) are sized for Fragment impulses.
- A Tip starts turning at `tipSpin` about its pivot edge, away from the Cells still standing on its layer, so it falls the way it leans rather than balancing on the edge.
- A Crush has no physics while it plays. Its falling Cells split into floors: a slab (a layer with at least half as many Cells as the fullest) and the pillars standing on it. The floors fall as one block under gravity. When the lowest one still falling lands on the stack, one metre above the slab below, its pillars blow out as Debris and dust and the block above keeps `crushImpactKeep` of its speed, so each floor's supports go only when the floor above hits. Once the top floor lands, the stack gets one static body. A Shot waits for it to finish.
- A Fragment freezes into Rubble, a static body in the same pose, only once Crashcat puts it to sleep. Its hits only count against other Buildings, never the one it came from.
- Fragments are drawn from their Cells without the Bites cut into them.

## Auto mode

- Auto mode (P, or the GUI) aims with `src/shot/auto-aim.ts`: a grid search over loft and power through `predictTrajectory`, about 1000 predictions and a few ms per Shot. It ignores collisions, so a shot can clip the other building. It ends a Shot once the ball is used up, asleep or 3 s in, without waiting for Debris to settle.

## Screenshots and recordings

- `bun run shoot` drives the production build in headless Chrome and writes PNGs or a GIF; see `bun run shoot --help`. It reaches the game through `window.__golf`, a debug hook set up at the end of `src/main.ts`.
- `docs/media/m5-tip.gif` and `m5-crush.gif` show both collapses.

## Performance

Measured 2026-10-29 on an Apple M5 MacBook, faster than the mid-range laptop the target is set for. Not yet measured on a mid-range laptop.

- **`bun run bench`** (Bun, no rendering): ten shots in a row at the Target. Main-thread physics and Structure work per frame: mean 0.11 ms, p99 1.35 ms. The worst frame, 6.3 ms, is the first hit, while the code is still cold; every later frame stays under 4 ms. In the workers, a Blast's `applyBlast` and `evaluate` take 1.5–3.4 ms and a Bite takes 2–8 ms.
- **In the browser**, the production build in headless Chrome 1248 (Metal) for ten standard shots and five explosive ones: a steady 60 fps, with physics and Structure work at 0.02–0.2 ms a frame (0.7 ms at worst) and up to 105 Debris. The on-screen label shows these numbers live.
