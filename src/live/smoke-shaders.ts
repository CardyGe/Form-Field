/**
 * Smoke: people are made of smoke. Each person's shape is filled with palette-coloured smoke up to
 * Density and held there, churning; movement tears smoke off and pushes it; Smoulder lets it stream
 * off a still figure. The camera picture is never drawn. GLSL ES 1.00, run through Passes.material.
 */
import { recolourGLSL } from './recolour';

/**
 * Deliberate movement from the flow field: how far things moved per camera frame, so sway does not count.
 * Starts at People's deliberate-movement threshold (0.002 uv a frame).
 */
const travel = /* glsl */`
float travel(vec3 flow) { return smoothstep(.002, .006, length(flow.rg)); }`;
/** A slowly turning swirl with no sources or sinks, for the smoke churning inside a figure. */
const churn = /* glsl */`
vec2 churn(vec2 p, float t) {
  p *= vec2(16. / 9., 1.) * 6.;
  return vec2(cos(p.y + t * .7) * sin(p.x - t * .5), -cos(p.x - t * .5) * sin(p.y + t * .7));
}`;

/** Velocity, in grid cells per second. */
export const velocityFragment = /* glsl */`
uniform sampler2D uCurrent, uFlow, uPeople, uDye; uniform float uReady, uResponse, uSmoulder, uSwirl, uRise, uStep, uTime; uniform vec2 uGrid;
${travel}
${churn}
void main() {
  vec2 v = texture2D(uCurrent, vUv).xy;
  vec3 flow = texture2D(uFlow, vUv).rgb;
  float person = texture2D(uPeople, vUv).r * uReady;
  // Smoke rises in proportion to how dense it is, except where a figure is holding it (see holdFragment).
  float hold = smoothstep(.05, .4, person) * (1. - uSmoulder) * (1. - travel(flow));
  v.y += uRise * dot(texture2D(uDye, vUv).rgb, vec3(.2126, .7152, .0722)) * uStep * (1. - hold);
  // Smoulder lifts smoke off them.
  v.y += uSmoulder * person * .25 * uGrid.y * uStep;
  // Without people found, movement anywhere in the area still drives the smoke.
  float region = uReady > .5 ? texture2D(uPeople, vUv).r : 1.;
  vec2 pushed = flow.rg * uGrid * 30. * uResponse * 1.5;
  v = mix(v, pushed, clamp(region * travel(flow) * uStep * 15., 0., 1.));
  gl_FragColor = vec4(v, 0., 1.);
}`;

/**
 * Holding the figure, applied as the last change to velocity before the smoke moves: inside a still
 * person the smoke only churns, clear of the edges, so it stays in their shape. Smoulder lets it go,
 * and so does movement, so moving still tears smoke off.
 */
export const holdFragment = /* glsl */`
uniform sampler2D uCurrent, uFlow, uPeople; uniform float uReady, uSmoulder, uSwirl, uTime; uniform vec2 uGrid;
${travel}
${churn}
void main() {
  vec2 v = texture2D(uCurrent, vUv).xy;
  float person = texture2D(uPeople, vUv).r * uReady;
  // The hold reaches a little way past the outline: still air right against the figure cannot draw smoke out of it.
  float near = person;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785398;
    near = max(near, texture2D(uPeople, vUv + vec2(cos(a), sin(a)) * 2.5 / uGrid).r * uReady);
  }
  float hold = smoothstep(.05, .4, near) * (1. - uSmoulder) * (1. - travel(texture2D(uFlow, vUv).rgb));
  vec2 held = churn(vUv, uTime) * uGrid.y * .06 * (.3 + uSwirl) * smoothstep(.6, .95, person);
  gl_FragColor = vec4(mix(v, held, hold), 0., 1.);
}`;

/** Smoke colour, in linear light, capped by its brightest channel so it keeps its hue. */
export const dyeFragment = /* glsl */`
uniform sampler2D uCurrent, uFlow, uPeople;
uniform float uReady, uDensity, uResponse, uSmoulder, uStep, uTime; uniform vec2 uPeopleTexel;
const float CAP = 1.5;
${recolourGLSL}
${travel}
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
// Turbulent cloud texture, 0..1, drifting upward and twisting, so a figure is made of wisps rather than a flat shape.
float cloud(vec2 uv, float t, float seed) {
  vec2 p = uv * vec2(16. / 9., 1.) * 14. + vec2(seed * 13.1, -t * 1.1);
  p += .9 * vec2(noise(p * .5 + vec2(0., t * .4)), noise(p * .5 + vec2(5.2, -t * .3))) - .45;
  return .5 * noise(p) + .3 * noise(p * 2.1 + vec2(t * .3, 7.)) + .2 * noise(p * 4.3 - vec2(3., t * .9));
}
// The palette drifting through the smoke at about the scale of its wisps; uRampShift is Colour change.
vec3 smokeColour(vec2 uv) {
  float t = uTime * (.15 + uRampShift);
  vec2 q = uv * vec2(16. / 9., 1.);
  float p = .5 + .3 * sin(q.x * 9. + t * .7 + 2. * noise(q * 4. + t * .2)) * cos(q.y * 7. - t * .5) + .2 * (noise(q * 6. - vec2(0., t * .6)) - .5) * 2.;
  return rampAt(p);
}
void main() {
  vec3 colour = smokeColour(vUv);
  vec3 flow = texture2D(uFlow, vUv).rgb;
  float person = texture2D(uPeople, vUv).r * uReady;
  float region = uReady > .5 ? texture2D(uPeople, vUv).r : 1.;
  vec2 e = uPeopleTexel * 2.;
  float edge = clamp(length(vec2(texture2D(uPeople, vUv + vec2(e.x, 0.)).r - texture2D(uPeople, vUv - vec2(e.x, 0.)).r,
    texture2D(uPeople, vUv + vec2(0., e.y)).r - texture2D(uPeople, vUv - vec2(0., e.y)).r)) * 2.5, 0., 1.) * uReady;
  vec3 current = texture2D(uCurrent, vUv).rgb;
  // The figure: smoke filling their shape up to Density.
  // Only the solid part of the outline is filled, where the smoke is held; the soft edge is left to what drifts there.
  // The figure is wisps with dark gaps: Density sets how much of the cloud is filled in, and how bright.
  float c = cloud(vUv, uTime, 0.), coverage = mix(.25, .9, uDensity);
  float wisp = smoothstep(.88 - coverage, 1.12 - coverage, c);
  vec3 figure = colour * (.35 + .65 * uDensity) * wisp * (.6 + .8 * c);
  // The figure settles towards its wisps, so the gaps stay dark even after it has been full.
  vec3 next = mix(current, figure, clamp(smoothstep(.3, .7, person) * uStep * 6., 0., 1.));
  // Movement and Smoulder pour more on top, in broken wisps rather than a fog or a bright outline;
  // pouring eases off near the cap.
  float frayed = smoothstep(.45, .7, cloud(vUv, uTime, 1.));
  float add = travel(flow) * region * uResponse * 3. * (.25 + .75 * frayed) + uSmoulder * 3. * frayed * (edge + .5 * person);
  float full = max(next.r, max(next.g, next.b)) / CAP;
  next += colour * add * uStep * max(0., 1. - full);
  // Near the frame edges smoke thins away, so it leaves the picture instead of piling up there.
  float border = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
  next *= mix(max(0., 1. - uStep * 3.), 1., smoothstep(0., .06, border));
  float m = max(next.r, max(next.g, next.b));
  gl_FragColor = vec4(next * min(1., CAP / max(m, 1e-6)), 1.);
}`;

/** The picture: the smoke, with bright colour rolling off smoothly instead of clipping. */
export const compositeFragment = /* glsl */`
uniform sampler2D uDye;
vec3 rolloff(vec3 c) {
  float m = max(c.r, max(c.g, c.b)), k = .75;
  if (m <= k) return c;
  return c * (k + (1. - k) * (1. - exp(-(m - k) / (1. - k)))) / m;
}
void main() { gl_FragColor = vec4(rolloff(texture2D(uDye, vUv).rgb), 1.); }`;
