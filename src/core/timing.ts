import type { ParameterDefinition } from '../shared/types';

/**
 * Per-element timing. Each element (band, ring, drip, tile, panel, glyph) runs
 * the shared loop clock with its own delay, and can pause for part of every
 * cycle before it moves. Delays are constant in time and the pause easing maps
 * each whole cycle onto itself, so loops still close exactly. At Delay spread 0
 * and Pause 0 the clock is returned unchanged, so older projects render the same.
 */
export const TIMING_PARAMETERS: ParameterDefinition[] = [
  { key: 'delaySpread', label: 'Delay spread', min: 0, max: 1, step: .01, default: 0, section: 'Motion', description: 'How far the last element runs behind the first, as a share of one cycle. 0 moves everything together.' },
  { key: 'delayShape', label: 'Delay from', min: 0, max: 2, step: 1, default: 0, section: 'Motion', description: 'Where the motion starts: the left side, the centre, or the top-left corner.' },
  { key: 'pause', label: 'Pause', min: 0, max: 1, step: .01, default: 0, section: 'Motion', description: 'Each element holds still for part of every cycle, then moves. 0 moves continuously.' },
];
export const TIMING_KEYS = TIMING_PARAMETERS.map(p => p.key);
export const DELAY_SHAPES = ['Left side', 'Centre', 'Corner'];
const TAU = Math.PI * 2;

/** Position of an element in the delay order, 0 (first) to 1 (last). x and y
 * are frame coordinates: x in ±aspect/2, y in ±1/2, y up. */
export function delayOrder(x: number, y: number, aspect: number, shape: number): number {
  const u = x / Math.max(aspect, 1e-6);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (Math.round(shape) === 1) return clamp(Math.hypot(u, y) * 1.4);
  if (Math.round(shape) === 2) return clamp((u + .5) * .5 + (.5 - y) * .5);
  return clamp(u + .5);
}

/** Loop clock t (radians) for an element at the given delay order. */
export function stagedTime(t: number, order: number, spread: number, pause: number): number {
  const u = t - spread * TAU * order;
  if (pause <= 0) return u;
  const cycle = u / TAU, k = Math.floor(cycle), f = cycle - k;
  const w = Math.min(pause, 1) * .8, g0 = Math.max(0, Math.min(1, (f - w) / (1 - w)));
  const g = g0 * g0 * g0 * (g0 * (g0 * 6 - 15) + 10);
  return TAU * (k + f + (g - f) * Math.min(pause * 2, 1));
}

/** The same functions for shaders. Requires uniforms uDelaySpread, uDelayShape and uPause. */
export const timingGLSL = /* glsl */`
float delayOrder(vec2 frame, float aspect) {
  float u = frame.x / max(aspect, 1e-6);
  if (uDelayShape > .5 && uDelayShape < 1.5) return clamp(length(vec2(u, frame.y)) * 1.4, 0., 1.);
  if (uDelayShape > 1.5) return clamp((u + .5) * .5 + (.5 - frame.y) * .5, 0., 1.);
  return clamp(u + .5, 0., 1.);
}
float stagedTime(float t, float order) {
  float u = t - uDelaySpread * 6.28318530718 * order;
  if (uPause <= 0.) return u;
  float cycle = u / 6.28318530718, k = floor(cycle), f = cycle - k;
  float w = min(uPause, 1.) * .8, g = clamp((f - w) / (1. - w), 0., 1.);
  g = g * g * g * (g * (g * 6. - 15.) + 10.);
  return 6.28318530718 * (k + f + (g - f) * min(uPause * 2., 1.));
}
`;
