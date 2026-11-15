/**
 * Paint: movement throws bristly streaks of opaque colour onto a canvas that
 * keeps its history and slowly fades. Style reference: Memo Akten, Body Paint.
 *
 * Particles live in two float textures:
 *   A: position xy (uv), velocity xy (uv per second)
 *   B: age 0..1, life in seconds (0 = resting), colour position 0..1, random seed
 */
const hash = /* glsl */`
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`;
const ASPECT = 'vec2(16. / 9., 1.)';

/** Flight, death and birth. Birth chance repeats birthChance() in maths.ts. */
export const particleFragment = /* glsl */`
layout(location = 1) out highp vec4 outB;
uniform sampler2D uA, uB, uFlow;
uniform float uStep, uTime, uSeed, uResponse, uStroke, uSpread, uColourChange;
${hash}
void main() {
  vec4 A = texture2D(uA, vUv), B = texture2D(uB, vUv);
  vec2 pos = A.xy, vel = A.zw; float age = B.x, life = B.y, colour = B.z, seed = B.w;
  if (life > 0. && age < 1.) {
    pos += vel * uStep; vel *= exp(-3. * uStep); age += uStep / life;
    if (any(lessThan(pos, vec2(-.05))) || any(greaterThan(pos, vec2(1.05)))) age = 1.;
  } else {
    // Resting: look at one random place. The more it moves there, the likelier a stroke starts.
    vec2 q = vec2(hash(vUv * 61. + uSeed * 17.), hash(vUv.yx * 47. + uSeed * 29. + 3.1));
    vec3 flow = texture2D(uFlow, q).rgb;
    float chance = clamp(flow.b * uResponse * uStep * 40., 0., 1.);
    life = 0.; age = 1.; pos = vec2(-1.); vel = vec2(0.);
    if (hash(vUv * 83. + uSeed * 41. + 7.7) < chance) {
      float r1 = hash(vUv * 19. + uSeed * 5.3), r2 = hash(vUv * 23. + uSeed * 11.9), r3 = hash(vUv * 31. + uSeed * 2.7);
      vec2 moved = flow.rg * ${ASPECT};
      float amount = length(moved);
      // Where the tracker saw change but no clear direction, throw paint any way round.
      float any = (r3 - .5) * 6.2831853;
      vec2 heading = amount > 1e-4 ? moved / amount : vec2(cos(any), sin(any));
      float turn = (r1 - .5) * 2. * uSpread * .6;
      heading = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * heading;
      float speed = (.15 + .85 * r2) * uStroke * 1.2 * (.2 + .8 * clamp(amount / .012, 0., 1.));
      pos = q; vel = heading * speed / ${ASPECT};
      age = 0.; life = mix(.25, .9, r3);
      colour = fract(uTime * uColourChange * .15 + q.x * .35 + q.y * .2 + r1 * .08);
      seed = hash(vUv * 7. + uSeed);
    }
  }
  gl_FragColor = vec4(pos, vel);
  outB = vec4(age, life, colour, seed);
}`;

export const restFragment = /* glsl */`
layout(location = 1) out highp vec4 outB;
void main() { gl_FragColor = vec4(-1., -1., 0., 0.); outB = vec4(1., 0., 0., 0.); }`;

/** The canvas before new strokes: older paint fades to the ground and drifts a little with the movement. */
export const canvasFragment = /* glsl */`
uniform sampler2D uCanvas, uFlow; uniform float uKeep, uDrift, uSink; uniform vec3 uGround;
void main() {
  vec3 old = texture2D(uCanvas, vUv - texture2D(uFlow, vUv).rg * uDrift).rgb;
  // A proportional fade never quite arrives, and its faint tail is easy to see on a projector.
  // The small fixed step finishes it, so the wall returns to exactly the ground.
  vec3 left = (old - uGround) * uKeep;
  gl_FragColor = vec4(uGround + sign(left) * max(abs(left) - uSink, 0.), 1.);
}`;
export const fillFragment = /* glsl */`
uniform vec3 uGround;
void main() { gl_FragColor = vec4(uGround, 1.); }`;

/** One streak per particle, from where it was to where it is. */
export const streakVertex = /* glsl */`
attribute vec2 ref;
uniform sampler2D uA, uB; uniform vec2 uSize; uniform float uStep, uWidth; uniform vec3 uPalette[5];
varying vec2 vAcross; varying vec3 vColour; varying float vFade;
void main() {
  vec4 A = texture2D(uA, ref), B = texture2D(uB, ref);
  if (B.y <= 0. || B.x >= 1.) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 to = A.xy * uSize, from = (A.xy - A.zw * uStep) * uSize, along = to - from;
  float reach = length(along);
  vec2 dir = reach > 1e-3 ? along / reach : vec2(1., 0.), side = vec2(-dir.y, dir.x);
  float width = uWidth * (.55 + .9 * B.w);
  vec2 p = from + dir * (position.x * (reach + width) - width * .5) + side * position.y * width;
  float c = B.z * 5., f = smoothstep(.3, .7, fract(c));
  int i = int(mod(floor(c), 5.));
  vColour = mix(uPalette[i], uPalette[i == 4 ? 0 : i + 1], f) * (.82 + .36 * B.w);
  vAcross = vec2(position.y * 2., width);
  vFade = 1. - smoothstep(.7, 1., B.x);
  gl_Position = vec4(p / uSize * 2. - 1., 0., 1.);
}`;
export const streakFragment = /* glsl */`
varying vec2 vAcross; varying vec3 vColour; varying float vFade;
void main() {
  // Solid to within about a pixel of the edge: paint covers what is under it.
  float edge = clamp((1. - abs(vAcross.x)) * vAcross.y * .5, 0., 1.);
  gl_FragColor = vec4(vColour, edge * vFade);
}`;
