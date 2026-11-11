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
  return layer.kind !== 'graphic' && !(layer.kind === 'livingink' && layer.params.inkMode === 2);
}

export function feedbackActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsFeedback(layer) && ((layer.params.echo ?? 0) > 0 || !!layer.modulations.echo);
}

export const feedbackFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource, uPrevious;
uniform float uAspect, uZoom, uRotate, uFade, uHue, uWarp, uMode, uHole, uWindow;
uniform vec2 uDrift;
const vec3 LUMA = vec3(.2126, .7152, .0722);
// Rotation about the grey axis: turns hue, keeps luminance-ish and stays linear,
// so it works directly on premultiplied colour.
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(.57735026919);
  float cs = cos(a), sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1. - cs);
}
float luma(vec2 uv) { return dot(texture2D(uPrevious, uv).rgb, LUMA); }
void main() {
  // Inverse of: scale by zoom, turn by rotate, then move by drift (height units).
  vec2 p = (vUv - .5) * vec2(uAspect, 1.) - uDrift;
  float c = cos(uRotate), s = sin(uRotate);
  p = mat2(c, -s, s, c) * p / max(uZoom, .001);
  vec2 uv = p / vec2(uAspect, 1.) + .5;
  if (uWarp > 0.) {
    // Slope of the echo's brightness, measured over a fixed fraction of the
    // frame so the melt looks the same at preview and export sizes.
    vec2 e = vec2(1.5 / (1080. * uAspect), 1.5 / 1080.);
    vec2 g = vec2(luma(uv + vec2(e.x, 0.)) - luma(uv - vec2(e.x, 0.)), luma(uv + vec2(0., e.y)) - luma(uv - vec2(0., e.y)));
    uv -= uWarp * .006 * g / (length(g) + .02) / vec2(uAspect, 1.);
  }
  vec4 moved = any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.))) ? vec4(0.) : texture2D(uPrevious, uv);
  moved.rgb = max(hueRotate(moved.rgb, uHue), vec3(0.));
  vec4 echo = moved * uFade;
  vec4 source = texture2D(uSource, vUv);
  // Frame-shaped cut-outs: a hole turns the source into a border whose echoes
  // nest inward (zoom below 1); a window keeps only the centre, whose echoes
  // stream outward (zoom above 1).
  vec2 q = abs(vUv - .5) * 2.;
  float edge = max(q.x, q.y), aa = 1.5 / 1080.;
  if (uHole > 0.) source *= smoothstep(uHole - aa, uHole + aa, edge);
  if (uWindow > 0.) source *= 1. - smoothstep(uWindow - aa, uWindow + aa, edge);
  vec4 over = source + echo * (1. - source.a);
  // Mix: where the source is opaque, blend towards the echo so trails show
  // across it; where it is transparent, the echo shows through as in Behind.
  // Both are convex blends of premultiplied colour, so coverage stays within 1.
  if (uMode < .5) gl_FragColor = mix(over, moved, uFade * source.a);
  else if (uMode < 1.5) gl_FragColor = over;
  else gl_FragColor = max(source, echo);
}`;
