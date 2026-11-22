/**
 * Time displacement (slit-scan) for a single layer.
 *
 * Each part of the frame shows the source as it was some frames ago, chosen by
 * a delay map (rows, columns, rings, a diagonal, random blocks, brightness or bands). The source
 * is rendered once per slice at evenly spaced delays, and every output pixel
 * takes the slice nearest its delay (hard steps) or blends the two nearest
 * (smooth). Weights always sum to one, so coverage is preserved.
 *
 * No history is stored: each slice is the source evaluated at an earlier
 * phase. The source loops, so the result loops exactly, seeks instantly and
 * exports in any order.
 */
import type { Layer } from '../shared/types';

export const SLIT_SHAPES = ['Rows', 'Columns', 'Rings', 'Diagonal', 'Blocks', 'Brightness', 'Bands'];
export const SLIT_MODES = ['Delay map', 'Echo', 'Median', 'Darkest', 'Brightest'];

export function supportsSlitScan(layer: Pick<Layer, 'kind' | 'params'>): boolean {
  return layer.kind !== 'graphic' && !(layer.kind === 'livingink' && layer.params.inkMode === 2);
}

export function slitActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsSlitScan(layer) && ((layer.params.slitShift ?? 0) !== 0 || !!layer.modulations.slitShift);
}

/** Whether an inspector control applies to the layer's current Time mode. Shift is always shown; the rest need it on. */
export function slitControlVisible(layer: Pick<Layer, 'params' | 'modulations'>, key: string): boolean {
  if (key === 'slitShift') return true;
  if (!((layer.params.slitShift ?? 0) !== 0 || !!layer.modulations.slitShift)) return false;
  const mode = Math.round(layer.params.slitMode ?? 0), delayMap = mode <= 0;
  switch (key) {
    case 'slitShape': case 'slitSmooth': case 'slitScroll': case 'slitTwist': case 'slitZoom': case 'slitChroma': return delayMap;
    case 'slitBlocks': { const shape = Math.round(layer.params.slitShape ?? 0); return delayMap && (shape === 4 || shape === 6); }
    case 'slitDecay': return mode === 1;
    case 'slitReach': return mode >= 2;
    default: return true;
  }
}

/** Slices rendered per frame. Median needs an odd count of at most nine. */
export function sliceCount(params: Record<string, number>): number {
  const count = Math.max(2, Math.round(params.slitSlices ?? 12));
  return Math.round(params.slitMode ?? 0) === 2 ? Math.min(9, count | 1) : count;
}

/** Delay in frames of each slice, from now (0) to the full span. */
export function sliceDelays(layer: Pick<Layer, 'params'>): number[] {
  const count = sliceCount(layer.params);
  const span = Math.abs(layer.params.slitShift ?? 0) * (layer.params.slitSpan ?? 30);
  return Array.from({ length: count }, (_, i) => span * i / (count - 1));
}

/** Source renders per frame: one per slice, plus the Brightness map's driver in Delay map mode. */
export function sliceSourceRenders(layer: Pick<Layer, 'params'>): number {
  const shape = layer.params.slitShape ?? 0;
  const delayMap = Math.round(layer.params.slitMode ?? 0) <= 0;
  return sliceDelays(layer).length + Number(delayMap && shape >= 4.5 && shape < 5.5);
}

/** The live preview draws slices smaller as they multiply, so together they cost about one and a half frames. */
export function previewSliceScale(renders: number): number {
  return Math.max(.25, Math.min(.5, Math.sqrt(1.5 / renders)));
}

/** Phase of a slice: back in time by default, forward in Future, wrapped to the loop. */
export function slicePhase(phase: number, delay: number, total: number, direction: number): number {
  const TAU = Math.PI * 2;
  const raw = phase + (direction >= .5 ? 1 : -1) * TAU * delay / total;
  return ((raw % TAU) + TAU) % TAU;
}

/** Echo weights: decay^age, normalised to sum to one. */
export function echoWeights(count: number, decay: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => Math.pow(decay, i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(v => v / sum);
}

/** How many slices each of red, green and blue remembers. Red the fewest, blue all. */
export function channelSliceCounts(count: number, reach: number): [number, number, number] {
  const r = Math.max(1, Math.round(count * reach));
  return [r, Math.round((r + count) / 2), count];
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MEDIAN_BUDGET = 768 * 1024 * 1024;
/** Half-float RGBA is 8 bytes a pixel; shrink the slices so all of them fit the budget. */
export function medianTargetSize(width: number, height: number, slices: number): { width: number; height: number } {
  if (width * height * 8 * slices <= MEDIAN_BUDGET) return { width, height };
  const scale = Math.sqrt(MEDIAN_BUDGET / (width * height * 8 * slices));
  return { width: Math.floor(width * scale), height: Math.floor(height * scale) };
}

export const slitFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uAccum, uSource, uDriver, uBound, uLag;
uniform float uIndex, uCount, uSmooth, uShape, uBlocks, uScroll, uAspect, uReverse, uSeed, uTwist, uZoom, uChroma;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
// 0 = now, 1 = the full span ago.
float delayMap(vec2 uv) {
  vec2 p = (uv - .5) * vec2(uAspect, 1.);
  float d;
  if (uShape < .5) d = 1. - uv.y;
  else if (uShape < 1.5) d = uv.x;
  else if (uShape < 2.5) d = length(p) / length(vec2(uAspect, 1.) * .5);
  else if (uShape < 3.5) d = (uv.x * uAspect + (1. - uv.y)) / (uAspect + 1.);
  else if (uShape < 4.5) d = hash(floor(uv * vec2(uBlocks * uAspect, uBlocks)));
  else if (uShape < 5.5) {
    // Bright parts of the current frame stay now; dark parts lag the full span.
    vec4 driver = texture2D(uDriver, uv);
    vec3 straight = driver.a > 0. ? driver.rgb / driver.a : vec3(0.);
    d = 1. - pow(max(dot(straight, vec3(.2126, .7152, .0722)), 0.), 1. / 2.2);
  }
  else d = mod(floor(uv.y * uBlocks), 2.);
  if (uReverse > .5) d = 1. - d;
  // Integer scroll cycles per loop, so the map returns to its start.
  return fract(clamp(d, 0., .9999) + uScroll);
}
float cumulative(float position, float edge, float width) {
  return clamp((position - edge) / width + .5, 0., 1.);
}
float sliceWeight(float position, float width) {
  // Hard steps: band membership, anti-aliased over one pixel. The first and
  // last bands extend outward so the weights always sum to one.
  float lower = uIndex < .5 ? 1. : cumulative(position, uIndex - .5, width);
  float upper = uIndex > uCount - 1.5 ? 0. : cumulative(position, uIndex + .5, width);
  float hard = lower - upper;
  // Smooth: linear interpolation between the two nearest slices.
  float soft = max(0., 1. - abs(position - uIndex));
  return mix(hard, soft, uSmooth);
}
// Each older slice turns and scales further about the frame centre. The delay
// map itself stays unwarped. Coordinates past the frame edge mirror back in.
vec2 sliceUv() {
  float age = uIndex / (uCount - 1.);
  float turn = 6.283185307179586 * uTwist * age, scale = 1. - uZoom * age;
  if (turn == 0. && scale == 1.) return vUv;
  vec2 p = (vUv - .5) * vec2(uAspect, 1.);
  float c = cos(turn), s = sin(turn);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * scale;
  return abs(mod(p / vec2(uAspect, 1.) + .5 + 1., 2.) - 1.);
}
void main() {
  float position = delayMap(vUv) * (uCount - 1.);
  float width = max(fwidth(position), 1e-4);
  float weight = sliceWeight(position, width);
  vec4 source = texture2D(uSource, sliceUv());
  // Colour lag: red reads a nearer moment and blue a further one. Green and
  // alpha keep the plain weight, so coverage does not change.
  float red = weight, blue = weight;
  if (uChroma > 0.) {
    float spread = uChroma * (uCount - 1.) * .25;
    red = sliceWeight(clamp(position - spread, 0., uCount - 1.), width);
    blue = sliceWeight(clamp(position + spread, 0., uCount - 1.), width);
  }
  // Below this a sample is light with no coverage, as in the colour split.
  bool covered = source.a > .001;
#if defined(SLIT_BOUND)
  // Brightest straight colour red and blue take from a covered slice; drawn with MAX blending.
  vec3 straight = covered ? source.rgb / source.a : vec3(0.);
  gl_FragColor = vec4(red > 0. ? straight.r : 0., 0., blue > 0. ? straight.b : 0., 1.);
#elif defined(SLIT_LAG)
  // What lag changes in red and blue, summed with additive blending:
  // covered samples in rg, light with no coverage in ba.
  vec2 change = vec2(source.r * (red - weight), source.b * (blue - weight));
  gl_FragColor = covered ? vec4(change, 0., 0.) : vec4(0., 0., change);
#else
  vec4 sum = texture2D(uAccum, vUv) + source * weight;
  if (uChroma > 0. && uIndex > uCount - 1.5) {
    // The plain result plus a bounded change, so no change means exactly the plain
    // result. Added colour stays within the brightest straight colour combined here,
    // which keeps over-range light and adds no fringe. Uncovered light passes as it is.
    vec4 lag = texture2D(uLag, vUv);
    vec2 room = max(sum.a * texture2D(uBound, vUv).rb - sum.rb, 0.);
    sum.rb += min(lag.rg, room) + lag.ba;
  }
  gl_FragColor = sum;
#endif
}`;
