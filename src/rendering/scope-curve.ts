/**
 * The curve drawn by the Oscilloscope instrument: one closed line on a sphere.
 *
 * Each figure winds around the sphere a whole number of times (`turns`) while
 * swinging between the poles a whole number of times (`waves`). Whole numbers
 * keep the line closed. The sphere then tumbles about two axes by a whole
 * number of turns per loop, so the last frame meets the first exactly.
 *
 * Everything here is plain maths with no drawing, so it can be unit tested.
 */
const TAU = Math.PI * 2;

export interface ScopeFigure {
  name: string;
  /** Times round the sphere. */
  turns: number;
  /** Swings between the poles. */
  waves: number;
  /** How far towards the poles it swings, in radians (below a quarter turn). */
  swing: number;
  /** Where in the swing the line starts, in turns. */
  shift: number;
}

/** Curated figures. Most combinations of raw numbers are ugly; these are not. */
export const SCOPE_FIGURES: readonly ScopeFigure[] = [
  { name: 'Seam', turns: 1, waves: 2, swing: .85, shift: 0 },
  { name: 'Orbit', turns: 1, waves: 1, swing: 1.0, shift: 0 },
  { name: 'Trefoil', turns: 1, waves: 3, swing: .7, shift: 0 },
  { name: 'Atom', turns: 3, waves: 2, swing: 1.0, shift: .125 },
  { name: 'Coil', turns: 5, waves: 1, swing: 1.2, shift: 0 },
  { name: 'Weave', turns: 3, waves: 4, swing: .9, shift: 0 },
  { name: 'Knot', turns: 2, waves: 3, swing: 1.0, shift: 0 },
  { name: 'Tangle', turns: 7, waves: 5, swing: 1.25, shift: 0 },
];

export const scopeFigure = (index: number): ScopeFigure =>
  SCOPE_FIGURES[Math.max(0, Math.min(SCOPE_FIGURES.length - 1, Math.round(index)))];

/** A point of a figure on the unit sphere, for s from 0 to 1 along the line. */
export function scopeFigurePoint(figure: ScopeFigure, s: number, out: number[] = [0, 0, 0]): number[] {
  const around = TAU * figure.turns * s;
  const up = figure.swing * Math.sin(TAU * (figure.waves * s + figure.shift));
  const c = Math.cos(up);
  out[0] = c * Math.cos(around); out[1] = Math.sin(up); out[2] = c * Math.sin(around);
  return out;
}

export interface ScopeMotion { tilt: number; tumbleX: number; tumbleY: number }

/** Row-major 3×3 rotation of the sphere at this phase of the loop (radians, 0 to 2π). */
export function scopeRotation(motion: ScopeMotion, phase: number): number[] {
  // A fixed lean first, so a figure is never seen exactly edge-on, then the tumble.
  const tilt = motion.tilt, ax = Math.round(motion.tumbleX) * phase, ay = Math.round(motion.tumbleY) * phase;
  const ct = Math.cos(tilt), st = Math.sin(tilt), cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  // R = Ry(ay) · Rx(ax) · Rz(tilt)
  const z = [ct, -st, 0, st, ct, 0, 0, 0, 1];
  const x = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  return multiply(y, multiply(x, z));
}

function multiply(a: number[], b: number[]): number[] {
  const m = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return m;
}

/** Everything that sets the shape of the line, apart from how the sphere is turned. */
export interface ScopeShape {
  figure: number;
  /** The figure the line morphs towards. */
  figureB: number;
  /** How far towards the second figure it goes, 0 to 1. */
  morph: number;
  /** Share of the loop spent resting on each figure, 0 to 0.9. */
  hold: number;
  /** Size of the fast ripple riding on the line, 0 to 1. */
  wiggle: number;
  /** Ripples along the whole line; rounded to a whole number so the line stays closed. */
  wiggleFrequency: number;
  /** 0 ripples the whole line all the time; 1 gathers the ripple into patches that come and go. */
  wiggleBursts: number;
}
export const SCOPE_PLAIN: Omit<ScopeShape, 'figure'> = { figureB: 0, morph: 0, hold: 0, wiggle: 0, wiggleFrequency: 36, wiggleBursts: 0 };

/**
 * How far the line has morphed at this phase: it rests on the first figure,
 * moves to the second, rests there, and moves back, once per loop.
 */
export function scopeMorphWeight(phase: number, hold: number): number {
  const u = ((phase / TAU) % 1 + 1) % 1, there = u < .5 ? u * 2 : 2 - u * 2;
  const rest = Math.max(0, Math.min(.9, hold));
  const t = Math.max(0, Math.min(1, (there - rest / 2) / (1 - rest)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The line before the sphere is turned: the two figures blended, on or just inside the sphere. */
function blended(a: ScopeFigure, b: ScopeFigure, weight: number, s: number, out: number[], scratch: number[]): void {
  scopeFigurePoint(a, s, out);
  if (weight <= 0) return;
  scopeFigurePoint(b, s, scratch);
  const x = out[0] + (scratch[0] - out[0]) * weight, y = out[1] + (scratch[1] - out[1]) * weight, z = out[2] + (scratch[2] - out[2]) * weight;
  // Push the blend back out to the sphere. Where the two figures are on
  // opposite sides the blend passes near the centre, and pushing it all the
  // way out would tear the line, so there it is allowed to cut through the
  // inside of the sphere instead.
  const length = Math.max(Math.hypot(x, y, z), .4);
  out[0] = x / length; out[1] = y / length; out[2] = z / length;
}

/**
 * The whole line at one moment: count + 1 points (x, y, z on the unit sphere,
 * z towards the viewer), the last equal to the first.
 */
export function scopeLine(shape: ScopeShape, motion: ScopeMotion, phase: number, count: number, out: Float32Array = new Float32Array((count + 1) * 3)): Float32Array {
  const a = scopeFigure(shape.figure), b = scopeFigure(shape.figureB), r = scopeRotation(motion, phase);
  const weight = shape.morph * scopeMorphWeight(phase, shape.hold);
  const p = [0, 0, 0], q = [0, 0, 0], scratch = [0, 0, 0];
  const size = shape.wiggle * .2, ripples = Math.max(1, Math.round(shape.wiggleFrequency)), second = Math.max(1, Math.round(ripples * 1.7));
  for (let i = 0; i <= count; i++) {
    // The last point is computed at s = 0, so the line closes exactly.
    const s = i === count ? 0 : i / count;
    blended(a, b, weight, s, p, scratch);
    if (size > 0) {
      // Push the point sideways, across the line and along the sphere.
      blended(a, b, weight, s + 1e-4, q, scratch);
      const tx = q[0] - p[0], ty = q[1] - p[1], tz = q[2] - p[2];
      let sx = p[1] * tz - p[2] * ty, sy = p[2] * tx - p[0] * tz, sz = p[0] * ty - p[1] * tx;
      const side = Math.hypot(sx, sy, sz) || 1;
      sx /= side; sy /= side; sz /= side;
      // Two ripples at unrelated rates read as jagged rather than as a neat wave.
      // Both crawl along the line a whole number of times per loop.
      const ripple = Math.sin(TAU * ripples * s + 3 * phase) + .5 * Math.sin(TAU * second * s - 2 * phase + 1.3);
      // Bursts: two patches travel round the line, and swell and fade once per loop.
      const patch = Math.max(0, Math.sin(TAU * 2 * s - phase)), swell = .5 - .5 * Math.cos(phase);
      const amount = size * ripple * (1 - shape.wiggleBursts + shape.wiggleBursts * patch * patch * swell * 1.6);
      // Keep the point at the distance from the centre it already had.
      const from = Math.hypot(p[0], p[1], p[2]), x = p[0] + sx * amount, y = p[1] + sy * amount, z = p[2] + sz * amount, k = from / Math.hypot(x, y, z);
      p[0] = x * k; p[1] = y * k; p[2] = z * k;
    }
    out[i * 3] = r[0] * p[0] + r[1] * p[1] + r[2] * p[2];
    out[i * 3 + 1] = r[3] * p[0] + r[4] * p[1] + r[5] * p[2];
    out[i * 3 + 2] = r[6] * p[0] + r[7] * p[1] + r[8] * p[2];
  }
  return out;
}

/** One plain figure, with no morph or wiggle. */
export function scopeCurve(figureIndex: number, motion: ScopeMotion, phase: number, count: number, out?: Float32Array): Float32Array {
  return scopeLine({ figure: figureIndex, ...SCOPE_PLAIN }, motion, phase, count, out);
}

/**
 * Brightness of the travelling dashes at s along the line. Dashes are evenly
 * spaced and travel a whole number of times round the line per loop, so the
 * loop closes. With amount 0 the line is evenly lit.
 */
export function scopeDash(s: number, phase: number, amount: number, count: number, length: number, speed: number): number {
  if (amount <= 0) return 1;
  const along = ((Math.round(count) * s - Math.round(speed) * phase / TAU) % 1 + 1) % 1;
  const duty = Math.max(.02, Math.min(.98, length)), soft = Math.min(.08, duty * .5, (1 - duty) * .5);
  const on = Math.min(1, along / soft) * Math.min(1, Math.max(0, (duty - along) / soft));
  // Between dashes the line dims; inside one it burns several times brighter.
  return 1 - amount * .75 + amount * 4 * Math.max(0, on);
}

/** Distance of the viewer from the sphere's centre, in sphere radii. */
export const SCOPE_VIEW_DISTANCE = 3.4;
/** How much larger a point at depth z appears than one at the centre. */
export const scopePerspective = (z: number) => SCOPE_VIEW_DISTANCE / (SCOPE_VIEW_DISTANCE - z);
