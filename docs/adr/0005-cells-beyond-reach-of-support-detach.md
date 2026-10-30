# 5. A Cell beyond its Material's Reach of Support Detaches

## Status

Accepted. Builds on [ADR 0001](0001-structure-grid-decides-collapse.md), which still holds: the Structure grid alone decides collapse.

## Context

A Cell stayed up as long as some path connected it to the ground, however far it reached past its last Support, so a cantilever never failed. The arch bridge showed this: its middle could only be dropped by Blasts far larger than any ball's.

## Decision

- **Reach is a Material property.** A Cell further than its Reach from Support, measured as a path through connected Cells in its own layer, can't hold itself up.
- **Beyond Reach means Detach.** Such a Cell Detaches, together with everything held up only through it, and falls as a Fragment. A stub hanging under a held Cell still hangs from it.
- **When it's checked:** Reach is checked together with the ground connection at the start of every pass of `evaluate()`, so Crushes and Detaches that open up new spans are resolved until nothing more fails.
- **Rubble follows the same rules.**
- **Load sharing is unchanged:** a layer's load is still shared equally across its group's Supports.

## Alternatives considered

- **Load goes to the nearest Support, or is shared only among Supports within Reach.** This would stop a local cut from overloading the far Supports. Both were built and tried against the Scenario harness:
  - The lighthouse Crushed instead of Tipping.
  - The glass office's core Crushed.
  - Nearest-Support sharing also Crushed a car-park level after one lost column.
  - The bridge collapsed in a chain of Crushes from one Shot.

  Every Blueprint was tuned against equal sharing, and the gain didn't justify retuning them all.
- **Bending stress** (load × distance against a strength limit): more realistic, but harder to tune, explain and test.
- **Reach per Structure, like `tipMargin`, or one global value:** instead, Blueprints tune spans by choosing Materials (ADR 0002).

## Consequences

- Cantilevers and cut spans can now fail. An undamaged building must keep every Cell within Reach, so arches and decks constrain their Materials.
- Cutting one side of a span still overloads its remaining Supports. When every Support in a layer fails, the whole layer Crushes and everything above it Detaches as one piece, dropping a metre and landing upright. That is a separate problem, about what a whole-layer Crush should do, not about load sharing.
- `bun run scenarios` is the regression gate.
