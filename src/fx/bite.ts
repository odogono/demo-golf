import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { buildingMesh, cellBox, type BuildingShape, type CellMesh, type OrnamentMesh } from "./building-geometry";
import { seeded } from "../random";

/**
 * Cuts Bites into Buildings' meshes. A Bite is a jagged blob subtracted
 * (three-bvh-csg) only from the Cells its Blast damaged, so it never cuts
 * where the grid hasn't changed. Cells that leave the Structure simply drop
 * out of the mesh. Runs in `csg.worker.ts`.
 */

export type Bite = {
  /** In the Structure's local space. */
  center: [number, number, number];
  radius: number;
  seed: number;
  /** Cells the Blast damaged that are still standing. */
  cells: number[];
};

export type CsgRequest =
  | { type: "create"; id: number; generation: number; size: [number, number, number]; alive: Uint8Array; colour: Uint32Array; cut?: Map<number, CellMesh>; ornaments?: Map<number, OrnamentMesh> }
  | { type: "update"; id: number; generation: number; alive: Uint8Array; bite?: Bite };

export type CsgReply = {
  type: "mesh";
  id: number;
  generation: number;
  position: Float32Array;
  normal: Float32Array;
  colour: Float32Array;
  /** Milliseconds spent cutting and merging. */
  ms: number;
};

/** A closed, randomly jagged blob around `center`, with flat-shaded facets. */
export function jaggedBlob(center: readonly number[], radius: number, seed: number): THREE.BufferGeometry {
  const random = seeded(seed);
  // Weld the icosphere's vertices so displacing them keeps the surface closed.
  const welded = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute("normal").deleteAttribute("uv"));
  const p = welded.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const scale = radius * (0.6 + 0.55 * random());
    p.setXYZ(i, p.getX(i) * scale, p.getY(i) * scale, p.getZ(i) * scale);
  }
  welded.rotateY(random() * Math.PI * 2);
  welded.rotateX(random() * Math.PI * 2);
  welded.translate(center[0]!, center[1]!, center[2]!);
  const blob = welded.toNonIndexed();
  blob.computeVertexNormals();
  return blob;
}

export function toGeometry(mesh: CellMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normal, 3));
  return geometry;
}

export function createBiteCutter() {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  const shapes = new Map<number, BuildingShape & { generation: number }>();

  function cut(shape: BuildingShape, bite: Bite) {
    const [nx, , nz] = shape.size;
    const blob = new Brush(jaggedBlob(bite.center, bite.radius, bite.seed));
    blob.updateMatrixWorld();
    for (const i of bite.cells) {
      if (!shape.alive[i]) continue;
      const x = i % nx;
      const z = Math.floor(i / nx) % nz;
      const y = Math.floor(i / (nx * nz));
      const before = shape.cut.get(i) ?? cellBox(x, y, z);
      const cell = new Brush(toGeometry(before));
      cell.updateMatrixWorld();
      const result = evaluator.evaluate(cell, blob, SUBTRACTION);
      const position = result.geometry.getAttribute("position") as THREE.BufferAttribute;
      const normal = result.geometry.getAttribute("normal") as THREE.BufferAttribute;
      shape.cut.set(i, {
        position: (position.array as Float32Array).slice(0, position.count * 3),
        normal: (normal.array as Float32Array).slice(0, normal.count * 3),
      });
      result.geometry.dispose();
      cell.geometry.dispose();
    }
    blob.geometry.dispose();
  }

  return {
    handle(request: CsgRequest): CsgReply | undefined {
      if (request.type === "create") {
        shapes.set(request.id, { size: request.size, alive: request.alive, colour: request.colour, cut: new Map(request.cut), ornaments: request.ornaments, generation: request.generation });
        return undefined;
      }
      const shape = shapes.get(request.id);
      if (!shape || shape.generation !== request.generation) return undefined;
      const start = performance.now();
      shape.alive = request.alive;
      for (const i of shape.cut.keys()) if (!shape.alive[i]) shape.cut.delete(i);
      if (request.bite) cut(shape, request.bite);
      const mesh = buildingMesh(shape);
      return { type: "mesh", id: request.id, generation: request.generation, ...mesh, ms: performance.now() - start };
    },
  };
}
