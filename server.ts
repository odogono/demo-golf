// Dev: `bun dev` bundles public/index.html with hot reload.
// Prod: `bun start` serves the static bundle that `bun run build` wrote to dist/.
import index from "./public/index.html";

const port = Number(process.env.PORT ?? 3000);
const production = process.env.NODE_ENV === "production";

const server = production
  ? Bun.serve({
      port,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(`./dist${path === "/" ? "/index.html" : path}`);
        return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
      },
    })
  : Bun.serve({
      port,
      routes: { "/": index },
      development: { hmr: true, console: true },
    });

console.log(`Demolition Golf on ${server.url}`);
