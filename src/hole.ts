import type { StructureOptions } from "./structure/structure";

/**
 * The lighthouse. A tall, slender tower Tips readily: its centre of mass must
 * sit 2 m inside what is left of a storey, or it falls over (#37).
 */
export const LIGHTHOUSE: StructureOptions = { origin: [-4.5, 0, -14.5], size: [9, 24, 9], blueprint: "lighthouse", tipMargin: 2 };

/** The church: a tall tower before a long nave, Tipping as readily as the lighthouse (#22). */
export const CHURCH: StructureOptions = { origin: [-5, 0, -22], size: [10, 21, 20], blueprint: "church", tipMargin: 2 };

/** The Hole's buildings: the Target, a lighthouse, with no Neighbours. */
export const BUILDINGS: StructureOptions[] = [LIGHTHOUSE];
