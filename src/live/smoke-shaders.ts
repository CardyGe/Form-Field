/**
 * Smoke: people are made of smoke. Each person's shape is filled with palette-coloured smoke up to
 * Density and held there, churning; movement tears smoke off and pushes it; Smoulder lets it stream
 * off a still figure. The camera picture is never drawn. GLSL ES 1.00, run through Passes.material.
 */
import { recolourGLSL } from './recolour';

/** Clear air: thin smoke (below `thin`) in slow air (below `slowTo` cells/s) fades out at up to `rate` per second. */
export const CLEAR = { slowFrom: 4, slowTo: 20, thin: .4, rate: 1.2 };

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
// A person counts only where the reading is solid: a real camera gives faint readings across the whole room.
float solid(vec2 uv) { return smoothstep(.3, .7, texture2D(uPeople, uv).r); }
${travel}
${churn}
void main() {
  vec2 v = texture2D(uCurrent, vUv).xy;
  vec3 flow = texture2D(uFlow, vUv).rgb;
  float person = solid(vUv) * uReady;
  // Smoke rises in proportion to how dense it is, except where a figure is holding it (see holdFragment).
  float hold = smoothstep(.05, .4, person) * pow(1. - uSmoulder, 3.) * (1. - travel(flow));
  v.y += uRise * dot(texture2D(uDye, vUv).rgb, vec3(.2126, .7152, .0722)) * uStep * (1. - hold);
  // Smoulder lifts smoke off them.
  v.y += uSmoulder * person * .25 * uGrid.y * uStep;
  // Without people found, movement anywhere in the area still drives the smoke.
  float region = uReady > .5 ? solid(vUv) : 1.;
  // Calm ↔ Wild: the middle (0.5) behaves as the smoke always did. Below it, movement throws smoke more gently and
  // never hard; above it, harder.
  float calm = 1. - clamp(uSwirl / .5, 0., 1.), wild = clamp((uSwirl - .5) / .5, 0., 1.);
  vec2 pushed = flow.rg * uGrid * 30. * uResponse * 1.5 * mix(1., .35, calm) * (1. + .4 * wild);
  float fling = length(pushed), most = mix(1e4, 20., calm);
  if (fling > most) pushed *= most / fling;
  v = mix(v, pushed, clamp(region * travel(flow) * uStep * 15., 0., 1.));
  gl_FragColor = vec4(v, 0., 1.);
}`;

/**
 * Holding the figure, applied as the last change to velocity before the smoke moves: inside a still
 * person the smoke only churns, clear of the edges, so it stays in their shape. Smoulder lets it go,
 * and so does movement, so moving still tears smoke off.
 */
export const holdFragment = /* glsl */`
uniform sampler2D uCurrent, uFlow, uPeople, uDrift; uniform float uReady, uSmoulder, uSwirl, uTime; uniform vec2 uGrid;
// A person counts only where the reading is solid: a real camera gives faint readings across the whole room.
float solid(vec2 uv) { return smoothstep(.3, .7, texture2D(uPeople, uv).r); }
${travel}
${churn}
void main() {
  vec2 v = texture2D(uCurrent, vUv).xy;
  float person = solid(vUv) * uReady;
  // The hold reaches a little way past the outline: still air right against the figure cannot draw smoke out of it.
  float near = person;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785398;
    near = max(near, solid(vUv + vec2(cos(a), sin(a)) * 2.5 / uGrid) * uReady);
  }
  // Held smoke churns, and is carried along at the people's own speed, so it moves with them.
  // Fully held at Smoulder 0, and let go quickly as Smoulder rises, so a smouldering figure really does give off smoke.
  float hold = smoothstep(.05, .4, near) * pow(1. - uSmoulder, 3.);
  vec2 carried = texture2D(uDrift, vec2(.5)).zw * uGrid;
  // The stirring inside figures is fixed (as it was before Calm ↔ Wild existed), so figures always read as smoke.
  vec2 held = churn(vUv, uTime) * uGrid.y * .06 * .8 * smoothstep(.6, .95, person) + carried * smoothstep(.05, .4, person);
  gl_FragColor = vec4(mix(v, held, hold), 0., 1.);
}`;

/**
 * How far the people in the picture have moved, added up over time (uv), in a 1 × 1 target: the figure's
 * texture is drawn shifted by it, so it travels with them instead of staying fixed to the screen.
 * The average movement of everything counted as a person, from a 32 × 18 grid.
 */
export const driftFragment = /* glsl */`
uniform sampler2D uPrevious, uFlow, uPeople; uniform float uReady, uStep;
// A person counts only where the reading is solid: a real camera gives faint readings across the whole room.
float solid(vec2 uv) { return smoothstep(.3, .7, texture2D(uPeople, uv).r); }
void main() {
  vec2 sum = vec2(0.); float weight = 0.;
  for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
    vec2 q = (vec2(float(x), float(y)) + .5) / vec2(32., 18.);
    // Only the parts of people that are actually moving: a still middle would dilute the average to nothing.
    vec2 f = texture2D(uFlow, q).rg;
    float p = solid(q) * uReady * smoothstep(.0005, .003, length(f));
    sum += f * p; weight += p;
  }
  // move: uv per second. xy: how far, added up; zw: how fast now, which also carries the held smoke along.
  vec2 move = weight > .5 ? sum / weight * 30. : vec2(0.);
  gl_FragColor = vec4(texture2D(uPrevious, vec2(.5)).xy + move * uStep, move);
}`;

/**
 * The smoky figure: the palette drifting through a turbulent cloud texture that travels with people
 * (uDrift) and streams upward. Density sets how much of the cloud is filled in, and how bright.
 * Shared by the smoke pass (which leaves some of it behind as smoke, set by Emit) and the picture
 * (which draws the figure over the smoke).
 */
const figureGLSL = /* glsl */`
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
// Turbulent cloud texture, 0..1, streaming upward and twisting, so a figure is made of wisps rather than a flat shape.
// uv is already shifted by how far people have moved, so the texture travels with them.
float cloud(vec2 uv, float t, float seed) {
  vec2 p = uv * vec2(16. / 9., 1.) * 20. + vec2(seed * 13.1, -t * 2.2);
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
vec2 figureUv(vec2 uv) { return uv - texture2D(uDrift, vec2(.5)).xy; }
vec3 figureColour(vec2 uv) {
  float c = cloud(figureUv(uv), uTime, 0.), coverage = mix(.25, .9, uDensity);
  float wisp = smoothstep(.88 - coverage, 1.12 - coverage, c);
  return smokeColour(uv) * (.35 + .65 * uDensity) * wisp * (.6 + .8 * c);
}`;

/** How full of smoke the picture is: the share of a 32 × 18 grid holding visible smoke. Written to a 1 × 1 target. */
export const fullnessFragment = /* glsl */`
uniform sampler2D uDye;
void main() {
  float full = 0.;
  for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
    vec3 d = texture2D(uDye, (vec2(float(x), float(y)) + .5) / vec2(32., 18.)).rgb;
    full += step(.01, max(d.r, max(d.g, d.b)));
  }
  gl_FragColor = vec4(full / 576., 0., 0., 1.);
}`;

/** Smoke colour, in linear light, capped by its brightest channel so it keeps its hue. */
export const dyeFragment = /* glsl */`
uniform sampler2D uCurrent, uFlow, uPeople;
uniform sampler2D uDrift, uVelocity, uFullness; uniform vec4 uClear; // slow from, slow to (cells/s), thin, rate
uniform float uReady, uDensity, uEmit, uSmoulder, uSwirl, uStep, uTime, uOpen, uCapFull; uniform vec2 uPeopleTexel;
// A person counts only where the reading is solid: a real camera gives faint readings across the whole room.
float solid(vec2 uv) { return smoothstep(.3, .7, texture2D(uPeople, uv).r); }
const float CAP = 1.5;
${recolourGLSL}
${travel}
${figureGLSL}
void main() {
  vec3 colour = smokeColour(vUv);
  vec3 flow = texture2D(uFlow, vUv).rgb;
  float person = solid(vUv) * uReady;
  float region = uReady > .5 ? solid(vUv) : 1.;
  vec2 e = uPeopleTexel * 2.;
  float edge = clamp(length(vec2(solid(vUv + vec2(e.x, 0.)) - solid(vUv - vec2(e.x, 0.)),
    solid(vUv + vec2(0., e.y)) - solid(vUv - vec2(0., e.y)))) * 2.5, 0., 1.) * uReady;
  vec4 stored = texture2D(uCurrent, vUv);
  vec3 current = stored.rgb;
  vec2 moved = figureUv(vUv);
  // On Forever, adding eases off once the picture is mostly full, so it cannot swamp it.
  float room = 1. - uCapFull * smoothstep(.25, .45, texture2D(uFullness, vec2(.5)).r);
  float emitting = min(1., uEmit / .6) * room;
  // The figure is poured into the smoke, settling towards its wisps so the gaps stay dark. Alpha marks how much
  // of the smoke here is figure, so what a moving figure leaves behind can fade quickly at low Emit.
  // Only the figure's own part settles: smoke already in the room passes through a figure and is pushed, not erased.
  float settle = clamp(person * uStep * 3., 0., 1.);
  vec3 figurePart = mix(current * stored.a, figureColour(vUv), settle);
  vec3 next = current * (1. - stored.a) + figurePart;
  float figureShare = max(figurePart.r, max(figurePart.g, figurePart.b)) / max(max(next.r, max(next.g, next.b)), 1e-4);
  // Movement and Smoulder pour more on top, in broken wisps rather than a fog or a bright outline;
  // pouring eases off near the cap.
  // Smoke is poured in broken wisps. What movement throws off is poured more smoothly below the middle of
  // Calm ↔ Wild; what the figure gives off itself (Smoulder) always stays broken.
  float broken = smoothstep(.45, .7, cloud(moved, uTime, 1.));
  float frayed = mix(broken, 1., .75 * (1. - clamp(uSwirl / .5, 0., 1.)));
  // Emit sets how much new smoke comes off people, moving or still; 0.6 is the original amount.
  float add = (travel(flow) * region * 3. * (.25 + .75 * frayed) + uSmoulder * 3. * broken * (edge + .5 * person)) * uEmit / .6 * room;
  float full = max(next.r, max(next.g, next.b)) / CAP;
  float before = max(next.r, max(next.g, next.b));
  next += colour * add * uStep * max(0., 1. - full);
  // What is poured is the figure's until it leaves them; poured outside people, it is the room's.
  figureShare *= mix(before / max(max(next.r, max(next.g, next.b)), 1e-4), 1., person);
  // Figure smoke just left behind outside people fades quickly as Emit goes down: at Emit 0 people add nothing
  // lasting. The mark wears off within about a second, after which the smoke belongs to the room and stays.
  next *= max(0., 1. - uStep * 8. * (1. - person) * figureShare * (1. - emitting));
  figureShare = mix(max(0., figureShare - uStep), figureShare, person);
  // Clear air: thin smoke in still air fades out quickly, so leftover haze clears to black while rising
  // wisps and fresh trails, which are moving, keep their smoke.
  float slow = 1. - smoothstep(uClear.x, uClear.y, length(texture2D(uVelocity, vUv).xy));
  // Not around people, where smoke is born thin and slow before it rises.
  float source = person;
  for (int i = 0; i < 8; i++) { float a = float(i) * .785398; source = max(source, solid(vUv + vec2(cos(a) * 9. / 16., sin(a)) * .06) * uReady); }
  float thin = (1. - smoothstep(.02, uClear.z, max(current.r, max(current.g, current.b)))) * slow * (1. - smoothstep(.1, .5, source));
  next *= max(0., 1. - uStep * uClear.w * thin);
  // Near the frame edges smoke thins away, so it leaves the picture instead of piling up there.
  float border = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
  next *= mix(max(0., 1. - uStep * 3. * uOpen), 1., smoothstep(0., .06, border));
  float m = max(next.r, max(next.g, next.b));
  gl_FragColor = vec4(next * min(1., CAP / max(m, 1e-6)), figureShare);
}`;

/** The picture: the smoke, figures included, with bright colour rolling off smoothly instead of clipping. */
export const compositeFragment = /* glsl */`
uniform sampler2D uDye; uniform float uVividness;
vec3 rolloff(vec3 c) {
  float m = max(c.r, max(c.g, c.b)), k = .75;
  if (m <= k) return c;
  return c * (k + (1. - k) * (1. - exp(-(m - k) / (1. - k)))) / m;
}
// Vividness: lifts saturation, most where colours have mixed towards grey and least where they are already vivid,
// so mixed smoke stays colourful without flattening into bands.
vec3 vivid(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  if (m < 1e-4) return c;
  float saturation = (m - min(c.r, min(c.g, c.b))) / m;
  float l = dot(c, vec3(.2126, .7152, .0722));
  float lift = 1. + uVividness * 2.6 * (1. - saturation);
  vec3 lifted = max(mix(vec3(l), c, lift), vec3(0.));
  // Keep the brightest channel where it was, so lifting colour does not dim or flare the smoke.
  return lifted * m / max(max(lifted.r, max(lifted.g, lifted.b)), 1e-4);
}
void main() { gl_FragColor = vec4(rolloff(vivid(texture2D(uDye, vUv).rgb)), 1.); }`;
