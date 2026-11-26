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
    // Echo has no depth; Fold works on each pixel alone, so it has no direction or distance.
    if (key === 'databendDepth') return mode !== 0;
    if (key === 'databendDistance' || key === 'databendAxis') return mode !== 2;
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
export const signalCommon = /* glsl */`
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
 * - The mask's cell is one triad, `uMaskSize` 1080-line pixels across, counted from the frame's top-left. Each
 *   phosphor is a raised cosine with a mean of 1, so a white field keeps its mean brightness before `uBright`, and
 *   every mask peaks at 2, the same at every light level. Like the scan lines, each cosine is averaged over the
 *   output pixel and fades to its flat mean below 2 output pixels, so a fine mask never beats against the pixel grid.
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
// The share of a cosine of this period, in output pixels, left after averaging over one output pixel, faded to
// nothing below 2 output pixels so it never beats against the pixel grid.
float kept(float period) { float w = PI / max(period, 1e-3); return sin(w) / w * clamp((period - 2.) * 4., 0., 1.); }
// A phosphor of a period of this many output pixels at phase x (in periods): 1 + depth * cos, mean 1, peak at x = 0.
float phosphor(float x, float period, float depth) { return 1. + depth * kept(period) * cos(2. * PI * x); }
// The colour mask at a place in output pixels from the frame's top-left. Each kind peaks at 2. Red, green and blue
// sit at the middle of each third of the cell, so at 3 output pixels a cell each pixel holds one colour.
vec3 screenMask(vec2 p) {
  int kind = int(uMask + .5);
  if (kind == 0) return vec3(1.);
  float cell = uMaskSize / uLines;
  vec2 at = p / cell;
  vec3 third = at.x - vec3(1., 3., 5.) / 6.;
  // Stripes: full-depth columns.
  if (kind == 1) return vec3(phosphor(third.r, cell, 1.), phosphor(third.g, cell, 1.), phosphor(third.b, cell, 1.));
  // Slots: shallower columns (peak 1.6), each column of triads cut into slots, neighbouring columns half a slot apart
  // (peak 1.25). The cut averages to nothing down a column, so the mean holds.
  if (kind == 2) {
    vec3 m = vec3(phosphor(third.r, cell, .6), phosphor(third.g, cell, .6), phosphor(third.b, cell, .6));
    return m * (1. - .25 * kept(cell) * kept(2. * cell) * cos(2. * PI * at.y) * cos(PI * (at.x - .5)));
  }
  // Dots: a triad of round dots, green half a row from red and blue, each axis peaking at sqrt 2. Rows and columns
  // average apart, so the mean holds.
  const float D = .41421356;
  vec3 across = vec3(phosphor(third.r, cell, D), phosphor(third.g, cell, D), phosphor(third.b, cell, D));
  return across * vec3(phosphor(at.y, cell, D), phosphor(at.y - .5, cell, D), phosphor(at.y, cell, D));
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
  float lines = 1. - uDepth * .5 * (1. - kept(period) * cos(2. * PI * (line - .5)));
  // Corners: a smooth falloff from the curved edge, 1 at the centre.
  float inner = pow(clamp(16. * s.x * (1. - s.x) * s.y * (1. - s.y), 0., 1.), .3);
  float shade = lines * (1. - uCorners * (1. - inner)) * uBright;
  vec4 tube = vec4(c.rgb * shade * screenMask(vec2(gl_FragCoord.x, fromTop())), c.a);
  vec4 outside = vec4(0., 0., 0., uBezel > .5 ? plain.a : 0.);
  gl_FragColor = mix(plain, mix(outside, tube, screen), uAmount);
}`;

/**
 * Databend's stream: where a pixel sits when the frame is read as one run of pixels along the axis. Across (0) and
 * Wrap (2) read row by row from the top-left, Down (1) column by column. Across and Down clamp at the frame's edge when
 * a tap reaches past it; Wrap runs off one row's end onto the next row. `databendFragment` runs the same maths in
 * pixels of a 1080-line frame.
 */
export function streamIndex(x: number, y: number, width: number, height: number, axis: number): number {
  return Math.round(axis) === 1 ? x * height + y : y * width + x;
}

/** The pixel at a place along the stream: the inverse of `streamIndex`. */
export function streamPixel(index: number, width: number, height: number, axis: number): [number, number] {
  if (Math.round(axis) === 1) { const x = Math.floor(index / height); return [x, index - x * height]; }
  const y = Math.floor(index / width);
  return [index - y * width, y];
}

/**
 * Databend: the frame read as one stream of pixels along the axis and bent like sound. Places and Distance are in
 * pixels of a 1080-line frame counted from the top-left (`uLines` per output pixel), so a 960 preview and a 4K
 * export bend alike; rows of the stream are one 1080-line pixel tall, and a pixel keeps its place inside its row
 * when a tap moves it to another row, so every tap is a filtered read of the same frame-fixed stream.
 * - Echo: `uRepeats` taps at whole multiples of Distance back along the stream, tap k weighted by `uFeedback` to the
 *   power k, the plain picture being tap 0, divided by the weights' sum so a flat field keeps its level. Split moves
 *   the red taps nearer and the blue ones farther, so the copies fan apart in colour.
 * - Comb: one delay line with feedback (the same taps, at multiples of one delay) whose delay swings by up to 75% of
 *   Distance times Depth, `uCycles` whole cycles per loop; Split offsets each channel's phase by up to a third of a turn.
 * - Fold: a wavefold of the 0..1 part of the straight colour around its middle, gain 1 + 7 × Depth, the curve moved
 *   per channel by Split.
 * - Stutter: the stream cut into grains of Distance; a hashed share (Depth) of them repeats the grain before or plays
 *   backwards, re-rolled `uCycles` times per loop on the loop frame, the channels read apart by Split.
 * - Corrupt: the 0..1 part of the straight colour as 8-bit sRGB codes, each bit flipped where a hashed mask says, one
 *   mask per run of Distance along the stream, each bit flipped with chance Depth; Split moves each channel's mask
 *   along the stream by up to one run, so the channels break apart.
 * Fold and Corrupt add the over-range part back and keep alpha; Echo, Comb and Stutter carry alpha with the colour (the
 * most of the three channels' reads, so light never leaves its coverage). Stutter and Corrupt place hashed cells, so
 * where an output pixel covers more than one 1080-line pixel they are averaged over the 1080-line pixels it covers.
 */
export const databendFragment = signalCommon + /* glsl */`
uniform float uPhase, uFrames, uMode, uAxis, uDistance, uRepeats, uFeedback, uSplit, uDepth, uCycles;
const float TAU = 6.28318530718;
vec2 lines() { return uSize * uLines; }
// The source at a place in 1080-line pixels from the top-left, filtered, clamped to the edge texels' centres.
vec4 fetch(vec2 p) {
  vec2 o = clamp(p / uLines, vec2(.5), uSize - .5);
  return texture2D(uSource, vec2(o.x / uSize.x, 1. - o.y / uSize.y));
}
// The source 'back' 1080-line pixels earlier along the stream than p (later when negative).
vec4 earlier(vec2 p, float back) {
  int axis = int(uAxis + .5);
  if (axis == 0) return fetch(vec2(p.x - back, p.y));
  if (axis == 1) return fetch(vec2(p.x, p.y - back));
  // Wrap: off one row's end onto the next, keeping the place inside the row; the stream's two ends clamp.
  vec2 F = lines();
  float row = floor(p.y), x = p.x - back, moved = floor(x / F.x);
  x -= moved * F.x;
  float to = row + moved;
  if (to < 0.) return fetch(vec2(0.));
  if (to >= F.y) return fetch(F);
  return fetch(vec2(x, to + p.y - row));
}
// A place along the stream cut into cells of 'size': the lane (row or column; the whole frame for Wrap), the cell
// and the offset into it, in 1080-line pixels. 'ahead' moves the place along the stream first. The cell is the one
// holding the middle of the 1080-line pixel, so every output pixel inside a 1080-line pixel takes the same cell and
// a preview reading one place per 1080-line pixel sees the cells a 4K export does.
vec3 cell(vec2 p, float size, float ahead) {
  int axis = int(uAxis + .5);
  float lane = 0., start = 0., along;
  if (axis == 0) { lane = floor(p.y); along = p.x; }
  else if (axis == 1) { lane = floor(p.x); along = p.y; }
  // Wrap: the row's start along the stream, up to about 2 million. Its whole cells are counted apart from the short
  // remainder plus the place in the row, so a fraction of a 1080-line pixel is never lost in a large float.
  else { start = floor(p.y) * lines().x; along = p.x; }
  float whole = floor(start / size), local = start - whole * size + ahead, inside = floor((local + floor(along) + .5) / size);
  return vec3(lane, max(0., whole + inside), clamp(local + along - inside * size, 0., size));
}
// Echo and Comb: taps at whole multiples of each channel's delay, weighted by the feedback to the power of the tap.
vec4 taps(vec2 p, vec3 delay) {
  int repeats = int(uRepeats + .5);
  vec3 rgb = vec3(0.);
  float a = 0., w = 1., total = 0.;
  bool split = delay.r != delay.g || delay.g != delay.b;
  for (int k = 0; k <= 8; k++) {
    if (k > repeats) break;
    vec3 back = float(k) * delay;
    vec4 g = earlier(p, back.g), r = g, b = g;
    if (split) { r = earlier(p, back.r); b = earlier(p, back.b); }
    rgb += w * vec3(r.r, g.g, b.b); a += w * max(g.a, max(r.a, b.a)); total += w;
    w *= uFeedback;
  }
  return vec4(rgb, a) / total;
}
// The straight colour of premultiplied light, split into its 0..1 part and what lies above.
void straight(vec4 c, out vec3 low, out vec3 over) {
  vec3 s = c.a > 0. ? max(c.rgb, 0.) / c.a : vec3(0.);
  low = clamp(s, 0., 1.); over = s - low;
}
// A triangle wave through 0..1: x itself inside 0..1, reflected outside. GLSL's float mod floors, so x < 0 is fine.
vec3 tri(vec3 x) { return 1. - abs(1. - mod(x, 2.)); }
vec4 fold(vec4 c) {
  if (c.a <= 0.) return c;
  vec3 low, over; straight(c, low, over);
  vec3 bent = tri(.5 + (low - .5) * (1. + 7. * uDepth) + (vec3(-1., 0., 1.) * uSplit * .5));
  return vec4((bent + over) * c.a, c.a);
}
vec3 encode(vec3 v) { return mix(12.92 * v, 1.055 * pow(v, vec3(1. / 2.4)) - .055, step(.0031308, v)); }
vec3 decode(vec3 v) { return mix(v / 12.92, pow((v + .055) / 1.055, vec3(2.4)), step(.04045, v)); }
// The bits a cell's mask flips: each of the eight with chance Depth, from 8-bit slices of one hash.
uint flips(vec3 at, uint salt) {
  uvec3 h = pcg(uvec3(uint(at.x), uint(at.y), uint(uSeed * 64.) * 64u + salt));
  uint mask = 0u, limit = uint(uDepth * 256. + .5);
  for (int b = 0; b < 8; b++) {
    uint v = ((b < 4 ? h.x : h.y) >> uint(8 * (b % 4))) & 255u;
    if (v < limit) mask |= 1u << uint(b);
  }
  return mask;
}
vec4 corrupt(vec4 c, vec2 p) {
  if (c.a <= 0.) return c;
  vec3 low, over; straight(c, low, over);
  uvec3 code = uvec3(floor(encode(low) * 255. + .5));
  float D = uDistance, ahead = uSplit * D;
  code.r ^= flips(cell(p, D, 0.), 41u);
  code.g ^= flips(cell(p, D, ahead), 41u);
  code.b ^= flips(cell(p, D, 2. * ahead), 41u);
  return vec4((decode(vec3(code & 255u) / 255.) + over) * c.a, c.a);
}
vec4 stutter(vec4 plain, vec2 p) {
  float D = uDistance;
  vec3 at = cell(p, D, 0.);
  int frames = max(1, int(uFrames + .5));
  float epoch = float(int(uFrame + .5) * int(uCycles + .5) / frames);
  if (rnd(at.x, at.y, epoch, 31u) >= uDepth) return plain;
  // Repeat the grain before, or play this one backwards.
  float back = rnd(at.x, at.y, epoch, 32u) < .5 ? D : 2. * at.z - D, spread = uSplit * D * .25;
  vec4 g = earlier(p, back), r = earlier(p, back - spread), b = earlier(p, back + spread);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}
void main() {
  vec4 plain = texture2D(uSource, vUv), bent;
  vec2 p = vec2(gl_FragCoord.x, fromTop()) * uLines;
  int mode = int(uMode + .5);
  if (mode == 0) bent = taps(p, uDistance * (1. + vec3(-1., 0., 1.) * uSplit * .25));
  else if (mode == 1) {
    vec3 turn = uCycles * uPhase + vec3(0., 1., 2.) * uSplit * TAU / 3.;
    bent = taps(p, uDistance * (1. + .75 * uDepth * sin(turn)));
  }
  else if (mode == 2) bent = fold(plain);
  else {
    // One read per 1080-line pixel the output pixel covers, up to 4 x 4.
    int n = int(clamp(ceil(uLines - .01), 1., 4.));
    bent = vec4(0.);
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      if (i >= n || j >= n) continue;
      vec2 q = p + ((vec2(float(i), float(j)) + .5) / float(n) - .5) * uLines;
      bent += mode == 3 ? stutter(plain, q) : corrupt(plain, q);
    }
    bent /= float(n * n);
  }
  gl_FragColor = mix(plain, bent, uAmount);
}`;
