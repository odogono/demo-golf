import { createFixedLoop } from "./loop";
import { createScene } from "./render/scene";
import { createStructureOverlay } from "./render/structure-overlay";
import { createStructure } from "./structure/structure";

const rig = createScene(document.body);
const loop = createFixedLoop(() => {});

// Debug: show the Structure grids. Press G to toggle them.
const structures = [
  createStructure({ origin: [-4, 0, -14], size: [8, 20, 8] }),
  createStructure({ origin: [8, 0, -12], size: [6, 12, 6] }),
];
const overlays = structures.map((s) => createStructureOverlay(s));
for (const overlay of overlays) rig.scene.add(overlay.mesh);
window.addEventListener("keydown", (e) => {
  if (e.key !== "g") return;
  for (const overlay of overlays) overlay.mesh.visible = !overlay.mesh.visible;
});

let last = performance.now();
rig.renderer.setAnimationLoop((now) => {
  loop.advance((now - last) / 1000);
  last = now;
  rig.renderer.render(rig.scene, rig.camera);
});
