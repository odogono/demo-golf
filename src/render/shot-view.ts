import * as THREE from "three";
import type { Vec3 } from "math";
import type { BallType } from "../shot/ball-types";

const MAX_PREVIEW_POINTS = 512;

/** The Tee marker, the ball, the trajectory preview and the power meter. */
export function createShotView(scene: THREE.Scene, container: HTMLElement, tee: Vec3) {
  const teeMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.02, 24),
    new THREE.MeshStandardMaterial({ color: 0xe8e2c8 }),
  );
  teeMarker.position.set(tee[0], tee[1] + 0.01, tee[2]);
  scene.add(teeMarker);

  const material = new THREE.MeshStandardMaterial();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
  ball.castShadow = true;
  scene.add(ball);

  const previewGeometry = new THREE.BufferGeometry();
  previewGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(MAX_PREVIEW_POINTS * 3), 3),
  );
  const preview = new THREE.Line(
    previewGeometry,
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.4, gapSize: 0.3 }),
  );
  preview.frustumCulled = false;
  scene.add(preview);

  const meter = document.createElement("div");
  meter.style.cssText =
    "position:fixed;left:24px;bottom:24px;width:24px;height:160px;border:2px solid #fff;background:#0004";
  const fill = document.createElement("div");
  fill.style.cssText = "position:absolute;left:0;right:0;bottom:0;background:#f5c542";
  meter.appendChild(fill);
  const label = document.createElement("div");
  label.style.cssText =
    "position:fixed;left:60px;bottom:24px;color:#fff;font:14px/1.4 system-ui;text-shadow:0 1px 2px #000;white-space:pre-line";
  container.append(meter, label);

  return {
    setBallType(type: BallType) {
      material.color.setHex(type.colour);
      ball.scale.setScalar(type.radius);
    },
    /** Hides the ball once an explosive ball has gone off. */
    setBallVisible(visible: boolean) {
      ball.visible = visible;
    },
    setBallPosition(p: Vec3) {
      ball.position.set(p[0], p[1], p[2]);
    },
    setPreview(points: Vec3[] | undefined) {
      preview.visible = points !== undefined;
      if (!points) return;
      const attribute = previewGeometry.getAttribute("position") as THREE.BufferAttribute;
      const n = Math.min(points.length, MAX_PREVIEW_POINTS);
      for (let i = 0; i < n; i++) attribute.setXYZ(i, points[i]![0], points[i]![1], points[i]![2]);
      attribute.needsUpdate = true;
      previewGeometry.setDrawRange(0, n);
      preview.computeLineDistances();
    },
    setPower(power: number) {
      fill.style.height = `${power * 100}%`;
    },
    setLabel(text: string) {
      label.textContent = text;
    },
  };
}
