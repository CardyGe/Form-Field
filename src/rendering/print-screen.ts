/**
 * Print screen finish: halftone dots, line screens, ordered dither and blue noise.
 *
 * The screen itself is drawn in the composite shader. This file holds the
 * rules for when it runs and the maths that decides how big each mark is, so
 * they can be tested; the shader mirrors these functions line for line.
 */
import type { Layer } from '../shared/types';
import { BLUE_NOISE_BASE64 } from './blue-noise-data';
import { RETRO_PALETTES } from './tiles';

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

/** Tone (0–1) to the share of a cell its mark should cover, at most `max`. */
export function printCoverage(tone: number, floor: number, ceiling: number, gain: number, invert: number, max = 1): number {
  let x = ceiling <= floor ? (tone > floor ? 1 : 0) : Math.min(Math.max((tone - floor) / Math.max(ceiling - floor, 1e-3), 0), 1);
  if (gain !== 0) x = Math.pow(x, Math.pow(2, -1.5 * gain));
  return (invert > .5 ? 1 - x : x) * max;
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

/** Side of the blue-noise threshold tile, in texels. One texel is one Print cell. */
export const BLUE_NOISE_SIZE = 64;

let noise: Uint8Array | null = null;
/** The blue-noise threshold tile, row by row: each value 0–255 appears 16 times. */
export function blueNoise(): Uint8Array {
  noise ??= Uint8Array.from(atob(BLUE_NOISE_BASE64), c => c.charCodeAt(0));
  return noise.slice();
}

/** Relative luminance of an sRGB hex colour (linear Rec. 709 weights). */
export function relativeLuminance(hex: string): number {
  const linear = (i: number) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  return .2126 * linear(1) + .7152 * linear(3) + .0722 * linear(5);
}

const retroOrder = RETRO_PALETTES.map(p => [...p.colours].sort((a, b) => relativeLuminance(a) - relativeLuminance(b)));
/** A retro palette's colours from dark to light, so a tone ramp maps to a brightness ramp. */
export function retroColours(palette: number): string[] {
  return retroOrder[Math.min(Math.max(Math.round(palette), 0), RETRO_PALETTES.length - 1)].slice();
}

/** Retro palette colour (sRGB hex) for a tone 0–1: the nearest of the palette's colours, dark to light. */
export function retroColour(tone: number, palette: number): string {
  const colours = retroColours(palette);
  return colours[Math.round(Math.min(Math.max(tone, 0), 1) * (colours.length - 1))];
}

// R2 low-discrepancy sequence (Roberts): steps by the inverse plastic number
// and its square, so successive offsets land far apart and cover the tile evenly.
const PLASTIC = 1.324717957244746, R2 = [1 / PLASTIC, 1 / (PLASTIC * PLASTIC)];
/** Whole-texel offset of the threshold tile for a loop frame. Frame 0 is no offset. */
export function shimmerOffset(frame: number): [number, number] {
  const f = Math.round(frame);
  return [0, 1].map(axis => Math.floor((((R2[axis] * f) % 1) + 1) % 1 * BLUE_NOISE_SIZE) % BLUE_NOISE_SIZE) as [number, number];
}

/**
 * Shimmer offset for a loop phase. Only Dither and Blue noise shimmer, and only
 * when Shimmer is on. The phase is quantised to the nearest loop frame, as
 * Characters' swaps are, so exact frame phases land on their own frame, seeking
 * repeats, and the instant before the loop's end is already frame 0: the seam closes.
 */
export function printShimmerShift(layer: Pick<Layer, 'params'>, loopPhase: number, frames: number): [number, number] {
  const p = layer.params, type = Math.round(p.printType ?? 0);
  if ((p.printShimmer ?? 0) < .5 || type < 2) return [0, 0];
  const TAU = Math.PI * 2, total = Math.max(1, Math.round(frames)), wrapped = ((loopPhase % TAU) + TAU) % TAU;
  return shimmerOffset(Math.floor(wrapped / TAU * total + .5) % total);
}
