import { GROUP_TABLES, SYMMETRY_GROUPS, sanitiseSpiral } from '../core/kaleidoscope-math';
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
  return {
    uKInput: control(layer, 'input', true),
    uKGroup: control(layer, 'group', true),
    uKSectors: control(layer, 'sectors', true),
    uKCell: control(layer, 'cell'),
    uKSpiral: spiral,
    uKSpiralA: a + 0,
    uKSpiralB: b + 0,
    uKSpiralScale: Math.max(1 + 1e-6, control(layer, 'spiralScale')),
    uKZoomCycles: zoomCycles,
    uKZoom: zoomCycles * loop,
    uKCycles: cycles,
    uKPhase: (turns - Math.floor(turns)) * TAU,
    uKSourceX: control(layer, 'sourceX'),
    uKSourceY: control(layer, 'sourceY'),
    uKSourceScale: control(layer, 'sourceScale'),
    uKSourceTurn: control(layer, 'sourceTurn'),
    uKSourceDrift: control(layer, 'sourceDrift'),
    uKWarpIn: control(layer, 'warpIn'),
    uKWarpOut: control(layer, 'warpOut'),
    uKMotif: control(layer, 'motif', true),
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
uniform int uKGroup, uKSpiral, uKSpiralA, uKSpiralB, uKMotif;
uniform float uKSectors, uKCell, uKSpiralScale, uKZoom, uKPhase;
uniform float uKSourceX, uKSourceY, uKSourceScale, uKSourceTurn, uKSourceDrift;
uniform float uKWarpIn, uKWarpOut, uKMotifScale, uKLineWidth, uKHasImage;
uniform vec2 uKImageFit;
uniform vec3 uKPalette[6];
uniform sampler2D uKImage;
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
  vec2 inverse = vec2(z.x, -z.y) / r2;
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

vec3 kLineField(vec2 q, vec2 dx, vec2 dy) {
  float t = K_TAU * q.x;
  // Four lines per tile: a whole count, so the field still repeats once per unit of q.
  float height = 4. * q.y + .55 * sin(t + uKPhase) + .18 * sin(2. * t - 2. * uKPhase);
  vec2 slope = vec2(K_TAU * (.55 * cos(t + uKPhase) + .36 * cos(2. * t - 2. * uKPhase)), 4.);
  float w = kWeight();
  float cover = kPulse(height, w, abs(dot(slope, dx)) + abs(dot(slope, dy)));
  vec3 ground = uKPalette[5];
  vec3 ink = mix(uKPalette[0], uKPalette[2], .5 + .5 * cos(t));
  vec3 average = mix(ground, .5 * (uKPalette[0] + uKPalette[2]), 2. * w);
  return mix(mix(ground, ink, cover), average, kFade(dx, dy));
}

float kSquare(vec2 q, float w, vec2 footprint) { return kPulse(q.x, w, footprint.x) * kPulse(q.y, w, footprint.y); }

vec3 kSquareTile(vec2 q, vec2 dx, vec2 dy) {
  vec2 footprint = abs(dx) + abs(dy);
  // Off the mirror lines, so the fold shows in the tile instead of landing on its symmetry.
  q += vec2(.19, .07) + .04 * vec2(cos(uKPhase), sin(uKPhase));
  const float outer = .42;
  float inner = outer - kWeight();
  float core = .15 + .05 * sin(uKPhase);
  float ring = kSquare(q, outer, footprint) - kSquare(q, inner, footprint);
  float centre = kSquare(q, core, footprint);
  vec3 ground = uKPalette[5];
  vec3 color = ground * (1. - ring - centre) + uKPalette[1] * ring + uKPalette[3] * centre;
  float ringArea = 4. * (outer * outer - inner * inner), coreArea = 4. * core * core;
  vec3 average = ground * (1. - ringArea - coreArea) + uKPalette[1] * ringArea + uKPalette[3] * coreArea;
  return mix(color, average, kFade(dx, dy));
}

float kDisc(vec2 q, vec2 centre, float radius, float footprint) {
  vec2 d = q - centre;
  d -= floor(d + .5);
  return clamp((radius - length(d)) / footprint + .5, 0., 1.);
}

// Each disc drifts around its own home, so parity changes only where an edge passes.
vec3 kCircleParity(vec2 q, vec2 dx, vec2 dy) {
  float footprint = max(length(dx) + length(dy), 1e-5);
  const vec3 radii = vec3(.33, .29, .24);
  float a = kDisc(q, vec2(.5) + .07 * vec2(cos(uKPhase), sin(uKPhase)), radii.x, footprint);
  float b = kDisc(q, vec2(.25, .75) + .06 * vec2(cos(2. * uKPhase), sin(uKPhase)), radii.y, footprint);
  float c = kDisc(q, vec2(.75, .25) + .05 * vec2(sin(uKPhase), cos(2. * uKPhase)), radii.z, footprint);
  float parity = a + b - 2. * a * b;
  parity = parity + c - 2. * parity * c;
  vec3 ground = uKPalette[5];
  vec3 ink = mix(uKPalette[4], uKPalette[2], .5 + .5 * cos(K_TAU * (q.x + q.y)));
  vec3 areas = K_PI * radii * radii;
  float meanParity = .5 * (1. - (1. - 2. * areas.x) * (1. - 2. * areas.y) * (1. - 2. * areas.z));
  vec3 average = mix(ground, .5 * (uKPalette[4] + uKPalette[2]), meanParity);
  return mix(mix(ground, ink, parity), average, kFade(dx, dy));
}

vec4 kMotif(vec2 p, vec2 dx, vec2 dy) {
  vec2 q = p * uKMotifScale;
  dx *= uKMotifScale; dy *= uKMotifScale;
  vec3 color = uKMotif == 0 ? kLineField(q, dx, dy) : uKMotif == 1 ? kSquareTile(q, dx, dy) : kCircleParity(q, dx, dy);
  return vec4(color, 1.);
}

// One filtered tap, read through a period-1 triangle wave so it closes around the spiral.
vec4 kImage(vec2 p, vec2 dx, vec2 dy) {
  float scale = uKSpiral == 1 ? 1. : .5;
  vec2 x = fract(uKSpiral == 1 ? p : .75 + scale * p);
  vec2 slope = 2. * scale * vec2(x.x > .5 ? 1. : -1., x.y > .5 ? 1. : -1.) * uKImageFit;
  vec2 uv = .5 + (abs(2. * x - 1.) - .5) * uKImageFit;
  return textureGrad(uKImage, uv, dx * slope, dy * slope);
}

vec4 kaleidoscopeColor(vec2 frame, vec2 dx, vec2 dy) {
  float c = cos(uKSourceTurn), s = sin(uKSourceTurn);
  mat2 turn = mat2(c, s, -s, c) / uKSourceScale;
  vec2 drift = .25 * uKSourceDrift * vec2(cos(uKPhase), sin(uKPhase));
  vec2 p = turn * (frame - vec2(uKSourceX, uKSourceY) - drift);
  dx = turn * dx; dy = turn * dy;
  p = kWarpBefore(p, dx, dy);
  if (uKSpiral == 1) {
    p = spiralDomain(p, dx, dy);
    p.x += uKZoom;
  } else {
    p /= uKCell; dx /= uKCell; dy /= uKCell;
    p = foldDomain(p, dx, dy);
  }
  p = kWarpAfter(p, dx, dy);
  return uKHasImage > .5 ? kImage(p, dx, dy) : kMotif(p, dx, dy);
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
