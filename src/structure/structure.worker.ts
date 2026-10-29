import { createStructureHost, type StructureRequest } from "./structure-host";

const host = createStructureHost();
self.onmessage = (e: MessageEvent<StructureRequest>) => {
  const reply = host.handle(e.data);
  if (reply) postMessage(reply, { transfer: [reply.alive.buffer, reply.integrity.buffer] });
};
