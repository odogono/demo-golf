import * as THREE from "three";
import { pancakePose, type Collapse, type Fragment, type Pancake } from "../damage/collapse";
import { buildingMesh } from "./building-geometry";

/**
 * Draws Fragments on their bodies and plays each Crush's pancake. Each piece
 * is meshed from its Cells, without the Bites cut into them, one draw call
 * per piece; they stay drawn once they freeze into Rubble.
 */
export function createCollapseView(scene: THREE.Scene, collapse: Collapse) {
  const material = new THREE.MeshStandardMaterial({ color: 0xb0aaa0, roughness: 0.9 });
  const groups = new Map<Fragment | Pancake, THREE.Group>();

  function add(piece: Fragment | Pancake): THREE.Group {
    const { structure } = piece.building;
    const { position, normal } = buildingMesh({ size: structure.size, alive: piece.mask, cut: new Map() });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A Fragment's grid hangs off its body; a pancake squashes toward its base.
    if ("offset" in piece) mesh.position.set(...piece.offset);
    else mesh.position.set(0, -piece.base, 0);
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    groups.set(piece, group);
    return group;
  }

  return {
    update() {
      const live = new Set<Fragment | Pancake>([...collapse.fragments, ...collapse.pancakes]);
      for (const [piece, group] of groups) {
        if (live.has(piece)) continue;
        scene.remove(group);
        (group.children[0] as THREE.Mesh).geometry.dispose();
        groups.delete(piece);
      }
      for (const fragment of collapse.fragments) {
        const group = groups.get(fragment) ?? add(fragment);
        group.position.set(...fragment.position);
        group.quaternion.set(...fragment.rotation);
      }
      for (const pancake of collapse.pancakes) {
        const group = groups.get(pancake) ?? add(pancake);
        const [ox, oy, oz] = pancake.building.structure.origin;
        const { drop, scale } = pancakePose(pancake.progress);
        group.position.set(ox, oy + pancake.base - drop, oz);
        group.scale.y = scale;
      }
    },
  };
}
