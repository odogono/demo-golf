import { expect, test } from "bun:test";
import { STEP, createFixedLoop } from "../src/loop";

test("runs whole steps and returns the leftover fraction", () => {
  let steps = 0;
  const loop = createFixedLoop(() => steps++);
  const alpha = loop.advance(STEP * 2.5);
  expect(steps).toBe(2);
  expect(alpha).toBeCloseTo(0.5);
});

test("clamps long frames so a stall can't spiral", () => {
  let steps = 0;
  const loop = createFixedLoop(() => steps++);
  loop.advance(10);
  expect(steps).toBe(15);
});
