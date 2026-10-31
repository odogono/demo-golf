import type { Vec3 } from "math";
import { CHURCH, LIGHTHOUSE } from "./hole";
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
    building: LIGHTHOUSE,
    steps: [
      // A standard ball's Blast low on the shaft only bites it.
      { shot: { from: [0, 0, 4], at: [0, 3, -7], ball: "standard" } },
      // One the size of an explosive ball's takes out a side of a storey, and the tower Tips.
      { blast: { center: [0, 2.5, -7.5], radius: 3, power: 150 } },
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
  {
    name: "glass-office",
    building: { origin: [-4.5, 0, -14.5], size: [9, 21, 9], floorHeight: 3, blueprint: "glass-office" },
    steps: [
      { blast: { center: [0, 8, -6.5], radius: 1.5, power: 60 } },
      { shot: { from: [0, 0, 4], at: [1.5, 4.5, -6.5], ball: "standard" } },
      { shot: { from: [0, 0, 4], at: [-1.5, 10.5, -6.5], ball: "explosive" } },
    ],
  },
  {
    name: "arch-bridge",
    building: { origin: [-12, 0, -15], size: [24, 10, 5], blueprint: "arch-bridge" },
    steps: [
      // A standard ball only bites the span.
      { shot: { from: [4, 0, 4], at: [4, 6.5, -10], ball: "standard" } },
      // An explosive one low near a quarter point brings the deck down onto the arch.
      { shot: { from: [-5, 0, 4], at: [-5, 4.5, -10], ball: "explosive" } },
      { shot: { from: [5, 0, 4], at: [5, 6, -10], ball: "explosive" } },
    ],
  },
  {
    name: "church",
    building: CHURCH,
    steps: [
      // A standard ball only bites the tower.
      { shot: { from: [0, 0, 4], at: [0, 4, -2.9], ball: "standard" } },
      // An explosive one low on its front Tips the tower over, away from the nave, which stands.
      { shot: { from: [0, 0, 4], at: [0, 2.5, -2.9], ball: "explosive" } },
      { shot: { from: [5, 0, 4], at: [4.5, 4, -10], ball: "explosive" } },
    ],
  },
];

export function scenarioNamed(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
