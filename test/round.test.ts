import { expect, test } from "bun:test";
import { DEFAULT_ROUND, createRound, scoreName } from "../src/game/round";

const settings = { ...DEFAULT_ROUND };

test("each Shot is one Stroke, and only one Shot is in play at a time", () => {
  const round = createRound(settings, 24);
  expect(round.shoot()).toBe(true);
  expect(round.shoot()).toBe(false);
  expect(round.strokes).toBe(1);
});

test("a Shot ends once the scene Settles", () => {
  const round = createRound(settings, 24);
  round.shoot();
  expect(round.update(1, false).over).toBe(false);
  expect(round.update(1, true)).toEqual({ over: true, timedOut: false });
});

test("a Shot ends at the settle timeout even if bodies still move", () => {
  const round = createRound(settings, 24);
  round.shoot();
  expect(round.update(settings.settleTimeout - 0.1, false).over).toBe(false);
  expect(round.update(0.2, false)).toEqual({ over: true, timedOut: true });
});

test("the Hole is won once 70% of the Target's Cells are Destroyed", () => {
  const round = createRound(settings, 100);
  round.shoot();
  round.finish(31);
  expect(round.state).toBe("aiming");
  round.shoot();
  round.finish(30);
  expect(round.state).toBe("won");
  expect(round.shoot()).toBe(false);
});

test("the threshold is a setting", () => {
  const round = createRound({ ...settings, winDestroyed: 0.25 }, 100);
  round.shoot();
  round.finish(75);
  expect(round.state).toBe("won");
});

test("Destroyed is the share of starting Cells gone from the Structure", () => {
  const round = createRound(settings, 200);
  expect(round.destroyed(200)).toBe(0);
  expect(round.destroyed(50)).toBe(0.75);
  expect(createRound(settings, 0).destroyed(0)).toBe(0);
});

test("the score is named against Par", () => {
  expect(scoreName(1, 5)).toBe("Hole in one");
  expect(scoreName(4, 5)).toBe("Birdie");
  expect(scoreName(5, 5)).toBe("Par");
  expect(scoreName(9, 5)).toBe("4 over par");
});
