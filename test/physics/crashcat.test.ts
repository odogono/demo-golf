import { expect, test } from "bun:test";
import { createCrashcatWorld } from "../../src/physics/crashcat";
import type { ContactEvent } from "../../src/physics/PhysicsWorld";

const DT = 1 / 60;

function addGround(world: ReturnType<typeof createCrashcatWorld>) {
  return world.addBody({
    shape: { kind: "box", halfExtents: [20, 0.5, 20] },
    motion: "static",
    position: [0, -0.5, 0],
  });
}

test("a box falls and settles on the ground", () => {
  const world = createCrashcatWorld();
  addGround(world);
  const box = world.addBody({
    shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
    motion: "dynamic",
    position: [0, 5, 0],
  });
  expect(world.isSettled()).toBe(false);

  let steps = 0;
  while (!world.isSettled() && steps < 600) {
    world.step(DT);
    steps++;
  }

  expect(world.isSettled()).toBe(true);
  // Crashcat lets resting boxes sink a little; see NOTES.md.
  expect(world.getPosition(box)[1]).toBeCloseTo(0.5, 1);
});

/** Fires a golf ball at 60 m/s at a 0.2 m wall and reports whether it stopped. */
function fireAtWall(wallX: number, ccd: boolean) {
  const world = createCrashcatWorld([0, 0, 0]);
  const wall = world.addBody({
    shape: { kind: "box", halfExtents: [0.1, 5, 5] },
    motion: "static",
    position: [wallX, 0, 0],
  });
  const ball = world.addBody({
    shape: { kind: "sphere", radius: 0.021 },
    motion: "dynamic",
    position: [0, 0, 0],
    linearVelocity: [60, 0, 0],
    ccd,
  });
  const contacts: ContactEvent[] = [];
  world.onContact((e) => contacts.push(e));
  for (let i = 0; i < 30; i++) world.step(DT);
  const hit = contacts.find((e) => [e.a, e.b].includes(wall) && [e.a, e.b].includes(ball));
  return { stopped: world.getPosition(ball)[0] < wallX, hit, wall };
}

// A ball moves 1 m per step, so sweep the wall across one step's travel.
const WALL_OFFSETS = Array.from({ length: 10 }, (_, i) => 4.5 + i * 0.1);

test("a CCD ball at 60 m/s doesn't tunnel through a 0.2 m wall", () => {
  for (const wallX of WALL_OFFSETS) {
    const { stopped, hit, wall } = fireAtWall(wallX, true);
    expect(stopped).toBe(true);
    expect(hit?.impulse).toBeGreaterThan(0);
    // The normal points from a to b, and the wall is on the +x side of the ball.
    expect(hit?.normal[0]).toBeCloseTo(hit?.a === wall ? -1 : 1);
  }
});

test("without CCD the same ball tunnels, so the test above means something", () => {
  expect(WALL_OFFSETS.some((wallX) => !fireAtWall(wallX, false).stopped)).toBe(true);
});

test("removals requested from a contact listener run after the step", () => {
  const world = createCrashcatWorld();
  addGround(world);
  const box = world.addBody({
    shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
    motion: "dynamic",
    position: [0, 1, 0],
  });
  world.onContact((e) => {
    world.removeBody(e.a === box ? e.a : e.b);
    expect(world.hasBody(box)).toBe(false);
  });

  for (let i = 0; i < 60 && world.hasBody(box); i++) world.step(DT);

  expect(world.hasBody(box)).toBe(false);
});

test("only the Crashcat adapter imports crashcat", async () => {
  const glob = new Bun.Glob("src/**/*.ts");
  for await (const file of glob.scan(".")) {
    if (file.startsWith("src/physics/crashcat/")) continue;
    expect({ file, imports: /from ["']crashcat["']/.test(await Bun.file(file).text()) }).toEqual({
      file,
      imports: false,
    });
  }
});
