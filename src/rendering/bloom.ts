/**
 * Bloom shared by the Oscilloscope and the Glow finish.
 *
 * Light is blurred at fixed heights in lines, not at fractions of the render
 * size, so the glow is the same share of the frame in the preview and in a 4K
 * export. Each level is half the one before and so blurs twice as wide.
 */
import type { Layer } from '../shared/types';

export const BLOOM_HEIGHTS = [540, 270, 135, 68, 34];

/** Level weights: size moves the glow from the tight levels to the wide ones. */
export function bloomWeights(amount: number, size: number): number[] {
  return BLOOM_HEIGHTS.map((_, i) => {
    const t = i / (BLOOM_HEIGHTS.length - 1);
    return amount * .9 * ((1 - size) * (1 - t) * (1 - t) + size * (.25 + .75 * t));
  });
}

/** Glow cannot run on tiled patterns (the source is a tile, not the frame);
 * the Oscilloscope has its own bloom. */
export function supportsGlow(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic' && layer.kind !== 'scope';
}

export function glowActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsGlow(layer) && ((layer.params.glowMix ?? 0) > 0 || !!layer.modulations.glowMix);
}
