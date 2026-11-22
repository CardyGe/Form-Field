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
uniform vec2 uLiquidDrift;
uniform float uLiquidAmount, uLiquidScale, uLiquidTurn, uLiquidTrail, uLiquidChroma;
uniform int uLiquidStyle, uLiquidSteps, uLiquidDetail;
const float TAU = 6.28318530718;
const int WARP_TAPS = 4;
const int TRAIL_SAMPLES = 8;

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

/** Value noise with its slope: x is the value, yz the gradient. Same lattice as valueNoise. */
vec3 sloped(vec2 x) {
  vec2 i = floor(x), f = x - i, u = f * f * (3. - 2. * f), du = 6. * f * (1. - f);
  float a = latticeValue(i), b = latticeValue(i + vec2(1., 0.)), c = latticeValue(i + vec2(0., 1.)), d = latticeValue(i + vec2(1., 1.));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du.x * (b - a + k * u.y), du.y * (c - a + k * u.x)) * 2. - vec3(1., 0., 0.);
}

/** Fractal noise on a closed circle, so whole cycles return exactly. The slope is per unit of the noise's own space,
 * which keeps the current's speed the same at every Liquid scale. */
vec3 liquidNoise(vec2 p) {
  vec2 orbit = .5 * vec2(cos(uLiquidTurn), sin(uLiquidTurn)), start = vec2(uSeed * .53, uSeed * .29);
  vec3 sum = vec3(0.);
  float amplitude = 1., total = 0., frequency = 1.;
  for (int i = 0; i < uLiquidDetail; i++) {
    vec3 n = sloped(p * uLiquidScale * frequency + start + float(i) * 13. + orbit);
    sum += vec3(amplitude * n.x, amplitude * frequency * n.yz);
    total += amplitude; amplitude *= .5; frequency *= 2.;
  }
  return sum / total;
}

/** A quarter turn of a slope follows the noise's contour lines, so the current neither gathers nor thins the picture,
 * except where the speed limit in liquidCurrent engages. */
vec2 turned(vec2 slope) { return vec2(-slope.y, slope.x) * .5; }

vec2 swirlCurrent(vec2 p) { return turned(liquidNoise(p).yz); }

/** Ridge reshapes the noise as 1 - abs(2n - 1). With n in 0..1, 2n - 1 is the signed noise. The crease is
 * rounded very slightly, because a current that flips instantly would tear the picture along it. */
vec2 ridgeFrom(vec3 n) { return turned(-n.x / sqrt(n.x * n.x + .0025) * n.yz); }

vec2 ridgeCurrent(vec2 p) { return ridgeFrom(liquidNoise(p)); }

/** Turns about the frame centre, with bands of faster and slower rotation travelling outward. Speed depends only on
 * the radius, so alone this neither gathers nor thins the picture. Added to another current, the speed limit can. */
vec2 spiralCurrent(vec2 p) {
  float r = length(p);
  return vec2(-p.y, p.x) / sqrt(r * r + .01) * (.5 + .25 * cos(TAU * uLiquidScale * r - uLiquidTurn));
}

vec2 liquidCurrent(vec2 p) {
  vec2 v;
  if (uLiquidStyle == 0) v = swirlCurrent(p);
  else if (uLiquidStyle == 1) v = swirlCurrent(p) + uLiquidDrift * .6;
  else if (uLiquidStyle == 2) v = ridgeCurrent(p);
  else if (uLiquidStyle == 3) v = swirlCurrent(p) + spiralCurrent(p);
  else {
    // Chaos is Ridge plus Vortex. The ridges are read at a position they have already moved, once,
    // and Swirl shares the first noise read.
    vec3 n = liquidNoise(p);
    v = ridgeCurrent(p + ridgeFrom(n) * .35 / uLiquidScale) + turned(n.yz) + spiralCurrent(p);
  }
  // Speed is at most 1, so a step never travels further than its share of the amount.
  float speed = length(v);
  return speed > 1. ? v / speed : v;
}

/** Trail samples behind the final position, as offsets so later warps carry them along. Slot 0 is the head. */
vec2 trailOffset[TRAIL_SAMPLES];
float trailWeight[TRAIL_SAMPLES];
int trailCount = 1;

/** How far red and blue read from green. Each effect adds its own movement, scaled by its own fringe control.
 * Mirror and Polar add nothing, so a large fold never inflates it. Set by warpedUv. */
vec2 warpFringe;

/** Follows the current in midpoint steps, each moving amount * .5 / steps of frame height. */
vec2 liquidUv(vec2 uv) {
  vec2 frame = vec2(uAspect, 1.), start = (uv - .5) * frame, p = start;
  vec2 path[TRAIL_SAMPLES];
  float h = uLiquidAmount * .5 / float(uLiquidSteps);
  // The trail reuses positions the integration already found, so it adds texture reads but no field evaluations.
  int count = uLiquidTrail > 0. ? (uLiquidSteps + 1 < TRAIL_SAMPLES ? uLiquidSteps + 1 : TRAIL_SAMPLES) : 1, next = 0;
  float stride = float(uLiquidSteps) / max(1., float(count - 1));
  for (int s = 0; s < uLiquidSteps; s++) {
    if (next < count - 1 && s == int(floor(float(next) * stride + .5))) { path[next] = p; next++; }
    p += liquidCurrent(p + liquidCurrent(p) * h * .5) * h;
  }
  trailCount = count;
  if (count > 1) {
    // Weights fall off exponentially from the head and sum to 1. At trail 0 the head has all of it.
    float falloff = uLiquidTrail * .8, weight = 1., total = 0.;
    for (int i = 0; i < count; i++) { trailWeight[i] = weight; total += weight; weight *= falloff; }
    for (int i = 0; i < count; i++) trailWeight[i] /= total;
    for (int i = 1; i < count; i++) trailOffset[i] = (path[count - 1 - i] - p) / frame;
  }
  warpFringe += (p - start) / frame * uLiquidChroma * .08;
  return p / frame + .5;
}

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
  if (uLiquidAmount > 0.) warped = liquidUv(warped);
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

/** How far the grid of reads spreads for this footprint. Zero while a pixel covers at most one source texel. */
vec2 tapReach(vec2 footprint) {
  float widest = max(footprint.x, footprint.y);
  if (WARP_TAPS == 1 || widest <= 1.) return vec2(0.);
  return footprint * 1.25 / uResolution * smoothstep(1., 1.5, widest);
}

vec2 tapPosition(int i) {
  return i == 0 ? vec2(.125, .375) : i == 1 ? vec2(-.375, .125) : i == 2 ? vec2(-.125, -.375) : vec2(.375, -.125);
}

/** One tap while a pixel covers at most one source texel. Past that, a rotated grid of four whose
 * spread grows from nothing, so squeezed detail does not sparkle and the change never shows.
 * The grid spans 1.25 footprints: a plain box still lets a fine checker shimmer. */
Gathered readAt(vec2 uv, vec2 footprint, float weight, inout float peak) {
  Gathered g = Gathered(vec3(0.), vec3(0.), 0.);
  vec2 reach = tapReach(footprint);
  if (reach == vec2(0.)) { gather(uv, weight, g, peak); return g; }
  for (int i = 0; i < 4; i++) gather(uv + reach * tapPosition(i), .25 * weight, g, peak);
  return g;
}

/** A tail sample takes the same filtered read as the head and adds to its running total. */
void addTail(vec2 uv, vec2 footprint, float weight, inout Gathered sum, inout float peak) {
  Gathered t = readAt(uv, footprint, weight, peak);
  sum.covered += t.covered; sum.light += t.light; sum.alpha += t.alpha;
}

void main() {
  vec2 warped = warpedUv(vUv);
  vec2 footprint = fwidth(warped) * uResolution;
  float peak = 0.;
  // Every trail sample takes the same filtered read, so the most a squeezed, fringed pixel can read is
  // 3 * 8 * 4 = 96. An unsqueezed pixel reads once per sample: 8, or 24 with fringe.
  bool fringed = warpFringe != vec2(0.);
  float head = trailCount > 1 ? trailWeight[0] : 1.;
  Gathered g = readAt(warped, footprint, head, peak);
  Gathered r = g, b = g;
  if (fringed) { r = readAt(warped + warpFringe, footprint, head, peak); b = readAt(warped - warpFringe, footprint, head, peak); }
  float tailPeak = 0.;
  for (int i = 1; i < trailCount; i++) {
    vec2 at = warped + trailOffset[i], spread = fwidth(at) * uResolution;
    addTail(at, spread, trailWeight[i], g, tailPeak);
    if (fringed) { addTail(at + warpFringe, spread, trailWeight[i], r, tailPeak); addTail(at - warpFringe, spread, trailWeight[i], b, tailPeak); }
  }
  // The tail loosens the fringe bound only as far as the trail is turned up, so a faint trail cannot jump it.
  if (trailCount > 1) peak = mix(peak, max(peak, tailPeak), uLiquidTrail);
  vec3 covered = g.covered, light = g.light;
  if (fringed) {
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
