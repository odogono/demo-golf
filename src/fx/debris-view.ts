import * as THREE from "three";
import type { Debris, DebrisPiece } from "../damage/debris";

/** Draws every Debris piece and all Rubble as one instanced mesh: one draw call. */
export function createDebrisView(scene: THREE.Scene, debris: Debris, capacity = 1024) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    capacity,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();

  return {
    mesh,
    update() {
      let n = 0;
      const draw = (piece: DebrisPiece) => {
        if (n >= capacity) return;
        position.set(...piece.position);
        rotation.set(...piece.rotation);
        scale.set(...piece.halfExtents);
        mesh.setColorAt(n, colour.setHex(piece.colour));
        mesh.setMatrixAt(n++, matrix.compose(position, rotation, scale));
      };
      debris.rubble.forEach(draw);
      debris.live.forEach(draw);
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
