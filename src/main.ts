import { createFixedLoop } from "./loop";
import { createScene } from "./render/scene";

const rig = createScene(document.body);
const loop = createFixedLoop(() => {});

let last = performance.now();
rig.renderer.setAnimationLoop((now) => {
  loop.advance((now - last) / 1000);
  last = now;
  rig.renderer.render(rig.scene, rig.camera);
});
