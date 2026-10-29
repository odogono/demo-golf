import { createBiteCutter, type CsgRequest } from "./bite";

const cutter = createBiteCutter();
self.onmessage = (e: MessageEvent<CsgRequest>) => {
  const reply = cutter.handle(e.data);
  if (reply) postMessage(reply, { transfer: [reply.position.buffer, reply.normal.buffer, reply.colour.buffer] });
};
