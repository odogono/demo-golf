import * as THREE from "three";
import { vec3 } from "math";
import type { Structure } from "../structure/structure";

/**
 * A debug view of a Structure's Cells: one wireframe cube per Cell, shaded
 * from green when undamaged to red as Integrity falls. Call `update` after a
 * Blast or `evaluate` to show the grid's current state.
 */
export function createStructureOverlay(structure: Structure) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    // Drawn over the Buildings' meshes, which would otherwise hide it.
    new THREE.MeshBasicMaterial({ wireframe: true, depthTest: false }),
    structure.count,
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const centre = vec3.create();

  function update() {
    let n = 0;
    for (let i = 0; i < structure.count; i++) {
      if (!structure.alive[i]) continue;
      structure.cellCenter(centre, i);
      matrix.makeTranslation(centre[0], centre[1], centre[2]);
      mesh.setMatrixAt(n, matrix);
      const health = structure.integrity[i]! / structure.maxIntegrity[i]!;
      mesh.setColorAt(n, color.setRGB(1 - health, health, 0.2));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  update();
  return { mesh, update };
}
