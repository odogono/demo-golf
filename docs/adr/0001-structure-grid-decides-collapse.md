# 1. The Structure grid alone decides collapse

## Status

Accepted

## Context

A building appears in three forms: the render mesh, which is cut by Bites; physics bodies; and a Structure grid of Cells. If more than one of these could decide whether the building fails, they would disagree, and collapses would be hard to reproduce or test.

## Decision

The Structure is the single source of truth. Every kind of damage is turned into a Blast on the Structure. `evaluate()` produces Detach, Crush and Tip events, and the mesh and physics only carry those events out. The Structure is written in pure TypeScript and runs in a worker. While a piece is a Fragment, it is governed only by physics, and it can affect other Structures only by causing Blasts. Once it comes to rest, it becomes Rubble: a new Structure, turned to the nearest axis-aligned orientation so it fits a grid, that takes Blasts like any Building. A Crush's stack becomes Rubble the same way when it lands.

## Consequences

- A Fragment that comes to rest tilted snaps upright, or onto its side, when it becomes Rubble.
- Rubble's bottom layer counts as the ground, even when it lies on another Building's stump.

- Collapse logic can be unit-tested with `bun test`, with no rendering or physics involved.
- Bites are purely cosmetic, so the visible damage can drift from the grid's 1 m resolution.
- Physics-driven behaviour, such as a beam bending, cannot cause a collapse unless the grid models it.
