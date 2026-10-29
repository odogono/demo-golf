# demo-golf

Demolition Golf: a single-hole browser prototype. Hit a ball at a building and knock it down. Terms such as Cell, Blast and Crush are defined in [`GLOSSARY.md`](GLOSSARY.md).

```sh
bun install
bun dev          # dev server with hot reload
bun run test     # bun test
bun run typecheck
bun run shoot    # headless screenshots and GIFs; --help for options
bun run bench    # ten shots, timed, without rendering
```

## Where things live

`src/main.ts` wires everything together: the fixed loop, input, the debug GUI and keys, and the `window.__golf` debug hook.

| Folder | Owns |
| --- | --- |
| `src/structure/` | The Structure grid of Cells. It alone decides what Detaches, Crushes or Tips ([ADR 0001](docs/adr/0001-structure-grid-decides-collapse.md)). Runs in a worker (`structure.worker.ts`). |
| `src/damage/` | Turns hits into Blasts (`damage.ts`), applies them to Buildings (`buildings.ts`), and carries out collapse (`collapse.ts`) and Debris (`debris.ts`). |
| `src/physics/` | The engine-neutral `PhysicsWorld` interface; `crashcat/` is the only code that imports Crashcat. |
| `src/shot/` | Ball types, aim, power, the trajectory preview and auto-aim. |
| `src/input/` | Keyboard and mouse to Shot controls. |
| `src/camera/` | Camera rigs, the director that picks between them, and shake and slow motion. |
| `src/render/` | The Three.js scene, camera view, Shot view and Structure overlay. |
| `src/fx/` | Building meshes, Bites (CSG, in `csg.worker.ts`), Debris, Fragments and dust. |

Three.js appears only in `render/` and `fx/`; everything else uses `math` (pmndrs) tuples. Workers are listed in `workers.ts` and bundled separately; see `NOTES.md`.

Tests are in `test/`, one file per area. Tools: `tools/commits/` (commit and changelog checks), `tools/shoot.ts`.

## Docs

- [`NOTES.md`](NOTES.md): decisions and gotchas the code doesn't show, plus performance numbers.
- [`docs/physics-api.md`](docs/physics-api.md): how we use Crashcat and `math`.
- [`docs/crashcat-issues.md`](docs/crashcat-issues.md): Crashcat bugs and our workarounds.
- [`docs/adr/`](docs/adr/): decisions. [`docs/mockups/`](docs/mockups/): how the game should look.
