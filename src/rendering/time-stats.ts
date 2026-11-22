/**
 * Statistical time modes: Echo, Median, Darkest and Brightest.
 *
 * Every slice is the looping source at another phase, combined per channel in
 * linear premultiplied light. Red, green and blue may remember different
 * numbers of slices, while alpha always uses them all. With equal counts every
 * mode keeps straight colour within its samples on its own. With unequal counts
 * a channel can outlast the coverage, so it is held to the brightest straight
 * colour among the slices it combined. Light with no coverage has no straight
 * colour and passes through, as in the colour split and Colour lag.
 */
import type { Layer } from '../shared/types';
import { slitActive } from './slitscan';

export const TIME_ECHO = 1, TIME_MEDIAN = 2, TIME_DARKEST = 3, TIME_BRIGHTEST = 4;
/** The most slices Median combines, which sizes the shader's sort arrays. */
export const MEDIAN_DEPTH = 9;

/** The time mode a parameter value selects. */
export const timeMode = (value: number | undefined): number => Math.max(0, Math.min(4, Math.round(value ?? 0)));

export interface TimeTargetNeeds { median: boolean; statBound: boolean; colourLag: boolean; driver: boolean }

/** Which optional time targets these layers can use at some phase of the loop. */
export function timeTargetNeeds(layers: readonly Layer[]): TimeTargetNeeds {
  const needs: TimeTargetNeeds = { median: false, statBound: false, colourLag: false, driver: false };
  for (const layer of layers) {
    if (!layer.visible || !slitActive(layer)) continue;
    const p = layer.params, m = layer.modulations;
    const modes = m.slitMode ? [0, TIME_ECHO, TIME_MEDIAN, TIME_DARKEST, TIME_BRIGHTEST] : [timeMode(p.slitMode)];
    if (modes.includes(TIME_MEDIAN)) needs.median = true;
    if (modes.some(mode => mode === TIME_ECHO || mode === TIME_DARKEST || mode === TIME_BRIGHTEST) && ((p.slitReach ?? 1) < 1 || !!m.slitReach)) needs.statBound = true;
    if (!modes.includes(0)) continue;
    if ((p.slitChroma ?? 0) > 0 || !!m.slitChroma) needs.colourLag = true;
    const shape = p.slitShape ?? 0;
    if ((shape >= 4.5 && shape < 5.5) || !!m.slitShape) needs.driver = true;
  }
  return needs;
}

export const timeGatherFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uAccum, uSource, uBoundMap, uLightMap;
uniform float uMode, uFirst, uLast, uBounded, uAlphaWeight;
// Per channel: whether it remembers this slice, and its Echo weight.
uniform vec3 uKeep, uWeights;
void main() {
  vec4 source = texture2D(uSource, vUv);
  // Below this a sample is light with no coverage, as in the colour split.
  bool covered = source.a > .001;
#if defined(GATHER_BOUND)
  // Brightest straight colour each channel combines; drawn with MAX blending.
  gl_FragColor = vec4((covered ? source.rgb / source.a : vec3(0.)) * uKeep, 1.);
#elif defined(GATHER_LIGHT)
  // Light with no coverage: summed for Echo, the brightest for the other modes.
  vec3 light = covered ? vec3(0.) : source.rgb;
  gl_FragColor = vec4(light * (uMode < 1.5 ? uWeights : uKeep), 1.);
#else
  vec4 accum = texture2D(uAccum, vUv), result;
  if (uMode < 1.5) result = accum + vec4(source.rgb * uWeights, source.a * uAlphaWeight);
  else if (uFirst > .5) result = source;
  else if (uMode < 3.5) result = vec4(mix(accum.rgb, min(accum.rgb, source.rgb), uKeep), min(accum.a, source.a));
  else result = vec4(mix(accum.rgb, max(accum.rgb, source.rgb), uKeep), max(accum.a, source.a));
  if (uLast > .5 && uBounded > .5) {
    vec3 limit = result.a * texture2D(uBoundMap, vUv).rgb, light = texture2D(uLightMap, vUv).rgb;
    result.rgb = uMode < 1.5 ? min(result.rgb - light, limit) + light : min(result.rgb, max(limit, light));
  }
  gl_FragColor = result;
#endif
}`;

export const timeMedianFragment = /* glsl */`
precision highp float;
precision highp sampler2DArray;
varying vec2 vUv;
uniform sampler2DArray uLayers;
uniform float uCount, uBounded;
// How many slices red, green and blue remember.
uniform vec3 uChannels;
float middle(float v[${MEDIAN_DEPTH}], int n) {
  for (int i = 1; i < n; i++) {
    float value = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > value) { v[j + 1] = v[j]; j--; }
    v[j + 1] = value;
  }
  return (n & 1) == 1 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) * .5;
}
void main() {
  int count = int(uCount + .5);
  ivec3 channels = ivec3(uChannels + .5);
  float r[${MEDIAN_DEPTH}], g[${MEDIAN_DEPTH}], b[${MEDIAN_DEPTH}], a[${MEDIAN_DEPTH}];
  vec3 bound = vec3(0.), light = vec3(0.);
  for (int i = 0; i < count; i++) {
    vec4 s = texture(uLayers, vec3(vUv, float(i)));
    r[i] = s.r; g[i] = s.g; b[i] = s.b; a[i] = s.a;
    vec3 keep = vec3(i < channels.r, i < channels.g, i < channels.b);
    if (s.a > .001) bound = max(bound, s.rgb / s.a * keep);
    else light = max(light, s.rgb * keep);
  }
  vec4 result = vec4(middle(r, channels.r), middle(g, channels.g), middle(b, channels.b), middle(a, count));
  if (uBounded > .5) result.rgb = min(result.rgb, max(result.a * bound, light));
  gl_FragColor = result;
}`;
