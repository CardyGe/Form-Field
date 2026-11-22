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
  vec3 rgb = vec3(0.);
  float alpha = 0., peak = 0.;
  for (int i = 0; i < uSplitCount; i++) {
    vec4 s = tap(uv + reach * uSplitOffsets[i]);
    rgb += s.rgb * uSplitWeights[i];
    alpha += s.a * uSplitWeights[i].g;
    if (s.a > .001) peak = max(peak, max(s.r, max(s.g, s.b)) / s.a);
  }
  // Each channel reads different pixels from the alpha, so at a soft edge colour
  // can outrun coverage. Holding it to the brightest colour under the taps stops
  // a bright fringe; min(peak, 1) also keeps RGB within alpha.
  return vec4(min(rgb, vec3(alpha * min(peak, 1.))), alpha);
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

void main() {
  vec4 c = uSplitOn > .5 ? splitStage(vUv) : tap(vUv);
  c.rgb = orderStage(c.rgb, vUv);
  gl_FragColor = vec4(min(c.rgb, vec3(c.a)), c.a);
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
