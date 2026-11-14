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

/**
 * The whole line at one moment: count + 1 points (x, y, z on the unit sphere,
 * z towards the viewer), the last equal to the first.
 */
export function scopeCurve(figureIndex: number, motion: ScopeMotion, phase: number, count: number, out = new Float32Array((count + 1) * 3)): Float32Array {
  const figure = scopeFigure(figureIndex), r = scopeRotation(motion, phase), p = [0, 0, 0];
  for (let i = 0; i <= count; i++) {
    // The last point is computed at s = 0, so the line closes exactly.
    scopeFigurePoint(figure, i === count ? 0 : i / count, p);
    out[i * 3] = r[0] * p[0] + r[1] * p[1] + r[2] * p[2];
    out[i * 3 + 1] = r[3] * p[0] + r[4] * p[1] + r[5] * p[2];
    out[i * 3 + 2] = r[6] * p[0] + r[7] * p[1] + r[8] * p[2];
  }
  return out;
}

/** Distance of the viewer from the sphere's centre, in sphere radii. */
export const SCOPE_VIEW_DISTANCE = 3.4;
/** How much larger a point at depth z appears than one at the centre. */
export const scopePerspective = (z: number) => SCOPE_VIEW_DISTANCE / (SCOPE_VIEW_DISTANCE - z);
