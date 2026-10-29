import * as THREE from "three";
import { floorFall, type Collapse, type Floor, type Fragment } from "../damage/collapse";
import { buildingMesh } from "./building-geometry";

/**
 * Draws Fragments on their bodies and drops each Crush's floors. Each piece
 * is meshed from its Cells, without the Bites cut into them, one draw call
 * per piece; they stay drawn once they freeze into Rubble.
 */
export function createCollapseView(scene: THREE.Scene, collapse: Collapse) {
  const material = new THREE.MeshStandardMaterial({ color: 0xb0aaa0, roughness: 0.9 });
  const groups = new Map<Fragment | Floor, THREE.Group>();

  function meshOf(building: Fragment["building"], alive: Uint8Array): THREE.Mesh {
    const { structure } = building;
    const { position, normal } = buildingMesh({ size: structure.size, alive, cut: new Map() });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** A Fragment's grid hangs off its body; a floor's, its slab then its pillars, off its Building's origin. */
  function add(piece: Fragment | Floor): THREE.Group {
    const group = new THREE.Group();
    if ("offset" in piece) {
      const mesh = meshOf(piece.building, piece.mask);
      mesh.position.set(...piece.offset);
      group.add(mesh);
    } else group.add(meshOf(piece.building, piece.slab), meshOf(piece.building, piece.pillars));
    scene.add(group);
    groups.set(piece, group);
    return group;
  }

  return {
    update() {
      const live = new Set<Fragment | Floor>([...collapse.fragments, ...collapse.pancakes.flatMap((p) => p.floors)]);
      for (const [piece, group] of groups) {
        if (live.has(piece)) continue;
        scene.remove(group);
        for (const mesh of group.children) (mesh as THREE.Mesh).geometry.dispose();
        groups.delete(piece);
      }
      for (const fragment of collapse.fragments) {
        const group = groups.get(fragment) ?? add(fragment);
        group.position.set(...fragment.position);
        group.quaternion.set(...fragment.rotation);
      }
      for (const pancake of collapse.pancakes) {
        const [ox, oy, oz] = pancake.building.structure.origin;
        for (const floor of pancake.floors) {
          const group = groups.get(floor) ?? add(floor);
          group.position.set(ox, oy - floorFall(pancake, floor), oz);
          // Its pillars blew out when it landed.
          group.children[1]!.visible = !floor.landed;
        }
      }
    },
  };
}
