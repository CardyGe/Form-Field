/**
 * Signal path: VHS, Dropout, CRT, JPEG damage and Databend finishes.
 *
 * Each damages the finished layer like a worn broadcast or a broken file. This file holds the rules for when the
 * pass runs, which stages it runs and the choices, so they can be tested apart from the shader.
 */
import type { Layer } from '../shared/types';

export const CRT_MASKS = ['None', 'Stripes', 'Slots', 'Dots'];
export const CRT_BEZELS = ['Transparent', 'Black'];
export const DROP_FILLS = ['Black', 'Noise', 'Hold line'];
export const DATABEND_MODES = ['Echo', 'Comb', 'Fold', 'Stutter', 'Corrupt'];
export const DATABEND_AXES = ['Across', 'Down', 'Wrap'];

type SignalStage = 'databend' | 'jpeg' | 'vhs' | 'drop' | 'crt';
/** Pass order: file damage first, then tape, dropouts and finally the screen showing it. */
const STAGES: { stage: SignalStage; amount: string }[] = [
  { stage: 'databend', amount: 'databendAmount' },
  { stage: 'jpeg', amount: 'jpegAmount' },
  { stage: 'vhs', amount: 'vhsAmount' },
  { stage: 'drop', amount: 'dropAmount' },
  { stage: 'crt', amount: 'crtAmount' },
];
const AMOUNTS = STAGES.map(item => item.amount);

/** A tiled pattern's source is a tile, not the frame, so it cannot take frame-wide damage. */
export function supportsSignal(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

const amountOn = (layer: Pick<Layer, 'params' | 'modulations'>, key: string) => (layer.params[key] ?? 0) > 0 || !!layer.modulations[key];

export function signalActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsSignal(layer) && AMOUNTS.some(key => amountOn(layer, key));
}

/** The stages that run for this layer, in pass order. */
export function signalStages(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): SignalStage[] {
  if (!supportsSignal(layer)) return [];
  return STAGES.filter(item => amountOn(layer, item.amount)).map(item => item.stage);
}

/** The loop frame for a loop phase in radians: the nearest frame, with the closing frame mapped back to 0. */
export function loopFrame(wrapped: number, frames: number): number {
  const count = Math.max(1, Math.round(frames));
  return Math.round(wrapped / (Math.PI * 2) * count) % count;
}

/**
 * Barrel distortion of the CRT glass: maps a screen uv to the source uv it shows. The centre stays put and points
 * are pushed out by `c + d * (1 + curve * |d|²)`, with `d = uv - .5` measured in frame heights (x times the aspect,
 * width over height), so the bulge is round on any frame. `crtFragment` runs the same maths.
 */
export function crtCurve(uv: [number, number], curve: number, aspect = 1): [number, number] {
  if (curve <= 0) return [uv[0], uv[1]];
  const dx = (uv[0] - .5) * aspect, dy = uv[1] - .5, push = 1 + curve * (dx * dx + dy * dy);
  return [.5 + dx * push / aspect, .5 + dy * push];
}

const VHS_OWN = ['vhsTracking', 'vhsBleed', 'vhsNoise', 'vhsHeadSwitch', 'vhsAge', 'vhsRoll'];
const DROP_OWN = ['dropChance', 'dropBands', 'dropFill', 'dropBurst'];
const CRT_OWN = ['crtCurve', 'crtLines', 'crtLineDepth', 'crtMask', 'crtMaskSize', 'crtCorners', 'crtBezel', 'crtBrightness'];
const JPEG_OWN = ['jpegQuality', 'jpegBlock', 'jpegChroma', 'jpegGlitch', 'jpegGlitchSwaps'];
const DATABEND_OWN = ['databendMode', 'databendAxis', 'databendDistance', 'databendRepeats', 'databendFeedback', 'databendSplit', 'databendDepth', 'databendCycles'];

/** Whether a signal control applies, given the layer's other choices. The amounts are always shown; unknown keys are not. */
export function signalControlVisible(layer: Pick<Layer, 'params' | 'modulations'>, key: string): boolean {
  const p = layer.params;
  if (AMOUNTS.includes(key)) return true;
  if (VHS_OWN.includes(key)) return amountOn(layer, 'vhsAmount');
  if (DROP_OWN.includes(key)) return amountOn(layer, 'dropAmount');
  if (CRT_OWN.includes(key)) {
    if (!amountOn(layer, 'crtAmount')) return false;
    if (key === 'crtMaskSize') return Math.round(p.crtMask ?? 0) !== 0;
    return true;
  }
  if (JPEG_OWN.includes(key)) {
    if (!amountOn(layer, 'jpegAmount')) return false;
    if (key === 'jpegGlitchSwaps') return (p.jpegGlitch ?? 0) > 0;
    return true;
  }
  if (DATABEND_OWN.includes(key)) {
    if (!amountOn(layer, 'databendAmount')) return false;
    const mode = Math.round(p.databendMode ?? 0);
    if (key === 'databendRepeats' || key === 'databendFeedback') return mode === 0 || mode === 1;
    if (key === 'databendCycles') return mode === 1 || mode === 3;
    return true;
  }
  return false;
}

/**
 * Shared by the stage programs. `uLines` is 1080-line pixels per output pixel. Randomness is placed on tape lines
 * and grain cells two 1080-line pixels across, counted from the frame's top-left: VHS holds well under 540 lines,
 * and a cell this size covers whole pixels of a 960 preview and of a 4K export alike, so the two match once the
 * export is averaged down. All randomness is a stateless hash of the seed (wrapped to 0..999), a place and the loop frame.
 */
const signalCommon = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uSize;
uniform float uLines, uSeed, uFrame, uAmount;
uvec3 pcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// 0..1 for whole numbers a, b and c, under this layer's seed.
float rnd(float a, float b, float c, uint salt) {
  uvec3 h = pcg(uvec3(uint(a), uint(b) + uint(c) * 4099u, uint(uSeed * 64.) * 64u + salt));
  return float(h.x) / 4294967296.;
}
// Distance from the frame's top in output pixels, the tape line (0..539) and the grain column.
float fromTop() { return uSize.y - gl_FragCoord.y; }
float tapeLine() { return floor(fromTop() * uLines * .5); }
float grainColumn() { return floor(gl_FragCoord.x * uLines * .5); }
`;

/**
 * VHS: worn videotape, in linear light. Rows wobble and now and then tear sideways, the colour part of a broadcast
 * split smears along the row while brightness stays sharp, noisy bands drift through, the bottom edge tears where the
 * heads switch, a rolling bar crosses `uRoll` whole times per loop, and tape age desaturates, warms and fades the picture.
 * Rows move by whole output pixels, so a moved row is the plain row exactly, with its alpha.
 * Moved rows carry their alpha, and every added light is scaled by coverage, so nothing appears where the layer is
 * empty. Light is never clamped above; only negative values from the colour split are cut.
 */
export const vhsFragment = signalCommon + /* glsl */`
uniform float uPhase, uTracking, uBleed, uNoise, uHead, uAge, uRoll;
const float TAU = 6.28318530718;
// The colour difference parts of BT.601, on premultiplied light.
vec2 chroma(vec3 c) { float y = dot(c, vec3(.299, .587, .114)); return vec2(.492 * (c.b - y), .877 * (c.r - y)); }
vec3 fromSplit(float y, vec2 uv) { return vec3(y + 1.140 * uv.y, y - .395 * uv.x - .581 * uv.y, y + 2.032 * uv.x); }
// A pixel of this row, the edge pixel repeating past the frame's sides.
vec4 along(float x) { return texture2D(uSource, vec2(clamp(x, .5, uSize.x - .5) / uSize.x, vUv.y)); }
void main() {
  vec4 plain = texture2D(uSource, vUv);
  float row = tapeLine(), k = 1. / uLines, frame = floor(uFrame + .5), shift = 0.;
  if (uTracking > 0.) shift += (rnd(row, frame, 0., 1u) - .5) * 80. * uTracking * k;
  // Rare rows tear up to 40% of the frame width.
  if (rnd(row, frame, 0., 2u) < .04 * uTracking * uTracking) shift += (rnd(row, frame, 0., 3u) - .5) * .8 * uSize.x;
  // Head switching: the bottom 8% times the amount, pulled further sideways toward the bottom.
  float strip = 540. * .08 * uHead, headTop = 540. - strip;
  bool head = uHead > 0. && row >= headTop;
  if (head) shift += uSize.x * (.01 + .05 * (row - headTop) / strip + .02 * (rnd(row, frame, 0., 4u) - .5));
  // Rolling bar: a soft band, its centre moving down the frame a whole number of times per loop.
  float bar = 0.;
  if (uRoll > 0.) {
    float d = fromTop() / uSize.y - fract(uRoll * uPhase / TAU + rnd(0., 0., 0., 5u));
    d -= floor(d + .5);
    bar = abs(d) < .06 ? .5 + .5 * cos(3.14159265 * d / .06) : 0.;
    shift += bar * (rnd(row, frame, 0., 6u) - .5) * 12. * k;
  }
  float x = gl_FragCoord.x - floor(shift + .5);
  vec4 c = along(x);
  vec3 rgb = c.rgb;
  if (uBleed > 0.) {
    // Colour per unit of coverage, blurred along the row, then laid back on this pixel's own coverage. Taps sit at
    // most 2 output pixels apart (at least 32 of them), so a 4K export samples the same triangle as finely as 1080p.
    float radius = 60. * uBleed * k, total = 0., cover = 0.;
    int taps = int(clamp(ceil(radius), 32., 128.));
    vec2 split = vec2(0.);
    for (int i = 0; i < 128; i++) {
      if (i >= taps) break;
      float o = (float(i) + .5) / float(taps) * 2. - 1., w = 1. - abs(o);
      vec4 s = along(x + o * radius);
      split += w * chroma(s.rgb); cover += w * s.a; total += w;
    }
    vec2 own = cover > 1e-5 ? split / cover * c.a : vec2(0.);
    rgb = max(fromSplit(dot(c.rgb, vec3(.299, .587, .114)), own), 0.);
  }
  float grain = rnd(grainColumn(), row, frame, 7u) - .5, noise = 0.;
  // Noise bands: up to twelve per frame, each 2 to 12 pixels of a 1080-line frame tall (1 to 6 tape lines).
  int bands = int(ceil(uNoise * 12.));
  for (int i = 0; i < 12; i++) {
    if (i >= bands) break;
    float top = floor(rnd(float(i), frame, 0., 8u) * 540.), tall = 1. + floor(rnd(float(i), frame, 0., 9u) * 6.);
    if (row >= top && row < top + tall) noise = max(noise, (.3 + .7 * rnd(float(i), frame, 0., 10u)) * uNoise);
  }
  rgb += grain * noise * .8 * c.a;
  if (head) rgb += (rnd(grainColumn(), row, frame, 11u) - .5) * uHead * .5 * c.a;
  rgb += ((rnd(grainColumn(), row, frame, 12u) - .5) * .5 + .06) * bar * c.a;
  if (uAge > 0.) {
    float y = dot(rgb, vec3(.299, .587, .114));
    rgb = mix(vec3(y), rgb, 1. - .45 * uAge);
    rgb *= vec3(1. + .12 * uAge, 1. + .02 * uAge, 1. - .18 * uAge);
    // Faded: the darks lift a little and the lights sink, inside coverage only.
    rgb = mix(rgb, rgb * .88 + .03 * c.a, uAge);
  }
  gl_FragColor = mix(plain, vec4(max(rgb, 0.), c.a), uAmount);
}`;

/**
 * Dropout: bands of the picture drop out. A frame starts an event when the hash of that frame is under the chance;
 * an event lasts `uBurst` frames and drops the bands its start frame chose, at least one. So a frame is dropped when
 * any of the last `uBurst` frames, counted around the loop, started an event, and seeks and the loop seam repeat.
 * Black and Noise fill only where the layer has coverage; Hold line repeats the last row above the dropped run,
 * carrying its alpha.
 */
export const dropFragment = signalCommon + /* glsl */`
uniform float uFrames, uChance, uBands, uFill, uBurst;
bool dropsBand(int start, float band) {
  float s = float(start);
  return rnd(s, band, 0., 21u) < .5 || band == floor(rnd(s, 0., 0., 22u) * uBands);
}
bool dropped(float band) {
  int frames = max(1, int(uFrames + .5)), frame = int(uFrame + .5);
  for (int k = 0; k < 8; k++) {
    if (float(k) >= uBurst) break;
    // Both operands stay non-negative: % of a negative int is undefined in GLSL ES 3.00. frame < frames and k < 8.
    int start = (frame - k + 8 * frames) % frames;
    if (rnd(float(start), 0., 0., 20u) < uChance && dropsBand(start, band)) return true;
  }
  return false;
}
void main() {
  vec4 plain = texture2D(uSource, vUv);
  float band = floor(fromTop() * uBands / uSize.y);
  if (!dropped(band)) { gl_FragColor = plain; return; }
  int fill = int(uFill + .5);
  vec4 result = vec4(0., 0., 0., plain.a);
  if (fill == 1) result.rgb = vec3(rnd(grainColumn(), tapeLine(), floor(uFrame + .5), 23u)) * plain.a;
  else if (fill == 2) {
    float top = band;
    for (int i = 0; i < 20; i++) { if (top <= 0. || !dropped(top - 1.)) break; top -= 1.; }
    // The last output row above the run, or the top row when the run starts at the top.
    float above = top <= 0. ? 0. : ceil(top * uSize.y / uBands - .5) - 1.;
    result = texture2D(uSource, vec2(vUv.x, 1. - (above + .5) / uSize.y));
  }
  gl_FragColor = mix(plain, result, uAmount);
}`;

/**
 * CRT: an old tube screen, in linear light. The picture is bent by the barrel of the glass (`crtCurve`), crossed by
 * scan lines that follow the bent picture, seen through a colour mask on the glass, darkened toward the curved edge
 * and lifted by `uBright` to make up for the light the lines and mask take away.
 * - Scan lines are a raised cosine across each line. Each is averaged over the output pixel, and lines finer than
 *   2 output pixels fade to a flat darkening of the same mean, so they never beat against the pixel grid.
 * - The mask's cell is one triad, `uMaskSize` 1080-line pixels across, counted from the frame's top-left. Every
 *   phosphor profile has a mean of 1, so a white field keeps its mean brightness before `uBright`; each harmonic is
 *   averaged over the output pixel (a box filter), so a 960 preview matches a 4K export averaged down.
 * - Bloom: a bright beam spreads past the mask, so the mask eases off as the light rises, just enough that its
 *   brightest phosphor stays in range wherever the light is in range (judged on the unaveraged mask, so a
 *   preview and an export ease alike). The display would otherwise clip the peaks
 *   and lose light the preview keeps; light already over range shows no mask and stays over range.
 * - Outside the screen is transparent, or black where the layer has coverage: the alpha of the unwarped pixel,
 *   so a Black bezel never adds light or cover where the layer is empty. The screen edge is filtered over one output pixel.
 * Light is never clamped.
 */
export const crtFragment = signalCommon + /* glsl */`
uniform float uCurve, uScanLines, uDepth, uMask, uMaskSize, uCorners, uBezel, uBright;
const float PI = 3.14159265359;
// crtCurve in signal.ts: d is measured in frame heights from the centre.
vec2 curved(vec2 uv) {
  if (uCurve <= 0.) return uv;
  vec2 aspect = vec2(uSize.x / uSize.y, 1.), d = (uv - .5) * aspect;
  return .5 + d * (1. + uCurve * dot(d, d)) / aspect;
}
// The share of a cosine of this period, in output pixels, left after averaging over one output pixel.
float boxed(float period) { float w = PI / max(period, 1e-3); return sin(w) / w; }
// A phosphor of a period of this many output pixels at phase x (in periods): (1 + cos)² / 1.5, mean 1, peak at x = 0.
float phosphor(float x, float period) {
  float t = 2. * PI * x;
  return 1. + 4. / 3. * boxed(period) * cos(t) + 1. / 3. * boxed(period * .5) * cos(2. * t);
}
// The colour mask at a place in output pixels from the frame's top-left, and the most any phosphor of it reaches
// before averaging over the pixel, so bloom eases a preview and an export alike.
vec3 screenMask(vec2 p, out float most) {
  most = 1.;
  int kind = int(uMask + .5);
  if (kind == 0) return vec3(1.);
  float cell = uMaskSize / uLines;
  vec2 at = p / cell;
  vec3 m = vec3(phosphor(at.x, cell), phosphor(at.x - 1. / 3., cell), phosphor(at.x - 2. / 3., cell));
  most = 8. / 3.;
  // Slots: each column of triads is cut into slots, neighbouring columns half a slot apart. The cut averages to
  // nothing down a column, so the mean holds.
  if (kind == 2) {
    m *= 1. - .7 * boxed(cell) * boxed(2. * cell) * cos(2. * PI * at.y) * cos(PI * (at.x - 1. / 3.));
    most *= 1.7;
  }
  // Dots: a triad of round dots, green half a row from red and blue. Rows and columns average apart, so the mean holds.
  else if (kind == 3) {
    m *= vec3(phosphor(at.y, cell), phosphor(at.y - .5, cell), phosphor(at.y, cell));
    most *= most;
  }
  return m;
}
void main() {
  vec4 plain = texture2D(uSource, vUv);
  vec2 s = curved(vUv);
  // How far s moves per output pixel, along each source axis: the edge distance and line size in output pixels.
  vec2 rate = max(vec2(length(vec2(dFdx(s.x), dFdy(s.x))), length(vec2(dFdx(s.y), dFdy(s.y)))), vec2(1e-7));
  vec2 edge = clamp(min(s, 1. - s) / rate + .5, 0., 1.);
  float screen = edge.x * edge.y;
  vec2 texel = .5 / uSize;
  vec4 c = texture2D(uSource, clamp(s, texel, 1. - texel));
  // Scan lines down the bent picture, bright at each line's middle.
  float line = (1. - s.y) * uScanLines, period = 1. / (uScanLines * rate.y);
  float keep = boxed(period) * clamp((period - 2.) * 4., 0., 1.);
  float lines = 1. - uDepth * .5 * (1. - keep * cos(2. * PI * (line - .5)));
  // Corners: a smooth falloff from the curved edge, 1 at the centre.
  float inner = pow(clamp(16. * s.x * (1. - s.x) * s.y * (1. - s.y), 0., 1.), .3);
  vec3 light = c.rgb * lines * (1. - uCorners * (1. - inner)) * uBright;
  float most, peak = max(max(light.r, light.g), light.b);
  vec3 m = screenMask(vec2(gl_FragCoord.x, fromTop()), most);
  // Bloom: the share of the mask that keeps the brightest phosphor at 1 or under; all of it for dim light.
  float bloom = peak * most <= 1. ? 1. : clamp((1. / peak - 1.) / (most - 1.), 0., 1.);
  vec4 tube = vec4(light * (1. + bloom * (m - 1.)), c.a);
  vec4 outside = vec4(0., 0., 0., uBezel > .5 ? plain.a : 0.);
  gl_FragColor = mix(plain, mix(outside, tube, screen), uAmount);
}`;
