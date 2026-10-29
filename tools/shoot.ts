// Builds the game, serves it, and drives it in headless Chrome to capture
// frames: PNGs, or one GIF with --gif. Run `bun run shoot --help`.
// It talks to the game through `window.__golf`, set up at the end of src/main.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const HELP = `usage: bun run shoot [options]

  --blast x,y,z,radius,power   blast the Target at a point (a Crush: 3,10,-10,5,2000)
  --building N                 which Building --blast hits, by index (default 0, the Target)
  --shot POWER                 fire the ball at POWER (0-1) along the default aim
  --explosive                  load the explosive ball before --shot
  --look px,py,pz,tx,ty,tz     pin the camera at p looking at t (e.g. 14,9,18,4,6,-10)
  --frames N                   frames to capture after the action (default 1)
  --every MS                   milliseconds between frames (default 100)
  --gif                        write one GIF instead of PNGs
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
const look = numbers(args.look, 6, "look");
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
  await page.goto(`http://localhost:${port}/`);
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
  if (args.explosive) await page.keyboard.press("Digit2");
  await page.evaluate(
    ([blast, building, shot]) => {
      const golf = (window as any).__golf;
      if (blast) golf.blast(blast.slice(0, 3), blast[3], blast[4], building);
      if (shot !== undefined) golf.shoot(shot);
    },
    [blast, Number(args.building), args.shot === undefined ? undefined : Number(args.shot)] as const,
  );

  const gif = args.gif ? GIFEncoder() : undefined;
  for (let i = 0; i < frames; i++) {
    const shot = await page.screenshot();
    if (gif) {
      const png = PNG.sync.read(shot);
      const palette = quantize(png.data, 128);
      gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: every });
    } else {
      const file = join(out, `frame-${String(i).padStart(3, "0")}.png`);
      writeFileSync(file, shot);
      console.log(file);
    }
    if (i < frames - 1) await page.waitForTimeout(every);
  }
  if (gif) {
    gif.finish();
    const file = join(out, "shoot.gif");
    writeFileSync(file, gif.bytes());
    console.log(file);
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "page errors: none");
