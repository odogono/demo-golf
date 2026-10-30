import { describe, expect, test } from "bun:test";
import type { Vec3 } from "math";
import { createBuildings, inlineStructures } from "../src/damage/buildings";
import { createDamage } from "../src/damage/damage";
import { createDebris } from "../src/damage/debris";
import { createCrashcatWorld } from "../src/physics/crashcat";
import { launchVelocity } from "../src/shot/aim";
import { autoAim } from "../src/shot/auto-aim";
import { BALL_TYPES } from "../src/shot/ball-types";
import { launchBall, TEE } from "../src/shot/shot";

const DT = 1 / 60;
const FROM: Vec3 = [TEE[0], TEE[1] + BALL_TYPES.standard.radius, TEE[2]];

describe("autoAim", () => {
  test("aims a predicted flight through points on both Buildings", () => {
    for (const target of [[0, 2.5, -6], [0, 15.5, -6], [8.5, 3.5, -9], [11, 10.5, -6]] as Vec3[]) {
      for (const type of [BALL_TYPES.standard, BALL_TYPES.explosive]) {
        expect(autoAim(FROM, target, type).miss).toBeLessThan(0.5);
      }
    }
  });

  test("the shot it picks hits the Building it aims at", () => {
    const world = createCrashcatWorld();
    world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
    const buildings = createBuildings(world, inlineStructures(), [
      { origin: [-4, 0, -14], size: [8, 20, 8] },
      { origin: [8, 0, -12], size: [6, 12, 6] },
    ]);
    const debris = createDebris(world, { cap: 150 });
    const damage = createDamage(world, buildings, debris);
    const { aim, power } = autoAim(FROM, [10.5, 4.5, -6.5], BALL_TYPES.standard);
    const ball = launchBall(world, BALL_TYPES.standard, launchVelocity([0, 0, 0], aim, power * BALL_TYPES.standard.maxSpeed));
    damage.track(ball, BALL_TYPES.standard);
    const hits = [];
    for (let n = 0; n < 240 && hits.length === 0; n++) {
      world.step(DT);
      hits.push(...damage.update());
    }
    expect(hits[0]?.buildings).toEqual([buildings.list[1]!]);
  });

  test("solves within a frame or two", () => {
    autoAim(FROM, [0, 2.5, -6], BALL_TYPES.standard);
    const start = performance.now();
    autoAim(FROM, [8.5, 3.5, -9], BALL_TYPES.explosive);
    expect(performance.now() - start).toBeLessThan(40);
  });
});
