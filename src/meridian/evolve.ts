import type { DisplayList } from './display-list';
import { MERIDIAN_PARAMETERS } from './parameters';
import { createRandom } from './random';
import { PRIMITIVE } from './types';

/**
 * Evolve: one radial structure that is always present and always becoming something else.
 *
 * A fixed cast of voices (rings, spokes, nodes, a hero) lives for the whole piece. A form is a place for every voice to
 * be. The journey glides from form to form, with each voice leading or lagging, so nothing is ever cut. A voice a form
 * does not need rests exactly on its parent, so rings split and merge and spokes fan out and fold back. Rhythm is carried
 * only by light. The display list has the same layout every frame, so an element can be followed from frame to frame.
 */

export const SCORE_STYLE_EVOLVE = 2;
export const RING_VOICES = 14;
export const SPOKE_VOICES = 24;
export const NODE_VOICES = 72;
export const ARC_SLOTS = 12;
export const GLITCH_SHARDS = 8;
/** Elements in the list before any glitch shards: arcs, spoke halves, nodes, two hero rings, a hub ring and a hub dot. */
export const EVOLVE_ELEMENTS = RING_VOICES * ARC_SLOTS + SPOKE_VOICES * 2 + NODE_VOICES + 2 + 2;
export const FORM_SECONDS = 55; // The average form at the centre of Evolution. Single forms run from about 22 to 88 seconds.

const TAU = Math.PI * 2;
const REFERENCE_HEIGHT = 1080;
const FORM_SWING = 0.3;
const TURN_RADIANS = 3.4 * Math.PI / 180; // Per second at centre Speed: slow enough to watch a single spoke travel.
const CLOSURE_STEP = Math.PI / 6; // The home form looks identical after this turn, so an export can close without a rewind.
const GLIDE_SECONDS = 16;
const NEXT_SECONDS = 11;
const SHORTEST_MORPH = 11; // However restless Evolution is, one form takes at least this long to become the next.
const FULL_PATH_SECONDS = 46; // An export shorter than this travels only part of the way to its second form and back.
const TIER_RATES = [1, -0.618, 0.382];
const TIER_WINDS = [1, -1, 1];

const RING_FIELDS = 5 + ARC_SLOTS * 2;
const SPOKE_FIELDS = 6;
const NODE_FIELDS = 3;
const HERO_FIELDS = 6;
const SPOKE_BASE = RING_VOICES * RING_FIELDS;
const NODE_BASE = SPOKE_BASE + SPOKE_VOICES * SPOKE_FIELDS;
const HERO_BASE = NODE_BASE + NODE_VOICES * NODE_FIELDS;
const POSE_SIZE = HERO_BASE + HERO_FIELDS;
const R_RADIUS = 0, R_X = 1, R_Y = 2, R_WIDTH = 3, R_ALPHA = 4, R_ARCS = 5;
const S_ANGLE = 0, S_INNER = 1, S_OUTER = 2, S_ALPHA = 3, S_WIDTH = 4, S_MIRROR = 5;
const N_ANGLE = 0, N_ALPHA = 1, N_SIZE = 2;
const H_RADIUS = 0, H_X = 1, H_Y = 2, H_WIDTH = 3, H_ALPHA = 4, H_GLOW = 5;

const AXIS = 0, NEST = 1, WHEEL = 2, ORBITS = 3, ROSETTE = 4, LATTICE = 5, HORIZON = 6, GATES = 7, VESICA = 8, HOME = 9;
const JOURNEY_KINDS = 9;
const ARC_COUNTS = [1, 2, 3, 4, 6];

/** Values a performer can move, with how much of their range they may travel in a second. */
const SMOOTHED: readonly (readonly [string, number])[] = [
  ['macroDensity', 0.16], ['macroTension', 0.5], ['macroOrder', 0.5], ['macroSpeed', 0.8], ['macroWeight', 0.5], ['macroGlitch', 0.8], ['macroHeat', 0.5], ['macroScale', 0.15],
  ['ringCount', 0.05], ['ringWeight', 0.1], ['ringOpacity', 0.5], ['ringArcShare', 0.25], ['ringRotationSpeed', 0.25], ['ringCounterRotation', 0.5],
  ['spokeCount', 0.03], ['spokeWeight', 0.1], ['spokeOpacity', 0.5], ['spokeInnerReach', 0.2], ['spokeOuterReach', 0.2], ['spokeOffsetAngle', 0.03],
  ['nodeDensity', 0.2], ['nodeSize', 0.1], ['nodeGlow', 0.25], ['nodeOpacity', 0.5],
  ['heroWeight', 0.1], ['heroGlow', 0.08], ['heroPulse', 0.5], ['heroRadius', 0.25], ['heroSplit', 0.25], ['heroHaloStrength', 0.25],
  ['lightExposure', 0.3], ['lightBloomAmount', 0.3], ['lightBloomSize', 0.3], ['lightLineGlow', 0.3], ['lightCore', 0.3], ['lightContrast', 0.3], ['colourSaturation', 0.3], ['colourFringe', 0.3], ['lightVignette', 0.3],
];
const SPANS = SMOOTHED.map(([key]) => { const d = MERIDIAN_PARAMETERS.find(item => item.key === key)!; return d.max - d.min; });

export interface EvolveMoves { next: boolean; hold: boolean; drop: boolean; collapse: boolean; burst: boolean }

/** Everything about a moment of the piece that is not the seed or a slider. */
export interface EvolveClock {
  exact: boolean; turn: number; duration: number;
  evolution: number; motion: number; beat: number;
  swell: number; gather: number;
  readonly ripples: Float32Array;
  glide: number;
  readonly from: Float32Array;
  readonly pose: Float32Array;
  schemeSeed: number;
}

export interface EvolveTransport {
  readonly clock: EvolveClock;
  readonly values: Record<string, number>;
  seed: number | null;
  lastPhase: number | null;
  evolveRate: number;
  chase: number | null;
  swellTarget: number;
  nextDown: boolean; dropDown: boolean; burstDown: boolean;
  nextRipple: number;
  evaluated: boolean;
}

class Form {
  seed = -1; index = Number.NaN; used = 0; kind = 0; rings = 1; spokes = 0; nodes = 0;
  readonly data = new Float32Array(POSE_SIZE);
  readonly ringParent = new Uint8Array(RING_VOICES);
  readonly spokeParent = new Uint8Array(SPOKE_VOICES);
}

const forms = Array.from({ length: 10 }, () => new Form());
const poseA = new Float32Array(POSE_SIZE);
const poseB = new Float32Array(POSE_SIZE);
const scratchPlace = new Float64Array(64);
const scratchKey = new Float64Array(64);
const scratchParent = new Uint8Array(64);
let useCounter = 0;

const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);
const unit = (value: number | undefined, fallback = 0.5): number => (Number.isFinite(value) ? clamp(value as number, 0, 1) : fallback);
const finite = (value: number | undefined, fallback: number): number => (Number.isFinite(value) ? value as number : fallback);
const smooth = (value: number): number => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const smoother = (value: number): number => { const t = clamp(value, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const windowed = (value: number, from: number, to: number): number => smoother((value - from) / (to - from));
const wrapAngle = (value: number): number => { const v = value % TAU; return v < 0 ? v + TAU : v; };
const shortest = (from: number, to: number): number => { let d = (to - from) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

function hash(seed: number, index: number, salt = 0): number {
  let value = Math.imul((seed >>> 0) ^ 0x51ed270b, 0x2c1b3c6d) ^ Math.imul(index + 11, 0x9e3779b1) ^ Math.imul(salt + 3, 0x27d4eb2f);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}
const hashUnit = (seed: number, index: number, salt = 0): number => hash(seed, index, salt) / 4294967296;

// Which voices fill a form first. Each new level lands between the voices already there, and rests on its nearest one.
function fillOrder(base: number, count: number, circular: boolean, parent: Uint8Array): void {
  const n = Math.max(1, base);
  let filled = 0;
  for (let level = 0; filled < count; level++) {
    const m = level === 0 ? n : n * 2 ** (level - 1);
    const size = Math.min(m, 64);
    for (let t = 0; t < size; t++) {
      let reversed = 0, bits = t, weight = 0.5;
      while (bits > 0) { if (bits & 1) reversed += weight; weight *= 0.5; bits >>= 1; }
      scratchKey[t] = reversed;
      scratchParent[t] = t;
    }
    for (let a = 1; a < size; a++) {
      const key = scratchKey[a], held = scratchParent[a];
      let b = a - 1;
      while (b >= 0 && scratchKey[b] > key) { scratchKey[b + 1] = scratchKey[b]; scratchParent[b + 1] = scratchParent[b]; b--; }
      scratchKey[b + 1] = key; scratchParent[b + 1] = held;
    }
    for (let t = 0; t < size && filled < count; t++) {
      const j = scratchParent[t], place = level === 0 ? j / n : (j + 0.5) / m;
      let best = filled > 0 ? 0 : filled, gap = Infinity;
      for (let k = 0; k < filled; k++) {
        const d = Math.abs(scratchPlace[k] - place), distance = circular ? Math.min(d, 1 - d) : d;
        if (distance < gap) { gap = distance; best = k; }
      }
      scratchPlace[filled] = place;
      parent[filled] = best;
      filled++;
    }
  }
}

function setArcs(data: Float32Array, at: number, count: number, open: number): void {
  const period = ARC_SLOTS / count, visible = (1 - open) * period;
  for (let slot = 0; slot < ARC_SLOTS; slot++) {
    const offset = slot % period;
    data[at + R_ARCS + slot * 2] = 0;
    data[at + R_ARCS + slot * 2 + 1] = clamp(visible - offset, 0, 1);
  }
}

function setRing(form: Form, voice: number, radius: number, x: number, y: number, width: number, alpha: number, arcs = 1, open = 0): void {
  const at = voice * RING_FIELDS, d = form.data;
  d[at + R_RADIUS] = radius; d[at + R_X] = x; d[at + R_Y] = y; d[at + R_WIDTH] = width; d[at + R_ALPHA] = alpha;
  setArcs(d, at, arcs, open);
}

function setSpoke(form: Form, voice: number, angle: number, inner: number, outer: number, alpha: number, width: number, mirror: number): void {
  const at = SPOKE_BASE + voice * SPOKE_FIELDS, d = form.data;
  d[at + S_ANGLE] = angle; d[at + S_INNER] = inner; d[at + S_OUTER] = outer; d[at + S_ALPHA] = alpha; d[at + S_WIDTH] = width; d[at + S_MIRROR] = mirror;
}

function setHero(form: Form, radius: number, x: number, y: number, width: number, alpha: number, glow: number): void {
  const at = HERO_BASE, d = form.data;
  d[at + H_RADIUS] = radius; d[at + H_X] = x; d[at + H_Y] = y; d[at + H_WIDTH] = width; d[at + H_ALPHA] = alpha; d[at + H_GLOW] = glow;
}

/** The kind of form at a place in the journey. It never repeats either of the two before it. */
function kindAt(seed: number, index: number): number {
  let previous = -1, before = -1, kind = hash(seed, 0, 7) % JOURNEY_KINDS;
  const from = Math.max(0, index - 12);
  if (from > 0) kind = hash(seed, from, 7) % JOURNEY_KINDS;
  for (let i = from; i <= index; i++) {
    let candidate = hash(seed, i, 7) % JOURNEY_KINDS;
    for (let tries = 1; candidate === previous || candidate === before; tries++) candidate = hash(seed, i, 7 + tries * 31) % JOURNEY_KINDS;
    before = previous; previous = candidate; kind = candidate;
  }
  return kind;
}

function compile(form: Form, seed: number, index: number): void {
  const random = createRandom(hash(seed, index, 101));
  const kind = index < 0 ? HOME : kindAt(seed, index);
  const turn = kind === HOME ? 0 : random() * TAU, d = form.data;
  form.seed = seed; form.index = index; form.kind = kind; form.nodes = 0;
  d.fill(0);
  let rings = 3, spokes = 2, circular = false, spokeSpan = Math.PI, spokeBase = turn, spokeInner = 0.035, spokeOuter = 0.86, spokeAlpha = 0.62, mirror = 1;
  let originX = 0, originY = 0;
  if (kind === AXIS) { rings = 1; spokes = 1; spokeOuter = 0.92; }
  else if (kind === NEST) { rings = 3 + Math.floor(random() * 3); spokes = random() < 0.5 ? 0 : 2; }
  else if (kind === WHEEL) { rings = 2; spokes = [5, 6, 8, 10][Math.floor(random() * 4)]; spokeInner = 0.06; spokeOuter = 0.43; }
  else if (kind === ORBITS) { rings = 3; circular = true; spokes = 2; }
  else if (kind === ROSETTE) { rings = [5, 6, 6, 8][Math.floor(random() * 4)]; circular = true; spokes = random() < 0.5 ? 0 : 3; spokeOuter = 0.5; }
  else if (kind === LATTICE) { rings = 3; spokes = 3; form.nodes = 36 + Math.floor(random() * 3) * 12; spokeOuter = 0.5; spokeAlpha = 0.42; }
  else if (kind === HORIZON) {
    // A vast system whose centre lies beyond one edge of the frame, so only its arcs cross the picture.
    const side = Math.floor(random() * 4), facing = side * Math.PI / 2 + Math.PI / 2, distance = side % 2 ? 1.52 : 1.02;
    rings = 4; spokes = 5; mirror = 0; spokeSpan = 1.05;
    originX = -Math.cos(facing) * distance; originY = -Math.sin(facing) * distance;
    spokeBase = facing - spokeSpan / 2 + (random() - 0.5) * 0.3; spokeInner = distance - 0.1; spokeOuter = distance + 1.1; spokeAlpha = 0.3;
  }
  else if (kind === GATES) { rings = 4; spokes = random() < 0.4 ? 1 : 0; spokeOuter = 0.54; }
  else if (kind === VESICA) { rings = 2; circular = true; spokes = 1; spokeOuter = 0.74; }
  else if (kind === HOME) { rings = 3; spokes = 6; spokeOuter = 0.62; spokeAlpha = 0.46; }
  form.rings = rings; form.spokes = spokes;

  fillOrder(rings, RING_VOICES, circular, form.ringParent);
  const places = scratchPlace;
  const axis = random() * TAU, largest = 0.44 + random() * 0.035, inmost = 0.075 + random() * 0.05;
  const orbit = 0.15 + random() * 0.07, orbitRadius = 0.2 + random() * 0.06, petal = 0.2 + random() * 0.03;
  const gateArcs = ARC_COUNTS[1 + Math.floor(random() * 3)], gateOpen = 0.32 + random() * 0.2;
  const apart = 0.13 + random() * 0.07, vesica = 0.28 + random() * 0.05;
  for (let voice = 0; voice < RING_VOICES; voice++) {
    const f = places[voice], base = voice < rings, line = base ? 1.25 : 0.95, ink = base ? 0.92 : 0.46;
    if (kind === AXIS) setRing(form, voice, largest * (1 - 0.72 * f), 0, 0, line, ink);
    else if (kind === NEST || kind === HOME) setRing(form, voice, largest * (inmost / largest) ** f, 0, 0, line, ink);
    else if (kind === WHEEL) setRing(form, voice, 0.43 * (0.4 ** (f * 1.15)), 0, 0, line, ink);
    else if (kind === ORBITS) { const a = axis + f * TAU; setRing(form, voice, orbitRadius * (base ? 1 : 0.72), Math.cos(a) * orbit, Math.sin(a) * orbit, line, ink); }
    else if (kind === ROSETTE) { const a = axis + f * TAU; setRing(form, voice, petal, Math.cos(a) * petal, Math.sin(a) * petal, line * 0.9, base ? 0.8 : 0.36); }
    else if (kind === LATTICE) setRing(form, voice, 0.44 * (0.4 ** f), 0, 0, line * 0.9, base ? 0.72 : 0.34);
    else if (kind === HORIZON) setRing(form, voice, Math.hypot(originX, originY) - 0.2 + f * 0.86, originX, originY, line, ink);
    else if (kind === GATES) setRing(form, voice, largest * (0.2 / largest) ** f, 0, 0, line * 1.08, ink, gateArcs, gateOpen * (voice % 2 ? 0.74 : 1));
    else { const side = f < 0.5 ? -1 : 1; setRing(form, voice, vesica * (1 - 0.34 * ((f * 2) % 1)), side * apart, 0, line, ink); }
  }

  fillOrder(spokes, SPOKE_VOICES, kind !== HORIZON, form.spokeParent);
  for (let voice = 0; voice < SPOKE_VOICES; voice++) {
    const f = scratchPlace[voice], base = voice < spokes, angle = spokeBase + f * spokeSpan;
    setSpoke(form, voice, angle, spokeInner, spokeOuter * (base ? 1 : 0.8), base ? spokeAlpha : spokeAlpha * 0.62, base ? 0.92 : 0.78, mirror);
  }

  const rows = 4, row = form.nodes / rows || 12;
  for (let node = 0; node < NODE_VOICES; node++) {
    const at = NODE_BASE + node * NODE_FIELDS, ringRow = node % rows, place = Math.floor(node / rows);
    d[at + N_ANGLE] = (place + (ringRow % 2) * 0.5) / row * TAU;
    d[at + N_ALPHA] = form.nodes > 0 && node < form.nodes ? 0.86 : 0;
    d[at + N_SIZE] = 0.003 + 0.0018 * ((place * 7 + ringRow * 3) % 5) / 5;
  }

  if (kind === AXIS) setHero(form, largest * 0.8, 0, 0, 3, 0.96, 0.36);
  else if (kind === NEST || kind === HOME) setHero(form, largest * (inmost / largest) ** (0.5 / rings), 0, 0, 2.4, 0.92, 0.3);
  else if (kind === WHEEL) setHero(form, 0.355, 0, 0, 2.6, 0.92, 0.32);
  else if (kind === ORBITS) setHero(form, orbit + orbitRadius, 0, 0, 1.6, 0.6, 0.16);
  else if (kind === ROSETTE) setHero(form, petal * 2.16, 0, 0, 2.1, 0.82, 0.26);
  else if (kind === LATTICE) setHero(form, 0.34, 0, 0, 1.8, 0.68, 0.2);
  else if (kind === HORIZON) setHero(form, Math.hypot(originX, originY) + 0.2, originX, originY, 3, 0.94, 0.4);
  else if (kind === GATES) setHero(form, largest * 0.68, 0, 0, 2.2, 0.82, 0.28);
  else setHero(form, vesica + apart, 0, 0, 1.5, 0.48, 0.14);

  // Each form sits at its own size and place in the frame, so the piece travels through its negative space.
  if (kind !== HOME && kind !== HORIZON) {
    const size = 0.74 + random() * 0.46, x = (random() - 0.5) * (1.18 - size) * 0.9, y = (random() - 0.5) * (1.18 - size) * 0.34;
    for (let voice = 0; voice < RING_VOICES; voice++) { const at = voice * RING_FIELDS; d[at + R_RADIUS] *= size; d[at + R_X] = d[at + R_X] * size + x; d[at + R_Y] = d[at + R_Y] * size + y; }
    for (let voice = 0; voice < SPOKE_VOICES; voice++) { const at = SPOKE_BASE + voice * SPOKE_FIELDS; d[at + S_INNER] *= size; d[at + S_OUTER] *= size; }
    d[HERO_BASE + H_RADIUS] *= size; d[HERO_BASE + H_X] = x; d[HERO_BASE + H_Y] = y;
  }
}

function formFor(seed: number, index: number): Form {
  let oldest = forms[0];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (form.seed === seed && form.index === index) { form.used = ++useCounter; return form; }
    if (form.used < oldest.used) oldest = form;
  }
  compile(oldest, seed, index);
  oldest.used = ++useCounter;
  return oldest;
}

// Single forms vary in length, and any moment of the journey can be found directly.
function boundary(seed: number, index: number): number {
  return (index + (hashUnit(seed, index, 59) - 0.5) * FORM_SWING * 2 * (index === 0 ? 0 : 1)) * FORM_SECONDS;
}

function segmentAt(seed: number, position: number): number {
  let index = Math.floor(position / FORM_SECONDS);
  while (index > 0 && boundary(seed, index) > position) index--;
  while (boundary(seed, index + 1) <= position) index++;
  return index;
}

/** The kind of form the journey is in at an evolution time: for tests and for naming a moment. */
export function evolveFormKind(seed: number, evolution: number): number {
  return kindAt(seed >>> 0, segmentAt(seed >>> 0, Math.max(0, evolution)));
}

function morphWindow(seed: number, index: number, position: number): number {
  const start = boundary(seed, index), end = boundary(seed, index + 1), length = end - start, glide = clamp(length * 0.62, 14, 36);
  return clamp((position - (end - glide)) / glide, 0, 1);
}

/** The furthest any visible voice has to travel between two forms, so a long journey can be given the time it needs. */
function travel(a: Form, b: Form): number {
  let most = 0;
  for (let voice = 0; voice < RING_VOICES; voice++) {
    const at = voice * RING_FIELDS, p = a.data, q = b.data;
    most = Math.max(most, Math.abs(p[at + R_RADIUS] - q[at + R_RADIUS]) + Math.hypot(p[at + R_X] - q[at + R_X], p[at + R_Y] - q[at + R_Y]));
  }
  for (let voice = 0; voice < SPOKE_VOICES; voice++) {
    const at = SPOKE_BASE + voice * SPOKE_FIELDS;
    most = Math.max(most, Math.abs(a.data[at + S_OUTER] - b.data[at + S_OUTER]) + Math.abs(shortest(a.data[at + S_ANGLE], b.data[at + S_ANGLE])) * Math.max(a.data[at + S_OUTER], b.data[at + S_OUTER]));
  }
  return most + Math.hypot(a.data[HERO_BASE + H_X] - b.data[HERO_BASE + H_X], a.data[HERO_BASE + H_Y] - b.data[HERO_BASE + H_Y]);
}

/** The fastest the journey clock may run through this morph. */
function morphRate(seed: number, index: number): number {
  const glide = clamp((boundary(seed, index + 1) - boundary(seed, index)) * 0.62, 14, 36);
  return glide / Math.max(SHORTEST_MORPH, travel(formFor(seed, index), formFor(seed, index + 1)) * 5.4);
}

/** Puts the voices a slider has asked for at their places, and every other voice on its parent. */
function project(form: Form, ringCount: number, spokeCount: number, nodeGain: number, out: Float32Array): void {
  out.set(form.data);
  for (let voice = 1; voice < RING_VOICES; voice++) {
    const presence = smooth(ringCount - voice), parent = form.ringParent[voice] * RING_FIELDS, at = voice * RING_FIELDS;
    for (let f = 0; f < RING_FIELDS; f++) if (f !== R_ALPHA) out[at + f] = out[parent + f] + (out[at + f] - out[parent + f]) * presence;
    out[at + R_ALPHA] *= presence;
  }
  for (let voice = 0; voice < SPOKE_VOICES; voice++) {
    const presence = smooth(spokeCount - voice), at = SPOKE_BASE + voice * SPOKE_FIELDS;
    if (voice > 0) {
      const parent = SPOKE_BASE + form.spokeParent[voice] * SPOKE_FIELDS;
      out[at + S_ANGLE] = out[parent + S_ANGLE] + shortest(out[parent + S_ANGLE], out[at + S_ANGLE]) * presence;
      for (const f of [S_INNER, S_OUTER, S_WIDTH, S_MIRROR]) out[at + f] = out[parent + f] + (out[at + f] - out[parent + f]) * presence;
    }
    out[at + S_ALPHA] *= presence;
  }
  for (let node = 0; node < NODE_VOICES; node++) {
    const at = NODE_BASE + node * NODE_FIELDS;
    out[at + N_ALPHA] *= smooth(form.nodes * nodeGain - node);
  }
}

function blendPose(out: Float32Array, a: Float32Array, b: Float32Array, amount: number): void {
  for (let voice = 0; voice < RING_VOICES; voice++) {
    const lag = voice / RING_VOICES * 0.38, m = windowed(amount, lag, lag + 0.62), at = voice * RING_FIELDS;
    for (let f = 0; f < RING_FIELDS; f++) out[at + f] = a[at + f] + (b[at + f] - a[at + f]) * m;
  }
  for (let voice = 0; voice < SPOKE_VOICES; voice++) {
    const lag = 0.08 + (SPOKE_VOICES - voice) / SPOKE_VOICES * 0.3, m = windowed(amount, lag, lag + 0.62), at = SPOKE_BASE + voice * SPOKE_FIELDS;
    out[at + S_ANGLE] = a[at + S_ANGLE] + shortest(a[at + S_ANGLE], b[at + S_ANGLE]) * m;
    for (let f = 1; f < SPOKE_FIELDS; f++) out[at + f] = a[at + f] + (b[at + f] - a[at + f]) * m;
  }
  for (let node = 0; node < NODE_VOICES; node++) {
    const lag = (node % 12) / 12 * 0.34, m = windowed(amount, lag, lag + 0.66), at = NODE_BASE + node * NODE_FIELDS;
    out[at + N_ANGLE] = a[at + N_ANGLE] + shortest(a[at + N_ANGLE], b[at + N_ANGLE]) * m;
    out[at + N_ALPHA] = a[at + N_ALPHA] + (b[at + N_ALPHA] - a[at + N_ALPHA]) * m;
    out[at + N_SIZE] = a[at + N_SIZE] + (b[at + N_SIZE] - a[at + N_SIZE]) * m;
  }
  const hero = windowed(amount, 0.14, 0.86);
  for (let f = 0; f < HERO_FIELDS; f++) out[HERO_BASE + f] = a[HERO_BASE + f] + (b[HERO_BASE + f] - a[HERO_BASE + f]) * hero;
}

const speedRate = (speed: number | undefined): number => 6 ** (unit(speed) * 2 - 1);

/** Evolution: frozen at 0, the designed pace at the centre, five times it at full. */
export function evolutionRate(params: Readonly<Record<string, number>>): number {
  if ((params.scoreHoldShape ?? 0) >= 0.5) return 0;
  const value = unit(params.scoreEvolution);
  if (value <= 0.02) return 0;
  return value <= 0.5 ? (value / 0.5) ** 2 : 1 + (value - 0.5) * 8;
}

export function createEvolveClock(): EvolveClock {
  return { exact: false, turn: 0, duration: 10, evolution: 0, motion: 0, beat: 0, swell: 0, gather: 0, ripples: new Float32Array(3).fill(-1), glide: 1, from: new Float32Array(POSE_SIZE), pose: new Float32Array(POSE_SIZE), schemeSeed: 0 };
}

export function createEvolveTransport(): EvolveTransport {
  return { clock: createEvolveClock(), values: {}, seed: null, lastPhase: null, evolveRate: 1, chase: null, swellTarget: 0, nextDown: false, dropDown: false, burstDown: false, nextRipple: 0, evaluated: false };
}

/** How many forms one closed export passes through. Each keeps enough time that its morph stays slow. */
function exactStops(duration: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.max(2, Math.min(Math.floor(duration / 26), Math.round(duration * rate / FORM_SECONDS)));
}

/** The clock for an export or any exact frame. One turn is a closed path that starts and ends on the home form. */
export function exactEvolveClock(phase: number, duration: number, params: Readonly<Record<string, number>>, out: EvolveClock): EvolveClock {
  const turn = Number.isFinite(phase) ? ((phase / TAU) % 1 + 1) % 1 : 0;
  out.exact = true; out.turn = turn;
  out.duration = Number.isFinite(duration) && duration > 0 ? duration : 10;
  const rate = evolutionRate(params);
  out.evolution = turn * exactStops(out.duration, rate);
  out.motion = out.duration * turn * speedRate(params.macroSpeed);
  const bpm = clamp(finite(params.scoreBpm, 124), 20, 400);
  out.beat = turn * Math.max(1, Math.round(out.duration * bpm / 60));
  out.swell = 0; out.gather = 0; out.ripples.fill(-1); out.glide = 1;
  return out;
}

/**
 * The clock for the live preview. Time runs on past the project's loop point, sliders are eased so nothing jumps, and
 * the pads shape envelopes instead of cutting. `wallSeconds` is real elapsed time, so sliders still ease while paused.
 */
export function advanceEvolve(transport: EvolveTransport, phase: number, duration: number, wallSeconds: number, seed: number, params: Readonly<Record<string, number>>, moves: EvolveMoves): EvolveClock {
  const clock = transport.clock, values = transport.values, wall = clamp(finite(wallSeconds, 0), 0, 0.1);
  for (let i = 0; i < SMOOTHED.length; i++) {
    const key = SMOOTHED[i][0], wanted = finite(params[key], 0);
    if (transport.seed === null || !Number.isFinite(values[key])) { values[key] = wanted; continue; }
    const step = SMOOTHED[i][1] * SPANS[i] * wall;
    values[key] += clamp(wanted - values[key], -step, step);
  }
  values.scoreBpm = finite(params.scoreBpm, 124);
  if (transport.seed === null) { transport.seed = seed; clock.schemeSeed = seed; }
  else if (transport.seed !== seed) {
    if (transport.evaluated) clock.from.set(clock.pose);
    clock.glide = transport.evaluated ? 0 : 1;
    clock.schemeSeed = transport.seed;
    transport.seed = seed;
    transport.chase = null;
  }
  if (clock.glide < 1) {
    clock.glide = Math.min(1, clock.glide + wall / GLIDE_SECONDS);
    if (clock.glide >= 0.5) clock.schemeSeed = seed;
  }

  let moved = 0;
  if (transport.lastPhase !== null && Number.isFinite(phase) && Number.isFinite(duration) && duration > 0) {
    let turn = (phase - transport.lastPhase) % TAU;
    if (turn > Math.PI) turn -= TAU; else if (turn < -Math.PI) turn += TAU;
    moved = turn / TAU * duration;
  }
  if (Number.isFinite(phase)) transport.lastPhase = phase;

  const running = moved > 0 ? moved : 0;
  clock.exact = false; clock.turn = 0; clock.duration = duration;
  clock.motion = Math.max(0, clock.motion + moved * speedRate(values.macroSpeed));
  clock.beat = Math.max(0, clock.beat + moved * clamp(values.scoreBpm, 20, 400) / 60);

  // Next: arrive at the following form. Time spent holding a form changes nothing, so it is crossed at once.
  if (moves.next && !transport.nextDown) {
    const index = segmentAt(seed, clock.evolution), end = boundary(seed, index + 1), length = end - boundary(seed, index), glide = clamp(length * 0.62, 14, 36);
    if (clock.evolution < end - glide) clock.evolution = end - glide;
    transport.chase = (clock.evolution < end - glide * 0.2 ? end : boundary(seed, index + 2)) + 0.001;
  }
  transport.nextDown = moves.next;

  const held = moves.hold || (params.scoreAutopilot ?? 1) < 0.5;
  const wantedRate = held ? 0 : evolutionRate(params);
  const rateStep = wall * 1.4;
  transport.evolveRate += clamp(wantedRate - transport.evolveRate, -rateStep, rateStep);
  if (transport.chase !== null) {
    const index = segmentAt(seed, Math.min(clock.evolution, transport.chase - 0.002));
    const length = boundary(seed, index + 1) - boundary(seed, index), glide = clamp(length * 0.62, 14, 36);
    clock.evolution = Math.min(transport.chase, clock.evolution + Math.max(running, wall) * Math.min(glide / NEXT_SECONDS, morphRate(seed, index)));
    if (clock.evolution >= transport.chase) transport.chase = null;
  } else {
    // A restless journey spends less time resting on each form, but a morph itself never hurries.
    const index = segmentAt(seed, clock.evolution), inMorph = morphWindow(seed, index, clock.evolution) > 0;
    clock.evolution = Math.max(0, clock.evolution + moved * (inMorph ? Math.min(transport.evolveRate, morphRate(seed, index)) : transport.evolveRate));
  }

  if (moves.drop && !transport.dropDown) transport.swellTarget = 1;
  transport.dropDown = moves.drop;
  const swellTo = moves.drop ? 1 : transport.swellTarget;
  clock.swell += (swellTo - clock.swell) * (1 - Math.exp(-wall / (swellTo > clock.swell ? 0.55 : 2.2)));
  if (!moves.drop && clock.swell > 0.9) transport.swellTarget = 0;
  if (!moves.drop && transport.swellTarget > 0 && clock.swell >= 0.82) transport.swellTarget = 0;
  const gatherTo = moves.collapse ? 1 : 0;
  clock.gather += clamp((gatherTo - clock.gather) * (1 - Math.exp(-wall / 1.1)), -wall * 0.42, wall * 0.42);

  if (moves.burst && !transport.burstDown) { clock.ripples[transport.nextRipple] = 0; transport.nextRipple = (transport.nextRipple + 1) % clock.ripples.length; }
  transport.burstDown = moves.burst;
  for (let i = 0; i < clock.ripples.length; i++) if (clock.ripples[i] >= 0) { clock.ripples[i] += wall; if (clock.ripples[i] > 3.2) clock.ripples[i] = -1; }
  transport.evaluated = true;
  return clock;
}

/** The accent scheme for a seed, a number into MERIDIAN_SCHEMES from 1. It holds for the whole piece. */
export function evolveScheme(seed: number): number {
  const schemes = [1, 2, 4, 5, 7, 8, 11, 12];
  return schemes[hash(seed, 3, 211) % schemes.length];
}

/** Heat opens the light gently: white line at zero, rich slow colour and glow at full, with no step anywhere. */
export function applyEvolveLight(source: Readonly<Record<string, number>>, live: Record<string, number>): void {
  const heat = unit(source.macroHeat), weight = unit(source.macroWeight);
  live.lightBloomAmount = finite(source.lightBloomAmount, 0.6) * (0.45 + heat * 1.1);
  live.lightLineGlow = finite(source.lightLineGlow, 0.5) * (0.4 + heat * 1.1);
  live.colourSaturation = Math.min(2, finite(source.colourSaturation, 1) * Math.min(1, heat * 2) * (1 - Math.max(0, heat - 0.5) * 0.36));
  live.colourFringe = finite(source.colourFringe, 0.2) * Math.max(0, heat - 0.5) * 1.4;
  live.lightExposure = finite(source.lightExposure, 1);
  live.lightCore = finite(source.lightCore, 1);
  live.lightContrast = finite(source.lightContrast, 1);
  live.lightBloomSize = finite(source.lightBloomSize, 0.5);
  live.lightVignette = finite(source.lightVignette, 0.3);
  live.outputMinLineWidth = Math.max(0.6, (live.outputMinLineWidth ?? 1.5) * Math.min(1, 4.2 ** (weight * 2 - 1)));
}

// HOT PATH: everything below runs every frame and must not allocate.

/** At small Scale, far-flung forms fold in towards the frame, so a jewel stays a jewel even on a horizon. */
const pull = (value: number, tuck: number): number => {
  const size = Math.abs(value);
  if (tuck <= 0 || size <= 0.5) return value;
  return (value < 0 ? -1 : 1) * (0.5 + (size - 0.5) * (1 - tuck * 0.88));
};

const oscillate = (clock: EvolveClock, period: number, offset: number, speed: number): number => {
  if (!clock.exact) return Math.sin(TAU * clock.motion / period + offset);
  return Math.sin(TAU * Math.max(1, Math.round(clock.duration * speed / period)) * clock.turn + offset);
};

/** A soft beat of light, moving outwards. Raised to a power so most of the beat is calm. */
function lightAt(clock: EvolveClock, radius: number): number {
  const wave = 0.5 + 0.5 * Math.cos(TAU * (clock.beat - radius * 0.72));
  return wave * wave * wave;
}

function rippleAt(clock: EvolveClock, radius: number): number {
  let light = 0;
  for (let i = 0; i < clock.ripples.length; i++) {
    const age = clock.ripples[i];
    if (age < 0) continue;
    const front = age * 0.46, into = (radius - front) / 0.13, rise = smooth(age / 0.35), fall = 1 - smooth((age - 1.6) / 1.6);
    light += rise * fall * Math.exp(-into * into);
  }
  return light;
}

/** Colour arrives on a voice rarely and slowly, and leaves the same way. */
function tintAt(clock: EvolveClock, heat: number, voice: number, speed: number): number {
  if (heat <= 0) return 0;
  const wave = 0.5 + 0.5 * oscillate(clock, 83 + voice * 5.3, voice * 2.4, speed);
  const gate = heat >= 0.5 ? 0.86 - (heat - 0.5) * 1.5 : 0.86 + (0.5 - heat) * 0.2;
  const rich = heat <= 0.5 ? heat * 0.62 : 0.31 + (heat - 0.5) * 0.92;
  const glide = clock.glide >= 1 ? 1 : Math.abs(clock.glide * 2 - 1);
  return Math.min(1, smooth((wave - gate) / 0.12) * rich * glide);
}

/** Exactly zero at or below the centre of the slider. Above it, one ring breaks briefly and mends. */
function glitchEvent(seed: number, time: number, amount: number): number {
  const cell = Math.floor(time / 2.2), chance = 0.08 + amount * 0.74;
  if (hashUnit(seed, cell, 401) >= chance) return 0;
  const start = hashUnit(seed, cell, 403) * 1.4, length = 0.5 + amount * 0.3, into = (time - cell * 2.2 - start) / length;
  if (into <= 0 || into >= 1) return 0;
  const shape = Math.sin(Math.PI * into);
  return shape * shape;
}

export function evaluateEvolve(seedValue: number, clock: EvolveClock, params: Readonly<Record<string, number>>, out: DisplayList): void {
  out.clear();
  const seed = seedValue >>> 0;
  const density = unit(params.macroDensity), tension = unit(params.macroTension), chaos = unit(params.macroOrder), heat = unit(params.macroHeat), glitch = unit(params.macroGlitch);
  const speed = speedRate(params.macroSpeed), weight = 4.2 ** (unit(params.macroWeight) * 2 - 1), scale = 2.4 ** (unit(params.macroScale) * 2 - 1);
  const grow = density <= 0.5 ? 0.34 + density * 1.32 : 1 + (density - 0.5) * 2;
  const ringGain = clamp(finite(params.ringCount, 7) / 7, 0, 3), spokeGain = clamp(finite(params.spokeCount, 12) / 12, 0, 4);
  const nodeGain = clamp(finite(params.nodeDensity, 0.5) * 2, 0, 2) * grow;
  const arcShare = clamp(finite(params.ringArcShare, 0.35) / 0.35, 0, 2.2);

  // Where the journey is: which two forms, and how far between them.
  let from: Form, to: Form, amount: number, home = 0;
  if (clock.exact) {
    const stops = exactStops(clock.duration, evolutionRate(params));
    if (stops === 0) { from = to = formFor(seed, -1); amount = 0; home = 1; }
    else {
      const index = Math.min(stops - 1, Math.floor(clock.evolution)), local = clock.evolution - index;
      amount = clamp((local - 0.38) / 0.62, 0, 1);
      if (stops === 2) {
        // Out to one form and home again. A short loop goes only part of the way, so it never has to hurry.
        from = formFor(seed, -1); to = formFor(seed, 1);
        amount = (index === 0 ? amount : 1 - amount) * clamp(clock.duration / FULL_PATH_SECONDS, 0.22, 1);
      } else {
        from = formFor(seed, index === 0 ? -1 : index);
        to = formFor(seed, index + 1 >= stops ? -1 : index + 1);
      }
      // Near the closing point the picture settles onto the exactly symmetric home form.
      home = Math.max(1 - smooth(clock.turn / 0.14), smooth((clock.turn - 0.86) / 0.14));
    }
  } else {
    const index = segmentAt(seed, clock.evolution);
    from = formFor(seed, index); to = formFor(seed, index + 1);
    amount = morphWindow(seed, index, clock.evolution);
  }

  const voicesFor = (form: Form) => form.rings * grow * ringGain;
  const spokesFor = (form: Form) => {
    const wanted = form.spokes * grow * spokeGain;
    if (form.kind !== HOME) return wanted;
    const steady = wanted < 9 ? 6 : wanted < 18 ? 12 : 24;
    return clock.exact ? steady : wanted;
  };
  project(from, voicesFor(from), spokesFor(from), nodeGain, poseA);
  project(to, voicesFor(to), spokesFor(to), nodeGain, poseB);
  blendPose(clock.pose, poseA, poseB, amount);
  const pose = clock.pose;
  if (clock.glide < 1) { poseA.set(pose); blendPose(pose, clock.from, poseA, clock.glide); }

  // Turning, breathing and drift, all continuous in the motion clock.
  const organic = chaos * chaos * (1 - home);
  const baseTurn = clock.exact
    ? Math.max(1, Math.round(TURN_RADIANS * speed * clock.duration / CLOSURE_STEP)) * CLOSURE_STEP * clock.turn
    : TURN_RADIANS * clock.motion;
  const ringTurn = finite(params.ringRotationSpeed, 1), counter = clamp(finite(params.ringCounterRotation, 0.5) * 2, 0, 2);
  const draw = (1.22 - tension * 0.44) * (1 - clock.gather * 0.62) * scale, tuck = smooth((1 - scale) / 0.5);
  const breathDepth = 0.008 + tension * 0.012;
  const heroBreath = 0.5 + 0.5 * oscillate(clock, 17, 1.3, speed);
  const heroPulse = clamp(finite(params.heroPulse, 0.5) * 2, 0, 2);
  const heroSwell = (0.012 + tension * tension * 0.075) * heroPulse * heroBreath + clock.swell * 0.055;
  const lineGain = clamp(finite(params.ringWeight, 1), 0, 16) * weight;
  const ringInk = clamp(finite(params.ringOpacity, 1), 0, 1);
  const lightDepth = 0.14;
  const life = 1 - home; // Even while a form rests, its rings drift, its arcs part and its spokes lean into pairs.

  const glitchAmount = glitch > 0.5 ? (glitch - 0.5) * 2 : 0;
  const glitchTime = clock.exact ? clock.turn * clock.duration : clock.motion / Math.max(speed, 1e-3);
  const glitchShape = glitchAmount > 0 && home < 1 ? glitchEvent(seed, glitchTime, glitchAmount) * glitchAmount ** 0.5 * (1 - home) : 0;
  const glitchVoice = glitchShape > 0 ? hash(seed, Math.floor(glitchTime / 2.2), 409) % Math.max(1, Math.min(RING_VOICES, Math.ceil(voicesFor(from)))) : -1;

  for (let voice = 0; voice < RING_VOICES; voice++) {
    const at = voice * RING_FIELDS, phase = voice * 1.91;
    const breathe = 1 + breathDepth * oscillate(clock, 29 + voice * 2.3, phase, speed) + life * 0.03 * oscillate(clock, 67 - voice * 2.6, phase * 1.4, speed) + organic * 0.05 * oscillate(clock, 37 + voice * 3.1, phase * 1.7, speed);
    const radius = pull(pose[at + R_RADIUS], tuck) * breathe * draw;
    const x = (pull(pose[at + R_X], tuck) + organic * 0.028 * oscillate(clock, 43 + voice * 2.9, phase * 2.3, speed)) * draw;
    const y = (pull(pose[at + R_Y], tuck) + organic * 0.028 * oscillate(clock, 47 + voice * 2.7, phase * 3.1, speed)) * draw;
    const tier = voice % 3;
    const tierRate = TIER_RATES[tier] * (tier === 1 ? counter : 1);
    const turn = clock.exact ? baseTurn * TIER_WINDS[tier] : baseTurn * ringTurn * tierRate;
    const beatLight = lightAt(clock, Math.abs(radius)), ripple = rippleAt(clock, Math.abs(radius));
    const broken = voice === glitchVoice ? 1 - glitchShape * 0.72 : 1;
    const ink = pose[at + R_ALPHA] * ringInk * (1 + lightDepth * (beatLight - 0.3) + ripple * 0.75 + clock.swell * 0.12) * broken;
    const width = -Math.max(0.0001, pose[at + R_WIDTH] * lineGain * (1 + beatLight * 0.08 + ripple * 0.45)) / REFERENCE_HEIGHT;
    const glow = 0.05 + beatLight * 0.07 + ripple * 0.5 + heat * 0.1;
    const colour = tintAt(clock, heat, voice, speed);
    const slot = TAU / ARC_SLOTS, parting = oscillate(clock, 59 + voice * 4.1, phase * 0.7, speed), opening = life * (parting > 0 ? parting * parting : 0) * 0.74, every = tier === 0 ? 6 : tier === 1 ? 4 : 3;
    for (let k = 0; k < ARC_SLOTS; k++) {
      const low = pose[at + R_ARCS + k * 2], high = 1 - (1 - pose[at + R_ARCS + k * 2 + 1]) * Math.min(arcShare, 1) - Math.max(0, arcShare - 1) * 0.28 * (1 - pose[at + R_ARCS + k * 2 + 1]);
      const share = Math.max(0, (k % every === every - 1 ? high * (1 - opening) : high) - low);
      out.push(PRIMITIVE.arc, x, y, radius, wrapAngle(turn + (k + low) * slot), share * slot, width, glow, colour, ink * smooth(share / 0.05), 0, voice * 0.07);
    }
  }

  const spokeTurn = baseTurn + finite(params.spokeOffsetAngle, 0) * Math.PI / 180;
  const inner = clamp(finite(params.spokeInnerReach, 0), 0, 1), reach = clamp(finite(params.spokeOuterReach, 1), 0, 1);
  const spokeLine = clamp(finite(params.spokeWeight, 1), 0, 16) * weight, spokeInk = clamp(finite(params.spokeOpacity, 1), 0, 1);
  const centreX = pull(pose[HERO_BASE + H_X], tuck) * draw, centreY = pull(pose[HERO_BASE + H_Y], tuck) * draw;
  for (let voice = 0; voice < SPOKE_VOICES; voice++) {
    const at = SPOKE_BASE + voice * SPOKE_FIELDS, phase = voice * 2.37;
    const pairing = life * 0.085 * (voice % 2 ? 1 : -1) * oscillate(clock, 71, 0.6 + (voice >> 1) * 0.5, speed);
    const angle = pose[at + S_ANGLE] + spokeTurn + pairing + organic * 0.2 * oscillate(clock, 41 + voice * 1.7, phase, speed);
    const outer = pull(pose[at + S_OUTER], tuck) * reach * draw * (1 + organic * 0.08 * oscillate(clock, 53 + voice * 2.1, phase * 1.3, speed));
    const start = pull(pose[at + S_INNER] + (pose[at + S_OUTER] - pose[at + S_INNER]) * inner * 0.8, tuck) * reach * draw;
    const cos = Math.cos(angle), sin = Math.sin(angle), middle = (start + outer) * 0.5;
    const beatLight = lightAt(clock, middle), ripple = rippleAt(clock, middle);
    const ink = pose[at + S_ALPHA] * spokeInk * (1 + lightDepth * (beatLight - 0.3) + ripple * 0.7);
    const width = -Math.max(0.0001, pose[at + S_WIDTH] * spokeLine) / REFERENCE_HEIGHT;
    const colour = tintAt(clock, heat, voice + 20, speed) * 0.8;
    out.push(PRIMITIVE.segment, centreX + cos * start, centreY + sin * start, centreX + cos * outer, centreY + sin * outer, 0, width, 0.03 + ripple * 0.3, colour, ink, 0, voice * 0.05);
    out.push(PRIMITIVE.segment, centreX - cos * start, centreY - sin * start, centreX - cos * outer, centreY - sin * outer, 0, width, 0.03 + ripple * 0.3, colour, ink * pose[at + S_MIRROR], 0, voice * 0.09);
  }

  const nodeInk = clamp(finite(params.nodeOpacity, 1), 0, 1), nodeSize = clamp(finite(params.nodeSize, 1), 0, 8) * Math.max(0.7, Math.min(weight, 1.45)), nodeGlow = clamp(finite(params.nodeGlow, 0.5), 0, 2);
  for (let node = 0; node < NODE_VOICES; node++) {
    const at = NODE_BASE + node * NODE_FIELDS, ringVoice = (node % 4) * RING_FIELDS;
    const tier = (node % 4) % 3, turn = clock.exact ? baseTurn * TIER_WINDS[tier] : baseTurn * ringTurn * TIER_RATES[tier] * (tier === 1 ? counter : 1);
    const angle = pose[at + N_ANGLE] + turn, radius = pull(pose[ringVoice + R_RADIUS], tuck) * draw;
    const beatLight = lightAt(clock, radius), ripple = rippleAt(clock, radius);
    const x = pull(pose[ringVoice + R_X], tuck) * draw + Math.cos(angle) * radius, y = pull(pose[ringVoice + R_Y], tuck) * draw + Math.sin(angle) * radius;
    const ink = pose[at + N_ALPHA] * nodeInk * (1 + lightDepth * 1.3 * (beatLight - 0.3) + ripple);
    out.push(PRIMITIVE.dot, x, y, pose[at + N_SIZE] * nodeSize * Math.min(1, 0.45 + pose[at + N_ALPHA]), 0, 0, 0, 0.16 * nodeGlow + beatLight * 0.1 + ripple * 0.4, tintAt(clock, heat, node % 9 + 40, speed), ink, 0, node * 0.013);
  }

  const heroGain = clamp(finite(params.heroWeight, 1), 0, 16) * Math.max(0.6, weight), heroLight = clamp(finite(params.heroGlow, 1), 0, 8) * clamp(finite(params.heroHaloStrength, 1), 0, 2);
  const heroPlace = 0.8 + clamp(finite(params.heroRadius, 0.5), 0, 1) * 0.4, split = clamp(finite(params.heroSplit, 0), 0, 1);
  const heroRadius = pull(pose[HERO_BASE + H_RADIUS], tuck) * heroPlace * (1 + heroSwell) * draw;
  const heroX = centreX, heroY = centreY;
  const heroBeat = lightAt(clock, heroRadius), heroRipple = rippleAt(clock, heroRadius);
  const heroInk = pose[HERO_BASE + H_ALPHA] * (1 + lightDepth * 0.8 * (heroBeat - 0.3) + heroRipple * 0.5 + clock.swell * 0.28);
  const heroWidth = -pose[HERO_BASE + H_WIDTH] * heroGain * (1 + heroBreath * 0.12 + clock.swell * 0.8) / REFERENCE_HEIGHT;
  const heroHalo = pose[HERO_BASE + H_GLOW] * heroLight * (0.72 + heroBreath * 0.28 + heroBeat * 0.14 + clock.swell * 1.3) * (0.55 + heat * 0.9) + heroRipple * 0.5;
  const heroColour = tintAt(clock, heat, 60, speed);
  const splitGap = 1 + split * 0.09;
  out.push(PRIMITIVE.ring, heroX, heroY, heroRadius / (split > 0 ? 1 + split * 0.03 : 1), 0, 0.5, heroWidth, heroHalo, heroColour, heroInk, 0, 0.9);
  out.push(PRIMITIVE.ring, heroX, heroY, heroRadius * splitGap, 0, 0.9, heroWidth * 0.7, heroHalo * 0.6, heroColour, heroInk * smooth(split * 6) * 0.72, 0, 0.77);

  const hub = Math.max(0.7, Math.min(scale, 1.8)) * (1 - clock.gather * 0.2);
  out.push(PRIMITIVE.ring, centreX, centreY, 0.014 * hub, 0, 0.2, -1.25 * Math.max(0.8, weight) / REFERENCE_HEIGHT, 0.14, 0, 0.85, 0, 0.2);
  out.push(PRIMITIVE.dot, centreX, centreY, 0.0036 * hub, 0, 0, 0, 0.2, 0, 0.95, 0, 0.3);

  // Glitch shards exist only above the centre of the slider, so at or below it the list is untouched by them.
  if (glitch > 0.5) {
    const at = Math.max(0, glitchVoice) * RING_FIELDS;
    const radius = pull(pose[at + R_RADIUS], tuck) * draw, x = pull(pose[at + R_X], tuck) * draw, y = pull(pose[at + R_Y], tuck) * draw, cell = Math.floor(glitchTime / 2.2);
    for (let i = 0; i < GLITCH_SHARDS; i++) {
      const a = hashUnit(seed, cell, 430 + i), b = hashUnit(seed, cell, 450 + i), reachOut = glitchShape * (0.012 + glitchAmount * 0.038);
      const start = a * TAU, sweep = 0.16 + b * 0.5;
      const shardX = x + (a - 0.5) * reachOut * 1.6, shardY = y + (b - 0.5) * reachOut;
      const colour = heat > 0 ? (i % 3) * Math.min(1, heat * 1.5) : 0;
      out.push(PRIMITIVE.arc, shardX, shardY, radius * (1 + (b - 0.5) * reachOut), start, sweep, -(1.2 + b * 2) * Math.max(0.7, weight) / REFERENCE_HEIGHT, 0.16 + glitchShape * 0.3, colour, glitchShape * 0.95, 0, a);
    }
  }
}
