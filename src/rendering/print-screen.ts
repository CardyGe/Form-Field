/**
 * Print screen finish: halftone dots, line screens and ordered dither.
 *
 * The screen itself is drawn in the composite shader. This file holds the
 * rules for when it runs and the maths that decides how big each mark is, so
 * they can be tested; the shader mirrors these functions line for line.
 */
import type { Layer } from '../shared/types';

/** Angle offsets in degrees for the channel screens: RGB uses the first three,
 * CMYK all four (cyan, magenta, yellow, black). */
export const PRINT_CHANNEL_ANGLES = [15, 75, 0, 45];

/** A tiled pattern's source is a tile, not the frame, so it cannot be screened. */
export function supportsPrint(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

export function printActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsPrint(layer) && ((layer.params.printMix ?? 0) > 0 || !!layer.modulations.printMix);
}

/** Screen geometry in frame units, independent of the render size: `cells` per
 * frame height, the four channel angles in radians, and travel in cells. */
export function printUniforms(layer: Pick<Layer, 'params'>, loopPhase: number): { cells: number; angles: number[]; scroll: number } {
  const p = layer.params, size = Math.max(p.printSize ?? 8, .25), angle = p.printAngle ?? 45;
  return {
    cells: 1080 / size,
    angles: PRINT_CHANNEL_ANGLES.map(offset => (angle + offset) * Math.PI / 180),
    scroll: (p.printScroll ?? 0) * loopPhase / (Math.PI * 2),
  };
}

/** Tone (0–1) to the share of a cell its mark should cover. */
export function printCoverage(tone: number, floor: number, ceiling: number, gain: number, invert: number): number {
  let x = ceiling <= floor ? (tone > floor ? 1 : 0) : Math.min(Math.max((tone - floor) / Math.max(ceiling - floor, 1e-3), 0), 1);
  if (gain !== 0) x = Math.pow(x, Math.pow(2, -1.5 * gain));
  return invert > .5 ? 1 - x : x;
}

/** Brightness scale for a mark in the layer's own colour, so the cell's
 * average matches the unscreened layer. */
export function printInkScale(coverage: number): number {
  return Math.min(1 / Math.max(coverage, 1e-4), 8);
}

const ROUND_TOUCH = Math.PI / 4, ROUND_FULL = Math.SQRT1_2 + .01;

/**
 * Half-extent of a mark, in cells, for the share of the cell it should cover.
 * 0 Round: radius. 1 Classic: the coverage itself (see classicLevel).
 * 2 Diamond: reach of |x|+|y|. 3 Square: half-side.
 */
export function printMarkSize(shape: number, coverage: number): number {
  const c = Math.min(Math.max(coverage, 0), 1);
  if (shape === 1) return c;
  if (shape === 2) return c <= .5 ? Math.sqrt(c / 2) : 1 - Math.sqrt((1 - c) / 2);
  if (shape === 3) return Math.sqrt(c) / 2;
  // Dots touch at radius .5; past that they grow steadily until they cover the cell corners.
  return c <= ROUND_TOUCH ? Math.sqrt(c / Math.PI) : .5 + (ROUND_FULL - .5) * (c - ROUND_TOUCH) / (1 - ROUND_TOUCH);
}

/**
 * Classic dot: the mark is where (cos 2πx + cos 2πy) / 2 is above a level.
 * These are the levels whose mark covers 0, 1/16 … 1 of the cell, found by
 * numeric integration. The shader carries the same seventeen numbers.
 */
export const CLASSIC_LEVELS = [1, .8131, .6446, .4938, .3599, .2426, .1421, .0592, 0, -.0592, -.1421, -.2426, -.3599, -.4938, -.6446, -.8131, -1];
export function classicLevel(coverage: number): number {
  const t = Math.min(Math.max(coverage, 0), 1) * 16, i = Math.min(Math.floor(t), 15);
  return CLASSIC_LEVELS[i] + (CLASSIC_LEVELS[i + 1] - CLASSIC_LEVELS[i]) * (t - i);
}

/** Ordered-dither threshold in (0, 1) for a cell. Matrix 0, 1, 2 is 2×2, 4×4, 8×8. */
export function bayerThreshold(matrix: number, x: number, y: number): number {
  const bits = Math.round(matrix) + 1, n = 1 << bits;
  let cx = ((Math.floor(x) % n) + n) % n, cy = ((Math.floor(y) % n) + n) % n, index = 0;
  for (let b = 0; b < bits; b++) {
    // Each level places four sub-cells in the order 0, 2, 3, 1.
    const bx = cx & 1, by = cy & 1;
    index = index * 4 + ((bx ^ by) * 2 + by);
    cx >>= 1; cy >>= 1;
  }
  return (index + .5) / (n * n);
}
