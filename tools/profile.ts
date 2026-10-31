// Plays a Scenario in Chrome, as `bun run shoot --scenario` does, and reports
// the slowest animation frames and the functions that ran during them, from a
// CPU profile. Run `bun run profile --help`.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { scenarioNamed } from "../src/scenarios";

const HELP = `usage: bun run profile --scenario NAME [options]

Plays the Scenario in headless Chrome on the GPU and prints the slowest
animation frames, each with the functions that took the most of it.

  --scenario NAME   the Scenario to play (src/scenarios.ts)
  --frames N        how many of the slowest frames to show (default 5)
  --top N           functions to list per frame (default 8)
  --out FILE        also write the CPU profile, for Chrome's Performance panel`;

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string" },
    frames: { type: "string", default: "5" },
    top: { type: "string", default: "8" },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (args.help || !args.scenario) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}
const scenario = scenarioNamed(args.scenario);
if (!scenario) throw new Error(`no Scenario named ${args.scenario}`);

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };
type Profile = { nodes: Node[]; startTime: number; samples: number[]; timeDeltas: number[] };

const ROOT = resolve(import.meta.dir, "..");
// Unminified, so the profile names the functions.
const build = Bun.spawnSync(["bun", "build.ts"], { cwd: ROOT, env: { ...process.env, GOLF_MINIFY: "0" }, stdout: "ignore", stderr: "pipe" });
if (build.exitCode !== 0) throw new Error(`build failed:\n${build.stderr}`);
const port = 4000 + Math.floor(Math.random() * 1000);
const server = Bun.spawn(["bun", "server.ts"], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdout: "ignore",
  stderr: "inherit",
});

try {
  await Bun.sleep(500);
  const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:${port}/?scenario=${scenario.name}`);
  await page.waitForFunction(() => "__golf" in window);
  await page.waitForTimeout(1000);
  // Every animation frame's start, on the page's clock.
  await page.evaluate(() => {
    const starts: number[] = [];
    (window as any).__frames = starts;
    const tick = (now: number) => {
      starts.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  // The profile's clock has its own origin: line it up with the page's at the start, to within a few ms.
  const started = await page.evaluate(() => performance.now());
  for (let index = 0; index < scenario.steps.length; index++) {
    await page.evaluate((index) => (window as any).__golf.step(index), index);
    for (let n = 0, held = 0; n < 150 && held < 3; n++) {
      await page.waitForTimeout(100);
      held = (await page.evaluate(() => (window as any).__golf.settled())) ? held + 1 : 0;
    }
  }
  const { profile } = (await cdp.send("Profiler.stop")) as { profile: Profile };
  const starts: number[] = await page.evaluate(() => (window as any).__frames);
  await browser.close();
  if (args.out) await Bun.write(args.out, JSON.stringify(profile));

  const intervals = starts.slice(1).map((t, i) => ({ from: starts[i]!, ms: t - starts[i]! }));
  const sorted = intervals.map((f) => f.ms).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.floor((sorted.length - 1) * p)]!.toFixed(1);
  console.log(`${scenario.name}: ${intervals.length} frames, median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, p99 ${pct(0.99)} ms`);

  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const name = (n: Node) => {
    const { functionName, url, lineNumber } = n.callFrame;
    const file = url.split("/").pop();
    return `${functionName || "(anonymous)"}${file ? ` ${file}:${lineNumber + 1}` : ""}`;
  };
  // Each sample's time on the page's clock, in milliseconds.
  const times: number[] = [];
  let t = 0;
  for (const d of profile.timeDeltas) times.push(started + (t += d) / 1000);

  for (const frame of [...intervals].sort((a, b) => b.ms - a.ms).slice(0, Number(args.frames))) {
    const self = new Map<string, number>();
    let sampled = 0;
    profile.samples.forEach((id, s) => {
      if (times[s]! < frame.from || times[s]! >= frame.from + frame.ms) return;
      const ms = (profile.timeDeltas[s + 1] ?? 0) / 1000;
      sampled += ms;
      const key = name(nodes.get(id)!);
      self.set(key, (self.get(key) ?? 0) + ms);
    });
    console.log(`\nframe at ${(frame.from / 1000).toFixed(2)} s: ${frame.ms.toFixed(1)} ms (${sampled.toFixed(1)} ms sampled on the main thread)`);
    for (const [fn, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top))) {
      console.log(`  ${ms.toFixed(1).padStart(6)} ms  ${fn}`);
    }
  }
} finally {
  server.kill();
}
