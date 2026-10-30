# 3. Every Ball is a bomb, and only buildings set it off

## Status

Accepted

## Context

There were two kinds of ball. The standard ball set off a small Blast on every hard hit on a building, with power scaled by how hard it hit, so one Shot could cause several Blasts. The explosive ball set off one large Blast on its first contact with a building, or on its first hard landing anywhere, and was used up. Comparing Blueprints needs one Shot to mean one known amount of damage. The game also needs to play like golf, where a Shot that misses leaves the ball somewhere to play from.

## Decision

Every Ball explodes into exactly one Blast the first time it touches a building, and is then used up. Its Blast radius and power come from its ball type and do not depend on how fast it hit. Touching anything else, such as the Terrain, water or a Foundation, never sets a Ball off. It bounces, rolls and comes to rest, and where it stops becomes the Lie for the next Shot. After an explosion, or a ball going out of play, the next Shot is played from the previous Lie, at the cost of one Stroke.

## Consequences

- One Shot that hits causes exactly one Blast, so Scenarios can measure a Shot as one step.
- The hit-by-impulse damage path and its cooldown are removed. Ball types differ only in their Blast and flight.
- A Crater appears only when a Ball's Blast at a building reaches the ground.
- Shots no longer all start from the Tee. The Tee is only the first Lie.
