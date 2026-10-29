// Bun's bundler doesn't follow `new Worker(new URL(...))`, so each worker is
// bundled on its own and served beside the page as `<name>.worker.js`
// (`startWorker` in src/worker-port.ts).
export const WORKERS = ["./src/structure/structure.worker.ts", "./src/fx/csg.worker.ts"];

/** Bundles one worker in memory, for the dev server. */
export async function bundleWorker(entry: string): Promise<Response> {
  const result = await Bun.build({ entrypoints: [entry], target: "browser", sourcemap: "inline" });
  if (!result.success) return new Response(result.logs.join("\n"), { status: 500 });
  return new Response(result.outputs[0], { headers: { "Content-Type": "text/javascript" } });
}

/** `/structure.worker.js` and so on, for each worker. */
export const workerPath = (entry: string) => `/${entry.split("/").pop()!.replace(/\.ts$/, ".js")}`;
