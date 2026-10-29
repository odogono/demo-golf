import * as THREE from "three";
import { slabFall, type Collapse, type Fragment, type Slab } from "../damage/collapse";
import { buildingMesh } from "./building-geometry";

/**
 * Draws Fragments on their bodies and drops each Crush's slabs. Each piece
 * is meshed from its Cells, without the Bites cut into them, one draw call
 * per piece; they stay drawn once they freeze into Rubble.
 */
export function createCollapseView(scene: THREE.Scene, collapse: Collapse) {
  const material = new THREE.MeshStandardMaterial({ color: 0xb0aaa0, roughness: 0.9 });
  const groups = new Map<Fragment | Slab, THREE.Group>();

  function add(piece: Fragment | Slab): THREE.Group {
    const { structure } = piece.building;
    const { position, normal } = buildingMesh({ size: structure.size, alive: piece.mask, cut: new Map() });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A Fragment's grid hangs off its body; a slab's off its Building's origin.
    if ("offset" in piece) mesh.position.set(...piece.offset);
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    groups.set(piece, group);
    return group;
  }

  return {
    update() {
      const live = new Set<Fragment | Slab>([...collapse.fragments, ...collapse.pancakes.flatMap((p) => p.slabs)]);
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
        const [ox, oy, oz] = pancake.building.structure.origin;
        for (const slab of pancake.slabs) {
          const group = groups.get(slab) ?? add(slab);
          group.position.set(ox, oy - slabFall(slab, pancake.time), oz);
        }
      }
    },
  };
}
