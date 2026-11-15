/**
 * The line drawn by the Oscilloscope instrument.
 *
 * As on a real oscilloscope in X-Y mode, the beam is steered by signals: one
 * oscillator for across, one for up, and a third for depth. Each runs a whole
 * number of times along the line, so the line closes. The figure is not a
 * solid object that turns: it moves because the oscillators slip against each
 * other in phase, a whole number of times per loop, so it folds, opens and
 * collapses and the last frame meets the first exactly.
 *
 * Everything here is plain maths with no drawing, so it can be unit tested.
 */
const TAU = Math.PI * 2;

export interface ScopeFigure {
  name: string;
  /** Cycles of the across, up and depth oscillators along the line. */
  x: number; y: number; z: number;
  /** Where each oscillator starts, in turns. */
  px: number; py: number; pz: number;
}

/** Curated frequency ratios. Simple ratios give calm figures, larger ones dense weaves. */
export const SCOPE_FIGURES: readonly ScopeFigure[] = [
  { name: 'Ellipse 1:1', x: 1, y: 1, z: 1, px: .25, py: 0, pz: .125 },
  { name: 'Eight 1:2', x: 1, y: 2, z: 1, px: 0, py: 0, pz: .25 },
  { name: 'Pretzel 3:2', x: 3, y: 2, z: 1, px: .25, py: 0, pz: .1 },
  { name: 'Trefoil 1:3', x: 1, y: 3, z: 2, px: .25, py: 0, pz: .15 },
  { name: 'Knot 3:4', x: 3, y: 4, z: 1, px: .25, py: 0, pz: .2 },
  { name: 'Weave 5:3', x: 5, y: 3, z: 2, px: .25, py: 0, pz: .05 },
  { name: 'Star 5:4', x: 5, y: 4, z: 3, px: .25, py: 0, pz: .3 },
  { name: 'Tangle 7:5', x: 7, y: 5, z: 3, px: .25, py: 0, pz: .2 },
];

export const scopeFigure = (index: number): ScopeFigure =>
  SCOPE_FIGURES[Math.max(0, Math.min(SCOPE_FIGURES.length - 1, Math.round(index)))];

/** One oscillator. Overtones add a second and third harmonic, bending the pure sine. */
function oscillator(angle: number, overtones: number): number {
  if (overtones <= 0) return Math.sin(angle);
  return (Math.sin(angle) + overtones * (.34 * Math.sin(2 * angle + .9) + .22 * Math.sin(3 * angle + 2.3))) / (1 + .56 * overtones);
}

/**
 * A point of a figure for s from 0 to 1 along the line, each coordinate
 * between -1 and 1. `slip` is how far the oscillators have slipped against
 * each other, in radians: across runs ahead by it and depth falls behind.
 */
export function scopeFigurePoint(figure: ScopeFigure, s: number, out: number[] = [0, 0, 0], slip = 0, overtones = 0): number[] {
  const a = TAU * s;
  out[0] = oscillator(figure.x * a + TAU * figure.px + slip, overtones);
  out[1] = oscillator(figure.y * a + TAU * figure.py, overtones);
  out[2] = oscillator(figure.z * a + TAU * figure.pz - slip, overtones);
  return out;
}

export interface ScopeMotion {
  tilt: number; tumbleX: number; tumbleY: number;
  /** 0 turns at a steady rate like a machine; 1 speeds up, slows and rocks as if floating. */
  float?: number;
}

/** Row-major 3×3 rotation of the sphere at this phase of the loop (radians, 0 to 2π). */
export function scopeRotation(motion: ScopeMotion, phase: number): number[] {
  // A fixed lean first, so a figure is never seen exactly edge-on, then the tumble.
  // Float adds terms that repeat once or twice per loop, so the loop still closes.
  const f = motion.float ?? 0;
  const tilt = motion.tilt + f * .22 * Math.sin(2 * phase + 2.1);
  const ax = Math.round(motion.tumbleX) * phase + f * .45 * Math.sin(phase + .7);
  const ay = Math.round(motion.tumbleY) * phase + f * .45 * Math.sin(phase + 3.9) + f * .12 * Math.sin(3 * phase);
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

/** Everything that sets the shape of the line, apart from how it is viewed. */
export interface ScopeShape {
  figure: number;
  /** The figure the line morphs towards. */
  figureB: number;
  /** How far towards the second figure it goes, 0 to 1. */
  morph: number;
  /** Share of the loop spent resting on each figure, 0 to 0.9. */
  hold: number;
  /** Whole turns the oscillators slip against each other per loop. This is what moves the figure. */
  drift: number;
  /** Bends the oscillators away from a pure sine, 0 to 1. */
  overtones: number;
  /** Slow, wide undulation of the whole line, 0 to 1. */
  sway: number;
  /** Size of the fast signal riding on the line, 0 to 1. */
  wiggle: number;
  /** Roughly how many ripples of signal fit along the whole line. */
  wiggleFrequency: number;
  /** 0 ripples the whole line all the time; 1 gathers the ripple into patches that come and go. */
  wiggleBursts: number;
}
export const SCOPE_PLAIN: Omit<ScopeShape, 'figure'> = { figureB: 0, morph: 0, hold: 0, drift: 0, overtones: 0, sway: 0, wiggle: 0, wiggleFrequency: 36, wiggleBursts: 0 };

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

/** The figure fills this share of the ring, so its corners stay inside. */
const FIGURE_SCALE = .64;

/** Samples in the wave the renderer uses for the main line. */
export const SCOPE_WAVE = 2048;
// The slow sway: a few wide waves that crawl round the line at different whole rates.
const SWAY = [[2, 1, .5, .3], [3, -1, .35, 2.1], [5, 2, .2, 4.4], [4, -2, .25, 5.6]];
// The fast signal: partials at unrelated pitches, each crawling at its own
// whole rate, so the sum never settles into a neat repeating zigzag.
const SIGNAL = [[1, 3, 1, 0], [1.37, -2, .6, 1.3], [1.93, 5, .45, 2.9], [2.61, -4, .3, 4.1], [.53, 1, .7, 5.2], [.71, -1, .5, .8]];
const SIGNAL_NORM = Math.hypot(...SIGNAL.map(p => p[2]));

/**
 * The wave: a signal added on top of the oscillators, at evenly spaced points
 * round the line (any number of them). It is fed to the three axes a little
 * apart in time, as the two channels of a stereo sound would be. This is where
 * sound will go: an audio waveform can be added to or put in place of the
 * signal here, and nothing else needs to change.
 */
export function scopeWave(shape: ScopeShape, phase: number, out: Float32Array = new Float32Array(SCOPE_WAVE)): Float32Array {
  const n = out.length, sway = shape.sway * .2, size = shape.wiggle * .17 / SIGNAL_NORM;
  if (sway <= 0 && size <= 0) return out.fill(0);
  const base = Math.max(1, shape.wiggleFrequency), swell = .5 - .5 * Math.cos(phase);
  // Whole numbers of ripples keep the line closed.
  const pitch = SIGNAL.map(p => Math.min(200, Math.max(1, Math.round(base * p[0]))));
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n;
    let value = 0;
    if (sway > 0) for (const w of SWAY) value += sway * w[2] * Math.sin(w[0] * a + w[1] * phase + w[3]);
    if (size > 0) {
      let signal = 0;
      for (let k = 0; k < SIGNAL.length; k++) signal += SIGNAL[k][2] * Math.sin(pitch[k] * a + SIGNAL[k][1] * phase + SIGNAL[k][3]);
      // Loud and quiet stretches wander round the line, as they do in speech or music.
      const level = .4 + .6 * (.5 + .5 * Math.sin(2 * a + 2 * phase + 1.2 * Math.sin(a - phase)));
      // Bursts: two patches travel round the line, and swell and fade once per loop.
      const patch = Math.max(0, Math.sin(2 * a - phase));
      value += size * signal * level * (1 - shape.wiggleBursts + shape.wiggleBursts * patch * patch * swell * 1.6);
    }
    out[i] = value;
  }
  return out;
}

/**
 * The whole line at one moment: count + 1 points (x, y, z, with z towards the
 * viewer), the last equal to the first. Pass `wave` to supply the added signal
 * yourself; otherwise it is worked out from the shape.
 */
export function scopeLine(shape: ScopeShape, motion: ScopeMotion, phase: number, count: number, out: Float32Array = new Float32Array((count + 1) * 3), wave?: Float32Array): Float32Array {
  const a = scopeFigure(shape.figure), b = scopeFigure(shape.figureB), r = scopeRotation(motion, phase);
  const weight = shape.morph * scopeMorphWeight(phase, shape.hold), slip = Math.round(shape.drift) * phase;
  const p = [0, 0, 0], q = [0, 0, 0];
  const moving = shape.sway > 0 || shape.wiggle > 0 || wave !== undefined;
  const push = moving ? wave ?? scopeWave(shape, phase) : undefined, n = push?.length ?? 0;
  // Up and depth hear the signal a quarter and most of a ripple later than across,
  // so the signal swings the beam round rather than along one fixed direction.
  const late = 1 / Math.max(4, shape.wiggleFrequency);
  const read = (s: number) => { const at = (s % 1) * n, lower = Math.floor(at), mix = at - lower; return push![lower % n] * (1 - mix) + push![(lower + 1) % n] * mix; };
  for (let i = 0; i <= count; i++) {
    // The last point is computed at s = 0, so the line closes exactly.
    const s = i === count ? 0 : i / count;
    scopeFigurePoint(a, s, p, slip, shape.overtones);
    if (weight > 0) {
      scopeFigurePoint(b, s, q, slip, shape.overtones);
      for (let k = 0; k < 3; k++) p[k] += (q[k] - p[k]) * weight;
    }
    let x = p[0] * FIGURE_SCALE, y = p[1] * FIGURE_SCALE, z = p[2] * FIGURE_SCALE;
    if (push) { x += read(s); y += read(s + .25 * late); z += .6 * read(s + .6 * late); }
    out[i * 3] = r[0] * x + r[1] * y + r[2] * z;
    out[i * 3 + 1] = r[3] * x + r[4] * y + r[5] * z;
    out[i * 3 + 2] = r[6] * x + r[7] * y + r[8] * z;
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

/** Distance of the viewer from the centre of the figure, in ring radii. */
export const SCOPE_VIEW_DISTANCE = 3.4;
/** How much larger a point at depth z appears than one at the centre. */
export const scopePerspective = (z: number) => SCOPE_VIEW_DISTANCE / (SCOPE_VIEW_DISTANCE - z);
