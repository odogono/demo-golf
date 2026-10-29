import { describe, expect, test } from "bun:test";
import { createStructure } from "../src/structure/structure";

const target = () => createStructure({ size: [8, 20, 8] });

describe("generation", () => {
  test("builds hollow floors held up by pillars", () => {
    const s = target();
    expect(s.alive[s.index(3, 0, 3)]).toBe(1); // ground slab
    expect(s.alive[s.index(3, 2, 3)]).toBe(0); // hollow storey
    expect(s.alive[s.index(0, 2, 0)]).toBe(1); // corner pillar
    expect(s.alive[s.index(3, 4, 3)]).toBe(1); // next floor
    expect(s.alive[s.index(3, 19, 3)]).toBe(1); // roof
  });

  test("an undamaged building stands", () => {
    const s = target();
    expect(s.evaluate()).toEqual([]);
    expect(s.height()).toBe(20);
  });
});

describe("connectivity", () => {
  test("Cells cut off from the ground Detach as one island", () => {
    const s = createStructure({ size: [3, 3, 1], floorHeight: 2, pillarSpacing: 2 });
    // Remove the ground row, leaving everything above floating.
    for (let x = 0; x < 3; x++) s.applyBlast([x + 0.5, 0.5, 0.5], 0.1, 1000);
    const events = s.evaluate();
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("detach");
    expect(s.height()).toBe(0);
  });

  test("Height is the highest Cell still connected to the ground", () => {
    const s = target();
    // Destroy a storey of every pillar between floors 2 and 3.
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) s.applyBlast([x + 0.5, 10.5, z + 0.5], 0.1, 1000);
    }
    expect(s.height()).toBe(10);
    const [event] = s.evaluate();
    expect(event!.kind).toBe("detach");
    expect(s.height()).toBe(10);
  });
});

describe("load cascade", () => {
  test("losing pillars overloads the rest of the layer, which Crush in turn", () => {
    const s = createStructure({ size: [8, 20, 8], safetyFactor: 1.5 });
    // Keep only the corner pillars: the footprint is intact, but they can't carry the load.
    for (const [x, z] of [
      [0, 4],
      [4, 0],
      [4, 4],
      [4, 7],
      [7, 4],
    ]) {
      s.applyBlast([x! + 0.5, 1.5, z! + 0.5], 0.1, 1000);
    }
    const events = s.evaluate();
    const crush = events.find((e) => e.kind === "crush");
    expect(crush).toBeDefined();
    expect(crush!.kind === "crush" && crush!.falling.length).toBeGreaterThan(0);
    expect(s.height()).toBe(1);
  });

  test("Capacity falls in proportion to Integrity", () => {
    const s = target();
    const i = s.index(0, 1, 0);
    const before = s.capacity(i);
    s.applyBlast([0.5, 1.5, 0.5], 1, 50);
    expect(s.capacity(i)).toBeCloseTo((before * s.integrity[i]!) / s.fullIntegrity);
  });

  test("a weakened pillar Crushes under the floors above", () => {
    const s = createStructure({ size: [1, 9, 1], floorHeight: 3 });
    const i = s.index(0, 1, 0);
    s.applyBlast([0.5, 1.5, 0.5], 1, 99);
    const events = s.evaluate();
    expect(events[0]).toMatchObject({ kind: "crush", layer: 1, crushed: [i] });
    expect(s.height()).toBe(1);
  });
  test("Cells left hanging under a Crushed layer Detach rather than pancake in mid-air", () => {
    const s = target();
    // Takes out the slab at 16 and the tops of the pillars under it, so what is
    // left of that floor hangs from the roof, then Crushes the roof.
    s.applyBlast([2.2, 16, 2], 3.9, 516);
    const events = s.evaluate();
    const crush = events.find((e) => e.kind === "crush" && e.layer === 19);
    expect(crush).toBeDefined();
    for (const e of events) {
      if (e.kind === "crush") for (const i of e.falling) expect(s.coords(i)[1]).toBeGreaterThan(e.layer);
    }
    expect(events.some((e) => e.kind === "detach" && e.cells.some((i) => s.coords(i)[1] < 19))).toBe(true);
  });
});

describe("tipping", () => {
  test("the part above Tips when one side of a layer is gone", () => {
    const s = target();
    // Remove every pillar on the x = 7 and x = 4 lines in the storey above floor 2.
    for (let z = 0; z < 8; z++) {
      s.applyBlast([7.5, 9.5, z + 0.5], 0.1, 1000);
      s.applyBlast([4.5, 9.5, z + 0.5], 0.1, 1000);
    }
    const events = s.evaluate();
    expect(events[0]).toMatchObject({ kind: "tip", layer: 9 });
    const tip = events[0]!;
    if (tip.kind !== "tip") throw new Error();
    // The pivot is the remaining x = 1 edge of the footprint.
    expect(tip.pivot[0]).toBe(1);
    expect(tip.pivot[2]).toBe(1);
    expect(s.height()).toBe(10);
  });

  test("Tip wins over Crush on the same layer", () => {
    const s = createStructure({ size: [8, 20, 8], safetyFactor: 1.01 });
    for (let z = 0; z < 8; z++) {
      s.applyBlast([7.5, 9.5, z + 0.5], 0.1, 1000);
      s.applyBlast([4.5, 9.5, z + 0.5], 0.1, 1000);
    }
    const events = s.evaluate();
    expect(events[0]!.kind).toBe("tip");
    expect(events.some((e) => e.kind === "crush" && e.layer === 9)).toBe(false);
  });

  test("a centred footprint holds within the margin", () => {
    const s = target();
    // Thin the middle of a slab; the pillars still surround the centre of mass.
    s.applyBlast([3.5, 8.5, 3.5], 0.1, 1000);
    expect(s.evaluate()).toEqual([]);
  });

  test("a larger safety margin tips a narrow footprint", () => {
    const narrow = (tipMargin: number) => {
      const s = createStructure({ size: [8, 20, 8], tipMargin });
      // Leave only the x = 0 and x = 4 pillar lines.
      for (let z = 0; z < 8; z++) s.applyBlast([7.5, 9.5, z + 0.5], 0.1, 1000);
      return s.evaluate().some((e) => e.kind === "tip");
    };
    expect(narrow(0.25)).toBe(false);
    expect(narrow(1.5)).toBe(true);
  });
});
