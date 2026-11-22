import type { DisplayList } from './display-list';
import { subdivisionAt } from './rhythm';
import { PHRASE_STATES, PRIMITIVE, type PerformanceState, type PhraseState, type Score, type ScoreElement } from './types';

export interface PhrasePosition { progress: number; state: PhraseState; stateProgress: number; beat: number }

const TAU = Math.PI * 2;
const DEFAULT_BEATS_PER_BAR = 4;
const CHARGE = PHRASE_STATES.indexOf('charge');
const ENTER_SPAN = 0.035; // Share of the phrase an element takes to draw on.
const POINT_RADIUS = 0.006;
const POINT_REST_ALPHA = 0.45;
const POINT_GLOW = 0.4;
const LINE_GLOW = 0.12;
const CONTRACTION = 0.05;
const VIBRATION = 0.0018;
const COUNTER_ROTATION = 0.35;
const RELEASE_SHARE = 0.25; // Share of Peak over which Charge lets go.
const IGNITE_SHARE = 0.15; // Share of Peak over which the hero reaches full light.
const SQUASH_END = 0.55; // Share of an element's fall spent flattening into the line.
const SHRINK_START = 0.45; // Share of its fall after which the line closes to a point.
const CURVE_STEPS = 48; // Segments per full turn while a curve is flattened.
const RHYTHM_DIP = 0.3;
const MAX_WEIGHT = 16;
const MAX_SIZE = 8;
const MAX_GLITCH = 4;
const MAX_BEAT = 1e6;

const frame = {
  seed: 0, progress: 0, beat: 0, seedEnd: 0, drawEnd: 0, peakEnd: 0, collapseEnd: 0,
  breath: 1, vibration: 0, spin: 0, ignite: 0, tear: 0, rhythmDepth: 0,
  ringPulse: 0, spokePulse: 0, nodePulse: 0,
  ringWeight: 1, spokeWeight: 1, nodeSize: 1, heroWeight: 1, heroGlow: 1,
};

/** Maps a phrase clock in beats to its state. A bad clock reads as the start of the phrase. */
export function positionAt(score: Score, beatsInPhrase: number, beatsPerBar = DEFAULT_BEATS_PER_BAR): PhrasePosition {
  const total = score.bars * beatsPerBar;
  const beat = Number.isFinite(beatsInPhrase) && total > 0 ? clamp(beatsInPhrase, 0, total) : 0;
  const progress = total > 0 ? beat / total : 0;
  let index = 0;
  while (index < PHRASE_STATES.length - 1 && progress >= stateEnd(score, index)) index++;
  const start = stateEnd(score, index - 1);
  return { progress, state: PHRASE_STATES[index], stateProgress: within(progress, start, stateEnd(score, index)), beat };
}

/** The state actually shown. A forced state wins; hold keeps a phrase that has reached Charge from leaving it. */
export function performedState(position: PhrasePosition, perf: PerformanceState): PhraseState {
  return PHRASE_STATES[performedIndex(position, perf)];
}

// HOT PATH: everything below runs every frame and must not allocate.

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function within(value: number, start: number, end: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  return clamp((value - start) / (end - start), 0, 1);
}

function smooth(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function setting(value: number | undefined, fallback: number, low: number, high: number): number {
  return Number.isFinite(value) ? clamp(value as number, low, high) : fallback;
}

function stateEnd(score: Score, index: number): number {
  if (index < 0) return 0;
  const end = score.stateEnds[index];
  return Number.isFinite(end) ? end : (index + 1) / PHRASE_STATES.length;
}

function performedIndex(position: PhrasePosition, perf: PerformanceState): number {
  if (perf.forcedState !== null) return Math.max(0, PHRASE_STATES.indexOf(perf.forcedState));
  const index = Math.max(0, PHRASE_STATES.indexOf(position.state));
  return perf.hold && index > CHARGE ? CHARGE : index;
}

function performedProgress(score: Score, position: PhrasePosition, perf: PerformanceState, index: number): number {
  const pinned = perf.forcedState === null && perf.hold && PHRASE_STATES.indexOf(position.state) > CHARGE;
  const stateProgress = pinned ? 1 : setting(position.stateProgress, 0, 0, 1);
  const start = stateEnd(score, index - 1);
  return start + (stateEnd(score, index) - start) * stateProgress;
}

function pulseAt(pattern: readonly boolean[], beat: number, subdivision: number): number {
  if (pattern.length === 0) return 1;
  const position = beat * subdivision;
  const step = Math.floor(position);
  return pattern[step % pattern.length] ? 1 - (position - step) : 0;
}

function instanceSeed(scoreSeed: number, index: number): number {
  let hash = Math.imul(scoreSeed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2f);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function prepareFrame(score: Score, position: PhrasePosition, perf: PerformanceState, params: Readonly<Record<string, number>>): void {
  const index = performedIndex(position, perf);
  const progress = performedProgress(score, position, perf, index);
  const beat = setting(position.beat, 0, 0, MAX_BEAT);
  const drawEnd = stateEnd(score, 1);
  const buildEnd = stateEnd(score, 2);
  const chargeEnd = stateEnd(score, 3);
  const peakEnd = stateEnd(score, 4);
  const collapseEnd = stateEnd(score, 5);
  const tension = setting(perf.tension, 0, 0, 1);
  const burst = setting(perf.burst, 0, 0, 1);
  const buildShare = within(progress, drawEnd, buildEnd);
  const chargeShare = smooth(within(progress, buildEnd, chargeEnd));
  const peakShare = within(progress, chargeEnd, peakEnd);
  const held = chargeShare * (1 - smooth(peakShare / RELEASE_SHARE));
  const subdivision = subdivisionAt(buildShare, 1, 4);

  frame.seed = score.seed;
  frame.progress = progress;
  frame.beat = beat;
  frame.seedEnd = stateEnd(score, 0);
  frame.drawEnd = drawEnd;
  frame.peakEnd = peakEnd;
  frame.collapseEnd = collapseEnd;
  frame.breath = 1 - CONTRACTION * (1 + tension) * held;
  frame.vibration = VIBRATION * (0.4 + tension) * held;
  frame.spin = COUNTER_ROTATION * smooth(within(progress, drawEnd, chargeEnd));
  frame.ignite = clamp(peakShare / IGNITE_SHARE, 0, 1) * (1 - 0.5 * within(progress, peakEnd, collapseEnd));
  frame.tear = clamp(setting(params.glitchAmount, 1, 0, MAX_GLITCH) * (Math.sin(Math.PI * peakShare) + burst), 0, 1);
  frame.rhythmDepth = RHYTHM_DIP * smooth(buildShare) * (1 - clamp(peakShare / RELEASE_SHARE, 0, 1));
  frame.ringPulse = pulseAt(score.rhythm.ring, beat, subdivision);
  frame.spokePulse = pulseAt(score.rhythm.spoke, beat, subdivision);
  frame.nodePulse = pulseAt(score.rhythm.node, beat, subdivision);
  frame.ringWeight = setting(params.ringWeight, 1, 0, MAX_WEIGHT);
  frame.spokeWeight = setting(params.spokeWeight, 1, 0, MAX_WEIGHT);
  frame.nodeSize = setting(params.nodeSize, 1, 0, MAX_SIZE);
  frame.heroWeight = setting(params.heroWeight, 1, 0, MAX_WEIGHT);
  frame.heroGlow = setting(params.heroGlow, 1, 0, MAX_SIZE);
}

function drawCurve(out: DisplayList, radius: number, start: number, sweep: number, width: number, glow: number, colour: number, alpha: number, tear: number, seed: number, scaleX: number, scaleY: number): void {
  if (scaleX >= 1 && scaleY >= 1) {
    if (sweep >= TAU - 1e-6) out.push(PRIMITIVE.ring, 0, 0, radius, 0, 0, width, glow, colour, alpha, tear, seed);
    else out.push(PRIMITIVE.arc, 0, 0, radius, start, sweep, width, glow, colour, alpha, tear, seed);
    return;
  }
  const steps = Math.max(2, Math.ceil((CURVE_STEPS * sweep) / TAU));
  let x = Math.cos(start) * radius * scaleX;
  let y = Math.sin(start) * radius * scaleY;
  for (let step = 1; step <= steps; step++) {
    const angle = start + (sweep * step) / steps;
    const nextX = Math.cos(angle) * radius * scaleX;
    const nextY = Math.sin(angle) * radius * scaleY;
    out.push(PRIMITIVE.segment, x, y, nextX, nextY, 0, width, glow, colour, alpha, tear, seed);
    x = nextX;
    y = nextY;
  }
}

/** The hub's dot is the point that survives Rest and opens the next phrase; its ring exists only between. */
function drawHub(out: DisplayList, element: ScoreElement, index: number): void {
  const progress = frame.progress;
  const seed = instanceSeed(frame.seed, index);
  const lit = smooth(within(progress, 0, frame.seedEnd)) * (1 - smooth(within(progress, frame.collapseEnd, 1)));
  const alpha = POINT_REST_ALPHA + (1 - POINT_REST_ALPHA) * lit;
  out.push(PRIMITIVE.dot, 0, 0, POINT_RADIUS, 0, 0, 0, POINT_GLOW, element.colour, alpha, 0, seed);
  const open = smooth(within(progress, frame.seedEnd, frame.drawEnd)) * (1 - within(progress, frame.peakEnd, frame.collapseEnd));
  if (open > 0) out.push(PRIMITIVE.ring, 0, 0, element.radius * open * frame.breath, 0, 0, element.weight * frame.ringWeight, LINE_GLOW, element.colour, open, frame.tear, seed);
}

function drawElement(out: DisplayList, element: ScoreElement, index: number): void {
  if (element.group === 'hub') {
    drawHub(out, element, index);
    return;
  }
  const progress = frame.progress;
  if (progress >= frame.collapseEnd) return;
  const entry = within(progress, element.enter, element.enter + ENTER_SPAN);
  if (entry <= 0) return;

  // `exit` is when an element starts to fall. Every element lands on the point at the end of Collapse.
  const fall = within(progress, element.exit, frame.collapseEnd);
  const scaleY = 1 - smooth(fall / SQUASH_END);
  const scaleX = 1 - smooth((fall - SHRINK_START) / (1 - SHRINK_START));
  const grow = smooth(entry);
  const seed = instanceSeed(frame.seed, index);
  const tear = frame.tear * (0.35 + 0.65 * seed);
  const radius = Math.max(0, element.radius * frame.breath + frame.vibration * Math.sin((frame.beat * 2 + seed) * TAU));
  const spin = element.zone % 2 ? -frame.spin : frame.spin;
  const fade = clamp(entry * 3, 0, 1) * (1 - fall * fall);
  const colour = element.colour;

  switch (element.group) {
    case 'hero': {
      const width = element.weight * frame.heroWeight * (1 + 0.5 * frame.ignite);
      const glow = frame.heroGlow * (0.25 + 1.75 * frame.ignite);
      drawCurve(out, radius, element.angle, TAU * grow, width, glow, colour, fade, tear, seed, scaleX, scaleY);
      break;
    }
    case 'ring':
    case 'arc': {
      const alpha = fade * (1 - frame.rhythmDepth * (1 - frame.ringPulse));
      const start = element.group === 'arc' ? element.angle + spin : element.angle;
      drawCurve(out, radius, start, element.length * grow, element.weight * frame.ringWeight, LINE_GLOW, colour, alpha, tear, seed, scaleX, scaleY);
      break;
    }
    case 'spoke':
    case 'tick': {
      const angle = element.group === 'tick' ? element.angle + spin : element.angle;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const end = radius + element.length * frame.breath * grow;
      const alpha = fade * (1 - frame.rhythmDepth * (1 - frame.spokePulse));
      out.push(PRIMITIVE.segment, cos * radius * scaleX, sin * radius * scaleY, cos * end * scaleX, sin * end * scaleY, 0, element.weight * frame.spokeWeight, LINE_GLOW, colour, alpha, tear, seed);
      break;
    }
    case 'node': {
      const angle = element.angle + spin;
      const size = element.length * frame.nodeSize * grow * (1 - fall);
      const alpha = fade * (1 - frame.rhythmDepth * (1 - frame.nodePulse));
      const kind = element.shape === 'square' ? PRIMITIVE.square : PRIMITIVE.dot;
      out.push(kind, Math.cos(angle) * radius * scaleX, Math.sin(angle) * radius * scaleY, size, angle, 0, 0, LINE_GLOW, colour, alpha, tear, seed);
      break;
    }
  }
}

/** Drawn in three passes so that a full list loses nodes first, then ticks, and keeps the structure. */
function passOf(element: ScoreElement): number {
  return element.group === 'node' ? 2 : element.group === 'tick' ? 1 : 0;
}

export function evaluate(score: Score, position: PhrasePosition, perf: PerformanceState, params: Readonly<Record<string, number>>, out: DisplayList): void {
  out.clear();
  prepareFrame(score, position, perf, params);
  const elements = score.elements;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < elements.length; i++) {
      if (passOf(elements[i]) === pass) drawElement(out, elements[i], i);
    }
  }
}
