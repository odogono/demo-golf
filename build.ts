import { rm } from "node:fs/promises";
import { WORKERS } from "./workers";

await rm("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./public/index.html"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  // GitHub Pages serves the build from /demo-golf/ (.github/workflows/pages.yml).
  publicPath: process.env.GOLF_BASE,
});

const workers = await Bun.build({
  entrypoints: WORKERS,
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "[name].js",
});

for (const build of [result, workers]) {
  if (build.success) continue;
  for (const log of build.logs) console.error(log);
  process.exit(1);
}
for (const output of [...result.outputs, ...workers.outputs]) console.log(`${output.path} ${(output.size / 1024).toFixed(1)} KB`);
