/**
 * Warp finish: Warp, Liquid, Luma Warp, Polar and Mirror, which move the picture's pixels.
 *
 * This file holds the rules for when the pass runs and the maths it shares, which can be tested directly.
 * Distances are shares of frame height and motion is in whole cycles per loop, so the look matches at every
 * export size and the loop closes exactly.
 */
import type { Layer } from '../shared/types';

export const WARP_FIELDS = ['Waves', 'Noise', 'Ripple', 'Magnetic', 'Plasma'];
export const LIQUID_STYLES = ['Swirl', 'Flow', 'Ridge', 'Vortex', 'Chaos'];
export const LUMA_SOURCES = ['This layer', 'Layer below'];
export const LUMA_CHANNELS = ['Brightness', 'Red', 'Green', 'Blue', 'Saturation'];
export const LUMA_MODES = ['Push', 'Edges', 'Contours'];
export const POLAR_MODES = ['To circle', 'Unroll'];
export const MIRROR_MODES = ['Left-right', 'Top-bottom', 'Four-way', 'Kaleidoscope'];

const AMOUNTS = ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount'];
const TAU = Math.PI * 2;

/** A tiled pattern's source is a tile, not the frame, and graphic layers are drawn from shapes: neither takes a warp. */
export function supportsWarp(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

export function warpActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsWarp(layer) && AMOUNTS.some(key => (layer.params[key] ?? 0) > 0 || !!layer.modulations[key]);
}

/** Small deterministic generator, so the same seed always places the same points. */
function hash(n: number): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Magnet points inside the frame, 10% to 90% across, with alternating pull and push. */
export function warpPoints(count: number, seed: number): { x: number; y: number; polarity: number }[] {
  const n = Math.max(1, Math.round(count));
  return Array.from({ length: n }, (_, i) => ({
    x: .1 + .8 * hash(seed * 131 + i * 2 + 1),
    y: .1 + .8 * hash(seed * 131 + i * 2 + 2),
    polarity: i % 2 === 0 ? 1 : -1,
  }));
}

/** Folds an angle into one mirrored wedge of a kaleidoscope with `segments` wedges. */
export function foldAngle(angle: number, segments: number): number {
  const wedge = TAU / Math.max(1, segments);
  const a = ((angle % wedge) + wedge) % wedge;
  return Math.min(a, wedge - a);
}

/** A circular path that returns to its start after any whole number of cycles. */
export function loopOffset(phase: number, cycles: number): [number, number] {
  if (!cycles) return [0, 0];
  return [Math.sin(cycles * phase), Math.cos(cycles * phase) - 1];
}
