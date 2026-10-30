// Builds the game, serves it, and drives it in headless Chrome to capture
// frames: PNGs, or one GIF with --gif and one MP4 with --mp4. Run `bun run shoot --help`.
// It talks to the game through `window.__golf`, set up at the end of src/main.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { scenarioNamed } from "../src/scenarios";

const HELP = `usage: bun run shoot [options]

  --blast x,y,z,radius,power   blast the Target at a point (a Crush: 3,10,-10,5,2000)
  --building N                 which Building --blast hits, by index (default 0, the Target)
  --shot POWER                 fire the ball at POWER (0-1) along the default aim
  --explosive                  load the explosive ball before --shot
  --scenario NAME              play a Scenario (src/scenarios.ts) step by step, capturing
                               each step until it Settles; ignores --blast, --shot, --frames
  --look px,py,pz,tx,ty,tz     pin the camera at p looking at t (e.g. 14,9,18,4,6,-10)
  --frames N                   frames to capture after the action (default 1)
  --every MS                   milliseconds between frames (default 100)
  --gif                        write one GIF instead of PNGs
  --mp4                        write one MP4 instead of PNGs (needs ffmpeg on the PATH)
  --gui                        keep the debug GUI visible
  --out DIR                    output directory (default /tmp/golf-shoot)
  --size WxH                   viewport (default 1280x720)

Prints each file written, then any page errors. Read the PNGs to look at them.`;

const { values: args } = parseArgs({
  options: {
    blast: { type: "string" },
    building: { type: "string", default: "0" },
    shot: { type: "string" },
    explosive: { type: "boolean", default: false },
    scenario: { type: "string" },
    mp4: { type: "boolean", default: false },
    look: { type: "string" },
    frames: { type: "string", default: "1" },
    every: { type: "string", default: "100" },
    gif: { type: "boolean", default: false },
    gui: { type: "boolean", default: false },
    out: { type: "string", default: "/tmp/golf-shoot" },
    size: { type: "string", default: "1280x720" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const numbers = (text: string | undefined, count: number, flag: string) => {
  if (text === undefined) return undefined;
  const parts = text.split(",").map(Number);
  if (parts.length !== count || parts.some(Number.isNaN)) throw new Error(`--${flag} needs ${count} comma-separated numbers`);
  return parts;
};
const blast = numbers(args.blast, 5, "blast");
const scenario = args.scenario === undefined ? undefined : scenarioNamed(args.scenario);
if (args.scenario !== undefined && !scenario) throw new Error(`no Scenario named ${args.scenario}`);
if (args.mp4 && !Bun.which("ffmpeg")) throw new Error("--mp4 needs ffmpeg on the PATH: brew install ffmpeg");
// A Scenario's building is framed from the front-right unless --look says otherwise.
const look = numbers(args.look, 6, "look") ?? (scenario ? frameBuilding(scenario.building) : undefined);
const [width = 1280, height = 720] = numbers(args.size?.replace("x", ","), 2, "size")!;
const frames = Number(args.frames);
const every = Number(args.every);
const out = resolve(args.out!);
mkdirSync(out, { recursive: true });

const ROOT = resolve(import.meta.dir, "..");
const build = Bun.spawnSync(["bun", "run", "build"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
if (build.exitCode !== 0) throw new Error(`build failed:\n${build.stderr}`);

const port = 4000 + Math.floor(Math.random() * 1000);
const server = Bun.spawn(["bun", "server.ts"], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdout: "ignore",
  stderr: "inherit",
});

const errors: string[] = [];
try {
  await Bun.sleep(500);
  // Metal keeps WebGL on the GPU; without it, headless Chrome falls back to a slow software renderer.
  const browser = await chromium
    .launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
    .catch((error) => {
      throw new Error(`${error.message}\nIf the browser is missing: bunx playwright install chromium-headless-shell`);
    });
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/${scenario ? `?scenario=${scenario.name}` : ""}`);
  await page.waitForFunction(() => "__golf" in window);
  await page.waitForTimeout(1000);

  await page.evaluate(
    ([look, gui]) => {
      const golf = (window as any).__golf;
      if (look) golf.look(look.slice(0, 3), look.slice(3));
      if (!gui) golf.hideUi();
    },
    [look, args.gui] as const,
  );
  const shots: Buffer[] = [];
  if (scenario) {
    // Each step runs until the Hole Settles, then holds a moment before the next.
    const limit = Math.ceil(15_000 / every);
    for (let index = 0; index < scenario.steps.length; index++) {
      await page.evaluate((index) => (window as any).__golf.step(index), index);
      for (let n = 0, held = 0; n < limit && held < 3; n++) {
        shots.push(await page.screenshot());
        await page.waitForTimeout(every);
        held = (await page.evaluate(() => (window as any).__golf.settled())) ? held + 1 : 0;
      }
    }
  } else {
    if (args.explosive) await page.keyboard.press("Digit2");
    await page.evaluate(
      ([blast, building, shot]) => {
        const golf = (window as any).__golf;
        if (blast) golf.blast(blast.slice(0, 3), blast[3], blast[4], building);
        if (shot !== undefined) golf.shoot(shot);
      },
      [blast, Number(args.building), args.shot === undefined ? undefined : Number(args.shot)] as const,
    );
    for (let i = 0; i < frames; i++) {
      shots.push(await page.screenshot());
      if (i < frames - 1) await page.waitForTimeout(every);
    }
  }

  const pngs = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    return shots.map((shot, i) => {
      const file = join(dir, `frame-${String(i).padStart(3, "0")}.png`);
      writeFileSync(file, shot);
      return file;
    });
  };
  if (!args.gif && !args.mp4) for (const file of pngs(out)) console.log(file);
  if (args.gif) {
    const gif = GIFEncoder();
    for (const shot of shots) {
      const png = PNG.sync.read(shot);
      const palette = quantize(png.data, 128);
      gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: every });
    }
    gif.finish();
    const file = join(out, "shoot.gif");
    writeFileSync(file, gif.bytes());
    console.log(file);
  }
  if (args.mp4) {
    const dir = join(out, "mp4-frames");
    pngs(dir);
    const file = join(out, "shoot.mp4");
    const ffmpeg = Bun.spawnSync(
      ["ffmpeg", "-y", "-loglevel", "error", "-framerate", String(1000 / every), "-i", join(dir, "frame-%03d.png"),
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", file],
      { stderr: "pipe" },
    );
    rmSync(dir, { recursive: true });
    if (ffmpeg.exitCode !== 0) throw new Error(`ffmpeg failed:\n${ffmpeg.stderr}`);
    console.log(file);
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "page errors: none");

/** A camera to the front-right of a building, looking at its middle: px,py,pz,tx,ty,tz. */
function frameBuilding({ origin = [0, 0, 0], size }: { origin?: number[]; size: number[] }): number[] {
  const centre = origin.map((o, i) => o + size[i]! / 2);
  const reach = Math.max(...size) * 1.2;
  return [centre[0]! + reach * 0.7, centre[1]! + size[1]! * 0.1, centre[2]! + reach, centre[0]!, centre[1]!, centre[2]!];
}
