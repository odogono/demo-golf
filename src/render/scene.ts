import * as THREE from "three";

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
}

export function createScene(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0x87b5d9, 80, 220);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 6, 30);
  camera.lookAt(0, 6, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(20, 40, 15);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x5d8c3e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Placeholder Target: 8×8×20 m, until the Structure drives it.
  const target = new THREE.Mesh(
    new THREE.BoxGeometry(8, 20, 8),
    new THREE.MeshStandardMaterial({ color: 0xb0aaa0 }),
  );
  target.position.set(0, 10, -10);
  target.castShadow = true;
  scene.add(target);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  return { renderer, scene, camera, resize };
}
