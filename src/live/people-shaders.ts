/** Shaders for people in tracking. GLSL ES 1.00, run through Passes.material. */
import { BOX_EDGE } from './maths';

/** Above this share of the picture changing at once, it is a lighting change rather than movement. */
export const LIGHTING_CHANGE = .4;

const box = /* glsl */`
float box(vec2 p, vec4 b) {
  return smoothstep(b.x, b.x + ${BOX_EDGE}, p.x) * (1. - smoothstep(b.y - ${BOX_EDGE}, b.y, p.x))
    * smoothstep(b.z, b.z + ${BOX_EDGE}, p.y) * (1. - smoothstep(b.w - ${BOX_EDGE}, b.w, p.y));
}`;

/**
 * A new mask from the model, lined up with Tracking's camera (mirrored and cropped
 * the same way, and flipped: the model's row 0 is the top) and blended half-and-half
 * with the last one to calm flicker.
 */
export const alignFragment = /* glsl */`
uniform sampler2D uRaw, uPrevious; uniform float uMirror; uniform vec2 uCrop;
void main() {
  vec2 p = (vec2(mix(vUv.x, 1. - vUv.x, uMirror), vUv.y) - .5) * uCrop + .5;
  float raw = texture2D(uRaw, vec2(p.x, 1. - p.y)).r;
  gl_FragColor = vec4(mix(texture2D(uPrevious, vUv).r, raw, .5), 0., 0., 1.);
}`;

/**
 * Two timers per point, in seconds.
 * r: since any movement nearby, sway included. Judged against a slow memory of the
 *    picture rather than the last frame: sway is far too slow to see frame to frame,
 *    but a swaying person drifts a pixel or two from the memory, and a poster never does.
 * g: since deliberate movement, judged by how far things moved per camera frame, so a
 *    person swaying in place still reads as still.
 */
export const stillFragment = /* glsl */`
const float LIGHTING = ${LIGHTING_CHANGE.toFixed(3)};
uniform sampler2D uStill, uFlow, uLuma, uMemory, uMask, uGlobal; uniform float uStep; uniform vec2 uTexel, uLumaTexel, uStillTexel;
uniform float uAny, uDeliberate;
void main() {
  // A change over the whole picture (lights, the camera re-exposing) is not movement.
  bool lighting = texture2D(uGlobal, vec2(.5)).r > LIGHTING;
  float drift = 0., travel = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    travel = max(travel, length(texture2D(uFlow, vUv + o * uTexel).rg));
    vec2 q = vUv + o * uLumaTexel;
    drift = max(drift, abs(texture2D(uLuma, q).r - texture2D(uMemory, q).r));
  }
  float strength = drift;
  vec2 t = min(texture2D(uStill, vUv).rg + uStep, vec2(1e4));
  if (strength > uAny && !lighting) t.r = 0.;
  // Within a person, any sway anywhere keeps all of them counted: the shortest time spreads across
  // the body. It spreads only where the model sees a person, so it never reaches the wall.
  if (texture2D(uMask, vUv).r > .5) {
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 q = vUv + vec2(float(x), float(y)) * uStillTexel;
      if (texture2D(uMask, q).r > .5) t.r = min(t.r, texture2D(uStill, q).r + uStep);
    }
  }
  if (travel > uDeliberate) t.g = 0.;
  gl_FragColor = vec4(t, 0., 1.);
}`;

/** People after the filters: the area box, ignore-still, and agreement with the empty room. Zero when not ready. */
export const peopleFragment = /* glsl */`
uniform sampler2D uSmoothed, uStill, uCamera, uRoom;
uniform vec4 uBox; uniform float uIgnore, uUseRoom, uCaptured, uReady; uniform vec2 uTexel;
${box}
float ignoreStill(float since) {
  if (uIgnore < 0.) return 1.;
  return 1. - smoothstep(0., 1., clamp((since - uIgnore) / 2., 0., 1.));
}
void main() {
  float model = texture2D(uSmoothed, vUv).r;
  float room = 1.;
  if (uUseRoom > .5 && uCaptured > .5) {
    float d = 0.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 q = vUv + vec2(float(x), float(y)) * uTexel;
      d += distance(texture2D(uCamera, q).rgb, texture2D(uRoom, q).rgb);
    }
    room = smoothstep(.06, .12, d / 9.);
  }
  float people = model * box(vUv, uBox) * ignoreStill(texture2D(uStill, vUv).r) * room * uReady;
  gl_FragColor = vec4(people, 0., 0., 1.);
}`;

/**
 * How much of the picture outside people has changed from the memory at once: the share of a 16 × 9
 * grid that drifted past the movement threshold. Most of it changing together is the lights or the
 * camera re-exposing, not movement. Written to a 1 × 1 target.
 */
export const globalFragment = /* glsl */`
uniform sampler2D uLuma, uMemory, uMask; uniform float uAny;
void main() {
  float n = 0., changed = 0.;
  for (int y = 0; y < 9; y++) for (int x = 0; x < 16; x++) {
    vec2 q = (vec2(float(x), float(y)) + .5) / vec2(16., 9.);
    float w = 1. - step(.3, texture2D(uMask, q).r);
    n += w; changed += w * step(uAny, abs(texture2D(uLuma, q).r - texture2D(uMemory, q).r));
  }
  gl_FragColor = vec4(n > 8. ? changed / n : 0., 0., 0., 1.);
}`;

/** The slow memory of the picture: eases towards each new camera frame, and snaps to it on a lighting change. */
export const memoryFragment = /* glsl */`
const float LIGHTING = ${LIGHTING_CHANGE.toFixed(3)};
uniform sampler2D uMemory, uLuma, uGlobal; uniform float uRate;
void main() {
  float rate = texture2D(uGlobal, vec2(.5)).r > LIGHTING ? 1. : uRate;
  gl_FragColor = vec4(mix(texture2D(uMemory, vUv).r, texture2D(uLuma, vUv).r, rate), 0., 0., 1.);
}`;

export const fillFragment = /* glsl */`uniform vec4 uValue; void main() { gl_FragColor = uValue; }`;
export const copyFragment = /* glsl */`uniform sampler2D uImage; void main() { gl_FragColor = texture2D(uImage, vUv); }`;
