/**
 * Material tiles: LED wall, Characters and Tiles finishes.
 *
 * Each rebuilds the picture from a grid of cells sized in pixels of a 1080-line
 * frame. This file holds the rules for when the pass runs, the grid maths and
 * the choices, so they can be tested apart from the shader.
 */
import type { Layer } from '../shared/types';

export const LED_SHAPES = ['Round', 'Square', 'Stripes'];
export const CHAR_SETS: { name: string; glyphs: string }[] = [
  { name: 'Density', glyphs: ' .:-=+*#%@' },
  { name: 'Blocks', glyphs: ' ░▒▓█' },
  { name: 'Binary', glyphs: ' 01' },
  { name: 'Dots', glyphs: ' ·•●' },
];
export const TILE_STYLES = ['Mosaic', 'Brick', 'Beads'];
export const GAP_FILLS = ['Transparent', 'Black', 'Colour 1', 'Colour 2', 'Colour 3', 'Colour 4', 'Colour 5', 'Colour 6'];
export const RETRO_PALETTES: { name: string; colours: string[] }[] = [
  { name: 'Game Boy', colours: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { name: 'CGA', colours: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  { name: 'Teletext', colours: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'] },
  { name: 'Green screen', colours: ['#001a00', '#00ff41'] },
];

const AMOUNTS = ['ledAmount', 'charAmount', 'tileAmount'];

/** A tiled pattern's source is a tile, not the frame, so it cannot be rebuilt into cells. */
export function supportsTiles(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

export function tilesActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsTiles(layer) && AMOUNTS.some(key => (layer.params[key] ?? 0) > 0 || !!layer.modulations[key]);
}

/** Cells for a frame. `cellPx` is in 1080-line pixels, so the grid matches at any render size. */
export function cellGrid(width: number, height: number, cellPx: number): { cols: number; rows: number; cellUv: [number, number] } {
  const size = Math.max(cellPx, .25), rows = Math.ceil(1080 / size), aspect = width / Math.max(height, 1);
  const cols = Math.ceil(1080 * aspect / size);
  return { cols, rows, cellUv: [1 / cols, size / 1080] };
}

/** Tone (0–1) to a glyph index, from the empty first glyph to the full last one. */
export function glyphForTone(tone: number, count: number): number {
  return Math.round(Math.min(Math.max(tone, 0), 1) * (count - 1));
}

const LED_OWN = ['ledSize', 'ledDot', 'ledShape', 'ledBrightness', 'ledGaps', 'ledDead', 'ledScan', 'ledFlicker'];
const CHAR_OWN = ['charSize', 'charSet', 'charColour', 'charInk', 'charGaps', 'charContrast', 'charSwaps', 'charSwapChance'];
const TILE_OWN = ['tileStyle', 'tileSize', 'tileGrout', 'tileGaps', 'tileRelief', 'tileLight', 'tileJitter'];

/** Whether a tile control applies, given the layer's other choices. The amounts are always shown. */
export function tileControlVisible(layer: Pick<Layer, 'params' | 'modulations'>, key: string): boolean {
  const p = layer.params, on = (amount: string) => (p[amount] ?? 0) > 0 || !!layer.modulations[amount];
  if (AMOUNTS.includes(key)) return true;
  if (LED_OWN.includes(key)) return on('ledAmount');
  if (CHAR_OWN.includes(key)) {
    if (!on('charAmount')) return false;
    if (key === 'charInk') return Math.round(p.charColour ?? 0) === 1;
    if (key === 'charSwapChance') return (p.charSwaps ?? 0) > 0;
    return true;
  }
  if (TILE_OWN.includes(key)) {
    if (!on('tileAmount')) return false;
    if (key === 'tileJitter') return Math.round(p.tileStyle ?? 0) === 0;
    return true;
  }
  return true;
}

/**
 * Cell pass: draws one texel per cell, the mean premultiplied colour of the
 * picture inside it. Cells are counted from the frame's top-left corner.
 *
 * Each side of a cell gets up to eight taps. A tap sits between two pixels,
 * placed so the hardware filter weighs each by how much of it the cell covers,
 * so a cell up to sixteen pixels across is averaged exactly, whatever its
 * edges. A larger cell takes eight even taps, each on a pixel edge, so each
 * still averages a 2x2 block.
 */
export const cellColourFragment = /* glsl */`
precision highp float;
uniform sampler2D uSource;
uniform vec2 uSourceSize, uCellUv;
uniform float uRows;
void axisTaps(float a, float b, float size, out float at[8], out float weight[8]) {
  a = clamp(a, 0., size); b = clamp(b, 0., size);
  float first = floor(a);
  if (ceil(b) - first <= 16.) {
    for (int i = 0; i < 8; i++) {
      float k = first + 2. * float(i);
      float wa = max(0., min(b, k + 1.) - max(a, k)), wb = max(0., min(b, k + 2.) - max(a, k + 1.)), w = wa + wb;
      weight[i] = w;
      at[i] = (k + 1. + (w > 0. ? wb / w : 0.) - .5) / size;
    }
  } else {
    float step = (b - a) / 8.;
    for (int i = 0; i < 8; i++) {
      weight[i] = step;
      at[i] = clamp(floor(a + (float(i) + .5) * step + .5), 1., size - 1.) / size;
    }
  }
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float row = uRows - 1. - cell.y;
  float ax[8], wx[8], ay[8], wy[8];
  axisTaps(cell.x * uCellUv.x * uSourceSize.x, (cell.x + 1.) * uCellUv.x * uSourceSize.x, uSourceSize.x, ax, wx);
  axisTaps((1. - (row + 1.) * uCellUv.y) * uSourceSize.y, (1. - row * uCellUv.y) * uSourceSize.y, uSourceSize.y, ay, wy);
  vec4 sum = vec4(0.);
  float total = 0.;
  for (int j = 0; j < 8; j++) {
    if (wy[j] <= 0.) continue;
    for (int i = 0; i < 8; i++) {
      float w = wx[i] * wy[j];
      if (w <= 0.) continue;
      sum += w * texture2D(uSource, vec2(ax[i], ay[j]));
      total += w;
    }
  }
  gl_FragColor = total > 0. ? sum / total : vec4(0.);
}`;

/**
 * Tile pass: rebuilds the layer from its cells. Each stage reads its cell's
 * colour with nearest filtering at the cell centre; the result is blended
 * with the plain layer by the stage's amount. Light is never clamped, so
 * bright emitters reach Glow and keep over-range values.
 */
export const tileFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource, uCells;
uniform vec2 uGrid, uCellUv, uCellPx;
uniform float uSeed, uPhase;
uniform float uLedAmount, uLedDot, uLedShape, uLedBrightness, uLedDead, uLedScan, uLedFlicker, uLedCycles, uLedGapOn;
uniform vec3 uLedGap;
const float TAU = 6.28318530718;

vec4 cellColour(vec2 cell) { return texture2D(uCells, vec2(cell.x + .5, uGrid.y - cell.y - .5) / uGrid); }

// A seeded random number for a cell, the same on every frame.
float cellRandom(vec2 cell, uint salt) {
  uvec3 v = uvec3(uint(cell.x) + uint(fract(uSeed) * 65536.) * 4096u, uint(cell.y), uint(floor(uSeed)) * 8u + salt);
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return float(v.x) / 4294967296.;
}

// How much of a one-pixel box at x lies inside [-half, half].
float span(float x, float half_) { return clamp(min(x + .5, half_) - max(x - .5, -half_), 0., 1.); }

// How much of the pixel at p a disc covers: a 4x4 grid of quarter-pixel ramps, so even a disc
// smaller than a pixel keeps its true area and the preview matches a larger render.
float disc(vec2 p, float r) {
  float sum = 0.;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++)
    sum += clamp((r - length(p + (vec2(i, j) - 1.5) * .25)) * 4. + .5, 0., 1.);
  return sum / 16.;
}

// One LED's light and coverage within the pixel at p, in pixels from that LED's cell centre.
// rgb is emitted light, a the share of the pixel the LED covers, and gap the share of the
// pixel inside the cell but outside the LED.
struct Led { vec3 rgb; float a; float gap; };
Led led(vec2 cell, vec2 p) {
  Led result = Led(vec3(0.), 0., 0.);
  float inside = span(p.x, .5 * uCellPx.x) * span(p.y, .5 * uCellPx.y);
  if (inside <= 0.) return result;
  vec4 c = cellColour(cell);
  int shape = int(uLedShape + .5);
  vec3 cover;
  if (shape == 2) {
    float bar = uCellPx.x / 3., across = .5 * uLedDot * bar, tall = span(p.y, .5 * uLedDot * uCellPx.y);
    cover = vec3(span(p.x + bar, across), span(p.x, across), span(p.x - bar, across)) * tall;
  } else {
    float r = .5 * uLedDot * min(uCellPx.x, uCellPx.y);
    cover = vec3(shape == 1 ? span(p.x, r) * span(p.y, r) : disc(p, r));
  }
  float light = uLedBrightness * (cellRandom(cell, 0u) < uLedDead ? 0. : 1.);
  if (mod(cell.y, 2.) >= 1.) light *= 1. - uLedScan;
  if (uLedFlicker > 0.) {
    // Whole cycles per loop, so the loop closes; each LED keeps its own pace and timing.
    float k1 = max(1., floor(uLedCycles * (.5 + cellRandom(cell, 1u)) + .5)), k2 = max(1., floor(uLedCycles * (1. + 1.5 * cellRandom(cell, 2u)) + .5));
    float wave = .5 + .5 * (.6 * cos(k1 * uPhase + TAU * cellRandom(cell, 3u)) + .4 * cos(k2 * uPhase + TAU * cellRandom(cell, 4u)));
    light *= 1. - .6 * uLedFlicker * wave;
  }
  float lit = min(inside, shape == 2 ? cover.r + cover.g + cover.b : cover.x);
  // Stripes put each channel in a third of the cell, so the cell's total light is unchanged.
  result.rgb = c.rgb * light * (shape == 2 ? 3. * cover : cover);
  result.a = c.a * lit;
  result.gap = c.a * (inside - lit);
  return result;
}

vec4 ledStage(vec2 uv) {
  vec2 f = vec2(uv.x, 1. - uv.y) / uCellUv, cell = floor(f);
  // Pixels from the cell centre, y down.
  vec2 p = (fract(f) - .5) * uCellPx;
  // Every cell the pixel overlaps adds its share, so cells near a pixel in size still match a larger render.
  vec4 sum = vec4(0.);
  float gap = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 n = vec2(i, j);
    Led one = led(cell + n, p - n * uCellPx);
    sum += vec4(one.rgb, one.a); gap += one.gap;
  }
  // The background shows only where the layer has coverage.
  return sum + vec4(uLedGap, 1.) * uLedGapOn * gap;
}

void main() {
  vec4 result = texture2D(uSource, vUv);
  if (uLedAmount > 0.) result = mix(result, ledStage(vUv), uLedAmount);
  gl_FragColor = result;
}`;
