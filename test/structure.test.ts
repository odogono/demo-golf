import { describe, expect, test } from "bun:test";
import { MATERIAL_NAMES, MATERIALS } from "../src/structure/blueprint";
import { splitFoundation } from "../src/structure/foundation";
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

  test("Detached Cells leave the Structure, so they count as Destroyed wherever they land", () => {
    const s = target();
    const before = s.cells();
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) s.applyBlast([x + 0.5, 10.5, z + 0.5], 0.1, 1000);
    }
    const blasted = before - s.cells();
    const [event] = s.evaluate();
    expect(event!.kind).toBe("detach");
    expect(s.cells()).toBe(before - blasted - (event as { cells: number[] }).cells.length);
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

describe("the lighthouse Blueprint", () => {
  const lighthouse = () => createStructure({ size: [9, 24, 9], blueprint: "lighthouse" });

  test("stands undamaged at its full Height", () => {
    const s = lighthouse();
    expect(s.evaluate()).toEqual([]);
    expect(s.height()).toBe(24);
  });

  test("has a hollow shaft between its floors", () => {
    const s = lighthouse();
    expect(s.alive[s.index(4, 2, 4)]).toBe(0);
    expect(s.alive[s.index(4, 4, 4)]).toBe(1);
  });

  test("mixes Materials, each with its own Integrity", () => {
    const s = lighthouse();
    const toughness = new Set<number>();
    for (let i = 0; i < s.count; i++) if (s.alive[i]) toughness.add(s.maxIntegrity[i]!);
    expect(toughness.size).toBe(2);
  });

  test("Tips when one side of a low storey is blown out, with a tipMargin of 2", () => {
    const s = createStructure({ size: [9, 24, 9], blueprint: "lighthouse", tipMargin: 2 });
    s.applyBlast([4.5, 2.5, 7], 3, 150);
    const tip = s.evaluate().find((e) => e.kind === "tip");
    expect(tip).toBeDefined();
    expect(s.height()).toBeLessThan(4);
  });
});

describe("the car park Blueprint", () => {
  const carPark = () => createStructure({ size: [9, 15, 9], floorHeight: 3, blueprint: "car-park" });

  test("stands undamaged, its tower a storey above the roof", () => {
    const s = carPark();
    expect(s.evaluate()).toEqual([]);
    expect(s.height()).toBe(15);
    expect(s.ornaments.size).toBeGreaterThan(0);
  });

  test("survives losing one ground-floor column, and pancakes on losing two", () => {
    const s = carPark();
    s.applyBlast([4.5, 1.5, 7.5], 0.1, 1e6);
    expect(s.evaluate()).toEqual([]);
    s.applyBlast([7.5, 1.5, 7.5], 0.1, 1e6);
    const events = s.evaluate();
    expect(events.some((e) => e.kind === "crush")).toBe(true);
    // The free-standing stair tower is left at full height.
    expect(s.height()).toBe(15);
  });
});

describe("the glass office Blueprint", () => {
  const office = () => createStructure({ size: [9, 21, 9], floorHeight: 3, blueprint: "glass-office" });

  test("stands undamaged, glass around a concrete core", () => {
    const s = office();
    expect(s.evaluate()).toEqual([]);
    expect(s.height()).toBe(21);
    expect(MATERIAL_NAMES[s.material[s.index(4, 5, 4)]!]).toBe("concrete");
    expect(MATERIAL_NAMES[s.material[s.index(1, 5, 4)]!]).toBe("glass");
  });

  test("sheds the glass across one face of a storey and the core still carries the floors above", () => {
    const s = office();
    for (let y = 5; y <= 6; y++) {
      for (let x = 0; x < 9; x++) {
        for (let z = 5; z < 9; z++) {
          const i = s.index(x, y, z);
          if (s.alive[i] && MATERIAL_NAMES[s.material[i]!] === "glass") s.applyBlast([x + 0.5, y + 0.5, z + 0.5], 0.1, 1e6);
        }
      }
    }
    expect(s.evaluate()).toEqual([]);
    expect(s.height()).toBe(21);
  });
});

describe("the arch bridge Blueprint", () => {
  const bridge = () => createStructure({ size: [24, 10, 7], blueprint: "arch-bridge" });

  test("stands undamaged, with an open arch under the deck", () => {
    const s = bridge();
    expect(s.evaluate()).toEqual([]);
    expect(s.height()).toBe(10);
    expect(s.alive[s.index(12, 3, 3)]).toBe(0);
    expect(s.alive[s.index(12, 8, 3)]).toBe(1);
  });

  test("cut across the span on both sides of the crown, the middle Detaches", () => {
    const s = bridge();
    s.applyBlast([7, 7, 3.5], 4.5, 500);
    s.evaluate();
    s.applyBlast([17, 7, 3.5], 4.5, 500);
    const detached = s.evaluate().filter((e) => e.kind === "detach");
    expect(detached).toHaveLength(1);
    const xs = (detached[0] as { cells: number[] }).cells.map((i) => s.coords(i)[0]);
    expect(Math.min(...xs)).toBeGreaterThan(7);
    expect(Math.max(...xs)).toBeLessThan(17);
    // Both ends still stand: their pillars and abutments.
    for (const x of [1, 3, 20, 22]) expect(s.alive[s.index(x, 5, 0)]).toBe(1);
  });
});

describe("Materials", () => {
  test("one Blast destroys a glass Cell but only damages the stone Cell beside it", () => {
    const glass = MATERIAL_NAMES.indexOf("glass");
    const stone = MATERIAL_NAMES.indexOf("stone");
    const s = createStructure({
      size: [2, 1, 1],
      cells: {
        alive: new Uint8Array([1, 1]),
        mass: new Float32Array([1, 1]),
        integrity: new Float32Array([100 * MATERIALS.glass.toughness, 100 * MATERIALS.stone.toughness]),
        material: new Uint8Array([glass, stone]),
        colour: new Uint32Array(2),
      },
    });
    // Centred between the two, so both take the same hit.
    const result = s.applyBlast([1, 0.5, 0.5], 1, 100);
    expect(result.destroyed).toEqual([0]);
    expect(result.damaged).toEqual([1]);
    expect(s.alive[1]).toBe(1);
  });
});

describe("Reach (ADR 0005)", () => {
  const brick = MATERIAL_NAMES.indexOf("brick");
  /** A brick beam a layer up, `length` long, standing on ground Cells at the given x. */
  function beam(length: number, legs: number[]) {
    const count = length * 2;
    const alive = new Uint8Array(count);
    for (let x = 0; x < length; x++) alive[x + length] = 1;
    for (const x of legs) alive[x] = 1;
    return createStructure({
      size: [length, 2, 1],
      cells: {
        alive,
        mass: new Float32Array(count).fill(1),
        integrity: new Float32Array(count).fill(100),
        material: new Uint8Array(count).fill(brick),
        colour: new Uint32Array(count),
      },
    });
  }
  const detached = (s: ReturnType<typeof beam>) =>
    s
      .evaluate()
      .filter((e) => e.kind === "detach")
      .flatMap((e) => (e.kind === "detach" ? e.cells : []))
      .map((i) => s.coords(i)[0])
      .sort((a, b) => a - b);

  test("a cantilever past its Material's Reach Detaches beyond it", () => {
    expect(MATERIALS.brick.reach).toBe(7);
    expect(detached(beam(12, [0]))).toEqual([8, 9, 10, 11]);
  });

  test("a span held at both ends stands, and cut on one side drops what is beyond Reach", () => {
    const s = beam(16, [0, 15]);
    expect(s.evaluate()).toEqual([]);
    s.applyBlast([3.5, 1.5, 0.5], 0.1, 1e6);
    // x 0 to 2 still stand on the left leg; x 4 to 7 are more than 7 from the right one.
    expect(detached(s)).toEqual([4, 5, 6, 7]);
  });
});

describe("a whole-layer Crush (#57)", () => {
  test("pancakes what was above it, with the layer's own leftovers, rather than Detaching it", () => {
    // The bridge as it stands on its Foundation.
    const s = createStructure(splitFoundation({ size: [24, 10, 7], blueprint: "arch-bridge" }).options);
    // Explosive-ball Blasts on the front of the deck, on alternating sides of the crown.
    s.applyBlast([7, 6, 0.5], 3, 150);
    s.evaluate();
    s.applyBlast([16, 6, 0.5], 3, 150);
    const events = s.evaluate();
    const crush = events.find((e) => e.kind === "crush" && e.falling.length > 0);
    expect(crush).toBeDefined();
    expect(events.some((e) => e.kind === "detach" && e.cells.length > 20)).toBe(false);
  });
});
