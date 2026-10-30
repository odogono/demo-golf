# 5. Load follows the nearest Support, within each Material's Reach

## Status

Accepted. Builds on [ADR 0001](0001-structure-grid-decides-collapse.md), which still holds: the Structure grid alone decides collapse.

## Context

A layer's load was shared equally across every Cell in its group that had Support, however far away. That had two faults:
- A cantilever never failed, however far it reached past its last Support.
- Cutting one side of a span overloaded every Support left in the layer at once. The whole layer Crushed and everything above dropped a metre and landed upright, looking intact.

The arch bridge showed both. Its middle could only be dropped by Blasts far larger than any ball's.

## Decision

- **Load follows the nearest Support.** Each Cell's load goes to the nearest Support, measured as a path through connected Cells in its own layer. Ties are shared equally. Capacity is still sized per layer, from its heaviest undamaged load.
- **Reach limits how far a Cell can be from Support.** Reach is a Material property. A Cell further than its Reach from Support can't hold itself up. It Detaches, with everything held up only through it, and falls as a Fragment.
- **When it's checked:** Reach is checked alongside the ground-connection Detach at the start of every pass of `evaluate()`, so Crushes and Detaches can uncover new spans and are resolved until nothing more fails.
- **Rubble follows the same rules.**

## Alternatives considered

- **Bending stress** (load × distance against a strength limit): more realistic, but harder to tune, explain and test.
- **Reach per Structure, like `tipMargin`, or one global value:** instead, Blueprints tune spans by choosing Materials (ADR 0002).
- **A new "Sag" event:** Detach already carries Fragments, Rubble and animation.

## Consequences

- One well-placed cut can drop a span, so finding the weak point becomes part of the game.
- An undamaged building must keep every Cell within Reach. Arches and decks constrain their Materials' Reach, and each Blueprint is tuned against the Scenario harness.
- Loads differ between Cells in an undamaged building, so Cells near Supports carry more than before.
- `bun run scenarios` is the regression gate. The car park pancakes, the glass office sheds glass while its core stands, the lighthouse Tips, and the frame barely breaks. Their Destroyed shares stay within about 10 points.
