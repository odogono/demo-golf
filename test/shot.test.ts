import { describe, expect, test } from "bun:test";
import type { Vec3 } from "math";
import { STEP } from "../src/loop";
import { createCrashcatWorld } from "../src/physics/crashcat";
import { BALL_TYPES } from "../src/shot/ball-types";
import { MAX_LOFT, clampAim, launchVelocity } from "../src/shot/aim";
import { createPowerMeter } from "../src/shot/power-meter";
import { createRestCheck, launchBall, REST_TIME } from "../src/shot/shot";
import { predictTrajectory } from "../src/shot/trajectory";

test("aim straight ahead launches down -z", () => {
  const v = launchVelocity([0, 0, 0], { yaw: 0, loft: 0 }, 10);
  expect(v[0]).toBeCloseTo(0);
  expect(v[1]).toBeCloseTo(0);
  expect(v[2]).toBeCloseTo(-10);
});

test("loft and yaw split the speed", () => {
  const v = launchVelocity([0, 0, 0], { yaw: Math.PI / 2, loft: Math.PI / 4 }, 10);
  expect(v[0]).toBeCloseTo(-Math.SQRT1_2 * 10);
  expect(v[1]).toBeCloseTo(Math.SQRT1_2 * 10);
  expect(v[2]).toBeCloseTo(0);
  expect(clampAim({ yaw: 0, loft: 3 }).loft).toBe(MAX_LOFT);
});

test("the power meter climbs, falls back and reports on release", () => {
  const meter = createPowerMeter(1);
  expect(meter.release()).toBeUndefined();
  meter.press();
  meter.update(0.25);
  expect(meter.power).toBeCloseTo(0.25);
  meter.update(1);
  expect(meter.power).toBeCloseTo(0.75);
  expect(meter.release()).toBeCloseTo(0.75);
  expect(meter.held).toBe(false);
  expect(meter.power).toBe(0);
});

test("the trajectory preview follows the ball in free flight", () => {
  const world = createCrashcatWorld();
  const velocity = launchVelocity([0, 0, 0], { yaw: 0.2, loft: 0.6 }, 20);
  const ball = launchBall(world, BALL_TYPES.standard, velocity, [0, 50, 0]);
  const start = world.getPosition(ball);
  const preview = predictTrajectory(start, velocity, { drag: BALL_TYPES.standard.drag, duration: 1, floorY: -Infinity });
  for (let i = 1; i <= 60; i++) world.step(STEP);
  const actual = world.getPosition(ball);
  const predicted = preview[60]!;
  for (let k = 0; k < 3; k++) expect(Math.abs(actual[k]! - predicted[k]!)).toBeLessThan(0.01);
});

test("the preview stops at the floor", () => {
  const points = predictTrajectory([0, 0, 0], [0, 5, -5]);
  expect(points.at(-1)![1]).toBeGreaterThanOrEqual(0);
  expect(points.length).toBeGreaterThan(30);
  expect(points.length).toBeLessThan(70);
});

for (const type of Object.values(BALL_TYPES)) {
  test(`a ${type.id} ball hits a static box building`, () => {
    const world = createCrashcatWorld();
    world.addBody({ shape: { kind: "box", halfExtents: [50, 0.5, 50] }, motion: "static", position: [0, -0.5, 0] });
    const building = world.addBody({
      shape: { kind: "box", halfExtents: [4, 10, 4] },
      motion: "static",
      position: [0, 10, -10],
    });
    let hit = false;
    world.onContact((e) => {
      if (e.a === building || e.b === building) hit = true;
    });
    const tee: Vec3 = [0, 0, 18];
    const ball = launchBall(world, type, launchVelocity([0, 0, 0], { yaw: 0, loft: 0.3 }, type.maxSpeed), tee);
    for (let i = 0; i < 180 && !hit; i++) world.step(STEP);
    expect(hit).toBe(true);
    expect(world.getPosition(ball)[2]).toBeGreaterThan(-6);
  });
}

describe("rest check", () => {
  test("a ball is at rest once it stays slow, but not at the top of a lob", () => {
    const rest = createRestCheck();
    // Slow for a moment at the top of a lob, then falling again.
    for (let n = 0; n < 10; n++) expect(rest.update(0.1, 1 / 60)).toBe(false);
    expect(rest.update(5, 1 / 60)).toBe(false);
    let steps = 0;
    while (!rest.update(0.1, 1 / 60)) steps++;
    expect((steps + 1) / 60).toBeCloseTo(REST_TIME, 1);
  });
});
