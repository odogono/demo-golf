import { expect, test } from "bun:test";
import { runScenario } from "../bench/run-scenario";
import { SCENARIOS, type Scenario } from "../src/scenarios";

const SHORT: Scenario = {
  name: "short",
  building: { origin: [-4, 0, -14], size: [8, 20, 8], blueprint: "frame" },
  steps: [
    { blast: { center: [0, 2, -6], radius: 3, power: 150 } },
    { shot: { from: [0, 0, 6], at: [0, 3, -6], ball: "standard" } },
  ],
};

test("a Scenario measures each step once it Settles", () => {
  const { startHeight, steps } = runScenario(SHORT);
  expect(startHeight).toBe(20);
  expect(steps.map((s) => s.kind)).toEqual(["blast", "shot"]);
  expect(steps[0]!.cells.blast).toBeGreaterThan(0);
  expect(steps[1]!.hit).toBe(true);
  expect(steps[1]!.debris).toBeGreaterThan(0);
  expect(steps[1]!.destroyed).toBeGreaterThanOrEqual(steps[0]!.destroyed);
  expect(steps[0]!.destroyed).toBeGreaterThan(0);
  for (const step of steps) expect(step.heightLeft).toBe(Math.round((step.height / startHeight) * 100) / 100);
});

test("the same seed gives the same results", () => {
  expect(runScenario(SHORT, 7)).toEqual(runScenario(SHORT, 7));
});

test("every Scenario's Shots start on open ground in front of its building", () => {
  for (const { building, steps } of SCENARIOS) {
    const front = (building.origin?.[2] ?? 0) + building.size[2];
    for (const step of steps) if ("shot" in step) expect(step.shot.from[2]).toBeGreaterThan(front);
  }
});
