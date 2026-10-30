// Plays each Scenario (src/scenarios.ts) headlessly and compares how the
// Blueprints are destroyed. Run `bun run scenarios --help`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SCENARIOS } from "../src/scenarios";
import { runScenario, type ScenarioResult } from "./run-scenario";

const HELP = `usage: bun run scenarios [options] [name...]

Plays each named Scenario (default: all) twice with a fixed seed, prints a
table of where each ended up, and writes every step to OUT/<name>.json.
Flags a Scenario whose two runs differ.

  --seed N     the seed for both runs (default 1)
  --gif        also capture each Scenario in the game as OUT/<name>/shoot.gif
  --mp4        also capture each Scenario as OUT/<name>/shoot.mp4 (needs ffmpeg)
  --out DIR    output directory (default /tmp/golf-scenarios)

Scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: "string", default: "1" },
    gif: { type: "boolean", default: false },
    mp4: { type: "boolean", default: false },
    out: { type: "string", default: "/tmp/golf-scenarios" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const unknown = positionals.filter((name) => !SCENARIOS.some((s) => s.name === name));
if (unknown.length) throw new Error(`no Scenario named ${unknown.join(", ")}; try --help`);
const chosen = positionals.length ? SCENARIOS.filter((s) => positionals.includes(s.name)) : SCENARIOS;
const out = resolve(args.out!);
mkdirSync(out, { recursive: true });
const seed = Number(args.seed);

const rows: Record<string, string | number>[] = [];
for (const scenario of chosen) {
  const result = runScenario(scenario, seed);
  const repeat = JSON.stringify(runScenario(scenario, seed)) === JSON.stringify(result);
  writeFileSync(join(out, `${scenario.name}.json`), JSON.stringify({ seed, repeatable: repeat, ...result }, null, 2));
  rows.push(summary(result, repeat));
}
console.table(rows);
console.log(`steps: ${out}/<name>.json`);

if (args.gif || args.mp4) {
  for (const scenario of chosen) {
    const dir = join(out, scenario.name);
    const flags = [args.gif && "--gif", args.mp4 && "--mp4"].filter(Boolean) as string[];
    const run = Bun.spawnSync(["bun", "tools/shoot.ts", "--scenario", scenario.name, ...flags, "--out", dir], {
      cwd: resolve(import.meta.dir, ".."),
      stdout: "inherit",
      stderr: "inherit",
    });
    if (run.exitCode !== 0) process.exit(run.exitCode ?? 1);
  }
}

/** One table row: where the Scenario ended up after its last step, with totals over all steps. */
function summary({ name, startHeight, steps }: ScenarioResult, repeatable: boolean) {
  const last = steps[steps.length - 1]!;
  const sum = (pick: (s: (typeof steps)[number]) => number) => steps.reduce((a, s) => a + pick(s), 0);
  return {
    scenario: name,
    height: `${startHeight} → ${last.height} m`,
    left: last.heightLeft,
    destroyed: `${Math.round(last.destroyed * 100)}%`,
    blast: sum((s) => s.cells.blast),
    detach: sum((s) => s.cells.detach),
    crush: sum((s) => s.cells.crush),
    tip: sum((s) => s.cells.tip),
    fragments: sum((s) => s.fragments),
    debris: sum((s) => s.debris),
    "settle s": steps.map((s) => (s.timedOut ? `${s.settleTime}!` : s.settleTime)).join(" "),
    won: steps.find((s) => s.wonOnStroke)?.wonOnStroke ?? "-",
    repeatable: repeatable ? "yes" : "NO",
  };
}
