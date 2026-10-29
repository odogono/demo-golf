import * as THREE from "three";

/** Blocks are half a metre each way, so each 1 m Cell holds whole blocks. */
const BRICK = [0.5, 0.5] as const;

/**
 * The material Buildings and their pieces are drawn with: each Cell's
 * vertex colour, laid as bricks in running bond with mortar between them and
 * a shade that varies brick to brick. Courses line up with the Cells that
 * break off. Works in the mesh's own space, which is the Structure's grid.
 */
export function createBlockMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBlockPos;\nvarying vec3 vBlockNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBlockPos = position;\nvBlockNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vBlockPos;
varying vec3 vBlockNormal;
float blockHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 n = normalize(vBlockNormal);
  // Step inside the surface so a point on a grid plane belongs to its own brick.
  vec3 q = vBlockPos - n * 0.01;
  float course = floor(q.y / ${BRICK[1].toFixed(2)});
  // Every other course is shifted half a brick.
  vec3 p = vec3(q.x / ${BRICK[0].toFixed(2)} + 0.5 * mod(course, 2.0), q.y / ${BRICK[1].toFixed(2)}, q.z / ${BRICK[0].toFixed(2)} + 0.5 * mod(course, 2.0));
  vec3 d = abs(fract(vBlockPos / vec3(${BRICK[0].toFixed(2)}, ${BRICK[1].toFixed(2)}, ${BRICK[0].toFixed(2)}) + vec3(0.5 * mod(course, 2.0), 0.0, 0.5 * mod(course, 2.0)) + 0.5) - 0.5);
  vec3 w = fwidth(p) * 0.75 + vec3(0.03);
  vec3 line = 1.0 - smoothstep(w, w * 1.6, d);
  // No mortar across a face that lies in that axis's plane.
  line *= step(abs(n), vec3(0.9));
  float mortar = max(line.x, max(line.y, line.z));
  float shade = 0.92 + 0.14 * blockHash(floor(p));
  diffuseColor.rgb *= shade * mix(1.0, 0.7, mortar);
}`,
      );
  };
  return material;
}
