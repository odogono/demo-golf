import * as THREE from "three";
import type { BlastOutcome, Building } from "../damage/buildings";
import type { Port } from "../worker-port";
import type { CsgReply, CsgRequest } from "./bite";
import { buildingMesh } from "./building-geometry";

/** A Bite's radius as a fraction of its Blast's, at full power. */
const BITE_SCALE = 0.6;
/** The Blast power at which a Bite reaches full size. */
const FULL_BITE_POWER = 150;

/**
 * Draws each Building as one mesh, one draw call per Building. Blast outcomes
 * go to `csg.worker.ts`, which cuts the Bites and sends back the new mesh;
 * `drain` swaps it in.
 */
export function createBuildingViews(scene: THREE.Scene, port: Port<CsgRequest, CsgReply>) {
  const material = new THREE.MeshStandardMaterial({ color: 0xb0aaa0, roughness: 0.9 });
  const meshes: THREE.Mesh[] = [];
  const arrived: CsgReply[] = [];
  let generation = 0;
  let seed = 1;
  port.onReply((reply) => arrived.push(reply));

  function setGeometry(mesh: THREE.Mesh, position: Float32Array, normal: Float32Array) {
    mesh.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
  }

  function add({ id, structure }: Building) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    const { position, normal } = buildingMesh({ size: structure.size, alive: structure.alive, cut: new Map() });
    setGeometry(mesh, position, normal);
    mesh.position.set(...structure.origin);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes[id] = mesh;
    port.send({ type: "create", id, generation, size: [...structure.size], alive: structure.alive.slice() });
  }

  return {
    /** Draws a Building added since the last `reset`, such as Rubble at rest. */
    add,

    /** Draws `buildings` undamaged, replacing any earlier ones. */
    reset(buildings: readonly Building[]) {
      generation++;
      arrived.length = 0;
      for (const mesh of meshes.splice(0)) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      for (const building of buildings) add(building);
    },

    /** Sends a Blast's outcome to be cut, if it changed the grid. */
    apply({ building, blast, reply }: BlastOutcome) {
      const { structure } = building;
      const cells = reply.result.damaged.filter((i) => structure.alive[i]);
      if (cells.length === 0 && reply.removed.length === 0) return;
      const [ox, oy, oz] = structure.origin;
      const size = Math.min(1, blast.power / FULL_BITE_POWER);
      port.send({
        type: "update",
        id: building.id,
        generation,
        alive: structure.alive.slice(),
        bite:
          cells.length === 0
            ? undefined
            : {
                center: [blast.center[0] - ox, blast.center[1] - oy, blast.center[2] - oz],
                radius: blast.radius * BITE_SCALE * (0.5 + 0.5 * size),
                seed: seed++,
                cells,
              },
      });
    },

    /** Swaps in every mesh that has arrived. Returns the worker's milliseconds for each. */
    drain(): number[] {
      const times: number[] = [];
      for (const reply of arrived.splice(0)) {
        const mesh = meshes[reply.id];
        if (!mesh || reply.generation !== generation) continue;
        setGeometry(mesh, reply.position, reply.normal);
        times.push(reply.ms);
      }
      return times;
    },
  };
}
