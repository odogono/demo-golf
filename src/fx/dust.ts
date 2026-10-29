import * as THREE from "three";
import type { Vec3 } from "math";

const GRAVITY = -3;
const DRAG = 1.5;

/**
 * Cosmetic dust puffs: instanced particles simulated here, never in physics,
 * so they don't collide. One draw call for all of them; when the pool is full
 * the oldest particle is reused.
 */
export function createDust(scene: THREE.Scene, capacity = 600) {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 1, flatShading: true }),
    capacity,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);

  const position = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const age = new Float32Array(capacity).fill(Infinity);
  const life = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  let next = 0;
  const matrix = new THREE.Matrix4();

  return {
    mesh,
    /** A puff of `count` particles at `center`, drifting along `outward`. */
    puff(center: Vec3, outward: Vec3, count: number, spread = 1) {
      for (let n = 0; n < count; n++) {
        const i = next;
        next = (next + 1) % capacity;
        for (let k = 0; k < 3; k++) {
          position[3 * i + k] = center[k]! + (Math.random() - 0.5) * 0.5 * spread;
          velocity[3 * i + k] = outward[k]! * (1 + Math.random() * 3) * spread + (Math.random() - 0.5) * 3 * spread;
        }
        velocity[3 * i + 1]! += Math.random() * 1.5;
        age[i] = 0;
        life[i] = 0.8 + Math.random() * 1.4;
        size[i] = (0.08 + Math.random() * 0.2) * Math.sqrt(spread);
      }
    },
    update(dt: number) {
      let n = 0;
      for (let i = 0; i < capacity; i++) {
        if (age[i]! >= life[i]!) continue;
        age[i]! += dt;
        const damping = Math.exp(-DRAG * dt);
        for (let k = 0; k < 3; k++) {
          velocity[3 * i + k]! *= damping;
          position[3 * i + k]! += velocity[3 * i + k]! * dt;
        }
        velocity[3 * i + 1]! += GRAVITY * dt;
        // Grow a little, then shrink away.
        const t = age[i]! / life[i]!;
        const s = size[i]! * (1 + t) * (1 - t);
        if (s <= 0) continue;
        matrix.makeScale(s, s, s).setPosition(position[3 * i]!, position[3 * i + 1]!, position[3 * i + 2]!);
        mesh.setMatrixAt(n++, matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
