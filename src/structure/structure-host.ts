import type { Vec3 } from "math";
import { createStructure, type BlastResult, type Structure, type StructureEvent, type StructureOptions } from "./structure";

/**
 * The messages between the main thread and `structure.worker.ts`, and the
 * handler that runs on the worker's side. Each Structure lives in the worker
 * (ADR 0001); the main thread keeps a copy of each grid, updated from the
 * state every reply carries.
 */

export type StructureRequest =
  | { type: "create"; id: number; options: StructureOptions }
  | { type: "blast"; id: number; blast: number; center: Vec3; radius: number; power: number };

export type StructureReply = {
  type: "blast";
  id: number;
  /** Echoes the request, so the main thread can match the reply to its hit. */
  blast: number;
  result: BlastResult;
  events: StructureEvent[];
  /** Every Cell that left the Structure: those the Blast destroyed first, then those in events. */
  removed: number[];
  alive: Uint8Array;
  integrity: Float32Array;
  /** Milliseconds the worker spent on `applyBlast` and `evaluate`. */
  ms: number;
};

export function createStructureHost() {
  const structures = new Map<number, Structure>();
  return {
    handle(request: StructureRequest): StructureReply | undefined {
      if (request.type === "create") {
        structures.set(request.id, createStructure(request.options));
        return undefined;
      }
      const structure = structures.get(request.id);
      if (!structure) return undefined;
      const start = performance.now();
      const result = structure.applyBlast(request.center, request.radius, request.power);
      const events = structure.evaluate();
      const removed = [...result.destroyed];
      for (const event of events) {
        if (event.kind === "crush") removed.push(...event.crushed, ...event.falling);
        else removed.push(...event.cells);
      }
      return {
        type: "blast",
        id: request.id,
        blast: request.blast,
        result,
        events,
        removed,
        alive: structure.alive.slice(),
        integrity: structure.integrity.slice(),
        ms: performance.now() - start,
      };
    },
  };
}
