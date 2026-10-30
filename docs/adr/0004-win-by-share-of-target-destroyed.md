# 4. Win by the share of the Target Destroyed

## Status

Accepted. Supersedes the Height win rule.

## Context

A Hole was won once the Target's Height fell below 30% of where it started. That suits a tower but not other buildings. A bridge whose middle span drops out leaves both ends standing at nearly full Height, so it could never be won. A lighthouse whose top breaks off and lands upright on its stump wins at once, while a full-height tower still stands on screen. Adding more kinds of building would only make these cases more common.

## Decision

The Hole is won once a set share of the Target's original Cells is Destroyed: no longer part of its Structure, whether a Blast destroyed them or they left by Detach, Crush or Tip. Cells that come to rest as Rubble still count, because Rubble is a new Building and not the Target. The share counts Cells, not mass, and Ornaments never count. The threshold is set per Hole, 70% by default. Height stays as a measurement, for example in Scenarios, but no longer decides anything.

## Consequences

- The HUD shows how much of the Target is Destroyed, in place of its Height.
- Any shape of building can be a Target, including a bridge.
- A heavy base and a light glass wall count the same per Cell, so a building that is mostly glass is easier to win.
