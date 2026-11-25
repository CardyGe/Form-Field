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
