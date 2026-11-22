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
const IGNITION_AS_COMPOSED = 0.6;
const SQUASH_END = 0.55; // Share of an element's fall spent flattening into the line.
const SHRINK_START = 0.45; // Share of its fall after which the line closes to a point.
const CURVE_STEPS = 144; // Segments per full turn while a curve is flattened: under a quarter pixel of sag on a 4K ring.
const RHYTHM_DIP = 0.3;
const MAX_WEIGHT = 16;
const MAX_SIZE = 8;
const MAX_GLITCH = 4;
const LINE_MEDIUM = 1.6;
const ACCENT_AS_COMPOSED = 0.3;
const MAX_BEAT = 1e6;
const DEGREE = Math.PI / 180;
const AXIS = Math.PI * 1.5; // The composer's first spoke points up the frame.
const MEDIUM_FROM = 1.3; // Composer weights at or above this are the medium line.
const DRIFT = 0.1; // Radians a ring zone turns over one phrase at Rotation speed 1.
const JITTER_RADIUS = 0.012;
const JITTER_NODE = 0.014;
const WOBBLE = 0.006;
const WOBBLE_LOBES = 5;
const END_NODE = 0.0042;
const ARC_DUTY = 0.74;
const HUB_REACH = 0.03; // Where a spoke with full Inner reach starts.
const COMPOSED_TWIN_GAP = 1.1 * DEGREE;
const HERO_CONTRACTION = 0.16;
const HERO_OVERSHOOT = 0.2;
const HERO_SPLIT = 0.05;
const HERO_FILL = 0.16;
const MAX_RINGS = 64;
const ringRadii = new Float64Array(MAX_RINGS);

const frame = {
  seed: 0, progress: 0, beat: 0, seedEnd: 0, drawEnd: 0, peakEnd: 0, collapseEnd: 0,
  breath: 1, vibration: 0, spin: 0, ignite: 0, tear: 0, rhythmDepth: 0,
  ringPulse: 0, spokePulse: 0, nodePulse: 0,
  ringWeight: 1, spokeWeight: 1, nodeSize: 1, heroWeight: 1, heroGlow: 1,
  symmetry: 1, rings: 0, held: 0, peakShare: 0, pulse: 0,
  thin: 1, medium: LINE_MEDIUM, spacing: 0, arcShare: 0, dashes: 0, dashGap: 0.4, ticks: 0.5, tickLength: 1, counter: 1,
  drawOn: 0, wobble: 0, ringAlpha: 1,
  twinShare: 0, twinGap: 1.1, inner: 0, outer: 1, spokeOffset: 0, lengthJitter: 0, sweep: 1, retract: 0, endNodes: 0, spokeAlpha: 1,
  nodeShape: 0, nodeGlow: LINE_GLOW, nodeJitter: 0, chase: 0, chasePattern: 0, snap: 0, nodeAccent: 0, twinkle: 0, nodeAlpha: 1,
  heroPlace: 0.5, heroContract: 0, heroKick: 0, heroHalo: 1, heroFill: 0, heroPulse: 0, heroSplit: 0,
  accent: ACCENT_AS_COMPOSED, byAge: 0,
};

/** Maps a phrase clock in beats to its state. A bad clock reads as the start of the phrase. */
export function positionAt(score: Score, beatsInPhrase: number, beatsPerBar = DEFAULT_BEATS_PER_BAR, out?: PhrasePosition): PhrasePosition {
  const total = score.bars * beatsPerBar;
  const beat = Number.isFinite(beatsInPhrase) && total > 0 ? clamp(beatsInPhrase, 0, total) : 0;
  const progress = total > 0 ? beat / total : 0;
  let index = 0;
  while (index < PHRASE_STATES.length - 1 && progress >= stateEnd(score, index)) index++;
  const start = stateEnd(score, index - 1);
  const state = PHRASE_STATES[index];
  const stateProgress = within(progress, start, stateEnd(score, index));
  if (!out) return { progress, state, stateProgress, beat };
  out.progress = progress;
  out.state = state;
  out.stateProgress = stateProgress;
  out.beat = beat;
  return out;
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
  const ignition = setting(params.heroIgnition, IGNITION_AS_COMPOSED, 0, 1);
  const igniteShare = IGNITE_SHARE * (1 + (IGNITION_AS_COMPOSED - ignition) * 3.2);
  frame.spin = setting(params.ringRotationSpeed, 1, -4, 4) * (COUNTER_ROTATION * smooth(within(progress, drawEnd, chargeEnd)) + DRIFT * progress);
  frame.ignite = clamp(peakShare / igniteShare, 0, 1) * (1 - 0.5 * within(progress, peakEnd, collapseEnd));
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
  frame.symmetry = Math.max(1, score.symmetry);
  frame.held = held;
  frame.peakShare = peakShare;
  frame.pulse = 1 - (beat - Math.floor(beat));

  frame.thin = setting(params.ringThinWeight, 1, 0.5, 4);
  frame.medium = setting(params.ringMediumWeight, LINE_MEDIUM, 0.5, 6);
  frame.spacing = setting(params.ringSpacingJitter, 0, 0, 1);
  frame.arcShare = setting(params.ringArcShare, 0, 0, 1);
  frame.dashes = Math.round(setting(params.ringDashCount, 0, 0, 64));
  frame.dashGap = setting(params.ringDashGap, 0.4, 0, 0.95);
  frame.ticks = setting(params.ringTicks, 0.5, 0, 1);
  frame.tickLength = setting(params.ringTickLength, 0.5, 0, 1) * 2;
  frame.counter = setting(params.ringCounterRotation, 0.5, 0, 1) * 2;
  frame.drawOn = Math.round(setting(params.ringDrawOnStyle, 0, 0, 3));
  frame.wobble = setting(params.ringWobble, 0, 0, 1) * WOBBLE;
  frame.ringAlpha = setting(params.ringOpacity, 1, 0, 1);

  frame.twinShare = setting(params.spokeTwinShare, 0, 0, 1);
  frame.twinGap = setting(params.spokeTwinGap, 1.1, 0.2, 4) * DEGREE;
  frame.inner = setting(params.spokeInnerReach, 0, 0, 1);
  frame.outer = setting(params.spokeOuterReach, 1, 0, 1);
  frame.spokeOffset = setting(params.spokeOffsetAngle, 0, -180, 180) * DEGREE;
  frame.lengthJitter = setting(params.spokeLengthJitter, 0, 0, 1);
  frame.sweep = Math.max(0.05, setting(params.spokeSweepSpeed, 1, 0, 4));
  frame.retract = Math.round(setting(params.spokeRetractStyle, 0, 0, 2));
  frame.endNodes = setting(params.spokeEndNodes, 0, 0, 1);
  frame.spokeAlpha = setting(params.spokeOpacity, 1, 0, 1);

  frame.nodeShape = Math.round(setting(params.nodeShape, 0, 0, 2));
  frame.nodeGlow = LINE_GLOW * setting(params.nodeGlow, 0.5, 0, 2) * 2;
  frame.nodeJitter = setting(params.nodeJitter, 0, 0, 1) * JITTER_NODE;
  frame.chase = setting(params.nodeChaseSpeed, 0, 0, 4) * beat * 0.5;
  frame.chasePattern = Math.round(setting(params.nodeChasePattern, 0, 0, 3));
  frame.snap = setting(params.nodeRingSnap, 0, 0, 1);
  frame.nodeAccent = setting(params.nodeColourAccent, 0, 0, 1);
  frame.twinkle = setting(params.nodeTwinkle, 0, 0, 1);
  frame.nodeAlpha = setting(params.nodeOpacity, 1, 0, 1);

  frame.heroPlace = setting(params.heroRadius, 0.5, 0, 1);
  frame.heroContract = 1 - setting(params.heroContraction, 0, 0, 1) * HERO_CONTRACTION * held;
  const kick = clamp(peakShare, 0, 1);
  frame.heroKick = 1 + setting(params.heroOvershoot, 0, 0, 1) * HERO_OVERSHOOT * Math.exp(-7 * kick) * Math.sin(kick * Math.PI * 5) * (peakShare > 0 ? 1 : 0);
  frame.heroHalo = setting(params.heroHaloStrength, 1, 0, 2);
  frame.heroFill = setting(params.heroInnerFill, 0, 0, 1);
  frame.heroPulse = setting(params.heroPulse, 0, 0, 1) * frame.pulse * frame.pulse * frame.ignite;
  frame.heroSplit = setting(params.heroSplit, 0, 0, 1) * HERO_SPLIT;

  frame.accent = setting(params.colourAccentFrequency, ACCENT_AS_COMPOSED, 0, 1);
  frame.byAge = setting(params.colourByAge, 0, 0, 1);
}

/** Moves a mark's colour towards or away from the accents, about the composer's own plan. */
function accentOf(colour: number, seed: number): number {
  const accent = frame.accent;
  if (accent < ACCENT_AS_COMPOSED) return colour > 0 && seed > accent / ACCENT_AS_COMPOSED ? 0 : colour;
  if (colour === 0 && seed < (accent - ACCENT_AS_COMPOSED) / (1 - ACCENT_AS_COMPOSED)) return 1;
  return colour;
}

/** A fractional colour blends towards the next swatch, so a mark can change colour as it ages. */
function agedColour(colour: number, enter: number): number {
  if (frame.byAge <= 0) return colour;
  return colour + 0.98 * clamp((frame.progress - enter) * 2.2 * frame.byAge, 0, 1);
}

function nearestRing(radius: number): number {
  let best = radius;
  let gap = Infinity;
  for (let i = 0; i < frame.rings; i++) {
    const distance = Math.abs(ringRadii[i] - radius);
    if (distance < gap) { gap = distance; best = ringRadii[i]; }
  }
  return best;
}

/** Hero radius 0.5 is where the composer put it; either side slides towards its neighbouring ring. */
function heroPlaced(radius: number): number {
  let inner = radius * 0.72;
  let outer = radius * 1.28;
  for (let i = 0; i < frame.rings; i++) {
    const other = ringRadii[i];
    if (other < radius && other > inner) inner = other;
    if (other > radius && other < outer) outer = other;
  }
  const place = frame.heroPlace;
  return place < 0.5 ? inner + (radius - inner) * place * 2 : radius + (outer - radius) * (place - 0.5) * 2;
}

function drawCurve(out: DisplayList, radius: number, start: number, sweep: number, width: number, glow: number, colour: number, alpha: number, tear: number, seed: number, scaleX: number, scaleY: number, wobble = 0): void {
  if (scaleX >= 1 && scaleY >= 1) {
    if (sweep >= TAU - 1e-6) out.push(PRIMITIVE.ring, 0, 0, radius, wobble, seed * TAU, width, glow, colour, alpha, tear, seed);
    else out.push(PRIMITIVE.arc, 0, 0, radius + wobble * Math.sin(start * WOBBLE_LOBES + seed * TAU), start, sweep, width, glow, colour, alpha, tear, seed);
    return;
  }
  const steps = Math.max(2, Math.ceil((CURVE_STEPS * sweep) / TAU));
  let x = Math.cos(start) * radius * scaleX;
  let y = Math.sin(start) * radius * scaleY;
  for (let step = 1; step <= steps; step++) {
    const angle = start + (sweep * step) / steps;
    const nextX = Math.cos(angle) * radius * scaleX;
    const nextY = Math.sin(angle) * radius * scaleY;
    // p2 = 1 marks a link in a chain: it has no end caps, so joints do not add up into beads.
    out.push(PRIMITIVE.segment, x, y, nextX, nextY, 1, width, glow, colour, alpha, tear, seed);
    x = nextX;
    y = nextY;
  }
}

/** A ring as the performer set it: whole, cut into dashes, or broken into symmetric arcs. */
function drawRing(out: DisplayList, radius: number, start: number, turn: number, width: number, colour: number, alpha: number, tear: number, seed: number, scaleX: number, scaleY: number): void {
  const pieces = frame.dashes > 0 ? frame.dashes : seed < frame.arcShare ? frame.symmetry : 1;
  if (pieces <= 1) {
    drawCurve(out, radius, start, turn, width, LINE_GLOW, colour, alpha, tear, seed, scaleX, scaleY, frame.wobble);
    return;
  }
  const duty = frame.dashes > 0 ? 1 - frame.dashGap : ARC_DUTY;
  const pitch = TAU / pieces;
  const reach = turn / TAU;
  for (let piece = 0; piece < pieces; piece++) drawCurve(out, radius, start + piece * pitch, pitch * duty * reach, width, LINE_GLOW, colour, alpha, tear, seed, scaleX, scaleY, frame.wobble);
}

function drawHero(out: DisplayList, element: ScoreElement, radius: number, grow: number, fade: number, tear: number, seed: number, scaleX: number, scaleY: number): void {
  const place = heroPlaced(element.radius) / Math.max(element.radius, 1e-6);
  const at = Math.max(0, radius * place * frame.heroContract * frame.heroKick);
  const beat = 1 + 0.45 * frame.heroPulse;
  const width = element.weight * frame.heroWeight * (1 + 0.5 * frame.ignite) * beat;
  const glow = frame.heroGlow * frame.heroHalo * (0.25 + 1.75 * frame.ignite) * beat;
  if (frame.heroFill > 0 && scaleX >= 1 && scaleY >= 1) out.push(PRIMITIVE.fill, 0, 0, at, 0, 0, 0, glow * 0.3, element.colour, fade * frame.heroFill * HERO_FILL * (0.3 + frame.ignite), 0, seed);
  if (frame.heroSplit > 0) {
    const apart = frame.heroSplit * (0.25 + 0.75 * frame.ignite);
    drawCurve(out, at * (1 + apart), element.angle, TAU * grow, width * 0.62, glow * 0.6, element.colour, fade, tear, seed, scaleX, scaleY);
    drawCurve(out, at * (1 - apart), element.angle, TAU * grow, width * 0.62, glow * 0.6, element.colour, fade, tear, seed, scaleX, scaleY);
    return;
  }
  drawCurve(out, at, element.angle, TAU * grow, width, glow, element.colour, fade, tear, seed, scaleX, scaleY);
}

function drawSpoke(out: DisplayList, element: ScoreElement, angle: number, inner: number, reach: number, width: number, colour: number, alpha: number, tear: number, seed: number, fall: number, scaleX: number, scaleY: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Retract style: the far end falls in, the near end runs out, or the line simply fades.
  const near = frame.retract === 1 ? inner + reach * fall : inner;
  const far = frame.retract === 0 ? inner + reach * (1 - fall) : inner + reach;
  const shown = frame.retract === 2 ? alpha * (1 - fall) : alpha;
  out.push(PRIMITIVE.segment, cos * near * scaleX, sin * near * scaleY, cos * far * scaleX, sin * far * scaleY, 0, width, LINE_GLOW, colour, shown, tear, seed);
  if (frame.endNodes > 0) out.push(PRIMITIVE.dot, cos * far * scaleX, sin * far * scaleY, END_NODE * frame.endNodes * (1 - fall), 0, 0, 0, LINE_GLOW * 2, element.colour > 0 ? element.colour : 1, shown, tear, seed);
}

function chaseLight(element: ScoreElement, seed: number): number {
  if (frame.chase <= 0) return 1;
  const pattern = frame.chasePattern;
  const place = pattern === 0 ? element.angle / TAU * frame.symmetry : pattern === 1 ? -element.radius * 9 : pattern === 2 ? element.radius * 9 : seed * 7;
  const wave = 0.5 + 0.5 * Math.cos((frame.chase + place) * TAU);
  return 0.35 + 1.25 * wave * wave * wave;
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
  const jitter = element.group === 'ring' || element.group === 'arc' ? frame.spacing * JITTER_RADIUS * (seed * 2 - 1) : 0;
  const radius = Math.max(0, (element.radius + jitter) * frame.breath + frame.vibration * Math.sin((frame.beat * 2 + seed) * TAU));
  const spin = element.zone % 2 ? -frame.spin * frame.counter : frame.spin;
  const fade = clamp(entry * 3, 0, 1) * (1 - fall * fall);
  const colour = agedColour(element.group === 'hero' ? element.colour : accentOf(element.colour, seed), element.enter);

  switch (element.group) {
    case 'hero': {
      drawHero(out, element, radius, grow, fade, tear, seed, scaleX, scaleY);
      break;
    }
    case 'ring':
    case 'arc': {
      const alpha = fade * frame.ringAlpha * (1 - frame.rhythmDepth * (1 - frame.ringPulse));
      const start = element.group === 'arc' ? element.angle + spin : element.angle + spin * 0.4;
      const width = (element.weight >= MEDIUM_FROM ? frame.medium : frame.thin * element.weight) * frame.ringWeight;
      // Draw-on style: sweep round, fade in, grow out from the centre, or snap on.
      const style = frame.drawOn;
      const shownAlpha = style === 1 ? alpha * grow : alpha;
      const shownRadius = style === 2 ? radius * grow : radius;
      const turn = style === 0 ? grow : 1;
      if (element.group === 'arc') drawCurve(out, shownRadius, start, element.length * turn, width, LINE_GLOW, colour, shownAlpha, tear, seed, scaleX, scaleY, frame.wobble);
      else drawRing(out, shownRadius, start, TAU * turn, width, colour, shownAlpha, tear, seed, scaleX, scaleY);
      break;
    }
    case 'tick': {
      // Crosshair marks (slot 0) always stay. Above the middle the scale gets bolder rather than denser.
      if (element.slot !== 0 && seed > frame.ticks * 2) break;
      const angle = element.slot === 0 ? element.angle : element.angle + spin;
      const bold = element.slot === 0 ? 1 : 1 + Math.max(0, frame.ticks - 0.5);
      const length = element.slot === 0 ? element.length : element.length * frame.tickLength * bold;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const end = radius + length * frame.breath * grow;
      const alpha = fade * frame.ringAlpha * Math.min(1, bold) * (1 - frame.rhythmDepth * (1 - frame.spokePulse));
      out.push(PRIMITIVE.segment, cos * radius * scaleX, sin * radius * scaleY, cos * end * scaleX, sin * end * scaleY, 0, element.weight * frame.spokeWeight * bold, LINE_GLOW, colour, alpha, tear, seed);
      break;
    }
    case 'spoke': {
      const swept = smooth(within(progress, element.enter, element.enter + ENTER_SPAN / frame.sweep));
      const angle = element.angle + frame.spokeOffset;
      const inner = radius + (HUB_REACH - radius) * frame.inner;
      const span = (radius + element.length * frame.breath - inner) * frame.outer * (1 - frame.lengthJitter * seed * 0.7) * swept;
      const alpha = fade * frame.spokeAlpha * (1 - frame.rhythmDepth * (1 - frame.spokePulse));
      const width = element.weight * frame.spokeWeight;
      if (element.colour === 2) {
        // A composed twin: the pair opens and closes about its shared centre line.
        const inSector = (((element.angle - AXIS) % (TAU / frame.symmetry)) + TAU / frame.symmetry) % (TAU / frame.symmetry);
        const side = inSector < TAU / frame.symmetry / 2 ? 1 : -1;
        drawSpoke(out, element, angle + side * (frame.twinGap - COMPOSED_TWIN_GAP) / 2, inner, span, width, colour, alpha, tear, seed, fall, scaleX, scaleY);
      } else {
        drawSpoke(out, element, angle, inner, span, width, colour, alpha, tear, seed, fall, scaleX, scaleY);
        if (seed < frame.twinShare) drawSpoke(out, element, angle + frame.twinGap, inner, span, width, colour, alpha, tear, seed, fall, scaleX, scaleY);
      }
      break;
    }
    case 'node': {
      const angle = element.angle + spin + frame.nodeJitter * (instanceSeed(frame.seed, index + 7919) - 0.5) * 6;
      const home = frame.snap > 0 ? radius + (nearestRing(element.radius) * frame.breath - radius) * frame.snap : radius;
      const place = home + frame.nodeJitter * (instanceSeed(frame.seed, index + 104729) - 0.5);
      const size = element.length * frame.nodeSize * grow * (1 - fall);
      const twinkle = frame.twinkle > 0 ? 1 - frame.twinkle * (0.5 + 0.5 * Math.sin((frame.beat * (0.5 + seed) + seed) * TAU * 1.5)) : 1;
      const light = chaseLight(element, seed);
      const alpha = fade * frame.nodeAlpha * twinkle * Math.min(light, 1) * (1 - frame.rhythmDepth * (1 - frame.nodePulse));
      const shape = frame.nodeShape === 0 ? element.shape === 'square' : frame.nodeShape === 2;
      const kind = shape ? PRIMITIVE.square : PRIMITIVE.dot;
      const tint = frame.nodeAccent > 0 && instanceSeed(frame.seed, index + 1299709) < frame.nodeAccent ? 1 : colour;
      out.push(kind, Math.cos(angle) * place * scaleX, Math.sin(angle) * place * scaleY, size, angle, 0, 0, frame.nodeGlow * Math.max(light, 1), tint, alpha, tear, seed);
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
  frame.rings = 0;
  for (let i = 0; i < elements.length && frame.rings < MAX_RINGS; i++) {
    if (elements[i].group === 'ring') ringRadii[frame.rings++] = elements[i].radius;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < elements.length; i++) {
      if (passOf(elements[i]) === pass) drawElement(out, elements[i], i);
    }
  }
}
