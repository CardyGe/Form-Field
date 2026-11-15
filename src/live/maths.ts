/** The small rules Live runs on. The shaders repeat these; the tests pin them here. */
import type { Box } from './settings';

/** The longest step the simulation will take. A stall must not fling paint. */
export const MAX_STEP = 1 / 30;
export function capStep(seconds: number): number {
  return Number.isFinite(seconds) ? Math.min(MAX_STEP, Math.max(0, seconds)) : 0;
}
/** What is left of the paint after one step: 5% remains after fadeSeconds. */
export function fadeFactor(step: number, fadeSeconds: number): number {
  return Math.exp(-3 * step / fadeSeconds);
}
/** Width of the soft edge of the interaction box. */
export const BOX_EDGE = .025;
const ramp = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 1 inside the box, 0 outside, soft over BOX_EDGE just inside each side. */
export function boxWeight(x: number, y: number, box: Box): number {
  return ramp(box.left, box.left + BOX_EDGE, x) * (1 - ramp(box.right - BOX_EDGE, box.right, x))
    * ramp(box.bottom, box.bottom + BOX_EDGE, y) * (1 - ramp(box.top - BOX_EDGE, box.top, y));
}
/** Chance that a resting particle is born this step at a place with this much movement. */
export function birthChance(motion: number, response: number, step: number): number {
  return Math.min(1, Math.max(0, motion * response * step * 5));
}
