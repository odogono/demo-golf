import { rm } from "node:fs/promises";
import { WORKERS } from "./workers";

await rm("./dist", { recursive: true, force: true });

const workers = await Bun.build({
  entrypoints: WORKERS,
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "[name].js",
});
exitOnFailure(workers);

// Worker names aren't hashed, so the page asks for `<name>.worker.js?v=<hash>`:
// a cached worker from an older deploy can't answer a newer page.
const hasher = new Bun.CryptoHasher("sha256");
for (const output of workers.outputs) if (output.kind === "entry-point") hasher.update(await output.text());
const workerVersion = hasher.digest("hex").slice(0, 12);

const result = await Bun.build({
  entrypoints: ["./public/index.html"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  // GitHub Pages serves the build from /demo-golf/ (.github/workflows/pages.yml).
  publicPath: process.env.GOLF_BASE,
  define: { WORKER_VERSION: JSON.stringify(workerVersion) },
});
exitOnFailure(result);

for (const output of [...result.outputs, ...workers.outputs]) console.log(`${output.path} ${(output.size / 1024).toFixed(1)} KB`);

function exitOnFailure(build: Bun.BuildOutput) {
  if (build.success) return;
  for (const log of build.logs) console.error(log);
  process.exit(1);
}
