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

/**
 * `cellGrid`, with cells grown just enough that the grid is at most `maxCols` across. The grids share one target, so
 * a very wide output at the smallest sizes would otherwise need a target wider than the GPU allows.
 */
export function fitCellGrid(width: number, height: number, cellPx: number, maxCols: number, maxRows = Infinity): ReturnType<typeof cellGrid> {
  const grid = cellGrid(width, height, cellPx);
  if (grid.cols <= maxCols && grid.rows <= maxRows) return grid;
  const least = Math.max(1080 * (width / Math.max(height, 1)) / Math.max(1, maxCols), 1080 / Math.max(1, maxRows));
  return cellGrid(width, height, Math.max(cellPx, least * (1 + 1e-6)));
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
    // Beads are round and sit apart, so Grout width does nothing; Grout colour still fills the bead hole.
    if (key === 'tileGrout') return Math.round(p.tileStyle ?? 0) !== 2;
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
// Where this grid starts in the shared cell target, in cells.
uniform vec2 uOrigin;
// Cells moved left on odd rows (counted from the top), for Brick's half-cell offset.
uniform float uOddShift;
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
  vec2 cell = floor(gl_FragCoord.xy) - uOrigin;
  float row = uRows - 1. - cell.y, x = cell.x - (mod(row, 2.) >= 1. ? uOddShift : 0.);
  float ax[8], wx[8], ay[8], wy[8];
  axisTaps(x * uCellUv.x * uSourceSize.x, (x + 1.) * uCellUv.x * uSourceSize.x, uSourceSize.x, ax, wx);
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
 * Tile pass: rebuilds the layer from its cells. LED wall, Characters and Tiles
 * each have their own grid in the shared cell target, left to right. Each stage reads its cell's
 * colour with nearest filtering at the cell centre; the result is blended
 * with the plain layer by the stage's amount. Light is never clamped, so
 * bright emitters reach Glow and keep over-range values.
 */
export const tileFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource, uCells;
// uGrid is this layer's cells; uCellsSize the shared target, which may be larger.
uniform vec2 uGrid, uCellsSize, uCellUv, uCellPx;
uniform float uSeed, uPhase;
uniform float uLedAmount, uLedDot, uLedShape, uLedBrightness, uLedDead, uLedScan, uLedFlicker, uLedCycles, uLedGapOn;
uniform vec3 uLedGap;
// Characters have their own grid, stored to the right of the LED cells in the shared target.
uniform sampler2D uGlyphs;
uniform vec2 uCharGrid, uCharCellUv, uCharCellPx;
uniform float uCharOrigin, uCharAmount, uCharCount, uCharColumns, uCharGlyphPx, uCharSpread, uCharContrast, uCharInkOn, uCharGapOn, uCharSwaps, uCharSwapChance;
uniform vec3 uCharInk, uCharGap;
// Tiles: a third grid, to the right of the character cells. Brick's grid has a spare column for its offset rows.
// uTileLight points toward the light in pixel axes, y down.
uniform vec2 uTileGrid, uTileCellUv, uTileCellPx, uTileLight;
uniform float uTileOrigin, uTileAmount, uTileStyle, uTileGrout, uTileRelief, uTileJitter, uTileGapOn;
uniform vec3 uTileGap;
const float TAU = 6.28318530718;

// A grid's cell, counted from the frame's top-left; cells past the grid read its nearest edge cell.
vec4 cellAt(vec2 cell, vec2 grid, float origin) {
  cell = clamp(cell, vec2(0.), grid - 1.);
  return texture2D(uCells, vec2(origin + cell.x + .5, grid.y - cell.y - .5) / uCellsSize);
}
vec4 cellColour(vec2 cell) { return cellAt(cell, uGrid, 0.); }

// Seeded random bits for a cell, the same on every frame.
uvec3 cellHash(vec2 cell, uint salt) {
  uvec3 v = uvec3(uint(cell.x) + uint(fract(uSeed) * 65536.) * 4096u, uint(cell.y), uint(floor(uSeed)) * 8u + salt);
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float cellRandom(vec2 cell, uint salt) { return float(cellHash(cell, salt).x) / 4294967296.; }

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

// Tone of a premultiplied linear colour: its brightest channel, unpremultiplied, held to full value and encoded as
// the display would. A saturated red or blue is as bright as white here, so it picks a full glyph, not a dark one.
float tone(vec4 c) {
  vec3 straight = max(c.rgb / max(c.a, 1e-4), vec3(0.));
  float y = min(max(straight.r, max(straight.g, straight.b)), 1.);
  return y <= .0031308 ? 12.92 * y : 1.055 * pow(y, 1. / 2.4) - .055;
}

// The glyph a cell shows: its tone after contrast, or now and then a seeded other glyph. Swaps hold for a
// slot of the loop; slots are centred on whole fractions of it, so the loop's end and start share slot 0.
float glyphFor(vec2 cell, vec4 c) {
  float t = clamp((tone(c) - .5) * uCharContrast + .5, 0., 1.), glyph = floor(t * (uCharCount - 1.) + .5);
  if (uCharSwaps > 0.) {
    float slot = mod(floor(uPhase / TAU * uCharSwaps + .5), uCharSwaps);
    vec2 key = cell + vec2(0., 4096. * (slot + 1.));
    if (cellRandom(key, 5u) < uCharSwapChance) glyph = mod(glyph + 1. + floor(cellRandom(key, 6u) * (uCharCount - 1.)), uCharCount);
  }
  return glyph;
}

vec4 charStage(vec2 uv) {
  vec2 f = vec2(uv.x, 1. - uv.y) / uCharCellUv;
  // Stored glyph pixels per output pixel, and the edge value's change across one of the 4x4 samples below.
  float texels = max(fwidth(f.x) * uCharGlyphPx, fwidth(f.y) * uCharGlyphPx), ramp = max(texels / (2. * uCharSpread) / 4., 1e-4);
  vec4 sum = vec4(0.);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    // Samples spread evenly over the pixel, so glyphs smaller than a pixel keep their true area.
    vec2 at = f + (vec2(i, j) - 1.5) * .25 / uCharCellPx, cell = clamp(floor(at), vec2(0.), uCharGrid - 1.);
    vec4 c = cellAt(cell, uCharGrid, uCharOrigin);
    // Inside the glyph's own square, half a stored pixel from its sides, so neighbours never bleed in.
    vec2 inGlyph = clamp(fract(at), .5 / uCharGlyphPx, 1. - .5 / uCharGlyphPx);
    float field = texture2D(uGlyphs, vec2((glyphFor(cell, c) + inGlyph.x) / uCharColumns, inGlyph.y)).r;
    float cover = clamp((field - .5) / ramp + .5, 0., 1.);
    vec3 ink = uCharInkOn > .5 ? uCharInk * c.a : c.rgb;
    sum += vec4(ink, c.a) * cover + vec4(uCharGap, 1.) * uCharGapOn * c.a * (1. - cover);
  }
  return sum / 16.;
}

// Light on a tile's surface. lean is the surface normal's tilt in pixel axes (y down), zero on a flat top. Relief 0
// leaves the colour as it is; otherwise light never passes the cell's own colour, only shades it.
vec3 tileNormal(vec2 lean) { return vec3(lean, sqrt(max(0., 1. - dot(lean, lean)))); }
vec3 tileLightDir() { return normalize(vec3(uTileLight, 1.)); }
float tileShade(vec2 lean) { return mix(1., .45 + .55 * max(dot(tileNormal(lean), tileLightDir()), 0.), uTileRelief); }

// A tile under one sample: the cell that colours it, how much of the sample is grout, the surface's tilt, whether a
// stud shades it, and its specular share.
struct Tile { vec2 cell; float grout; vec2 lean; float shadow; float spec; };
const float BEVEL = .12, TILT = .7;

// A mosaic grid corner's seeded shift, in cells: up to Irregularity x .35 of a cell on each axis, capped at a quarter
// cell so every quad stays convex. Corners on the frame's border move only along it, so no tile pulls away from an edge.
vec2 cornerShift(vec2 corner) {
  if (uTileJitter <= 0.) return vec2(0.);
  uvec3 h = cellHash(corner + 8., 7u);
  vec2 shift = min(uTileJitter * .35, .25) * (2. * vec2(h.xy) / 4294967296. - 1.), frame = 1. / uTileCellUv;
  if (corner.x <= 0. || corner.x >= frame.x - 1e-3) shift.x = 0.;
  if (corner.y <= 0. || corner.y >= frame.y - 1e-3) shift.y = 0.;
  return shift;
}
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

// Mosaic: quads between the moved grid corners. s is in cells from the frame's top-left, y down. Corners move under
// half a cell, so the quad holding s is its own cell's or a neighbour's on the side of the cell s is nearer.
Tile mosaic(vec2 s) {
  vec2 c = floor(s), lo = c - vec2(fract(s.x) < .5 ? 1. : 0., fract(s.y) < .5 ? 1. : 0.), p = s * uTileCellPx;
  vec2 k[9];
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) { vec2 at = lo + vec2(i, j); k[j * 3 + i] = (at + cornerShift(at)) * uTileCellPx; }
  float best = -1e9; vec2 owner = c, inward = vec2(0., 1.);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    // Corners clockwise on screen, so the inside of each edge is to its right in y-down axes.
    vec2 q[4] = vec2[4](k[j * 3 + i], k[j * 3 + i + 1], k[j * 3 + i + 4], k[j * 3 + i + 3]);
    float inside = 1e9; vec2 normal = vec2(0.);
    for (int e = 0; e < 4; e++) {
      vec2 a = q[e], edge = q[(e + 1) % 4] - a;
      float len = max(length(edge), 1e-4), d = cross2(edge, p - a) / len;
      if (d < inside) { inside = d; normal = vec2(-edge.y, edge.x) / len; }
    }
    if (inside > best) { best = inside; owner = lo + vec2(i, j); inward = normal; }
  }
  // Grout is a band centred on each edge; a sample is a quarter-pixel box, so its share is the box's overlap.
  float half_ = .5 * uTileGrout * dot(abs(inward), uTileCellPx);
  Tile t = Tile(owner, span(4. * best, 4. * half_), vec2(0.), 0., 0.);
  if (best - half_ < BEVEL * min(uTileCellPx.x, uTileCellPx.y)) t.lean = -inward * TILT;
  return t;
}

// Brick: odd rows move half a cell left, so their cells come from the offset footprint, with one more per row.
// Each brick carries a round stud of radius .3 cell that casts a short shadow away from the light.
Tile brick(vec2 s) {
  float row = floor(s.y), x = s.x + (mod(row, 2.) >= 1. ? .5 : 0.);
  vec2 l = (vec2(fract(x), fract(s.y)) - .5) * uTileCellPx, edge = .5 * uTileCellPx - abs(l);
  bool side = edge.x < edge.y;
  float inside = side ? edge.x : edge.y, half_ = .5 * uTileGrout * (side ? uTileCellPx.x : uTileCellPx.y), m = min(uTileCellPx.x, uTileCellPx.y);
  Tile t = Tile(vec2(floor(x), row), span(4. * inside, 4. * half_), vec2(0.), 0., 0.);
  float r = length(l), stud = .3 * m;
  if (inside - half_ < BEVEL * m) t.lean = (side ? vec2(sign(l.x), 0.) : vec2(0., sign(l.y))) * TILT;
  else if (r < stud && r > stud - .07 * m) t.lean = l / r * TILT;
  else if (r >= stud && length(l + uTileLight * .1 * m) < stud) t.shadow = 1.;
  return t;
}

// Beads: a ring per cell, outer radius .46 and inner .16 of a cell, round in cross-section, with a highlight.
Tile beads(vec2 s) {
  vec2 l = (fract(s) - .5) * uTileCellPx;
  float m = min(uTileCellPx.x, uTileCellPx.y), r = length(l), outer = .46 * m, inner = .16 * m;
  float ring = clamp((outer - r) * 4. + .5, 0., 1.) * clamp((r - inner) * 4. + .5, 0., 1.);
  float u = clamp((r - .31 * m) / (.15 * m), -1., 1.);
  Tile t = Tile(floor(s), 1. - ring, l / max(r, 1e-4) * u, 0., 0.);
  vec3 n = tileNormal(t.lean);
  t.spec = .85 * uTileRelief * pow(max(reflect(-tileLightDir(), n).z, 0.), 24.);
  return t;
}

vec4 tileStage(vec2 uv) {
  vec2 f = vec2(uv.x, 1. - uv.y) / uTileCellUv;
  int style = int(uTileStyle + .5);
  vec4 sum = vec4(0.);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    // Samples spread evenly over the pixel, so edges are filtered to one output pixel at any tile size.
    vec2 s = f + (vec2(i, j) - 1.5) * .25 / uTileCellPx;
    Tile t;
    if (style == 0) t = mosaic(s); else if (style == 1) t = brick(s); else t = beads(s);
    // Only Brick uses the spare last column; Mosaic and Beads read their own grid's cells.
    vec4 c = cellAt(t.cell, style == 1 ? uTileGrid : uTileGrid - vec2(1., 0.), uTileOrigin);
    vec3 rgb = c.rgb * (t.shadow > 0. ? mix(1., .45, uTileRelief) : tileShade(t.lean));
    // The highlight whitens toward the cell's brightest channel, so it never passes the source.
    rgb = mix(rgb, vec3(max(max(c.r, c.g), c.b)), t.spec);
    // Grout shows only where the layer has coverage.
    sum += vec4(rgb, c.a) * (1. - t.grout) + vec4(uTileGap, 1.) * uTileGapOn * c.a * t.grout;
  }
  return sum / 16.;
}

void main() {
  vec4 result = texture2D(uSource, vUv);
  // LED wall first, then Characters, then Tiles. Each is built from the plain layer's cells and cross-fades over the
  // result so far, so a later stage at full amount replaces the earlier ones.
  if (uLedAmount > 0.) result = mix(result, ledStage(vUv), uLedAmount);
  if (uCharAmount > 0.) result = mix(result, charStage(vUv), uCharAmount);
  if (uTileAmount > 0.) result = mix(result, tileStage(vUv), uTileAmount);
  gl_FragColor = result;
}`;
