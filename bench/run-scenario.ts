import { vec3 } from "math";
import { createBuildings, inlineStructures, type Building } from "../src/damage/buildings";
import { createCollapse, DEFAULT_COLLAPSE } from "../src/damage/collapse";
import { createDamage } from "../src/damage/damage";
import { createDebris } from "../src/damage/debris";
import { DEFAULT_ROUND } from "../src/game/round";
import { createCrashcatWorld } from "../src/physics/crashcat";
import { seeded } from "../src/random";
import type { Scenario } from "../src/scenarios";
import { launchVelocity } from "../src/shot/aim";
import { autoAim } from "../src/shot/auto-aim";
import { BALL_TYPES } from "../src/shot/ball-types";
import { createRestCheck, launchBall } from "../src/shot/shot";

const DT = 1 / 60;

/** What one step of a Scenario did, measured once the Hole Settled. */
export type StepResult = {
  step: number;
  kind: "blast" | "shot";
  /** The Target's Height in metres, and as a fraction of its starting Height. */
  height: number;
  heightLeft: number;
  /** Cells that left any Structure, by how they left. */
  cells: { blast: number; detach: number; crush: number; tip: number };
  /** Fragments made by Detach and Tip, and Debris pieces thrown. */
  fragments: number;
  debris: number;
  /** Simulated seconds until Settled, and whether the settle timeout ended it instead. */
  settleTime: number;
  timedOut: boolean;
  /** For Shots: whether the ball set off a Blast. */
  hit?: boolean;
  /** The Stroke on which the Hole was won, if this step won it. */
  wonOnStroke?: number;
};

export type ScenarioResult = { name: string; startHeight: number; steps: StepResult[] };

/**
 * Plays a Scenario headlessly, the way the game would, with a fixed seed so
 * the same Scenario gives the same numbers. The Structure runs inline.
 */
export function runScenario(scenario: Scenario, seed = 1): ScenarioResult {
  const random = seeded(seed);
  const world = createCrashcatWorld();
  world.addBody({ shape: { kind: "box", halfExtents: [100, 0.5, 100] }, motion: "static", position: [0, -0.5, 0] });
  const buildings = createBuildings(world, inlineStructures(), [scenario.building]);
  const debris = createDebris(world, {
    cap: 150,
    otherBodies: () => (damage.ball === undefined ? 0 : 1) + collapse.moving,
    random,
  });
  const damage = createDamage(world, buildings, debris);
  const collapse = createCollapse(world, buildings, debris, { ...DEFAULT_COLLAPSE }, random);
  const target: Building = buildings.list[0]!;
  const startHeight = target.structure.height();

  let thrown = 0;
  const spawn = debris.spawn;
  debris.spawn = (...args: Parameters<typeof spawn>) => {
    thrown += args[2];
    return spawn(...args);
  };

  const steps: StepResult[] = [];
  let strokes = 0;
  let won = false;
  scenario.steps.forEach((step, index) => {
    const result: StepResult = {
      step: index,
      kind: "blast" in step ? "blast" : "shot",
      height: 0,
      heightLeft: 0,
      cells: { blast: 0, detach: 0, crush: 0, tip: 0 },
      fragments: 0,
      debris: 0,
      settleTime: 0,
      timedOut: false,
    };
    thrown = 0;
    const heightBefore = target.structure.height();

    if ("blast" in step) {
      buildings.blast(target, { ...step.blast, outward: [0, 0, 1] });
    } else {
      const type = BALL_TYPES[step.shot.ball];
      const from = vec3.clone(step.shot.from);
      const { aim, power } = autoAim([from[0], from[1] + type.radius, from[2]], step.shot.at, type);
      damage.track(launchBall(world, type, launchVelocity(vec3.create(), aim, power * type.maxSpeed), from), type);
      result.hit = false;
      strokes++;
    }

    const rest = createRestCheck();
    let time = 0;
    for (;;) {
      for (const outcome of buildings.drain()) {
        result.cells.blast += outcome.reply.result.destroyed.length;
        for (const event of outcome.reply.events) {
          if (event.kind === "detach") result.cells.detach += event.cells.length;
          if (event.kind === "tip") result.cells.tip += event.cells.length;
          if (event.kind === "crush") result.cells.crush += event.crushed.length;
          if (event.kind !== "crush") result.fragments++;
        }
        collapse.apply(outcome);
      }
      world.step(DT);
      if (damage.update().length > 0) result.hit = true;
      collapse.update(DT);
      debris.update();
      buildings.drainAdded();
      time += DT;

      if (damage.ball !== undefined) {
        const position = world.getPosition(damage.ball);
        if (position[1] < -5 || rest.update(vec3.length(world.getLinearVelocity(damage.ball)), DT)) {
          world.removeBody(damage.ball);
          damage.track(undefined);
        }
      }
      if (world.isSettled() && !collapse.animating && !buildings.waiting && damage.ball === undefined) break;
      if (time >= DEFAULT_ROUND.settleTimeout) {
        result.timedOut = true;
        if (damage.ball !== undefined) world.removeBody(damage.ball);
        damage.track(undefined);
        collapse.freeze();
        debris.freeze();
        break;
      }
    }

    result.settleTime = Math.round(time * 100) / 100;
    result.debris = thrown;
    result.height = target.structure.height();
    result.heightLeft = Math.round((result.height / startHeight) * 100) / 100;
    // Won by this Shot only if it brought the Target down; a Blast step can't win.
    const winHeight = startHeight * DEFAULT_ROUND.winBelow;
    if (!won && result.kind === "shot" && heightBefore >= winHeight && result.height < winHeight) {
      won = true;
      result.wonOnStroke = strokes;
    }
    steps.push(result);
  });
  return { name: scenario.name, startHeight, steps };
}
