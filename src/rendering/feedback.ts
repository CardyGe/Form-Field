/**
 * Video feedback for a single layer.
 *
 * Every frame the previous output (the echo) is zoomed, turned, moved,
 * hue-shifted and faded, then the new source is drawn over it:
 *
 *   out[t] = source[t] over (fade · transform(out[t-1]))
 *
 * Loops: the fade makes the process forget where it started, so out[t] only
 * depends on the last few hundred source frames. The source is periodic, so
 * running the feedback for `warmupFrames` before the requested frame from black
 * reaches the periodic steady state to within 1/4096, and the last frame of
 * the loop flows into the first like any other pair of frames.
 */
import type { Layer } from '../shared/types';

/** The highest fade per frame. Higher values need very long warm-ups. */
export const MAX_PERSISTENCE = .97;
/** Contribution below which an old frame no longer matters (half-float precision). */
const FORGET = 1 / 4096;

export function persistence(layer: Pick<Layer, 'params'>): number {
  return MAX_PERSISTENCE * Math.max(0, Math.min(1, layer.params.echo ?? 0));
}

/** Held echoes only forget by leaving the frame, so they need outward zoom. */
export function holds(params: Record<string, number>): boolean {
  return (params.echoKeep ?? 0) > .5 && (params.echo ?? 0) > 0 && (params.echoZoom ?? 1) >= 1.005;
}

/** The fade applied to the echo every frame. */
export function echoFade(params: Record<string, number>): number {
  return holds(params) ? 1 : persistence({ params });
}

/**
 * Frames of history that still reach the picture. A fading echo forgets
 * below half-float precision; a held echo forgets once everything has zoomed
 * from the centre past the frame corners (24 times further out), with a
 * margin for glitch events that throw pixels back inward.
 */
export function historyFrames(params: Record<string, number>): number {
  if (!holds(params)) return warmupFrames(persistence({ params }));
  return Math.ceil(1.5 * Math.log(24) / Math.log(params.echoZoom));
}

/**
 * The echo controls in effect. Feedback Glitch drives the echo from its own
 * instrument controls; every other layer uses its Feedback finish.
 */
export function echoSettings(layer: Pick<Layer, 'kind' | 'params'>, phase: number): Record<string, number> {
  const p = layer.params;
  if (layer.kind !== 'glitchtunnel') return p;
  const fade = p.fade ?? 0;
  return {
    echo: fade > 0 ? 1 - .25 * fade : 1, echoKeep: fade > 0 ? 0 : 1, echoBlend: 1,
    echoZoom: p.tunnelZoom, echoRotate: (p.wobble ?? 0) * Math.sin(phase * Math.max(1, Math.round(p.cycles ?? 1))),
    echoDriftX: 0, echoDriftY: 0, echoHue: p.hueShift ?? 0, echoMelt: p.melt ?? 0, echoFrame: 0, echoWindow: 0,
    echoCentreX: p.vanishX ?? 0, echoCentreY: p.vanishY ?? 0, echoTiltX: p.tiltX ?? 0, echoTiltY: p.tiltY ?? 0, echoLens: p.lens ?? 0,
    echoRound: 0, echoSquare: 0, echoEdge: 0, echoStreak: p.streaks ?? 0, echoStreakAxis: p.streakAxis ?? 0, echoBlock: p.blocks ?? 0,
    echoSlip: p.split ?? 0, echoCrush: p.crush ?? 0, echoEvents: p.glitch ?? 0, echoColourDrift: p.colourDrift ?? 0, echoPunch: p.punch ?? 0, echoPixel: p.pixelSize ?? 0,
  };
}

/** Frames of history needed for the steady state at this persistence. */
export function warmupFrames(fade: number): number {
  if (fade <= 0) return 0;
  return Math.ceil(Math.log(FORGET) / Math.log(fade));
}

/** The loop frame a phase falls in. Exact for export phases i·2π/N. */
export function frameAtPhase(phase: number, total: number): number {
  const TAU = Math.PI * 2;
  const wrapped = ((phase % TAU) + TAU) % TAU;
  return Math.floor(wrapped / TAU * total + 1e-6) % total;
}

/** Feedback cannot run on tiled patterns (the source is a tile, not the frame)
 * or on Evolving ink, whose clip clock does not loop. */
export function supportsFeedback(layer: Pick<Layer, 'kind' | 'params'>): boolean {
  // Feedback Glitch is a feedback instrument: its echo is not a finish. Meridian keeps its own afterglow.
  return layer.kind !== 'graphic' && layer.kind !== 'glitchtunnel' && layer.kind !== 'meridian' && !(layer.kind === 'livingink' && layer.params.inkMode === 2);
}

export function feedbackActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return layer.kind === 'glitchtunnel' || supportsFeedback(layer) && ((layer.params.echo ?? 0) > 0 || !!layer.modulations.echo);
}

export const feedbackFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource, uPrevious;
uniform float uAspect, uZoom, uRotate, uFade, uHue, uWarp, uMode, uHole, uWindow;
uniform vec2 uDrift, uCentre, uTilt, uTexels;
// Glitch extras, all neutral at 0: lens bulge, rounded and squared frames,
// outward streaks, macroblock breakup, channel slip and colour crush.
uniform float uLens, uRound, uSquare, uStreak, uStreakAxis, uBlock, uSlip, uCrush, uFrame, uEdge;
// Held echoes keep full brightness; glitch events, colour drift, contrast
// push and chunky echo pixels compound over the generations.
uniform float uKeep, uEvents, uColourDrift, uPunch, uPixel;
const vec3 LUMA = vec3(.2126, .7152, .0722);
// Rotation about the grey axis: turns hue, keeps luminance-ish and stays linear,
// so it works directly on premultiplied colour.
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(.57735026919);
  float cs = cos(a), sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1. - cs);
}
float luma(vec2 uv) { return dot(texture2D(uPrevious, uv).rgb, LUMA); }
float hash(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
bool outside(vec2 uv) { return any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.))); }
// With a lens the frame edge is stretched rather than cut, so corners fill
// with smeared edge colour. With blocks the echo is read as hard pixels.
vec4 fetch(vec2 uv) {
  // Held echoes stretch the frame edge into streaks instead of cutting it.
  if (uLens != 0. || uKeep > .5) uv = clamp(uv, .5 / uTexels, 1. - .5 / uTexels);
  else if (outside(uv)) return vec4(0.);
  if (uBlock > 0. || uPixel > 0.) uv = (floor(uv * uTexels) + .5) / uTexels;
  return texture2D(uPrevious, uv);
}
// Distance outside a centred box of half-height t (height units), with
// rounded corners. Squareness 0 follows the frame's shape; 1 is a square.
float boxEdge(vec2 h, float t) {
  vec2 half_ = t * vec2(mix(uAspect, 1., uSquare), 1.);
  float r = uRound * t;
  vec2 d = abs(h) - half_ + r;
  return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r;
}
void main() {
  vec2 frame = vec2(uAspect, 1.);
  // Inverse of: perspective tilt and lens about the vanishing point, scale by
  // zoom, turn by rotate, then move by drift (all in height units).
  // Echo pixels: every pixel of a coarse cell reads the same echo point, so
  // the echoes are carried as chunky low-resolution pixels.
  vec2 at = vUv;
  if (uPixel > 0.) { float size = uPixel / 1080.; at = (floor((vUv - .5) * frame / size) + .5) * size / frame + .5; }
  vec2 p = (at - .5) * frame - uDrift - uCentre;
  float c = cos(uRotate), s = sin(uRotate);
  p = mat2(c, -s, s, c) * p / max(uZoom, .001);
  p /= max(1. + dot(uTilt, p), .2);
  // Lens, scaled so the frame corners stay put: everything inside bends
  // towards the vanishing point and never reaches beyond the frame.
  float corner = .25 * (uAspect * uAspect + 1.);
  p *= (1. + uLens * dot(p, p)) / (1. + max(uLens, 0.) * corner);
  vec2 rel = p;
  vec2 uv = (p + uCentre) / frame + .5;
  if (uWarp > 0.) {
    // Slope of the echo's brightness, measured over a fixed fraction of the
    // frame so the melt looks the same at preview and export sizes.
    vec2 e = vec2(1.5 / (1080. * uAspect), 1.5 / 1080.);
    vec2 g = vec2(luma(uv + vec2(e.x, 0.)) - luma(uv - vec2(e.x, 0.)), luma(uv + vec2(0., e.y)) - luma(uv - vec2(0., e.y)));
    uv -= uWarp * .006 * g / (length(g) + .02) / frame;
  }
  // Outward direction: from the vanishing point, or snapped to the nearest
  // side of the frame so streaks run straight up, down, left and right.
  vec2 out_ = rel / max(length(rel), 1e-4);
  if (uStreakAxis > .5) out_ = abs(rel.x) / uAspect > abs(rel.y) ? vec2(sign(rel.x), 0.) : vec2(0., sign(rel.y));
  if (uBlock > 0.) {
    // Macroblock breakup: a few blocks each frame sample one point of a
    // neighbouring block, so detail shatters into jittering squares.
    float size = uBlock / 1080.;
    vec2 cell = floor((uv - .5) * frame / size);
    if (hash(vec3(cell, uFrame)) < .12) {
      vec2 jitter = floor(vec2(hash(vec3(cell, uFrame + 17.)), hash(vec3(cell, uFrame + 41.))) * 3.) - 1.;
      uv = ((cell + .5 + jitter) * size) / frame + .5;
    }
  }
  if (uStreak > 0.) {
    // Streaks: each thin lane across the outward direction is dragged outward
    // by its own random amount, like a torn scanline. Stronger further out.
    vec2 across = vec2(-out_.y, out_.x);
    float lane = uStreakAxis > .5 ? floor(dot((vUv - .5) * frame, across) * 540.) : floor(atan(rel.y, rel.x) * 240.);
    float pull = pow(hash(vec3(lane, floor(uFrame / 3.), 7.)), 4.);
    uv -= out_ * pull * uStreak * .06 * length(rel) / frame;
  }
  // Glitch events: a few cells per beat slide sideways or up and down by a
  // large amount; the same draw later posterises or swaps their channels.
  float event = .5;
  if (uEvents > 0.) {
    vec2 cell = floor(at * vec2(40., 70.));
    // A new draw every six frames: one tear per ~20% of tunnel growth.
    float beat = floor(uFrame / 6.);
    event = hash(vec3(cell, beat));
    if (event > 1. - .06 * uEvents) uv.x += (hash(vec3(cell.yy, beat + 3.)) - .5) * .25;
    if (hash(vec3(cell.x, beat, 5.)) > 1. - .03 * uEvents) uv.y += (hash(vec3(beat, cell.x, 9.)) - .5) * .2;
  }
  vec4 moved = fetch(uv);
  if (uSlip > 0.) {
    // Horizontal, like a misaligned scanline read.
    vec2 o = vec2(uSlip * 4. / 1080., 0.) / frame;
    moved.r = fetch(uv + o).r; moved.b = fetch(uv - o).b;
  }
  moved.rgb = max(hueRotate(moved.rgb, uHue), vec3(0.));
  if (uEvents > 0.) {
    if (event > 1. - .025 * uEvents) moved.rgb = floor(moved.rgb / max(moved.a, 1e-4) * 3.) / 3. * moved.a;
    if (event < .02 * uEvents) moved.rgb = moved.gbr;
  }
  if (uColourDrift > 0.) moved.rgb = mix(moved.rgb, moved.brg, uColourDrift);
  // Contrast push about mid grey (premultiplied), clamped to the coverage.
  if (uPunch > 0.) moved.rgb = clamp((moved.rgb - .5 * moved.a) * (1. + uPunch) + .5 * moved.a, 0., moved.a);
  if (uCrush > 0.) {
    // Codec crunch: push colour towards the RGB and CMY corners. Only the
    // hue moves; brightness is kept, so the fade still forgets old echoes.
    float m = max(max(moved.r, moved.g), moved.b);
    if (m > 1e-4) {
      vec3 n = moved.rgb / m;
      moved.rgb = mix(n, step(.5, n), uCrush) * m;
    }
  }
  vec4 echo = moved * uFade;
  vec4 source = texture2D(uSource, vUv);
  // Frame-shaped cut-outs: a hole turns the source into a border whose echoes
  // nest inward (zoom below 1); a window keeps only the centre, whose echoes
  // stream outward (zoom above 1). Both sit at the vanishing point.
  vec2 h = (vUv - .5) * frame - uCentre;
  float aa = 1.5 / 1080.;
  float line = uEdge * 4. / 1080.;
  if (uHole > 0.) {
    float d = boxEdge(h, uHole * .5);
    source *= smoothstep(-aa, aa, d);
    // A dark rule just inside the hole: one per frame, so echoes nest as steps.
    if (uEdge > 0.) source = mix(source, vec4(0., 0., 0., 1.), smoothstep(-line - aa, -line + aa, d) * (1. - smoothstep(-aa, aa, d)));
  }
  if (uWindow > 0.) {
    float d = boxEdge(h, uWindow * .5);
    source *= 1. - smoothstep(-aa, aa, d);
    if (uEdge > 0.) source = mix(source, vec4(0., 0., 0., 1.), smoothstep(-aa, aa, d) * (1. - smoothstep(line - aa, line + aa, d)));
  }
  vec4 over = source + echo * (1. - source.a);
  // Mix: where the source is opaque, blend towards the echo so trails show
  // across it; where it is transparent, the echo shows through as in Behind.
  // Both are convex blends of premultiplied colour, so coverage stays within 1.
  if (uMode < .5) gl_FragColor = mix(over, moved, uFade * source.a);
  else if (uMode < 1.5) gl_FragColor = over;
  else gl_FragColor = max(source, echo);
}`;
