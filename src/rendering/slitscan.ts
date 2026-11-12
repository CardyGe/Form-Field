/**
 * Time displacement (slit-scan) for a single layer.
 *
 * Each part of the frame shows the source as it was some frames ago, chosen by
 * a delay map (rows, columns, rings, a diagonal or random blocks). The source
 * is rendered once per slice at evenly spaced delays, and every output pixel
 * takes the slice nearest its delay (hard steps) or blends the two nearest
 * (smooth). Weights always sum to one, so coverage is preserved.
 *
 * No history is stored: each slice is the source evaluated at an earlier
 * phase. The source loops, so the result loops exactly, seeks instantly and
 * exports in any order.
 */
import type { Layer } from '../shared/types';

export const SLIT_SHAPES = ['Rows', 'Columns', 'Rings', 'Diagonal', 'Blocks'];

export function supportsSlitScan(layer: Pick<Layer, 'kind' | 'params'>): boolean {
  return layer.kind !== 'graphic' && !(layer.kind === 'livingink' && layer.params.inkMode === 2);
}

export function slitActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsSlitScan(layer) && ((layer.params.slitShift ?? 0) !== 0 || !!layer.modulations.slitShift);
}

/** Delay in frames of each slice, from now (0) to the full span. */
export function sliceDelays(layer: Pick<Layer, 'params'>): number[] {
  const count = Math.max(2, Math.round(layer.params.slitSlices ?? 12));
  const span = Math.abs(layer.params.slitShift ?? 0) * (layer.params.slitSpan ?? 30);
  return Array.from({ length: count }, (_, i) => span * i / (count - 1));
}

export const slitFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uAccum, uSource;
uniform float uIndex, uCount, uSmooth, uShape, uBlocks, uScroll, uAspect, uReverse, uSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
// 0 = now, 1 = the full span ago.
float delayMap(vec2 uv) {
  vec2 p = (uv - .5) * vec2(uAspect, 1.);
  float d;
  if (uShape < .5) d = 1. - uv.y;
  else if (uShape < 1.5) d = uv.x;
  else if (uShape < 2.5) d = length(p) / length(vec2(uAspect, 1.) * .5);
  else if (uShape < 3.5) d = (uv.x * uAspect + (1. - uv.y)) / (uAspect + 1.);
  else d = hash(floor(uv * vec2(uBlocks * uAspect, uBlocks)));
  if (uReverse > .5) d = 1. - d;
  // Integer scroll cycles per loop, so the map returns to its start.
  return fract(clamp(d, 0., .9999) + uScroll);
}
float cumulative(float position, float edge, float width) {
  return clamp((position - edge) / width + .5, 0., 1.);
}
void main() {
  float position = delayMap(vUv) * (uCount - 1.);
  // Hard steps: band membership, anti-aliased over one pixel. The first and
  // last bands extend outward so the weights always sum to one.
  float width = max(fwidth(position), 1e-4);
  float lower = uIndex < .5 ? 1. : cumulative(position, uIndex - .5, width);
  float upper = uIndex > uCount - 1.5 ? 0. : cumulative(position, uIndex + .5, width);
  float hard = lower - upper;
  // Smooth: linear interpolation between the two nearest slices.
  float soft = max(0., 1. - abs(position - uIndex));
  float weight = mix(hard, soft, uSmooth);
  gl_FragColor = texture2D(uAccum, vUv) + texture2D(uSource, vUv) * weight;
}`;
