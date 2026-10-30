import { describe, expect, test } from "bun:test";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { createDamage } from "../src/damage/damage";
import { DEFAULT_ROUND } from "../src/game/round";
import { createDebris } from "../src/damage/debris";
import { createCrashcatWorld } from "../src/physics/crashcat";
import { BALL_TYPES } from "../src/shot/ball-types";
import { createRestCheck, launchBall } from "../src/shot/shot";
import { structureColliders } from "../src/structure/colliders";
import { createStructure } from "../src/structure/structure";

const DT = 1 / 60;
const TARGET = { origin: [-4, 0, -14] as [number, number, number], size: [8, 20, 8] as [number, number, number] };

function setup(cap = 150) {
  const world = createCrashcatWorld();
  world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
  const buildings = createBuildings(world, inlineStructures(), [TARGET]);
  const debris = createDebris(world, { cap, otherBodies: () => (damage.ball === undefined ? 0 : 1) });
  const damage = createDamage(world, buildings, debris);
  return { world, buildings, debris, damage };
}

/** Fires a ball straight at the Target's front face at `speed` and runs until it hits. */
function fire(env: ReturnType<typeof setup>, type: keyof typeof BALL_TYPES, speed: number) {
  const ball = launchBall(env.world, BALL_TYPES[type], [0, 0, -speed], [0, 4, 0]);
  env.damage.track(ball, BALL_TYPES[type]);
  const hits = [];
  for (let n = 0; n < 120 && hits.length === 0; n++) {
    env.world.step(DT);
    hits.push(...env.damage.update());
  }
  return hits;
}

describe("colliders", () => {
  test("merged boxes cover exactly the live Cells", () => {
    const s = createStructure({ size: [8, 20, 8] });
    const boxes = structureColliders(s);
    let volume = 0;
    for (const { shape } of boxes) {
      if (shape.kind !== "box") throw new Error("expected boxes");
      volume += 8 * shape.halfExtents[0] * shape.halfExtents[1] * shape.halfExtents[2];
    }
    expect(volume).toBe(s.alive.reduce((a, b) => a + b, 0));
    // One box per slab and per storey of each pillar.
    expect(boxes).toHaveLength(6 + 9 * 14);
  });
});

describe("hits", () => {
  test("every ball sets off its own Blast on touching a building, whatever its speed, and is used up", () => {
    for (const type of ["standard", "explosive"] as const) {
      for (const speed of [8, 30]) {
        const env = setup();
        const hits = fire(env, type, speed);
        expect(hits).toHaveLength(1);
        expect(hits[0]!.blast.radius).toBe(BALL_TYPES[type].blast.radius);
        expect(hits[0]!.blast.power).toBe(BALL_TYPES[type].blast.power);
        expect(hits[0]!.buildings).toHaveLength(1);
        expect(env.damage.ball).toBeUndefined();
      }
    }
  });

  test("the Blast is on the Target's front face, and Debris flies back out of it", () => {
    const [hit] = fire(setup(), "standard", 30);
    expect(hit!.blast.center[2]).toBeCloseTo(-6, 0);
    expect(hit!.blast.outward[2]).toBeGreaterThan(0.9);
  });

  test("a ball landing hard on the ground away from buildings doesn't go off and comes to rest", () => {
    for (const type of ["standard", "explosive"] as const) {
      const env = setup();
      // Lobbed away from the Target, so it thumps down on open ground.
      const ball = launchBall(env.world, BALL_TYPES[type], [0, 8, 12], [0, 0, 6]);
      env.damage.track(ball, BALL_TYPES[type]);
      // It must come to rest within the settle timeout, or it would count as out of play.
      const rest = createRestCheck();
      let rested = false;
      for (let n = 0; n < DEFAULT_ROUND.settleTimeout * 60 && !rested; n++) {
        env.world.step(DT);
        expect(env.damage.update()).toHaveLength(0);
        rested = rest.update(Math.hypot(...env.world.getLinearVelocity(ball)), DT);
      }
      expect(env.damage.ball).toBe(ball);
      expect(rested).toBe(true);
      expect(env.world.getPosition(ball)[2]).toBeGreaterThan(6);
    }
  });

  test("the Structure's results arrive through drain and update the grid and collider", () => {
    const env = setup();
    const [building] = env.buildings.list;
    const body = building!.body;
    fire(env, "explosive", 20);
    const outcomes = env.buildings.drain();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.reply.result.destroyed.length).toBeGreaterThan(0);
    expect(building!.structure.alive.reduce((a, b) => a + b, 0)).toBe(outcomes[0]!.reply.alive.reduce((a, b) => a + b, 0));
    expect(building!.body).not.toBe(body);
    expect(env.buildings.drain()).toHaveLength(0);
  });
});

describe("Debris", () => {
  test("each hit throws 5–15 pieces", () => {
    const env = setup();
    fire(env, "standard", 30);
    expect(env.debris.live.length).toBeGreaterThanOrEqual(5);
    expect(env.debris.live.length).toBeLessThanOrEqual(15);
  });

  test("Debris never causes a Blast", () => {
    const env = setup();
    // Hurl Debris at the Target with no ball in play.
    for (let n = 0; n < 4; n++) env.debris.spawn([0, 2 + n, -5], [0, 0, -1], 15);
    for (let n = 0; n < 60; n++) {
      env.world.step(DT);
      expect(env.damage.update()).toHaveLength(0);
    }
    expect(env.buildings.drain()).toHaveLength(0);
  });

  test("at the body cap, the oldest Debris freezes into Rubble", () => {
    const env = setup(20);
    env.debris.spawn([0, 2, 0], [0, 1, 0], 15);
    const oldest = env.debris.live[0]!;
    env.debris.spawn([0, 2, 0], [0, 1, 0], 15);
    expect(env.debris.live).toHaveLength(20);
    expect(env.debris.rubble).toHaveLength(10);
    expect(env.debris.live).not.toContain(oldest);
    expect(env.debris.rubble[0]!.halfExtents).toBe(oldest.halfExtents);

    // Lowering the cap freezes more at once.
    env.debris.cap = 5;
    expect(env.debris.live).toHaveLength(5);
  });
});
