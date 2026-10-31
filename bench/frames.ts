/**
 * Times each simulated frame of every Scenario, phase by phase, and prints the
 * slowest. The Structure runs inline here, so its time shows under `apply`
 * and `damage`; in the game it runs in a worker. Rendering is not measured.
 *
 *   bun bench/frames.ts [name...]
 */
import { SCENARIOS } from "../src/scenarios";
import { runScenario, type SlowFrame } from "./run-scenario";

const names = process.argv.slice(2);
const ms = (n: number) => n.toFixed(1).padStart(6);
console.log("scenario       step   at s   total   apply    step  damage collapse  debris");
for (const scenario of SCENARIOS.filter((s) => names.length === 0 || names.includes(s.name))) {
  const slowest: SlowFrame[] = [];
  runScenario(scenario, 1, slowest);
  for (const f of slowest.slice(0, 3)) {
    console.log(
      `${scenario.name.padEnd(14)} ${String(f.step).padStart(4)} ${f.time.toFixed(2).padStart(6)} ${ms(f.total)}  ${ms(f.apply)}  ${ms(f.step)}  ${ms(f.damage)}  ${ms(f.collapse)}   ${ms(f.debris)}`,
    );
  }
}
