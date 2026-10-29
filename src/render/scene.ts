import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

const SKY = 0x8ec5ef;

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ambient occlusion: soft shadow where surfaces meet, such as a building's foot. */
  ao: GTAOPass;
  resize(): void;
  /** Draws a frame, with ambient occlusion and tone mapping. */
  render(): void;
}

export function createScene(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 90, 240);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 6, 30);
  camera.lookAt(0, 6, 0);

  // A cool sky above and warm bounce from the grass below.
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x7a8f4a, 1.1));
  // A warm afternoon sun from the Tee's side, low enough for long shadows.
  const sun = new THREE.DirectionalLight(0xfff0d0, 3);
  sun.position.set(30, 35, 30);
  sun.target.position.set(0, 0, -5);
  sun.castShadow = true;
  // Shadows cover the Hole, from the Tee past the Target.
  const reach = 45;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 140 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x6a9a3f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera);
  ao.updateGtaoMaterial({ radius: 1, distanceExponent: 1, thickness: 1, distanceFallOff: 0.5, scale: 1 });
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  return { renderer, scene, camera, ao, resize, render: () => composer.render() };
}
