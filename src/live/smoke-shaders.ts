/**
 * Smoke: people, recoloured through the palette, pour coloured smoke into a fluid simulation.
 * Movement tears smoke off and pushes it; Smoulder gives off smoke all the time; Burn away fades
 * a still person into their own smoke. GLSL ES 1.00, run through Passes.material.
 */
import { recolourGLSL } from './recolour';

/** Deliberate movement from the flow field: how far things moved per camera frame, so sway does not count. */
const travel = /* glsl */`
float travel(vec3 flow) { return smoothstep(.0008, .005, length(flow.rg)); }`;
/** How far a still person has burnt away; repeats burnFade() in maths.ts. */
const burn = /* glsl */`
float burnFade(float since, float amount) { float t = clamp((since - 1.) / 2., 0., 1.); return amount * t * t * (3. - 2. * t); }`;

/** Velocity, in grid cells per second. */
export const velocityFragment = /* glsl */`
uniform sampler2D uCurrent, uFlow, uPeople; uniform float uReady, uResponse, uSmoulder, uStep; uniform vec2 uGrid;
${travel}
void main() {
  vec2 v = texture2D(uCurrent, vUv).xy;
  vec3 flow = texture2D(uFlow, vUv).rgb;
  float person = texture2D(uPeople, vUv).r;
  // Without people found, movement anywhere in the area still drives the smoke.
  float region = uReady > .5 ? person : 1.;
  vec2 pushed = flow.rg * uGrid * 30. * uResponse * 1.5;
  v = mix(v, pushed, clamp(region * travel(flow) * uStep * 15., 0., 1.));
  v.y += uSmoulder * person * uReady * .25 * uGrid.y * uStep;
  gl_FragColor = vec4(v, 0., 1.);
}`;

/** Smoke colour, in linear light, capped so a room full of people cannot run away to white. */
export const dyeFragment = /* glsl */`
uniform sampler2D uCurrent, uCamera, uFlow, uPeople, uStill;
uniform float uReady, uResponse, uSmoulder, uBurn, uStep, uTime; uniform vec2 uPeopleTexel;
const float CAP = 1.5;
${recolourGLSL}
${travel}
${burn}
void main() {
  vec3 colour = recolour(texture2D(uCamera, vUv).rgb, vUv, uTime);
  vec3 flow = texture2D(uFlow, vUv).rgb;
  float person = texture2D(uPeople, vUv).r;
  float region = uReady > .5 ? person : 1.;
  vec2 e = uPeopleTexel * 2.;
  float edge = clamp(length(vec2(texture2D(uPeople, vUv + vec2(e.x, 0.)).r - texture2D(uPeople, vUv - vec2(e.x, 0.)).r,
    texture2D(uPeople, vUv + vec2(0., e.y)).r - texture2D(uPeople, vUv - vec2(0., e.y)).r)) * 4., 0., 1.);
  float add = travel(flow) * region * uResponse * 6.
    + uSmoulder * 1.5 * (edge + .3 * person) * uReady
    + burnFade(texture2D(uStill, vUv).g, uBurn) * 2. * person;
  // Capped by its brightest channel, so colour keeps its hue at the cap instead of every channel
  // filling up to white; pouring eases off as the smoke there approaches the cap.
  vec3 current = texture2D(uCurrent, vUv).rgb;
  float full = max(current.r, max(current.g, current.b)) / CAP;
  vec3 next = current + colour * add * uStep * max(0., 1. - full);
  float m = max(next.r, max(next.g, next.b));
  gl_FragColor = vec4(next * min(1., CAP / max(m, 1e-6)), 1.);
}`;

/** The picture: smoke, with the person on top fading as they burn away. uShow: 0 all, 1 smoke only, 2 person only. */
export const compositeFragment = /* glsl */`
uniform sampler2D uDye, uCamera, uPeople, uStill; uniform float uBurn, uTime, uShow;
${recolourGLSL}
${burn}
// Bright colour rolls off smoothly instead of clipping.
vec3 rolloff(vec3 c) {
  float m = max(c.r, max(c.g, c.b)), k = .75;
  if (m <= k) return c;
  return c * (k + (1. - k) * (1. - exp(-(m - k) / (1. - k)))) / m;
}
void main() {
  vec3 smoke = rolloff(texture2D(uDye, vUv).rgb);
  float person = texture2D(uPeople, vUv).r * (1. - burnFade(texture2D(uStill, vUv).g, uBurn));
  vec3 own = rolloff(recolour(texture2D(uCamera, vUv).rgb, vUv, uTime));
  vec3 c = uShow > 1.5 ? own * person : uShow > .5 ? smoke : mix(smoke, own, person);
  gl_FragColor = vec4(c, 1.);
}`;
