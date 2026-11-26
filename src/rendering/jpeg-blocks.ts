/**
 * JPEG damage: a real 8x8 block transform, quantised like a heavily compressed picture.
 *
 * Blocks are `jpegBlock` pixels of a 1080-line frame, counted from the frame's top-left, so they sit on the same
 * place in a preview and an export. A block 8 output pixels or wider is transformed as 8x8 samples and rebuilt
 * smoothly; a smaller one as one sample per output pixel (`jpegSamples`), so the work follows the frame's size. Each
 * sample is the exact mean of its own square of the picture, so detail finer than a sample never aliases.
 *
 * The transform runs on brightness and colour difference (BT.601, as JPEG does) of sRGB-encoded straight colour, the
 * clamped 0 to 1 part only. Colour runs on blocks twice the size (sampled at half size, as 4:2:0 JPEG does).
 */
import { signalCommon } from './signal';

const term = (k: number, n: number) => (k === 0 ? Math.SQRT1_2 : 1) * .5 * Math.cos(Math.PI * (2 * n + 1) * k / 16);

/** The 8-point orthonormal cosine transform (DCT-II), as JPEG uses along each axis. */
export function dct8(row: number[]): number[] {
  return Array.from({ length: 8 }, (_, k) => row.reduce((sum, v, n) => sum + v * term(k, n), 0));
}

/** The inverse of `dct8`. */
export function idct8(coefficients: number[]): number[] {
  return Array.from({ length: 8 }, (_, n) => coefficients.reduce((sum, c, k) => sum + c * term(k, n), 0));
}

/**
 * The step for frequency `index` (row-major, 0 is the first term) at `quality` 0..1, in 0..1 units of the 2D
 * orthonormal transform. In the spirit of the JPEG tables, but its own smooth curves (in 0..255 units):
 * - Brightness `12 + 3 (u + v) + .6 (u² + v²)`, from 12 for the first term to about 113 for the finest.
 * - Colour `17 + 2 (u + v) + 2.2 (u² + v²)`, rising faster and levelling at 99, never finer than brightness.
 * Quality scales every step by `2^(4.5 - 9 quality)`: 9 stops from about 22.6 times at 0 to 1/22.6 at 1, the tables
 * as they are at .5. Steps stop at a whole range (255), and the first term at 24 (a block mean step of 3/255), so a
 * flat colour keeps its colour within a few levels and block steps come from the lost detail.
 */
export function quantStep(index: number, quality: number, colour: boolean): number {
  const u = index % 8, v = Math.floor(index / 8), q = Math.min(1, Math.max(0, quality));
  const brightness = 12 + 3 * (u + v) + .6 * (u * u + v * v);
  const base = colour ? Math.max(brightness, Math.min(99, 17 + 2 * (u + v) + 2.2 * (u * u + v * v))) : brightness;
  return Math.min(index === 0 ? 24 : 255, base * 2 ** (4.5 - 9 * q)) / 255;
}

/** The brightness blocks across and down a frame, part blocks at the right and bottom included. */
export function blockGrid(width: number, height: number, blockPx: number): { cols: number; rows: number } {
  const lines = 1080, across = width * lines / height;
  return { cols: Math.ceil(across / blockPx - 1e-9), rows: Math.ceil(lines / blockPx - 1e-9) };
}

/**
 * The step table for the shader: 64 brightness steps, then 64 colour steps made coarser by Colour damage (up to 8
 * times at 1). The colour's first term keeps its own step, so flat colours hold.
 */
export function jpegSteps(quality: number, chroma: number, into: number[] | Float32Array = new Array<number>(128)): number[] | Float32Array {
  for (let i = 0; i < 64; i++) into[i] = quantStep(i, quality, false);
  for (let i = 0; i < 64; i++) into[64 + i] = quantStep(i, quality, true) * (i === 0 ? 1 : 2 ** (3 * chroma));
  return into;
}

/**
 * Samples a side for a block of `blockPx` 1080-line pixels in a frame `height` output pixels tall: 8, or as many as
 * the block has output pixels when it has fewer (at least 1). A smaller block then costs about one sample per output
 * pixel, so the grid follows the frame's size; its terms are the 8x8 block's lowest ones, the finer ones being finer
 * than its pixels anyway. Colour blocks are twice the size, so they keep more samples.
 */
export function jpegSamples(blockPx: number, height: number): { n: number; nc: number } {
  const across = blockPx * height / 1080, samples = (px: number) => Math.min(8, Math.max(1, Math.ceil(px - 1e-3)));
  return { n: samples(across), nc: samples(2 * across) };
}

/**
 * Shared by the four passes. The grid targets hold one texel per sample. A block holds `uN` samples a side (8, or as
 * many as it has output pixels when it is smaller, see `jpegSamples`); a colour block (2x2 brightness blocks) holds
 * `uNc`. Brightness blocks are n x n texels from the left edge, a term in red; colour blocks are nc x nc texels from
 * `uChromaX`, terms in red and green (two-channel targets). Grid rows count from the frame's top. Integer maths only ever sees
 * non-negative numbers.
 */
const jpegCommon = signalCommon + /* glsl */`
uniform float uBlock, uChromaX, uN, uNc;
const float PI = 3.14159265359;
// One term of the n-point orthonormal transform: the weight of sample x (0..n-1, or between) in frequency k.
float dctTerm(int k, float x, float n) { return sqrt((k == 0 ? 1. : 2.) / n) * cos(PI * (2. * x + 1.) * float(k) / (2. * n)); }
// All n weights at a place t in samples, by the cosine recurrence, each averaged over one output pixel of span
// samples: a cosine's mean over a span is its middle value times sin(x) / x, x half the phase the span covers. So a
// block of few output pixels shows each pixel's mean of the rebuilt block, as an export averaged down does.
void weights(float t, float span, float n, out float w[8]) {
  float c = cos(PI * (2. * t + 1.) / (2. * n)), before = 1., now = c, a = sqrt(2. / n);
  w[0] = sqrt(1. / n); w[1] = a * c;
  for (int k = 2; k < 8; k++) { float next = 2. * c * now - before; before = now; now = next; w[k] = a * now; }
  for (int k = 1; k < 8; k++) { float x = PI * float(k) * span / (2. * n); w[k] = float(k) < n ? w[k] * sin(x) / x : 0.; }
}
vec3 encode(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(.0031308)), vec3(1. / 2.4)) - .055, step(.0031308, c)); }
vec3 decode(vec3 c) { return mix(c / 12.92, pow(max((c + .055) / 1.055, vec3(0.)), vec3(2.4)), step(.04045, c)); }
float luma(vec3 e) { return dot(e, vec3(.299, .587, .114)); }
vec2 split(vec3 e) { float y = luma(e); return vec2((e.b - y) / 1.772, (e.r - y) / 1.402); }
vec3 join(float y, vec2 c) { float r = y + 1.402 * c.y, b = y + 1.772 * c.x; return vec3(r, (y - .299 * r - .114 * b) / .587, b); }
`;

/**
 * Pass 1, rows forward, into the grid. Each sample is the mean of its square of the picture. Every sample of a row is
 * laid over the row's mean colour by its coverage, so empty and soft-edged parts never ring against the colour beside
 * them. Light over 1 is left out here and added back at the end.
 */
const rowsForward = jpegCommon + /* glsl */`
// Where one linear tap, along one axis in output pixels, takes the mean of the span from lo, size long (at most one
// pixel): the pixel the span lies in, or the two it crosses weighted by how much of each it covers.
float tapAt(float lo, float size) {
  float a = floor(lo), b = floor(lo + size - 1e-4);
  return a == b ? a + .5 : a + .5 + (lo + size - b) / size;
}
// The mean premultiplied light over a square of this many output pixels from p, its top-left corner (from the frame's
// top-left): n x n exact taps of at most one pixel each, so detail finer than a sample never aliases. Past 16 pixels
// the taps spread wider and only blur. Taps stay inside the frame, so a part block at the edge repeats the edge
// pixel even when the source wraps.
vec4 cell(vec2 p, float size) {
  int n = int(clamp(ceil(size - 1e-3), 1., 16.));
  float part = size / float(n);
  vec4 sum = vec4(0.);
  for (int b = 0; b < 16; b++) {
    if (b >= n) break;
    float y = part > 1. ? p.y + (float(b) + .5) * part : tapAt(p.y + float(b) * part, part);
    y = clamp(y, .5, uSize.y - .5);
    for (int a = 0; a < 16; a++) {
      if (a >= n) break;
      float x = part > 1. ? p.x + (float(a) + .5) * part : tapAt(p.x + float(a) * part, part);
      sum += texture2D(uSource, vec2(clamp(x, .5, uSize.x - .5) / uSize.x, 1. - y / uSize.y));
    }
  }
  return sum / float(n * n);
}
// The n encoded samples of a row of cells from p, its top-left corner, each spacing output pixels square.
void row(vec2 p, float spacing, int n, out vec3 e[8]) {
  vec4 s[8];
  vec3 sum = vec3(0.);
  float cover = 0.;
  for (int i = 0; i < 8; i++) {
    vec4 c = i < n ? cell(p + vec2(float(i) * spacing, 0.), spacing) : vec4(0.);
    float a = clamp(c.a, 0., 1.);
    s[i] = vec4(clamp(c.rgb, 0., a), a); sum += s[i].rgb; cover += a;
  }
  vec3 mean = cover > 1e-5 ? sum / cover : vec3(0.);
  for (int i = 0; i < 8; i++) e[i] = encode(clamp(s[i].rgb + mean * (1. - s[i].a), 0., 1.));
}
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy);
  int chromaX = int(uChromaX), n = int(uN), nc = int(uNc);
  float block = uBlock / uLines;
  vec3 e[8];
  if (g.x < chromaX) {
    float spacing = block / uN;
    int bx = g.x / n, by = g.y / n;
    row(vec2(float(bx) * block, float(by) * block + float(g.y - by * n) * spacing), spacing, n, e);
    float y = 0.;
    for (int i = 0; i < 8; i++) y += i < n ? luma(e[i]) * dctTerm(g.x - bx * n, float(i), uN) : 0.;
    gl_FragColor = vec4(y, 0., 0., 1.);
  } else {
    int h = g.x - chromaX, bx = h / nc, by = g.y / nc;
    float size = 2. * block, spacing = size / uNc;
    row(vec2(float(bx) * size, float(by) * size + float(g.y - by * nc) * spacing), spacing, nc, e);
    vec2 c = vec2(0.);
    for (int i = 0; i < 8; i++) c += i < nc ? split(e[i]) * dctTerm(h - bx * nc, float(i), uNc) : vec2(0.);
    gl_FragColor = vec4(c, 0., 1.);
  }
}`;

/**
 * Pass 2, columns forward with quantising, grid to grid: each term rounded to its step from `uSteps`. The steps (128 floats, packed four to a vec4) are
 * for 8x8 blocks; a block of n samples has terms n/8 the size (the orthonormal transform grows with the square root
 * of the samples on each axis), so its steps shrink alike and it is quantised as its 8x8 self would be.
 */
const columnsForward = jpegCommon + /* glsl */`
uniform sampler2D uGrid;
uniform vec4 uSteps[32];
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy);
  int chromaX = int(uChromaX);
  bool colour = g.x >= chromaX;
  int n = int(colour ? uNc : uN), x = colour ? g.x - chromaX : g.x, top = (g.y / n) * n, v = g.y - top, u = x - (x / n) * n;
  vec2 sum = vec2(0.);
  for (int j = 0; j < 8; j++) sum += j < n ? texelFetch(uGrid, ivec2(g.x, top + j), 0).rg * dctTerm(v, float(j), float(n)) : vec2(0.);
  // Brightness steps are the first 64, colour steps the next.
  int at = (colour ? 64 : 0) + v * 8 + u;
  float step = uSteps[at >> 2][at & 3] * float(n) / 8.;
  gl_FragColor = vec4(floor(sum / step + .5) * step, 0., 1.);
}`;

/**
 * Pass 3, columns inverse, from the grid to a target as wide as the grid and as tall as the frame: each output row
 * rebuilds its place in the block from the terms, between samples too, so a large block scales up smoothly.
 */
const columnsInverse = jpegCommon + /* glsl */`
uniform sampler2D uTerms;
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy);
  // Brightness blocks are uBlock 1080-line pixels tall, colour blocks twice that.
  bool colour = g.x >= int(uChromaX);
  float size = colour ? 2. * uBlock : uBlock, n = colour ? uNc : uN;
  float at = (float(g.y) + .5) * uLines / size, by = floor(at);
  float w[8];
  weights((at - by) * n - .5, n * uLines / size, n, w);
  vec2 sum = vec2(0.);
  int top = int(by * n), last = int(n) - 1;
  for (int v = 0; v < 8; v++) sum += w[v] * texelFetch(uTerms, ivec2(g.x, top + min(v, last)), 0).rg;
  gl_FragColor = vec4(sum, 0., 1.);
}`;

/**
 * Pass 4, rows inverse, to the frame, with broken blocks and the mix with plain. A block is broken for one slot of
 * the loop when a hash of the block, the seed and the slot is under `uGlitch`: it then takes a neighbour's first term
 * (its mean brightness, and the mean colour of the neighbour's colour block) or shows the neighbour one block over.
 * The colour difference is mixed from the pixel's own toward the damaged one by Colour damage. The pixel keeps its own
 * coverage, so nothing appears where the layer is empty, and the light over 1 is added back.
 */
const rowsInverse = jpegCommon + /* glsl */`
uniform sampler2D uTerms, uColumns;
uniform vec2 uBlocks;
uniform float uChroma, uGlitch, uSlot;
// A block's first term, scaled to its mean (the first weight squared is 1 / n).
float term(vec2 block) { return texelFetch(uTerms, ivec2(block * uN), 0).r / uN; }
vec2 colourTerm(vec2 block) { return texelFetch(uTerms, ivec2(floor(block * .5) * uNc) + ivec2(int(uChromaX), 0), 0).rg / uNc; }
// Brightness, then colour difference, at p, output pixels from the top-left.
vec3 rebuild(vec2 p) {
  int r = int(clamp(floor(p.y), 0., uSize.y - 1.)), chromaX = int(uChromaX);
  float at = p.x * uLines / uBlock, bx = floor(at), cx = floor(at * .5), span = uLines / uBlock;
  float w[8];
  weights((at - bx) * uN - .5, span * uN, uN, w);
  float y = 0.;
  int left = int(bx * uN), last = int(uN) - 1;
  for (int u = 0; u < 8; u++) y += w[u] * texelFetch(uColumns, ivec2(left + min(u, last), r), 0).r;
  weights((at * .5 - cx) * uNc - .5, span * .5 * uNc, uNc, w);
  vec2 c = vec2(0.);
  left = chromaX + int(cx * uNc); last = int(uNc) - 1;
  for (int u = 0; u < 8; u++) c += w[u] * texelFetch(uColumns, ivec2(left + min(u, last), r), 0).rg;
  return vec3(y, c);
}
void main() {
  vec4 plain = texture2D(uSource, vUv);
  vec2 p = vec2(gl_FragCoord.x, fromTop());
  float block = uBlock / uLines;
  vec2 b = floor(p / block), from = p;
  vec3 first = vec3(0.);
  if (uGlitch > 0. && rnd(b.x, b.y, uSlot, 31u) < uGlitch) {
    int side = int(rnd(b.x, b.y, uSlot, 33u) * 4.);
    vec2 d = side == 0 ? vec2(1., 0.) : side == 1 ? vec2(-1., 0.) : side == 2 ? vec2(0., 1.) : vec2(0., -1.);
    vec2 n = b + d;
    if (n.x < 0. || n.y < 0. || n.x >= uBlocks.x || n.y >= uBlocks.y) { d = -d; n = b + d; }
    if (rnd(b.x, b.y, uSlot, 32u) < .5) first = vec3(term(n) - term(b), colourTerm(n) - colourTerm(b));
    else from = clamp(p + d * block, vec2(.5), uSize - .5);
  }
  vec4 own = from == p ? plain : texture2D(uSource, vec2(from.x / uSize.x, 1. - from.y / uSize.y));
  vec3 straight = own.a > 1e-5 ? own.rgb / own.a : vec3(0.), low = clamp(straight, 0., 1.);
  vec3 damaged = rebuild(from) + first;
  vec3 e = join(damaged.x, mix(split(encode(low)), damaged.yz, uChroma));
  vec3 light = decode(clamp(e, 0., 1.)) + straight - low;
  gl_FragColor = mix(plain, vec4(light * plain.a, plain.a), uAmount);
}`;

/** The four passes in order: rows forward, columns forward with quantising, columns inverse, rows inverse. */
export const jpegFragments = { rowsForward, columnsForward, columnsInverse, rowsInverse };
