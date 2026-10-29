/**
 * A request/reply channel to a worker. `inlinePort` runs the same handler on
 * the calling thread instead, for tests and benchmarks.
 */
export interface Port<Request, Reply> {
  send(request: Request, transfer?: Transferable[]): void;
  onReply(listener: (reply: Reply) => void): void;
}

export function workerPort<Request, Reply>(worker: Worker): Port<Request, Reply> {
  return {
    send: (request, transfer = []) => worker.postMessage(request, transfer),
    onReply: (listener) => worker.addEventListener("message", (e: MessageEvent<Reply>) => listener(e.data)),
  };
}

export function inlinePort<Request, Reply>(handle: (request: Request) => Reply | undefined): Port<Request, Reply> {
  const listeners: ((reply: Reply) => void)[] = [];
  return {
    send(request) {
      const reply = handle(request);
      if (reply) for (const l of listeners) l(reply);
    },
    onReply: (listener) => void listeners.push(listener),
  };
}

/**
 * A worker built from `src/**\/<name>.worker.ts`. Bun's bundler doesn't follow
 * `new Worker(new URL(...))`, so `build.ts` and `server.ts` serve each worker
 * as `<name>.worker.js` beside the page.
 */
export function startWorker(name: string): Worker {
  return new Worker(new URL(`${name}.worker.js`, document.baseURI), { type: "module" });
}
