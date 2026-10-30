import type { Vec3 } from "math";
import type { BallTypeId } from "./shot/ball-types";
import type { StructureOptions } from "./structure/structure";

/**
 * One step of a Scenario: a Blast set off directly on the Target, or a Shot
 * fired from `from` (on the ground) and auto-aimed at `at`. Shots start close
 * enough to hit, so a step measures the building, not the golfer.
 */
export type ScenarioStep =
  | { blast: { center: Vec3; radius: number; power: number } }
  | { shot: { from: Vec3; at: Vec3; ball: BallTypeId } };

/** A repeatable test of one Blueprint, standing alone as the Target (GLOSSARY.md). */
export type Scenario = { name: string; building: StructureOptions; steps: ScenarioStep[] };

export const SCENARIOS: Scenario[] = [
  {
    name: "frame",
    building: { origin: [-4, 0, -14], size: [8, 20, 8], blueprint: "frame" },
    steps: [
      { blast: { center: [0, 2, -6], radius: 3, power: 150 } },
      { shot: { from: [0, 0, 6], at: [-3, 3, -6], ball: "explosive" } },
      { shot: { from: [0, 0, 6], at: [3, 3, -6], ball: "standard" } },
    ],
  },
  {
    name: "lighthouse",
    building: { origin: [-4.5, 0, -14.5], size: [9, 24, 9], blueprint: "lighthouse" },
    steps: [
      { blast: { center: [0, 6, -7], radius: 1.5, power: 60 } },
      { shot: { from: [0, 0, 4], at: [0, 3, -7], ball: "standard" } },
      { shot: { from: [0, 0, 4], at: [0, 2, -7], ball: "explosive" } },
    ],
  },
  {
    name: "car-park",
    building: { origin: [-4.5, 0, -14.5], size: [9, 15, 9], floorHeight: 3, blueprint: "car-park" },
    steps: [
      { blast: { center: [0.5, 4.5, -7], radius: 1.5, power: 60 } },
      { shot: { from: [0, 0, 4], at: [2, 1.5, -6], ball: "explosive" } },
      { shot: { from: [0, 0, 4], at: [-1, 7.5, -6], ball: "standard" } },
    ],
  },
];

export function scenarioNamed(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
