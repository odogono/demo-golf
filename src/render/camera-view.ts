import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Vec3 } from "math";
import type { Pose } from "../camera/rigs";

/** Puts the scene camera where the director says, or hands it to a free orbit for debugging. */
export function createCameraView(camera: THREE.PerspectiveCamera, element: HTMLElement) {
  let orbit: OrbitControls | undefined;
  const target = new THREE.Vector3();

  return {
    get orbiting() {
      return orbit !== undefined;
    },

    /** Turns the free-orbit debug camera on or off. It starts from wherever the camera is now. */
    toggleOrbit() {
      if (orbit) {
        orbit.dispose();
        orbit = undefined;
        return;
      }
      orbit = new OrbitControls(camera, element);
      orbit.target.copy(target);
      orbit.update();
    },

    update(pose: Pose, shake: Vec3) {
      if (orbit) {
        orbit.update();
        return;
      }
      camera.position.set(pose.position[0] + shake[0], pose.position[1] + shake[1], pose.position[2] + shake[2]);
      target.set(pose.target[0] + shake[0], pose.target[1] + shake[1], pose.target[2] + shake[2]);
      camera.lookAt(target);
      if (camera.fov !== pose.fov) {
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
      }
    },
  };
}
