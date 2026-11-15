/**
 * Paint: movement lays wet paint on a canvas that keeps its history.
 * Style reference: Memo Akten, Body Paint.
 *
 * Three things make it read as paint rather than as marks:
 *   - a wind field: gestures leave momentum behind, so paint keeps flowing and smearing;
 *   - a wash: movement soaks soft colour into the canvas under the strokes;
 *   - strokes: particles that follow the wind, from fine hairs to broad bristled marks.
 *
 * Particles live in two float textures:
 *   A: position xy (uv), velocity xy (uv per second)
 *   B: age 0..1, life in seconds (0 = resting), colour position 0..1, random seed
 */
const ASPECT = 'vec2(16. / 9., 1.)';
const common = /* glsl */`
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
// A slowly turning swirl with no sources or sinks, in two sizes.
vec2 swirl(vec2 p, float t) {
  p *= ${ASPECT};
  vec2 a = vec2(cos(p.y * 7. + t * .31) * sin(p.x * 5. - t * .23), -cos(p.x * 5. - t * .23) * sin(p.y * 7. + t * .31));
  vec2 b = vec2(cos(p.y * 17. - t * .47) * sin(p.x * 13. + t * .37), -cos(p.x * 13. + t * .37) * sin(p.y * 17. - t * .47));
  return a + b * .45;
}`;
const palette = /* glsl */`
uniform vec3 uPalette[5];
vec3 pigment(float c) {
  c = fract(c) * 5.;
  int i = int(mod(floor(c), 5.));
  return mix(uPalette[i], uPalette[i == 4 ? 0 : i + 1], smoothstep(.25, .75, fract(c)));
}`;

/** Wind: where gestures push it, it takes their speed; then it carries itself along, spreads and dies down. uv per second. */
export const windFragment = /* glsl */`
uniform sampler2D uWind, uFlow; uniform float uStep, uPush, uCalm; uniform vec2 uTexel;
void main() {
  vec2 here = texture2D(uWind, vUv).xy;
  vec2 p = vUv - here * uStep;
  vec2 w = texture2D(uWind, p).xy;
  vec2 around = (texture2D(uWind, p + vec2(uTexel.x, 0.)).xy + texture2D(uWind, p - vec2(uTexel.x, 0.)).xy
    + texture2D(uWind, p + vec2(0., uTexel.y)).xy + texture2D(uWind, p - vec2(0., uTexel.y)).xy) * .25;
  w = mix(w, around, .5);
  vec3 flow = texture2D(uFlow, vUv).rgb;
  w = mix(w, flow.rg * 30. * uPush, clamp(flow.b * uStep * 30., 0., 1.));
  w *= exp(-uStep * uCalm);
  float border = smoothstep(0., .04, min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y)));
  gl_FragColor = vec4(clamp(w, vec2(-1.5), vec2(1.5)) * border, 0., 1.);
}`;

/** Flight, death and birth. Birth chance repeats birthChance() in maths.ts. */
export const particleFragment = /* glsl */`
layout(location = 1) out highp vec4 outB;
uniform sampler2D uA, uB, uFlow, uWind;
uniform float uStep, uTime, uSeed, uResponse, uStroke, uSpread, uColourChange;
${common}
void main() {
  vec4 A = texture2D(uA, vUv), B = texture2D(uB, vUv);
  vec2 pos = A.xy, vel = A.zw; float age = B.x, life = B.y, colour = B.z, seed = B.w;
  if (life > 0. && age < 1.) {
    // A stroke is carried by the wind and turned by the swirl, so it curves instead of flying straight.
    vec2 wind = texture2D(uWind, pos).xy;
    vec2 carried = wind * 1.15 + swirl(pos + seed, uTime) * length(wind * ${ASPECT}) * .55 / ${ASPECT};
    vel = mix(vel, carried, 1. - exp(-3. * uStep));
    pos += vel * uStep; vel *= exp(-.8 * uStep); age += uStep / life;
    if (any(lessThan(pos, vec2(-.05))) || any(greaterThan(pos, vec2(1.05)))) age = 1.;
  } else {
    // Resting: look at one random place. The more it moves there, the likelier a stroke starts.
    vec2 q = vec2(hash(vUv * 61. + uSeed * 17.), hash(vUv.yx * 47. + uSeed * 29. + 3.1));
    vec3 flow = texture2D(uFlow, q).rgb;
    float chance = clamp(flow.b * uResponse * uStep * 5., 0., 1.);
    life = 0.; age = 1.; pos = vec2(-1.); vel = vec2(0.);
    if (hash(vUv * 83. + uSeed * 41. + 7.7) < chance) {
      float r1 = hash(vUv * 19. + uSeed * 5.3), r2 = hash(vUv * 23. + uSeed * 11.9), r3 = hash(vUv * 31. + uSeed * 2.7);
      // Direction comes mostly from the wind, which is the movement smoothed over space and time. Measured
      // point by point, movement reads as pushing straight out of every edge, which gives fur instead of strokes.
      vec2 wind = texture2D(uWind, q).xy * ${ASPECT};
      vec2 moved = wind + flow.rg * ${ASPECT} * 30. * .3;
      float amount = length(moved);
      // Where there is change but no clear direction, throw paint any way round.
      float anyWay = (r3 - .5) * 6.2831853;
      vec2 heading = amount > 1e-3 ? moved / amount : vec2(cos(anyWay), sin(anyWay));
      float turn = (r1 - .5) * 2. * uSpread * .9;
      heading = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * heading;
      float speed = (.3 + .7 * r2) * uStroke * 1.6 * (.3 + .7 * clamp(amount / .3, 0., 1.));
      pos = q; vel = heading * speed / ${ASPECT};
      age = 0.; life = mix(1., 3.2, r3 * r3);
      colour = fract(uTime * uColourChange * .15 + q.x * .35 + q.y * .2 + (noise(q * 3. + uTime * .05) - .5) * .3 + (r1 - .5) * .12);
      seed = hash(vUv * 7. + uSeed);
    }
  }
  gl_FragColor = vec4(pos, vel);
  outB = vec4(age, life, colour, seed);
}`;

export const restFragment = /* glsl */`
layout(location = 1) out highp vec4 outB;
void main() { gl_FragColor = vec4(-1., -1., 0., 0.); outB = vec4(1., 0., 0., 0.); }`;

/**
 * The canvas before new strokes. Older paint is carried by the wind (which also softens it, like a wet
 * brush dragged through), fades to the ground, and takes a wash of new colour where there is movement.
 */
export const canvasFragment = /* glsl */`
uniform sampler2D uCanvas, uFlow, uWind;
uniform float uKeep, uSink, uStep, uTime, uResponse, uColourChange; uniform vec3 uGround; uniform vec2 uTexel;
${common}
${palette}
void main() {
  vec2 wind = texture2D(uWind, vUv).xy;
  float blowing = length(wind * ${ASPECT});
  vec2 carry = wind * .9 + swirl(vUv, uTime) * blowing * .45 / ${ASPECT};
  vec2 from = vUv - carry * uStep;
  vec3 old = texture2D(uCanvas, from).rgb;
  // Where paint is being moved it is wet: neighbouring colours run into each other.
  vec3 around = (texture2D(uCanvas, from + vec2(uTexel.x, 0.)).rgb + texture2D(uCanvas, from - vec2(uTexel.x, 0.)).rgb
    + texture2D(uCanvas, from + vec2(0., uTexel.y)).rgb + texture2D(uCanvas, from - vec2(0., uTexel.y)).rgb) * .25;
  old = mix(old, around, clamp(blowing * 2.5, 0., .6));
  // A proportional fade never quite arrives, and its faint tail is easy to see on a projector.
  // The small fixed step finishes it, so the wall returns to exactly the ground.
  vec3 left = (old - uGround) * uKeep;
  vec3 c = uGround + sign(left) * max(abs(left) - uSink, 0.);
  float movement = texture2D(uFlow, vUv).b;
  float where = uTime * uColourChange * .15 + vUv.x * .35 + vUv.y * .2 + (noise(vUv * 3. + uTime * .05) - .5) * .3;
  vec3 wash = pigment(where) * (.8 + .35 * noise(vUv * vec2(60., 34.) + uTime * .2));
  c = mix(c, wash, clamp(movement * uResponse * uStep * 5., 0., 1.) * .85);
  gl_FragColor = vec4(c, 1.);
}`;
export const fillFragment = /* glsl */`
uniform vec3 uGround;
void main() { gl_FragColor = vec4(uGround, 1.); }`;
export const zeroFragment = /* glsl */`void main() { gl_FragColor = vec4(0.); }`;

/** One brush mark per particle, from where it was to where it is. Most are fine; a few are broad. */
export const streakVertex = /* glsl */`
attribute vec2 ref;
uniform sampler2D uA, uB; uniform vec2 uSize; uniform float uStep, uWidth;
${palette}
varying vec4 vMark; varying vec3 vColour; varying float vAlpha;
void main() {
  vec4 A = texture2D(uA, ref), B = texture2D(uB, ref);
  if (B.y <= 0. || B.x >= 1.) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 to = A.xy * uSize, from = (A.xy - A.zw * uStep) * uSize, along = to - from;
  float reach = length(along);
  vec2 dir = reach > 1e-3 ? along / reach : vec2(1., 0.), side = vec2(-dir.y, dir.x);
  // The brush presses down, then lifts: the mark swells and tapers to a point.
  float width = uWidth * mix(.8, 11., pow(B.w, 1.5)) * mix(.3, 1., pow(sin(3.14159265 * clamp(B.x, 0., 1.)), .6));
  vec2 p = from + dir * (position.x * (reach + width) - width * .5) + side * position.y * width;
  float shade = fract(B.w * 7.31);
  vColour = pigment(B.z + (shade - .5) * .08) * (.78 + .44 * shade);
  // Along and across the mark in pixels, measured from its middle, with half its length and its width.
  vMark = vec4(position.x * (reach + width) - (reach + width) * .5, position.y * width, reach * .5, width);
  // Paint goes on as it travels and thins as the stroke ends; a stroke that has stopped leaves nothing.
  float opacity = mix(.18, .6, fract(B.w * 3.17));
  vAlpha = opacity * smoothstep(0., .08, B.x) * (1. - smoothstep(.55, 1., B.x)) * smoothstep(.15, 1.5, reach);
  gl_Position = vec4(p / uSize * 2. - 1., 0., 1.);
}`;
export const streakFragment = /* glsl */`
varying vec4 vMark; varying vec3 vColour; varying float vAlpha;
void main() {
  float width = vMark.w;
  // A rounded dab: distance from the line the brush travelled this frame. Square ends would show as bristling bars.
  float d = length(vec2(max(abs(vMark.x) - vMark.z, 0.), vMark.y)) / (width * .5);
  // Broad marks have a soft edge and show the hairs of the brush; fine ones are a single hair.
  float soft = clamp(1.5 / width + .45, 0., 1.);
  float edge = 1. - smoothstep(1. - soft, 1., d);
  float hairs = .7 + .3 * sin(vMark.y * 1.1 + vAlpha * 40.) * sin(vMark.y * .37 + vAlpha * 70.);
  gl_FragColor = vec4(vColour, edge * vAlpha * mix(1., hairs, smoothstep(4., 10., width)));
}`;
