import { clampAim, type Aim } from "../shot/aim";
import type { BallTypeId } from "../shot/ball-types";
import type { PowerMeter } from "../shot/power-meter";

const KEY_RATE = 0.8; // radians per second
const DRAG_RATE = 0.004; // radians per pixel

export type ShotInputHandlers = {
  /** Space was released: shoot with this power in [0, 1]. */
  onRelease(power: number): void;
  onBallType(id: BallTypeId): void;
};

/**
 * Aim with A/D (or ←/→) for direction and W/S (or ↑/↓) for loft, or drag
 * with the mouse. Hold Space to run the power meter and release to shoot.
 * 1 and 2 pick the ball type.
 */
export function createShotInput(target: HTMLElement, meter: PowerMeter, handlers: ShotInputHandlers) {
  let aim: Aim = { yaw: 0, loft: 0.35 };
  const down = new Set<string>();
  let dragging = false;
  let enabled = true;

  window.addEventListener("keydown", (e) => {
    down.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) meter.press();
    }
    if (e.code === "Digit1") handlers.onBallType("standard");
    if (e.code === "Digit2") handlers.onBallType("explosive");
  });
  window.addEventListener("keyup", (e) => {
    down.delete(e.code);
    if (e.code !== "Space") return;
    const power = meter.release();
    if (power !== undefined) handlers.onRelease(power);
  });
  window.addEventListener("blur", () => {
    down.clear();
    meter.cancel();
  });
  target.addEventListener("pointerdown", (e) => {
    dragging = true;
    target.setPointerCapture(e.pointerId);
  });
  target.addEventListener("pointerup", () => (dragging = false));
  target.addEventListener("pointermove", (e) => {
    if (!dragging || !enabled) return;
    aim = clampAim({ yaw: aim.yaw - e.movementX * DRAG_RATE, loft: aim.loft - e.movementY * DRAG_RATE });
  });

  const axis = (plus: string[], minus: string[]) =>
    (plus.some((k) => down.has(k)) ? 1 : 0) - (minus.some((k) => down.has(k)) ? 1 : 0);

  return {
    get aim() {
      return aim;
    },
    /** While off, neither keys nor the mouse change the aim, so a debug camera can use the mouse. */
    set enabled(value: boolean) {
      enabled = value;
    },
    set aim(value: Aim) {
      aim = clampAim(value);
    },
    update(dt: number) {
      meter.update(dt);
      if (!enabled) return;
      aim = clampAim({
        yaw: aim.yaw + axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]) * KEY_RATE * dt,
        loft: aim.loft + axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]) * KEY_RATE * dt,
      });
    },
  };
}
