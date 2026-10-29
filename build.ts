import { rm } from "node:fs/promises";

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

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs) console.log(`${output.path} ${(output.size / 1024).toFixed(1)} KB`);
