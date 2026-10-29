import { expect, test } from "bun:test";
import type { StructureReply, StructureRequest } from "../src/structure/structure-host";

test("structure.worker.ts applies a Blast, evaluates and replies with the new grid", async () => {
  const worker = new Worker(new URL("../src/structure/structure.worker.ts", import.meta.url));
  const reply = new Promise<StructureReply>((resolve) => worker.addEventListener("message", (e) => resolve(e.data)));
  const send = (request: StructureRequest) => worker.postMessage(request);
  send({ type: "create", id: 3, options: { size: [3, 3, 1], floorHeight: 2, pillarSpacing: 2 } });
  // Destroy the ground row: everything above it Detaches.
  send({ type: "blast", id: 3, blast: 9, center: [1.5, 0.5, 0.5], radius: 1.2, power: 1000 });
  const { id, blast, result, events, removed, alive } = await reply;
  worker.terminate();
  expect([id, blast]).toEqual([3, 9]);
  expect(result.destroyed).toEqual([0, 1, 2]);
  expect(events.map((e) => e.kind)).toEqual(["detach"]);
  // Every Cell has left: the 3 destroyed, then the 2 pillars and the roof slab above them.
  expect(new Set(removed).size).toBe(8);
  expect(alive.every((a) => a === 0)).toBe(true);
});
