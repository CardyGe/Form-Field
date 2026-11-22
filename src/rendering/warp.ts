/**
 * Warp finish: Warp, Liquid, Luma Warp, Polar and Mirror, which move the picture's pixels.
 *
 * This file holds the rules for when the pass runs and the maths it shares, which can be tested directly.
 * Distances are shares of frame height and motion is in whole cycles per loop, so the look matches at every
 * export size and the loop closes exactly.
 */
import type { Layer } from '../shared/types';

export const WARP_FIELDS = ['Waves', 'Noise', 'Ripple', 'Magnetic', 'Plasma'];
export const LIQUID_STYLES = ['Swirl', 'Flow', 'Ridge', 'Vortex', 'Chaos'];
export const LUMA_SOURCES = ['This layer', 'Layer below'];
export const LUMA_CHANNELS = ['Brightness', 'Red', 'Green', 'Blue', 'Saturation'];
export const LUMA_MODES = ['Push', 'Edges', 'Contours'];
export const POLAR_MODES = ['To circle', 'Unroll'];
export const MIRROR_MODES = ['Left-right', 'Top-bottom', 'Four-way', 'Kaleidoscope'];

const AMOUNTS = ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount'];
const TAU = Math.PI * 2;

/** A tiled pattern's source is a tile, not the frame, and graphic layers are drawn from shapes: neither takes a warp. */
export function supportsWarp(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

export function warpActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsWarp(layer) && AMOUNTS.some(key => (layer.params[key] ?? 0) > 0 || !!layer.modulations[key]);
}

/** Small deterministic generator, so the same seed always places the same points. */
function hash(n: number): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Magnet points inside the frame, 10% to 90% across, with alternating pull and push. */
export function warpPoints(count: number, seed: number): { x: number; y: number; polarity: number }[] {
  const n = Math.max(1, Math.round(count));
  return Array.from({ length: n }, (_, i) => ({
    x: .1 + .8 * hash(seed * 131 + i * 2 + 1),
    y: .1 + .8 * hash(seed * 131 + i * 2 + 2),
    polarity: i % 2 === 0 ? 1 : -1,
  }));
}

/** Folds an angle into one mirrored wedge of a kaleidoscope with `segments` wedges. */
export function foldAngle(angle: number, segments: number): number {
  const wedge = TAU / Math.max(1, segments);
  const a = ((angle % wedge) + wedge) % wedge;
  return Math.min(a, wedge - a);
}

/** A circular path that returns to its start after any whole number of cycles. */
export function loopOffset(phase: number, cycles: number): [number, number] {
  if (!cycles) return [0, 0];
  return [Math.sin(cycles * phase), Math.cos(cycles * phase) - 1];
}

/**
 * The shared warp pass. Every warp adds to `warpedUv`, the one place a pixel's read position is decided,
 * so filtering, mirrored edges and colour fringes work the same for all of them.
 * Non-graphic sources are already in frame coordinates, so `vUv` is both the frame and the source position.
 */
export const warpFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uResolution, uBendDirection;
uniform float uAspect, uSeed, uBendAmount, uBendScale, uBendFalloff, uBendChroma, uBendTurn;
uniform int uBendField, uBendDetail, uBendCount;
uniform vec3 uBendPoints[8];
const float TAU = 6.28318530718;
const int WARP_TAPS = 4;

/** Waves: two sines along the chosen direction. Length is at most 1. */
vec2 wavesField(vec2 p) {
  vec2 across = vec2(-uBendDirection.y, uBendDirection.x);
  float k = TAU * uBendScale;
  return across * .8 * sin(k * dot(p, uBendDirection) + uBendTurn + uSeed)
    + uBendDirection * .6 * sin(k * .618 * dot(p, across) - uBendTurn + uSeed * 1.7);
}

float latticeValue(vec2 cell) {
  vec3 q = fract(vec3(cell.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 x) {
  vec2 i = floor(x), f = x - i;
  f = f * f * (3. - 2. * f);
  float low = mix(latticeValue(i), latticeValue(i + vec2(1., 0.)), f.x);
  float high = mix(latticeValue(i + vec2(0., 1.)), latticeValue(i + vec2(1., 1.)), f.x);
  return mix(low, high, f.y) * 2. - 1.;
}

/** Noise: each octave moves around a closed circle, so whole cycles return exactly. */
vec2 noiseField(vec2 p) {
  vec2 orbit = .5 * vec2(cos(uBendTurn), sin(uBendTurn)), sum = vec2(0.), start = vec2(uSeed * .37, uSeed * .73);
  float amplitude = 1., total = 0., frequency = uBendScale;
  for (int i = 0; i < uBendDetail; i++) {
    vec2 q = p * frequency + start + float(i) * 13.;
    sum += amplitude * vec2(valueNoise(q + orbit), valueNoise(q.yx - orbit.yx + 17.));
    total += amplitude; amplitude *= .5; frequency *= 2.;
  }
  return sum / total * .7071;
}

vec2 pointAt(int i) { return (uBendPoints[i].xy - .5) * vec2(uAspect, 1.); }

/** Ripple: rings spread from each point and fade with distance. */
vec2 rippleField(vec2 p) {
  vec2 sum = vec2(0.);
  float fade = mix(.5, 6., uBendFalloff);
  for (int i = 0; i < uBendCount; i++) {
    vec2 d = p - pointAt(i);
    float r = length(d);
    sum += uBendPoints[i].z * d / sqrt(r * r + .0025) * sin(TAU * uBendScale * r - uBendTurn) * exp(-r * fade);
  }
  return sum / sqrt(1. + dot(sum, sum));
}

/** Magnetic: points circle slowly, pulling and pushing the picture around them. */
vec2 magneticField(vec2 p) {
  vec2 sum = vec2(0.);
  float fade = mix(.5, 6., uBendFalloff) * uBendScale / 3.;
  for (int i = 0; i < uBendCount; i++) {
    float turn = uBendTurn + float(i) * 2.4;
    vec2 d = pointAt(i) + .06 * vec2(cos(turn), sin(turn)) - p;
    float r = length(d);
    sum += uBendPoints[i].z * d / sqrt(r * r + .01) * exp(-r * fade);
  }
  return sum / sqrt(1. + dot(sum, sum));
}

/** Plasma: four interfering sines on each axis. */
vec2 plasmaField(vec2 p) {
  float k = TAU * uBendScale, t = uBendTurn, s = uSeed;
  float a = sin(k * p.x + t + s) + sin(k * .8 * p.y - t + 1.7 + s) + sin(k * .6 * (p.x + p.y) + 2. * t + 4.1) + sin(k * .7 * length(p + .3) - t);
  float b = sin(k * p.y + t + 2.3 + s) + sin(k * .8 * p.x + t + 5.1 - s) + sin(k * .6 * (p.x - p.y) - 2. * t + .9) + sin(k * .7 * length(p - .3) + t);
  return vec2(a, b) * .25 * .7071;
}

vec2 bendField(vec2 p) {
  if (uBendField == 0) return wavesField(p);
  if (uBendField == 1) return noiseField(p);
  if (uBendField == 2) return rippleField(p);
  if (uBendField == 3) return magneticField(p);
  return plasmaField(p);
}

/** How far red and blue read from green. Each effect adds its own movement, scaled by its own fringe control.
 * Mirror and Polar add nothing, so a large fold never inflates it. Set by warpedUv. */
vec2 warpFringe;

/** Where this pixel reads from. Warps compose here in order: Mirror, Polar, Warp, Liquid, Luma. */
vec2 warpedUv(vec2 uv) {
  vec2 frame = vec2(uAspect, 1.), warped = uv;
  warpFringe = vec2(0.);
  // Warp: amount 1 moves a pixel at most half the frame height.
  if (uBendAmount > 0.) {
    vec2 move = bendField((warped - .5) * frame) * uBendAmount * .5 / frame;
    warped += move;
    warpFringe += move * uBendChroma * .08;
  }
  return warped;
}

/** Folds a position back into the frame, so a push past the edge shows picture rather than a streak or a gap. */
vec2 mirrored(vec2 uv) {
  vec2 m = mod(uv, 2.);
  return vec2(m.x > 1. ? 2. - m.x : m.x, m.y > 1. ? 2. - m.y : m.y);
}

struct Gathered { vec3 covered; vec3 light; float alpha; };

void gather(vec2 uv, float weight, inout Gathered g, inout float peak) {
  vec4 s = texture2D(uSource, mirrored(uv));
  g.alpha += s.a * weight;
  // Light with no coverage has no straight colour to bound, so it passes as it is.
  if (s.a > .001) { g.covered += s.rgb * weight; peak = max(peak, max(s.r, max(s.g, s.b)) / s.a); }
  else g.light += s.rgb * weight;
}

/** One tap while a pixel covers at most one source texel. Past that, a rotated grid of four whose
 * spread grows from nothing, so squeezed detail does not sparkle and the change never shows.
 * The grid spans 1.25 footprints: a plain box still lets a fine checker shimmer. */
Gathered readAt(vec2 uv, vec2 footprint, inout float peak) {
  Gathered g = Gathered(vec3(0.), vec3(0.), 0.);
  float widest = max(footprint.x, footprint.y);
  if (WARP_TAPS == 1 || widest <= 1.) { gather(uv, 1., g, peak); return g; }
  vec2 reach = footprint * 1.25 / uResolution * smoothstep(1., 1.5, widest);
  gather(uv + reach * vec2(.125, .375), .25, g, peak);
  gather(uv + reach * vec2(-.375, .125), .25, g, peak);
  gather(uv + reach * vec2(-.125, -.375), .25, g, peak);
  gather(uv + reach * vec2(.375, -.125), .25, g, peak);
  return g;
}

void main() {
  vec2 warped = warpedUv(vUv);
  vec2 footprint = fwidth(warped) * uResolution;
  float peak = 0.;
  Gathered g = readAt(warped, footprint, peak);
  vec3 covered = g.covered, light = g.light;
  if (warpFringe != vec2(0.)) {
    Gathered r = readAt(warped + warpFringe, footprint, peak), b = readAt(warped - warpFringe, footprint, peak);
    // Red and blue read other pixels than the alpha, so at a soft edge colour can outrun coverage.
    // Only that change is bounded, by the brightest straight colour read, so over-range light stays.
    // Uncovered light always passes, and counts against the room left for covered colour.
    light = vec3(r.light.r, g.light.g, b.light.b);
    vec3 room = max(vec3(g.alpha * peak), g.covered + g.light) - light;
    covered = min(vec3(r.covered.r, g.covered.g, b.covered.b), max(room, vec3(0.)));
  }
  gl_FragColor = vec4(covered + light, g.alpha);
}
`;
