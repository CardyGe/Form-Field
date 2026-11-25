import { GROUP_TABLES, PARITY_RADII, SYMMETRY_GROUPS, parityAverage, parityCentres, sanitiseSpiral } from '../core/kaleidoscope-math';
import { parameterDefinitions } from '../core/project';
import type { Layer } from '../shared/types';

const TAU = Math.PI * 2;
const DEFINITIONS = new Map(parameterDefinitions('kaleidoscope').map(d => [d.key, d]));

/** A control as the shader may use it: finite, inside its range, and whole if asked. */
function control(layer: Layer, key: string, whole = false): number {
  const d = DEFINITIONS.get(key);
  if (!d) throw new Error(`Unknown Kaleidoscope control ${key}.`);
  const raw = layer.params[key];
  const value = Number.isFinite(raw) ? raw : d.default;
  const shaped = whole ? Math.round(value) : value;
  // Adding zero turns -0 from rounding into 0.
  return Math.min(d.max, Math.max(d.min, shaped)) + 0;
}

/** Echo at which the Feedback source's ground has fully cleared. */
const GROUND_CLEAR_ECHO = 0.05;

/** The Feedback source's ground: opaque at Echo 0, easing to clear, so raising Echo never snaps the frame. */
export function feedbackGroundAlpha(echo: number): number {
  const t = Number.isFinite(echo) ? Math.max(0, Math.min(1, echo / GROUND_CLEAR_ECHO)) : 0;
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The render boundary. Saved values are validated, but modulation can reach here fractional or
 * out of range, so every control is made safe again. Plain numbers only; pure.
 */
export function kaleidoscopeUniforms(layer: Layer, loopFraction: number): Record<string, unknown> {
  const loop = Number.isFinite(loopFraction) ? loopFraction - Math.floor(loopFraction) : 0;
  const spiral = control(layer, 'spiral', true);
  const { a, b } = sanitiseSpiral(control(layer, 'spiralA', true), control(layer, 'spiralB', true));
  const zoomCycles = control(layer, 'zoomCycles', true);
  const cycles = control(layer, 'cycles', true);
  const motifScale = control(layer, 'motifScale');
  const turns = loop * cycles;
  const phase = (turns - Math.floor(turns)) * TAU;
  const motif = control(layer, 'motif', true);
  // The parity average is only read by that motif, so the other two do not pay for it.
  const morphTo = control(layer, 'morphTo', true);
  const parity = motif === 2 || morphTo === 3 ? parityAverage(phase) : { coverage: 0, ink: 0 };
  // There and back within each morph, so the loop always closes on the first motif.
  const morphWave = morphTo > 0 ? .5 - .5 * Math.cos(TAU * loop * control(layer, 'morphs', true)) : 0;
  return {
    uKTwist: control(layer, 'twist'),
    uKLens: control(layer, 'lens'),
    uKMelt: control(layer, 'melt'),
    uKMorphTo: morphTo - 1,
    uKMorphWave: morphWave,
    uKInput: control(layer, 'input', true),
    uKGroup: control(layer, 'group', true),
    uKSectors: control(layer, 'sectors', true),
    // Rosette has no repeating tile, so Repeat size is kept but not used.
    uKCell: control(layer, 'group', true) === 0 ? 1 : control(layer, 'cell'),
    uKFeedbackGround: feedbackGroundAlpha(layer.params.echo ?? 0),
    uKSpiral: spiral,
    uKSpiralA: a + 0,
    uKSpiralB: b + 0,
    uKSpiralScale: Math.max(1 + 1e-6, control(layer, 'spiralScale')),
    uKZoomCycles: zoomCycles,
    uKZoom: zoomCycles * loop,
    uKCycles: cycles,
    uKPhase: phase,
    uKSourceX: control(layer, 'sourceX'),
    uKSourceY: control(layer, 'sourceY'),
    uKSourceScale: control(layer, 'sourceScale'),
    uKSourceTurn: control(layer, 'sourceTurn'),
    uKSourceDrift: control(layer, 'sourceDrift'),
    uKWarpIn: control(layer, 'warpIn'),
    uKWarpOut: control(layer, 'warpOut'),
    uKMotif: motif,
    uKParityCentres: parityCentres(phase),
    uKParityAverage: [parity.coverage, parity.ink],
    // After the spiral everything must repeat once per unit of tau, so the count is whole.
    uKMotifScale: spiral === 1 ? Math.max(1, Math.round(motifScale)) : motifScale,
    uKLineWidth: control(layer, 'lineWidth'),
  };
}

const float = (n: number) => n.toFixed(12);
const vec2 = (v: { x: number; y: number }) => `vec2(${float(v.x)},${float(v.y)})`;

/** Lattice and wall tables indexed by the group param, generated from the verified maths. */
function groupTables(): string {
  const lattice = SYMMETRY_GROUPS.map(g => g === 'rosette' ? { a: { x: 1, y: 0 }, b: { x: 0, y: 1 }, walls: [] as number[][] } : GROUP_TABLES[g]);
  const first: number[] = [], count: number[] = [], walls: string[] = [];
  for (const group of lattice) {
    first.push(walls.length); count.push(group.walls.length);
    for (const [x, y, d] of group.walls) walls.push(`vec3(${float(x)},${float(y)},${float(d)})`);
  }
  const n = lattice.length;
  return `const vec2 K_LATTICE_A[${n}]=vec2[${n}](${lattice.map(g => vec2(g.a)).join(',')});
const vec2 K_LATTICE_B[${n}]=vec2[${n}](${lattice.map(g => vec2(g.b)).join(',')});
const int K_WALL_FIRST[${n}]=int[${n}](${first.join(',')});
const int K_WALL_COUNT[${n}]=int[${n}](${count.join(',')});
const vec3 K_WALLS[${walls.length}]=vec3[${walls.length}](${walls.join(',')});`;
}

/**
 * The picture, from a continuous pre-fold coordinate and its screen derivatives. Nothing here takes
 * a screen derivative: gradients are carried through every step, so no fold, log or wrap can put a
 * spike in the filter footprint. Output is associated linear RGBA.
 */
export const kaleidoscopeGLSL = /* glsl */`
uniform int uKGroup, uKSpiral, uKSpiralA, uKSpiralB, uKMotif, uKMorphTo;
uniform float uKTwist, uKLens, uKMelt, uKMorphWave;
float gKMorph = 0.;
uniform float uKSectors, uKCell, uKSpiralScale, uKZoom, uKPhase;
uniform float uKSourceX, uKSourceY, uKSourceScale, uKSourceTurn, uKSourceDrift;
uniform float uKWarpIn, uKWarpOut, uKMotifScale, uKLineWidth, uKHasImage;
uniform float uKAssociated, uKEmpty, uKFeedback, uKGain, uKFeedbackGround;
uniform vec2 uKImageFit, uKParityAverage;
uniform vec2 uKParityCentres[3];
uniform vec3 uKPalette[6];
uniform sampler2D uKImage, uKHistory;
const float K_PI = 3.14159265358979;
const float K_TAU = 6.28318530717959;
const int K_MAX_PASSES = 6;
${groupTables()}

vec2 kReflect(vec2 v, vec2 n) { return v - 2. * dot(v, n) * n; }

vec2 kFoldRosette(vec2 p, inout vec2 dx, inout vec2 dy) {
  if (dot(p, p) < 1e-24) return vec2(0.);
  float wedge = K_PI / uKSectors;
  float angle = atan(p.y, p.x);
  float k = floor(angle / (2. * wedge));
  float c = cos(2. * wedge * k), s = sin(2. * wedge * k);
  mat2 turn = mat2(c, -s, s, c);
  p = turn * p; dx = turn * dx; dy = turn * dy;
  if (angle - k * 2. * wedge > wedge) {
    vec2 n = vec2(-sin(wedge), cos(wedge));
    p = kReflect(p, n); dx = kReflect(dx, n); dy = kReflect(dy, n);
  }
  return p;
}

vec2 foldDomain(vec2 p, inout vec2 dx, inout vec2 dy) {
  if (uKGroup == 0) return kFoldRosette(p, dx, dy);
  vec2 a = K_LATTICE_A[uKGroup], b = K_LATTICE_B[uKGroup];
  float det = a.x * b.y - a.y * b.x;
  vec2 nearest = floor(vec2(p.x * b.y - p.y * b.x, a.x * p.y - a.y * p.x) / det + .5);
  p -= nearest.x * a + nearest.y * b;
  int first = K_WALL_FIRST[uKGroup], count = K_WALL_COUNT[uKGroup];
  for (int pass = 0; pass < K_MAX_PASSES; pass++) {
    bool changed = false;
    for (int i = first; i < first + count; i++) {
      vec3 wall = K_WALLS[i];
      float over = dot(wall.xy, p) - wall.z;
      if (over > 0.) {
        p -= 2. * over * wall.xy;
        dx = kReflect(dx, wall.xy); dy = kReflect(dy, wall.xy);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return p;
}

vec2 kComplexMul(vec2 u, vec2 v) { return vec2(u.x * v.x - u.y * v.y, u.x * v.y + u.y * v.x); }

vec2 spiralDomain(vec2 z, inout vec2 dx, inout vec2 dy) {
  float r2 = max(dot(z, z), 1e-24);
  vec2 w = vec2(.5 * log(r2), z == vec2(0.) ? 0. : atan(z.y, z.x));
  float lnScale = log(uKSpiralScale);
  vec2 gamma = vec2(float(uKSpiralB), -float(uKSpiralA) * lnScale / K_TAU);
  vec2 unit = vec2(1. / lnScale, 1. / K_TAU);
  // d(log z) = dz / z, then the same linear map as tau itself.
  // At the centre itself 1/z has no direction: keep the footprint huge so it filters to the average.
  vec2 inverse = r2 < 1e-12 ? vec2(1e6, 0.) : vec2(z.x, -z.y) / r2;
  dx = kComplexMul(gamma, kComplexMul(dx, inverse)) * unit;
  dy = kComplexMul(gamma, kComplexMul(dy, inverse)) * unit;
  return kComplexMul(gamma, w) * unit;
}

vec2 kWarpBefore(vec2 p, inout vec2 dx, inout vec2 dy) {
  if (uKWarpIn <= 0.) return p;
  const float frequency = 2.6;
  float amount = .16 * uKWarpIn;
  float u = frequency * p.y + uKPhase, v = frequency * p.x - uKPhase;
  vec2 slope = amount * frequency * vec2(cos(u), cos(v));
  dx += vec2(slope.x * dx.y, slope.y * dx.x);
  dy += vec2(slope.x * dy.y, slope.y * dy.x);
  return p + amount * vec2(sin(u), sin(v));
}

// Whole frequencies, so this keeps period 1 when it runs on spiral coordinates.
vec2 kWarpAfter(vec2 p, inout vec2 dx, inout vec2 dy) {
  if (uKWarpOut <= 0.) return p;
  const float frequency = 2. * K_TAU;
  float amount = .045 * uKWarpOut;
  float u = frequency * p.y + uKPhase, v = frequency * p.x - uKPhase;
  vec2 slope = amount * frequency * vec2(cos(u), cos(v));
  dx += vec2(slope.x * dx.y, slope.y * dx.x);
  dy += vec2(slope.x * dy.y, slope.y * dy.x);
  return p + amount * vec2(sin(u), sin(v));
}

// Running integral of a period-1 pulse of half-width w centred on .5.
float kPulseIntegral(float x, float w) {
  float n = floor(x);
  return n * 2. * w + clamp(x - n - (.5 - w), 0., 2. * w);
}
// Exact box filter of that pulse over a footprint.
float kPulse(float x, float w, float footprint) {
  x = fract(x);
  footprint = max(footprint, 1e-5);
  return (kPulseIntegral(x + .5 * footprint, w) - kPulseIntegral(x - .5 * footprint, w)) / footprint;
}
float kFade(vec2 dx, vec2 dy) {
  vec2 footprint = abs(dx) + abs(dy);
  return smoothstep(.5, 1., max(footprint.x, footprint.y));
}
float kWeight() { return clamp(.03 * uKLineWidth, .005, .18); }

// On the feedback input the ground clears as Echo rises, so the folded history shows between the marks.
vec4 kGround() { return vec4(uKPalette[5], 1.) * (uKFeedback > .5 ? uKFeedbackGround : 1.); }

vec4 kLineField(vec2 q, vec2 dx, vec2 dy) {
  float t = K_TAU * q.x;
  // Four lines per tile: a whole count, so the field still repeats once per unit of q.
  float height = 4. * q.y + .55 * sin(t + uKPhase) + .18 * sin(2. * t - 2. * uKPhase);
  vec2 slope = vec2(K_TAU * (.55 * cos(t + uKPhase) + .36 * cos(2. * t - 2. * uKPhase)), 4.);
  float w = kWeight();
  float cover = kPulse(height, w, abs(dot(slope, dx)) + abs(dot(slope, dy)));
  vec4 ground = kGround();
  vec4 ink = vec4(mix(uKPalette[0], uKPalette[2], .5 + .5 * cos(t)), 1.);
  vec4 average = mix(ground, vec4(.5 * (uKPalette[0] + uKPalette[2]), 1.), 2. * w);
  return mix(mix(ground, ink, cover), average, kFade(dx, dy));
}

float kSquare(vec2 q, float w, vec2 footprint) { return kPulse(q.x, w, footprint.x) * kPulse(q.y, w, footprint.y); }

vec4 kSquareTile(vec2 q, vec2 dx, vec2 dy) {
  vec2 footprint = abs(dx) + abs(dy);
  // Off the mirror lines, so the fold shows in the tile instead of landing on its symmetry.
  q += vec2(.19, .07) + .04 * vec2(cos(uKPhase), sin(uKPhase));
  const float outer = .42;
  float inner = outer - kWeight();
  float core = .15 + .05 * sin(uKPhase);
  float ring = kSquare(q, outer, footprint) - kSquare(q, inner, footprint);
  float centre = kSquare(q, core, footprint);
  vec4 ground = kGround(), line = vec4(uKPalette[1], 1.), middle = vec4(uKPalette[3], 1.);
  vec4 color = ground * (1. - ring - centre) + line * ring + middle * centre;
  float ringArea = 4. * (outer * outer - inner * inner), coreArea = 4. * core * core;
  vec4 average = ground * (1. - ringArea - coreArea) + line * ringArea + middle * coreArea;
  return mix(color, average, kFade(dx, dy));
}

float kDisc(vec2 q, vec2 centre, float radius, float footprint) {
  vec2 d = q - centre;
  d -= floor(d + .5);
  return clamp((radius - length(d)) / footprint + .5, 0., 1.);
}

// Each disc drifts around its own home, so parity changes only where an edge passes.
vec4 kCircleParity(vec2 q, vec2 dx, vec2 dy) {
  float footprint = max(length(dx) + length(dy), 1e-5);
  const vec3 radii = vec3(${PARITY_RADII.map(float).join(',')});
  float a = kDisc(q, uKParityCentres[0], radii.x, footprint);
  float b = kDisc(q, uKParityCentres[1], radii.y, footprint);
  float c = kDisc(q, uKParityCentres[2], radii.z, footprint);
  float parity = a + b - 2. * a * b;
  parity = parity + c - 2. * parity * c;
  vec4 ground = kGround();
  vec4 ink = vec4(mix(uKPalette[4], uKPalette[2], .5 + .5 * cos(K_TAU * (q.x + q.y))), 1.);
  // The true tile average for this phase, including how the ink blend falls inside the mask.
  vec4 average = ground * (1. - uKParityAverage.x) + vec4(uKPalette[4], 1.) * (uKParityAverage.x - uKParityAverage.y) + vec4(uKPalette[2], 1.) * uKParityAverage.y;
  return mix(mix(ground, ink, parity), average, kFade(dx, dy));
}

// Colour travelling through the five inks. Period 1, so it closes around the spiral.
vec3 kCycle(float t) {
  t = fract(t) * 5.;
  int a = int(floor(t)) % 5, b = (a + 1) % 5;
  float f = fract(t);
  return mix(uKPalette[a], uKPalette[b], f * f * (3. - 2. * f));
}
vec3 kInkMean() { return (uKPalette[0] + uKPalette[1] + uKPalette[2] + uKPalette[3] + uKPalette[4]) / 5.; }

// One family of glowing curves: three per tile, each with a bright pulse running along it.
void kNeonFamily(float h, vec2 slope, vec2 dx, vec2 dy, float along, inout vec3 light, inout float cover) {
  float stretch = length(slope) / 3.;
  float w = min(clamp(.018 * uKLineWidth, .006, .12) * stretch, .4);
  float foot = abs(dot(slope, dx)) + abs(dot(slope, dy));
  float core = kPulse(h, w, foot);
  float off = abs(fract(h) - .5), reach = 3.5 * w;
  float halo = exp(-off / max(reach, foot)) * min(1., reach / max(foot, 1e-5)) * smoothstep(.5, .34, off);
  float lane = floor(h) / 3.;
  vec3 ink = kCycle(lane + along - uKPhase / K_TAU);
  float spark = pow(.5 + .5 * cos(K_TAU * (2. * along + lane) - 2. * uKPhase), 10.);
  light += ink * (core * (1.1 + 1.4 * spark) + halo * (.34 + .5 * spark));
  cover = max(cover, clamp(core + .7 * halo, 0., 1.));
}

vec4 kNeon(vec2 q, vec2 dx, vec2 dy) {
  float t = K_TAU * q.x, s = K_TAU * q.y, ph = uKPhase;
  float ha = 3. * q.y + .55 * sin(t + ph) + .22 * sin(2. * t - 2. * ph);
  vec2 sa = vec2(K_TAU * (.55 * cos(t + ph) + .44 * cos(2. * t - 2. * ph)), 3.);
  float hb = 3. * q.x + .55 * sin(s - ph) + .22 * sin(2. * s + 2. * ph);
  vec2 sb = vec2(3., K_TAU * (.55 * cos(s - ph) + .44 * cos(2. * s + 2. * ph)));
  vec3 light = vec3(0.);
  float cover = 0.;
  kNeonFamily(ha, sa, dx, dy, q.x, light, cover);
  kNeonFamily(hb, sb, dx, dy, q.y + .5, light, cover);
  vec4 ground = kGround();
  vec4 color = vec4(ground.rgb + light, max(ground.a, cover));
  vec4 average = vec4(ground.rgb + .42 * kInkMean(), max(ground.a, .5));
  return mix(color, average, kFade(dx, dy));
}

// Over/under strands with a rounded profile and a contact shadow where one passes beneath another.
vec4 kRibbons(vec2 q, vec2 dx, vec2 dy) {
  float ph = uKPhase;
  vec2 c = 2. * q + .16 * vec2(sin(K_TAU * q.y + ph), sin(K_TAU * q.x - ph));
  float foot = max(2. * (length(dx) + length(dy)), 1e-5);
  float r = clamp(.2 + .045 * uKLineWidth, .18, .46);
  vec2 id = floor(c), f = c - id - .5;
  float coverA = clamp((r - abs(f.y)) / foot + .5, 0., 1.), coverB = clamp((r - abs(f.x)) / foot + .5, 0., 1.);
  vec2 n = clamp(f.yx / r, -1., 1.);
  vec2 round_ = sqrt(max(1. - n * n, 0.));
  vec3 inkA = kCycle(id.y / 2. + q.x - ph / K_TAU), inkB = kCycle(id.x / 2. + .5 + q.y + ph / K_TAU);
  vec3 tubeA = inkA * (.28 + .85 * round_.x) + vec3(.45) * pow(round_.x, 10.);
  vec3 tubeB = inkB * (.28 + .85 * round_.y) + vec3(.45) * pow(round_.y, 10.);
  bool aOver = mod(id.x + id.y, 2.) < .5;
  vec3 over = aOver ? tubeA : tubeB, under = aOver ? tubeB : tubeA;
  float overCover = aOver ? coverA : coverB, underCover = aOver ? coverB : coverA;
  under *= mix(.22, 1., smoothstep(r, r + .16, aOver ? abs(f.y) : abs(f.x)));
  vec4 color = mix(mix(kGround(), vec4(under, 1.), underCover), vec4(over, 1.), overCover);
  float area = 1. - (1. - 2. * r) * (1. - 2. * r);
  vec4 average = mix(kGround(), vec4(.8 * kInkMean(), 1.), area);
  return mix(color, average, kFade(dx, dy));
}

// A grid of glowing dots whose size and colour ripple diagonally through the pattern.
vec4 kDots(vec2 q, vec2 dx, vec2 dy) {
  vec2 g = q * 4., id = floor(g), f = g - id - .5;
  float wave = sin(K_TAU * (id.x + id.y) / 4. - uKPhase) + .5 * sin(K_TAU * (id.x - id.y) / 4. + 2. * uKPhase);
  float r = clamp(.25 + .024 * (uKLineWidth - 2.) + .1 * wave, .05, .46);
  float foot = max(4. * (length(dx) + length(dy)), 1e-5), d = length(f);
  float cover = clamp((r - d) / foot + .5, 0., 1.);
  float halo = .38 * exp(-max(d - r, 0.) / max(.09, foot)) * smoothstep(.72, .42, d);
  vec3 ink = kCycle((id.x + id.y) / 4. - uKPhase / K_TAU);
  vec3 lit = ink * 1.05 + vec3(.5) * smoothstep(r * .55, 0., d);
  vec4 ground = kGround();
  vec4 color = vec4(ground.rgb + ink * halo, max(ground.a, halo));
  color = mix(color, vec4(lit, 1.), cover);
  vec4 average = mix(ground, vec4(kInkMean(), 1.), K_PI * .0625 + .14);
  return mix(color, average, kFade(dx * 2., dy * 2.));
}

vec4 kMotifAt(int motif, vec2 q, vec2 dx, vec2 dy) {
  if (motif == 3) return kNeon(q, dx, dy);
  if (motif == 4) return kRibbons(q, dx, dy);
  if (motif == 5) return kDots(q, dx, dy);
  return motif == 0 ? kLineField(q, dx, dy) : motif == 1 ? kSquareTile(q, dx, dy) : kCircleParity(q, dx, dy);
}

// The second motif is only drawn inside the travelling morph front, so an idle morph costs nothing.
vec4 kMotif(vec2 p, vec2 dx, vec2 dy) {
  vec2 q = p * uKMotifScale;
  dx *= uKMotifScale; dy *= uKMotifScale;
  if (uKMorphTo < 0 || gKMorph <= 0.) return kMotifAt(uKMotif, q, dx, dy);
  if (gKMorph >= 1.) return kMotifAt(uKMorphTo, q, dx, dy);
  return mix(kMotifAt(uKMotif, q, dx, dy), kMotifAt(uKMorphTo, q, dx, dy), gKMorph);
}

// Twist, a roaming lens and a melt, all before the fold so they stay seamless in every symmetry.
vec2 kBendMap(vec2 p) {
  float ph = uKPhase;
  if (uKTwist > 0.) {
    float angle = uKTwist * (1.8 + 1.2 * sin(ph)) * exp(-.9 * dot(p, p));
    float c = cos(angle), s = sin(angle);
    p = mat2(c, s, -s, c) * p;
  }
  if (uKLens > 0.) {
    vec2 centre = .2 * vec2(cos(ph), sin(2. * ph));
    vec2 d = p - centre;
    p = centre + d * (1. - uKLens * .72 * (.68 + .32 * sin(ph)) * exp(-2.4 * dot(d, d)));
  }
  if (uKMelt > 0.) {
    float sag = sin(3.1 * p.x + ph) + .5 * sin(7.3 * p.x - 2. * ph);
    p += uKMelt * vec2(.055 * sin(5. * p.y + ph), .2 * sag * (.65 + .35 * sin(2. * p.y + ph)));
  }
  return p;
}
vec2 kBend(vec2 p, inout vec2 dx, inout vec2 dy) {
  if (uKTwist <= 0. && uKLens <= 0. && uKMelt <= 0.) return p;
  vec2 bent = kBendMap(p);
  // The bend is smooth, so one-pixel differences give its filter footprint.
  dx = kBendMap(p + dx) - bent;
  dy = kBendMap(p + dy) - bent;
  return bent;
}

// The picture's coordinate, read through a period-1 triangle wave so it closes around the spiral.
vec2 kPictureUv(vec2 p, out vec2 slope) {
  float scale = uKSpiral == 1 ? 1. : .5;
  vec2 x = fract(uKSpiral == 1 ? p : .75 + scale * p);
  slope = 2. * scale * vec2(x.x > .5 ? 1. : -1., x.y > .5 ? 1. : -1.) * uKImageFit;
  return .5 + (abs(2. * x - 1.) - .5) * uKImageFit;
}

// One filtered tap. A fit above 1 on an axis is a contain bar: its edge is box filtered exactly.
vec4 kImage(vec2 p, vec2 dx, vec2 dy) {
  vec2 slope;
  vec2 uv = kPictureUv(p, slope);
  vec2 gx = dx * slope, gy = dy * slope;
  vec4 color = textureGrad(uKImage, uv, gx, gy);
  // Image files are straight alpha; the composite below is already associated.
  if (uKAssociated < .5) color.rgb *= color.a;
  vec2 footprint = max(abs(gx) + abs(gy), vec2(1e-6));
  vec2 inside = clamp((min(uv + .5 * footprint, vec2(1.)) - max(uv - .5 * footprint, vec2(0.))) / footprint, 0., 1.);
  return color * (uKImageFit.x > 1. ? inside.x : 1.) * (uKImageFit.y > 1. ? inside.y : 1.);
}

// Zero-mean offsets inside the unit footprint, equally weighted so the feedback gain is unchanged.
const vec2 K_HISTORY_TAPS[8] = vec2[8](vec2(1., -3.), vec2(-1., 3.), vec2(5., 1.), vec2(-3., -5.), vec2(-5., 5.), vec2(-7., -1.), vec2(3., 7.), vec2(7., -7.));
// The widest spread in picture units, so the centre of a spiral stays a local average.
const float K_HISTORY_RADIUS = .08;

// The history has no mip chain, so minification is filtered by level-0 linear taps across the
// mapped footprint. Taps go through the triangle wave, so they stay correct across a mirror.
vec4 kHistory(vec2 p, vec2 dx, vec2 dy) {
  vec2 slope;
  vec2 uv = kPictureUv(p, slope);
  vec2 texels = vec2(textureSize(uKHistory, 0));
  float reach = max(length(dx * slope), length(dy * slope));
  float size = max(length(dx * slope * texels), length(dy * slope * texels));
  // At one texel or less a single linear tap is already right, and repeated blur would soften echoes.
  if (size <= 1.) return textureLod(uKHistory, uv, 0.);
  float spread = (size - 1.) / size * min(1., K_HISTORY_RADIUS / reach) / 16.;
  vec4 sum = vec4(0.);
  for (int i = 0; i < 8; i++) {
    vec2 offset = K_HISTORY_TAPS[i] * spread;
    vec2 unused;
    sum += textureLod(uKHistory, kPictureUv(p + dx * offset.x + dy * offset.y, unused), 0.);
  }
  return sum / 8.;
}

// Everything after the fold, for one footprint.
vec4 kShade(vec2 p, vec2 dx, vec2 dy) {
  p = kWarpAfter(p, dx, dy);
  if (uKFeedback > .5) {
    vec4 motif = kMotif(p, dx, dy);
    return motif + (1. - motif.a) * uKGain * kHistory(p, dx, dy);
  }
  return uKHasImage > .5 ? kImage(p, dx, dy) : kMotif(p, dx, dy);
}

// One filtered tap across a mirror would read picture from beyond the wall. Every pixel takes the
// same four rotated-grid taps, each with its own fold and half the footprint: because the filter is
// the same on and off a mirror, a fold line cannot look sharper or softer than its surroundings.
const vec2 K_FOLD_TAPS[4] = vec2[4](vec2(-.125, -.375), vec2(.375, -.125), vec2(.125, .375), vec2(-.375, .125));
vec4 kFoldedColor(vec2 p, vec2 dx, vec2 dy) {
  vec4 color = vec4(0.);
  for (int i = 0; i < 4; i++) {
    vec2 tapX = .5 * dx, tapY = .5 * dy;
    vec2 tap = foldDomain(p + K_FOLD_TAPS[i].x * dx + K_FOLD_TAPS[i].y * dy, tapX, tapY);
    tap = kWarpAfter(tap, tapX, tapY);
    color += .25 * (uKHasImage > .5 && uKFeedback < .5 ? kImage(tap, tapX, tapY) : kMotif(tap, tapX, tapY));
  }
  if (uKFeedback < .5) return color;
  // The history is read once: spreading taps here would blur it again on every echo.
  vec2 historyX = dx, historyY = dy;
  vec2 history = kWarpAfter(foldDomain(p, historyX, historyY), historyX, historyY);
  return color + (1. - color.a) * uKGain * kHistory(history, historyX, historyY);
}

vec4 kaleidoscopeColor(vec2 frame, vec2 dx, vec2 dy) {
  if (uKEmpty > .5) return vec4(0.);
  // A soft ring that sweeps out from the centre, so a morph never changes the whole frame at once.
  float front = uKMorphWave * 1.84 - .12;
  gKMorph = uKMorphTo < 0 ? 0. : 1. - smoothstep(front - .12, front + .12, length(frame));
  frame = kBend(frame, dx, dy);
  float c = cos(uKSourceTurn), s = sin(uKSourceTurn);
  mat2 turn = mat2(c, s, -s, c) / uKSourceScale;
  vec2 drift = .25 * uKSourceDrift * vec2(cos(uKPhase), sin(uKPhase));
  vec2 p = turn * (frame - vec2(uKSourceX, uKSourceY) - drift);
  dx = turn * dx; dy = turn * dy;
  p = kWarpBefore(p, dx, dy);
  if (uKSpiral == 1) {
    p = spiralDomain(p, dx, dy);
    p.x += uKZoom;
    return kShade(p, dx, dy);
  }
  return kFoldedColor(p / uKCell, dx / uKCell, dy / uKCell);
}
`;

export const kaleidoscopeFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform mat3 uView;
uniform float uAspect;
${kaleidoscopeGLSL}
void main() {
  // The only screen derivative: taken before any fold, log or wrap.
  vec2 frame = ((uView * vec3(vUv, 1.)).xy - .5) * vec2(uAspect, 1.);
  gl_FragColor = kaleidoscopeColor(frame, dFdx(frame), dFdy(frame));
}
`;
