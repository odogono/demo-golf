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

test("the Hole is won when the Target falls below 30% of its starting Height", () => {
  const round = createRound(settings, 24);
  round.shoot();
  round.finish(8);
  expect(round.state).toBe("aiming");
  round.shoot();
  round.finish(7);
  expect(round.state).toBe("won");
  expect(round.shoot()).toBe(false);
});

test("the score is named against Par", () => {
  expect(scoreName(1, 5)).toBe("Hole in one");
  expect(scoreName(4, 5)).toBe("Birdie");
  expect(scoreName(5, 5)).toBe("Par");
  expect(scoreName(9, 5)).toBe("4 over par");
});
