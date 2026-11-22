/**
 * Colour and Lens finish: Split (colour channels pulled apart) and Gradient Map
 * (tone mapped onto a palette).
 *
 * The passes themselves live in the renderer. This file holds the rules for
 * when they run and the maths they share, so they can be tested; the shaders
 * mirror these functions line for line.
 */
import type { Layer } from '../shared/types';

export const SPLIT_SHAPES = ['Straight', 'Lens', 'Edges', 'Wave'];
export const SPLIT_ORDERS = ['RGB', 'GBR', 'BRG', 'RBG', 'GRB', 'BGR'];

/** Index 0 takes its stops from the layer's own palette. The others run dark to bright. */
export const GRADIENT_PALETTES: { name: string; stops: string[] }[] = [
  { name: 'Layer palette', stops: [] },
  { name: 'Neon', stops: ['#0d0033', '#e61a80', '#ffe64d'] },
  { name: 'Toxic', stops: ['#001a0d', '#4de633', '#e6ff66'] },
  { name: 'Cyber', stops: ['#050026', '#1ae6f2', '#ff33cc'] },
  { name: 'Infrared', stops: ['#00001a', '#cc0000', '#ffe6b3'] },
  { name: 'Duotone', stops: ['#0d0d1a', '#8066cc', '#fff2ff'] },
  { name: 'Vapor', stops: ['#330d66', '#f266b3', '#4df2ff'] },
  { name: 'Blood', stops: ['#0d0000', '#80000d', '#ff801a'] },
  { name: 'Deep', stops: ['#00051a', '#006699', '#80f2e6'] },
  { name: 'Acid', stops: ['#1a0026', '#99ff00', '#ff4de6'] },
];

/** A tiled pattern's source is a tile, not the frame, so it takes no Split or Gradient Map. */
export function supportsLens(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

export function lensActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  const p = layer.params, m = layer.modulations;
  return supportsLens(layer) && ((p.splitAmount ?? 0) > 0 || (p.splitOrder ?? 0) > 0 || (p.gradMix ?? 0) > 0 || !!m.splitAmount || !!m.gradMix);
}

/** Taps for Split. Sample i sits at `offset` (-.5 to .5 of the split distance)
 * and contributes to each channel by a triangle centred on that channel's
 * position (red 0, green .5, blue 1). Each channel's weights sum to 1, so grey
 * stays grey; three samples are pure red, green and blue. */
export function spectralWeights(count: number): { offset: number; weight: [number, number, number] }[] {
  const n = Math.max(3, Math.round(count));
  const samples = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { offset: t - .5, raw: [0, .5, 1].map(c => Math.max(0, 1 - 2 * Math.abs(t - c))) };
  });
  const totals = [0, 1, 2].map(c => samples.reduce((a, s) => a + s.raw[c], 0));
  return samples.map(s => ({ offset: s.offset, weight: s.raw.map((w, c) => w / totals[c]) as [number, number, number] }));
}

/** Brightness position on the gradient: perceptual (gamma 2.2), then bent so
 * that the midpoint tone lands halfway along the gradient. */
export function gradientTone(luma: number, midpoint: number): number {
  const perceptual = Math.pow(Math.min(Math.max(luma, 0), 1), 1 / 2.2);
  return Math.pow(perceptual, Math.log(.5) / Math.log(midpoint));
}

function hexLuma(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return .2126 * r + .7152 * g + .0722 * b;
}

/** Stops of a gradient, dark to bright. Palette 0 sorts the layer's own colours by brightness. */
export function gradientStops(index: number, palette: string[]): string[] {
  if (index > 0) return [...(GRADIENT_PALETTES[index] ?? GRADIENT_PALETTES[1]).stops];
  return [...palette].sort((a, b) => hexLuma(a) - hexLuma(b));
}
