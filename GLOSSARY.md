# Glossary

**Hole** — One playable level: a Tee, a Target, any number of Neighbours (possibly none), and a Par.

**Tee** — The fixed spot every Shot starts from.

**Shot** — One launch of the ball from the Tee. Each Shot counts as one Stroke.

**Stroke** — One unit of the player's score on a Hole, compared against Par.

**Par** — The expected number of Strokes needed to win a Hole.

**Target** — The building the player must bring down. Only its Height counts toward winning.

**Neighbour** — A building that can be damaged by Fragments but does not count toward winning.

**Structure** — The grid of Cells that models a building and alone decides whether it holds, crumbles or falls.

**Cell** — A 1 m cube of a Structure, with a Material, mass, Integrity and Capacity.

**Material** — What a Cell is made of, such as stone, brick, timber or glass. It sets the Cell's mass, Integrity and Capacity, and the look of its Debris. One building can mix Materials.

**Blueprint** — The layout of a building's Cells and their Materials, from which its Structure is built. Different kinds of building differ only in their Blueprint, never in how they are destroyed.

**Integrity** — How much Blast damage a Cell can take before it is destroyed.

**Capacity** — How much mass above it a Cell can carry before it is crushed. It falls as Integrity falls.

**Blast** — A single damage event on a Structure, defined by a centre, radius and power. Every kind of damage is a Blast, including ball impacts and Fragment impacts.

**Bite** — The visible hole cut into a building's mesh to show a Blast. It only shows damage and never decides anything.

**Detach** — When Cells are no longer connected to the ground and leave the Structure.

**Crush** — When Cells fail under load and the floors above them pancake downward.

**Tip** — When the part of a Structure above a damaged layer topples over a pivot edge.

**Fragment** — A piece that has left a Structure through Detach or Tip and is governed only by physics until it comes to rest and becomes Rubble.

**Debris** — Small chunks thrown off by a Blast. They collide with the world but never cause a Blast.

**Rubble** — What is left at rest. A Fragment or Crush stack at rest becomes a new Building, snapped to the nearest upright grid, that takes Blasts like any other. Old Debris freezes in place to stay within the physics body budget.

**Terrain** — The ground of a Hole. It can be lowered by a Blast but never raised, and it never decides whether a Structure holds or falls.

**Foundation** — The fixed, indestructible plinth a Structure stands on. It is not made of Cells, is never damaged and stays after its Structure has fallen.

**Crater** — A dip that a ball's Blast leaves in the Terrain where its radius reaches the ground. It never reaches into a Foundation, and it lasts until the Hole ends.

**Height** — The height, above the top of its Foundation, of the highest Cell in a Structure that is still connected to the ground.

**Settled** — The state in which every body is asleep, or the settle timeout has passed, so the next Shot is allowed.
