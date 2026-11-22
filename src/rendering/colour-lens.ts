/**
 * Colour and Lens finish: Split (colour channels pulled apart) and Gradient Map
 * (tone mapped onto a palette).
 *
 * This file holds the rules for when the pass runs, the maths it shares, which
 * can be tested directly, and its shader. The renderer owns the target and binds
 * the uniforms (see StudioRenderer.lensSource).
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

/** Amounts that switch grading on; temperature and tint work in both directions. */
const GRADE_AMOUNTS = ['gradeTemperature', 'gradeTint', 'gradeShadowTint', 'gradeHighlightTint'];

export function lensActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  const p = layer.params, m = layer.modulations;
  return supportsLens(layer) && ((p.splitAmount ?? 0) > 0 || (p.splitOrder ?? 0) > 0 || (p.gradMix ?? 0) > 0 || !!m.splitAmount || !!m.gradMix ||
    GRADE_AMOUNTS.some(key => (p[key] ?? 0) !== 0 || !!m[key]) || (p.keyMix ?? 0) > 0 || !!m.keyMix);
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

/**
 * The Colour and Lens pass. Reads the layer's finished source (linear,
 * premultiplied) and writes the same. Each look is one stage in `main`, so the
 * result of one feeds the next.
 */
export const lensFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform float uAspect, uHeight, uTile, uPhase, uSeed;
uniform float uSplitOn, uSplitAmount, uSplitShape, uSplitThreshold, uSplitWaves, uSplitTravel, uSplitOrder, uSplitBlocks, uSplitChance;
uniform vec2 uSplitDirection;
uniform int uSplitCount;
uniform float uSplitOffsets[15];
uniform vec3 uSplitWeights[15];
uniform float uGradMix, uGradMidpoint, uGradShift, uGradKeep;
uniform int uGradCount;
uniform vec3 uGradStops[6];
uniform vec3 uGradeWb, uShadowColour, uHighlightColour;
uniform float uShadowTint, uHighlightTint;
uniform float uKeyMix, uKeyMode, uKeyLow, uKeyHigh, uKeySoft, uKeyHue, uKeyHueRange, uKeyInvert;
const float TAU = 6.28318530718;

vec4 tap(vec2 uv) { return texture2D(uSource, uTile > .5 ? fract(uv) : clamp(uv, 0., 1.)); }
float luma(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }

/** Sobel magnitude. The step is one pixel of a 1080-line frame, and never less
 * than one render pixel, so a hard edge reads the same at every render size. */
float edgeStrength(vec2 uv) {
  float size = max(1. / 1080., 1. / uHeight);
  vec2 e = vec2(size / uAspect, size);
  float a = luma(tap(uv + e * vec2(-1., 1.)).rgb), b = luma(tap(uv + vec2(0., e.y)).rgb), c = luma(tap(uv + e).rgb);
  float d = luma(tap(uv - vec2(e.x, 0.)).rgb), f = luma(tap(uv + vec2(e.x, 0.)).rgb);
  float g = luma(tap(uv - e).rgb), h = luma(tap(uv - vec2(0., e.y)).rgb), i = luma(tap(uv + e * vec2(1., -1.)).rgb);
  return length(vec2(c + 2. * f + i - a - 2. * d - g, a + 2. * b + c - g - 2. * h - i)) / 4.;
}

/** Split direction and strength here, in height units, at most length 1. */
vec2 splitField(vec2 uv) {
  if (uSplitShape < .5) return uSplitDirection;
  if (uSplitShape < 1.5) {
    // A tiled frame needs the push to meet itself at the edge, so it eases to
    // zero there; near the centre the two forms are the same.
    vec2 q = uv - .5;
    vec2 p = uTile > .5 ? sin(TAU * q) / TAU : q;
    return p * vec2(uAspect, 1.) / (.5 * length(vec2(uAspect, 1.)));
  }
  if (uSplitShape < 2.5) return uSplitDirection * smoothstep(uSplitThreshold, uSplitThreshold + .2, edgeStrength(uv));
  return uSplitDirection * sin(TAU * (uSplitWaves * uv.y + uSplitTravel * uPhase / TAU));
}

vec4 splitStage(vec2 uv) {
  vec2 reach = splitField(uv) * uSplitAmount / 1080. / vec2(uAspect, 1.);
  vec3 covered = vec3(0.), light = vec3(0.);
  float alpha = 0., peak = 0.;
  for (int i = 0; i < uSplitCount; i++) {
    vec4 s = tap(uv + reach * uSplitOffsets[i]);
    alpha += s.a * uSplitWeights[i].g;
    // Light with no coverage has no straight colour to bound, so it passes as it is.
    if (s.a > .001) { covered += s.rgb * uSplitWeights[i]; peak = max(peak, max(s.r, max(s.g, s.b)) / s.a); }
    else light += s.rgb * uSplitWeights[i];
  }
  // Each channel reads different pixels from the alpha, so at a soft edge colour
  // can outrun coverage. Straight colour stays within the brightest straight
  // colour among the samples, which keeps over-range light and adds no fringe.
  return vec4(min(covered, vec3(alpha * peak)) + light, alpha);
}

float blockHash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * .1031 + uSeed * .0137);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 permute(vec3 c) {
  if (uSplitOrder < .5) return c;
  if (uSplitOrder < 1.5) return c.gbr;
  if (uSplitOrder < 2.5) return c.brg;
  if (uSplitOrder < 3.5) return c.rbg;
  if (uSplitOrder < 4.5) return c.grb;
  return c.bgr;
}

vec3 orderStage(vec3 c, vec2 uv) {
  if (uSplitBlocks > .5) {
    // A whole number of near-square blocks, so the grid also fits a tiled frame.
    vec2 grid = vec2(max(1., floor(uSplitBlocks * uAspect + .5)), uSplitBlocks);
    if (blockHash(floor(fract(uv) * grid)) >= uSplitChance) return c;
  }
  return permute(c);
}

/** Position along the gradient, in [0, 1]. The shift runs in units of two, so a
 * whole turn (offset 1, or a whole cycle) is a full period of the triangle fold
 * and returns to the start. With no shift the fold is the identity. */
float foldTone(float t) {
  float f = fract(.5 * t) * 2.;
  return 1. - abs(f - 1.);
}

/** Even stops, smoothstep between neighbours. */
vec3 gradientColour(float t) {
  float x = t * float(uGradCount - 1);
  vec3 a = uGradStops[0], b = uGradStops[0];
  for (int i = 0; i < 5; i++) {
    if (i + 1 < uGradCount && x >= float(i)) { a = uGradStops[i]; b = uGradStops[i + 1]; }
  }
  float seg = min(floor(x), float(uGradCount - 2));
  return mix(a, b, smoothstep(0., 1., x - seg));
}

/** Gradient Map on unpremultiplied colour. Over-range light keeps its extra
 * brightness; with Keep brightness the mapped colour takes the input's luma. */
vec4 gradientStage(vec4 c) {
  if (uGradMix <= 0. || uGradCount < 2 || c.a <= .0001) return c;
  vec3 straight = c.rgb / c.a;
  float l = luma(straight);
  float tone = pow(pow(clamp(l, 0., 1.), 1. / 2.2), log(.5) / log(uGradMidpoint));
  vec3 mapped = gradientColour(foldTone(tone + uGradShift));
  mapped *= uGradKeep > .5 ? l / max(luma(mapped), .0001) : max(l, 1.);
  return vec4(mix(straight, mapped, uGradMix) * c.a, c.a);
}

/** Moves the colour towards a tint and keeps its brightness: the tint is scaled
 * to the pixel's luma, so the mix has the same luma. Nothing is clamped. */
vec3 tintTowards(vec3 straight, vec3 tint, float weight) {
  float l = luma(straight), t = luma(tint);
  if (weight <= 0. || l <= 0. || t <= .0001) return straight;
  return mix(straight, tint * (l / t), weight);
}

/** Grading on unpremultiplied colour: white balance, then shadow and highlight
 * tints weighted by perceptual tone. Over-range light stays over range. */
vec4 gradeStage(vec4 c) {
  if (c.a <= .0001) return c;
  vec3 straight = c.rgb / c.a;
  straight *= uGradeWb;
  float tone = pow(clamp(luma(straight), 0., 1.), 1. / 2.2);
  straight = tintTowards(straight, uShadowColour, uShadowTint * (1. - smoothstep(0., .5, tone)));
  straight = tintTowards(straight, uHighlightColour, uHighlightTint * smoothstep(.5, 1., tone));
  return vec4(straight * c.a, c.a);
}

/** Port of keyCoverage in colour-lens.ts: the lower edge feathers only when it
 * is above 0 and the upper edge only when it is below 1, so the ends stay open. */
float keyCoverage(float v, float lo, float hi, float soft, float invert) {
  float a = 1., b = 1.;
  if (lo > 0.) a = soft > 0. ? smoothstep(lo - soft * .5, lo + soft * .5, v) : step(lo, v);
  if (hi < 1.) b = soft > 0. ? 1. - smoothstep(hi - soft * .5, hi + soft * .5, v) : step(v, hi);
  return mix(a * b, 1. - a * b, invert);
}

float hueOf(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), d = mx - min(c.r, min(c.g, c.b));
  float h = mx == c.r ? mod((c.g - c.b) / d, 6.) : mx == c.g ? (c.b - c.r) / d + 2. : (c.r - c.g) / d + 4.;
  return h * 60.;
}

/** Key: colour and alpha are scaled together, so a feathered edge fades without a fringe. */
vec4 keyStage(vec4 c) {
  if (uKeyMix <= 0. || c.a <= .0001) return c;
  vec3 straight = c.rgb / c.a;
  float cover;
  if (uKeyMode < .5) {
    cover = keyCoverage(pow(clamp(luma(straight), 0., 1.), 1. / 2.2), uKeyLow, uKeyHigh, uKeySoft, uKeyInvert);
  } else {
    float mx = max(straight.r, max(straight.g, straight.b)), d = mx - min(straight.r, min(straight.g, straight.b));
    float away = abs(hueOf(straight) - uKeyHue);
    away = min(away, 360. - away);
    // Greys have no hue and are never inside the key. The range is mapped so the kept half is 0 to .5.
    float v = d < .05 * mx || mx <= 0. ? 2. : .5 * away / uKeyHueRange;
    cover = keyCoverage(v, 0., .5, uKeySoft, uKeyInvert);
  }
  return c * mix(1., cover, uKeyMix);
}

void main() {
  vec4 c = uSplitOn > .5 ? splitStage(vUv) : tap(vUv);
  c.rgb = orderStage(c.rgb, vUv);
  gl_FragColor = keyStage(gradeStage(gradientStage(c)));
}
`;

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

/** Per-channel multipliers for temperature and tint (each -1 to 1). They are
 * divided by their own luma, so a white pixel keeps its brightness. */
export function whiteBalance(temperature: number, tint: number): [number, number, number] {
  if (temperature === 0 && tint === 0) return [1, 1, 1];
  const m = [1 + .25 * temperature, 1 - .15 * tint, 1 - .25 * temperature];
  const l = .2126 * m[0] + .7152 * m[1] + .0722 * m[2];
  return [m[0] / l, m[1] / l, m[2] / l];
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How much of a pixel the key keeps. The range [low, high] is kept, its edges
 * feather by `softness` centred on each edge, and the ends of the scale (0 for
 * the lower edge, 1 for the upper) stay open. `invert` keeps what is outside.
 * Hue keying calls this with low 0 and high .5, on half the distance to the key
 * hue as a share of the hue range. */
export function keyCoverage(value: number, low: number, high: number, softness: number, invert: number): number {
  const edge = (e: number, above: boolean) => softness > 0 ? smooth(e - softness / 2, e + softness / 2, value) : Number(above ? value >= e : value <= e);
  const a = low > 0 ? edge(low, true) : 1;
  const b = high < 1 ? (softness > 0 ? 1 - edge(high, false) : edge(high, false)) : 1;
  const kept = a * b;
  return invert > 0 ? 1 - kept : kept;
}
