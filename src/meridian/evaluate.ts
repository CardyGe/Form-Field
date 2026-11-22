import type { DisplayList } from './display-list';
import { subdivisionAt } from './rhythm';
import { AXIS, COLLAPSE_STYLES, PHRASE_STATES, PRIMITIVE, type PerformanceState, type PhraseState, type Score, type ScoreElement, type ScoreForm } from './types';

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
const REFERENCE_HEIGHT = 1080; // The hero's weight is in pixels at this height, so it keeps its share of the frame at any size.
const BAND_STEPS = 480; // A heavy band needs finer links than a line, or its outer edge shows the joints.
const BAND_REST = 0.17; // How lit the colour bands are before the Peak.
const BAND_CHARGE = 0.26;
const BAND_GLOW = 0.3;
const SPIN_ALIVE = 2.6; // A composed form turns further through the phrase than the plain instrument.
const WAVE_DEPTH = 0.055; // How far the Peak's beat wave pushes each mark outwards.
const PINGS = 3;
const ARM_TRAIL = 7;
const ARM_STEP = 0.022; // Radians between the arm's fading echoes.
const COLLAPSE_FOLD = COLLAPSE_STYLES.indexOf('fold');
const COLLAPSE_IMPLODE = COLLAPSE_STYLES.indexOf('implode');
const COLLAPSE_VORTEX = COLLAPSE_STYLES.indexOf('vortex');
const COLLAPSE_IRIS = COLLAPSE_STYLES.indexOf('iris');
const BEAT_EPSILON = 1e-9; // Keeps a clock sitting on a whole beat from reading as the end of the one before.
const LIFE_FADE = 0.35; // Share of Collapse over which the pings and the arm die away.
const RATCHET_NOTCHES = 6; // Clicks to turn one symmetric sector.
const RATCHET_EASE = 0.28; // Share of a beat each click takes.
const CHARGE_SQUEEZE = 2.6; // How much harder a composed form contracts in Charge.
const VORTEX_TURNS = 2.4;
const RECOIL = 0.5; // How far marks are flung outwards before they are pulled back in.
/** Hand-built scores have no form: one centred system that folds through a line. */
const PLAIN_FORM: ScoreForm = { kind: 'bleed', outer: 0.46, turn: 0, centreX: 0, centreY: 0, twinX: 0, twinY: 0, square: 0, collapse: 'fold', collapseAngle: 0, scheme: 1, peakScheme: 1 };
const point = { x: 0, y: 0 };
const origin = { x: 0, y: 0 };
/** How the current element is folded on its way to the point: a 2x2 matrix, and whether it is still a true circle. */
const fold = { a: 1, b: 0, c: 0, d: 1, plain: true, scale: 1, twist: 0, sweep: 1 };

const frame = {
  seed: 0, progress: 0, beat: 0, seedEnd: 0, drawEnd: 0, peakEnd: 0, collapseEnd: 0,
  breath: 1, vibration: 0, spin: 0, ignite: 0, tear: 0, rhythmDepth: 0,
  ringPulse: 0, spokePulse: 0, nodePulse: 0,
  ringWeight: 1, spokeWeight: 1, nodeSize: 1, heroWeight: 1, heroGlow: 1,
  symmetry: 1, rings: 0, held: 0, peakShare: 0, pulse: 0,
  thin: 1, medium: LINE_MEDIUM, spacing: 0, arcShare: 0, dashes: 0, dashGap: 0.4, ticks: 0.5, tickLength: 1, counter: 1,
  drawOn: 0, wobble: 0, ringAlpha: 1,
  twinShare: 0, twinGap: 1.1, inner: 0, outerReach: 1, spokeOffset: 0, lengthJitter: 0, sweep: 1, retract: 0, endNodes: 0, spokeAlpha: 1,
  nodeShape: 0, nodeGlow: LINE_GLOW, nodeJitter: 0, chase: 0, chasePattern: 0, snap: 0, nodeAccent: 0, twinkle: 0, nodeAlpha: 1,
  heroPlace: 0.5, heroContract: 0, heroKick: 0, heroHalo: 1, heroFill: 0, heroPulse: 0, heroSplit: 0,
  accent: ACCENT_AS_COMPOSED, byAge: 0,
  alive: false, axis: AXIS, outer: 0.46, square: 0, negative: 0.5, travel: 0, centreX: 0, centreY: 0, twinX: 0, twinY: 0,
  ratchet: 0, rotation: 1, hasSpokes: false, collapse: 0, foldCos: 1, foldSin: 0, bandLight: BAND_REST, bandSnap: 0, wave: 0, wavePlace: 0, life: 0,
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
  frame.breath = 1 - CONTRACTION * (score.form ? CHARGE_SQUEEZE : 1) * (1 + tension) * held;
  frame.vibration = VIBRATION * (0.4 + tension) * held;
  const ignition = setting(params.heroIgnition, IGNITION_AS_COMPOSED, 0, 1);
  const igniteShare = IGNITE_SHARE * (1 + (IGNITION_AS_COMPOSED - ignition) * 3.2);
  const form = score.form ?? PLAIN_FORM;
  frame.alive = score.form !== undefined;
  frame.axis = AXIS + form.turn;
  frame.outer = form.outer;
  // The slider travels from the composed shape to its opposite, so it has its full range on a square composition too.
  frame.square = form.square + setting(params.structureSquareMix, 0, 0, 1) * ((form.square >= 0.5 ? 0 : 1) - form.square);
  frame.negative = setting(params.structureNegativeSpace, 0.5, 0, 1);
  // The system leaves the opening point for its place in the frame, and is back on it by the end of Collapse.
  frame.travel = smooth(within(progress, frame.seedEnd, drawEnd)) * (1 - smooth(within(progress, peakEnd, collapseEnd)));
  frame.centreX = form.centreX;
  frame.centreY = form.centreY;
  frame.twinX = form.twinX;
  frame.twinY = form.twinY;
  // From the end of Draw the machine clicks round one notch a beat, each zone against its neighbour.
  frame.rotation = setting(params.ringRotationSpeed, 1, -4, 4);
  const phraseBeats = setting(position.progress, 0, 0, 1) > 0 && beat > 0 ? Math.round(beat / position.progress) : score.bars * DEFAULT_BEATS_PER_BAR;
  // Held or forced, the phrase clock stands where the performer put it rather than where the beat has run on to.
  const clock = perf.forcedState === null && !perf.hold ? beat : progress * phraseBeats;
  const machine = Math.min(clock, peakEnd * phraseBeats) + BEAT_EPSILON;
  const wholeBeat = Math.floor(machine);
  const firstClick = Math.ceil(drawEnd * phraseBeats - BEAT_EPSILON);
  const clicks = wholeBeat >= firstClick ? wholeBeat - firstClick + smooth((machine - wholeBeat) / RATCHET_EASE) : 0;
  frame.ratchet = frame.alive ? frame.rotation * clicks * TAU / (Math.max(1, score.symmetry) * RATCHET_NOTCHES) : 0;
  // The bands step on each whole beat of the Peak, and keep the last step while they fall.
  const firstStep = Math.ceil(chargeEnd * phraseBeats - BEAT_EPSILON);
  frame.bandSnap = wholeBeat >= firstStep ? frame.rotation * (wholeBeat - firstStep + 1) * Math.PI / Math.max(1, score.symmetry) : 0;
  frame.collapse = COLLAPSE_STYLES.indexOf(form.collapse);
  frame.foldCos = Math.cos(form.collapseAngle);
  frame.foldSin = Math.sin(form.collapseAngle);
  frame.spin = setting(params.ringRotationSpeed, 1, -4, 4) * (COUNTER_ROTATION * (frame.alive ? SPIN_ALIVE : 1) * smooth(within(progress, drawEnd, chargeEnd)) + DRIFT * (frame.alive ? SPIN_ALIVE : 1) * progress);
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
  frame.outerReach = setting(params.spokeOuterReach, 1, 0, 1);
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

  const beatPart = beat - Math.floor(beat);
  const peakLit = peakShare > 0 ? 1 - within(progress, peakEnd, collapseEnd) : 0;
  frame.bandLight = BAND_REST + (BAND_CHARGE - BAND_REST) * chargeShare + (1 - BAND_CHARGE) * frame.ignite * 2 * (0.82 + 0.18 * frame.pulse * frame.pulse) * peakLit;
  frame.wave = peakLit * WAVE_DEPTH;
  frame.wavePlace = beatPart * 1.3;
  frame.life = clamp(0.3 * smooth(within(progress, frame.seedEnd, drawEnd)) + 0.3 * buildShare + 0.4 * peakLit, 0, 1);
}

/** Sets how far this mark has fallen. Every style reaches a scale of zero, so everything lands on the one point. */
function setFold(fall: number, seed: number): void {
  fold.sweep = 1;
  fold.twist = 0;
  fold.scale = 1;
  fold.plain = true;
  if (fall <= 0) {
    fold.a = 1; fold.b = 0; fold.c = 0; fold.d = 1;
    return;
  }
  const style = frame.collapse;
  if (style === COLLAPSE_FOLD || style < 0) {
    // Flattens across its axis into a line, then the line closes to a point.
    const across = 1 - smooth(fall / SQUASH_END);
    const along = 1 - smooth((fall - SHRINK_START) / (1 - SHRINK_START));
    const cos = frame.foldCos, sin = frame.foldSin;
    fold.a = cos * cos * along + sin * sin * across;
    fold.b = cos * sin * (along - across);
    fold.c = fold.b;
    fold.d = sin * sin * along + cos * cos * across;
    fold.plain = false;
    return;
  }
  let scale: number;
  if (style === COLLAPSE_IMPLODE) scale = (1 + 0.09 * Math.sin(Math.PI * clamp(fall / 0.32, 0, 1))) * (1 - smooth((fall - 0.22) / 0.78));
  else if (style === COLLAPSE_VORTEX) {
    scale = (1 - fall) * Math.sqrt(1 - fall);
    fold.twist = fall * fall * VORTEX_TURNS * TAU * (seed < 0.5 ? 0.82 : 1);
  } else if (style === COLLAPSE_IRIS) {
    fold.sweep = 1 - smooth(fall / 0.7);
    scale = 1 - smooth((fall - 0.5) / 0.5);
  } else scale = (1 + RECOIL * (0.4 + 0.6 * seed) * Math.sin(Math.PI * clamp(fall / 0.5, 0, 1))) * (1 - smooth((fall - 0.42) / 0.58));
  fold.scale = scale;
  const cos = Math.cos(fold.twist) * scale, sin = Math.sin(fold.twist) * scale;
  fold.a = cos; fold.b = -sin; fold.c = sin; fold.d = cos;
}

/** Where a point of the design lands: bent towards a square, folded, then carried to its centre. */
function mapPoint(x: number, y: number): void {
  let px = x, py = y;
  if (frame.square > 0) {
    const radius = Math.sqrt(x * x + y * y);
    if (radius > 1e-9) {
      const bend = 1 + frame.square * (radius / Math.max(Math.abs(x), Math.abs(y)) - 1);
      px *= bend;
      py *= bend;
    }
  }
  point.x = fold.a * px + fold.b * py + origin.x;
  point.y = fold.c * px + fold.d * py + origin.y;
}

function setOrigin(second: boolean): void {
  origin.x = frame.travel * (second ? frame.twinX : frame.centreX);
  origin.y = frame.travel * (second ? frame.twinY : frame.centreY);
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

function drawCurve(out: DisplayList, radius: number, start: number, sweep: number, width: number, glow: number, colour: number, alpha: number, tear: number, seed: number, wobble = 0): void {
  const shown = sweep * fold.sweep;
  if (shown <= 1e-4) return;
  if (fold.plain && frame.square <= 0) {
    const at = radius * fold.scale;
    if (shown >= TAU - 1e-6) out.push(PRIMITIVE.ring, origin.x, origin.y, at, wobble, seed * TAU, width, glow, colour, alpha, tear, seed);
    else out.push(PRIMITIVE.arc, origin.x, origin.y, at + wobble * Math.sin(start * WOBBLE_LOBES + seed * TAU), start + fold.twist, shown, width, glow, colour, alpha, tear, seed);
    return;
  }
  const steps = Math.max(2, Math.ceil(((width < 0 ? BAND_STEPS : CURVE_STEPS) * shown) / TAU));
  const from = radius + wobble * Math.sin(start * WOBBLE_LOBES + seed * TAU);
  mapPoint(Math.cos(start) * from, Math.sin(start) * from);
  let x = point.x;
  let y = point.y;
  for (let step = 1; step <= steps; step++) {
    const angle = start + (shown * step) / steps;
    const at = radius + wobble * Math.sin(angle * WOBBLE_LOBES + seed * TAU);
    mapPoint(Math.cos(angle) * at, Math.sin(angle) * at);
    // p2 = 1 marks a link in a chain: it has no end caps, so joints do not add up into beads.
    out.push(PRIMITIVE.segment, x, y, point.x, point.y, 1, width, glow, colour, alpha, tear, seed);
    x = point.x;
    y = point.y;
  }
}

/** A ring as the performer set it: whole, cut into dashes, or broken into symmetric arcs. */
function drawRing(out: DisplayList, radius: number, start: number, turn: number, width: number, colour: number, alpha: number, tear: number, seed: number): void {
  const pieces = frame.dashes > 0 ? frame.dashes : seed < frame.arcShare ? frame.symmetry : 1;
  if (pieces <= 1) {
    drawCurve(out, radius, start, turn, width, LINE_GLOW, colour, alpha, tear, seed, frame.wobble);
    return;
  }
  const duty = frame.dashes > 0 ? 1 - frame.dashGap : ARC_DUTY;
  const pitch = TAU / pieces;
  const reach = turn / TAU;
  for (let piece = 0; piece < pieces; piece++) drawCurve(out, radius, start + piece * pitch, pitch * duty * reach, width, LINE_GLOW, colour, alpha, tear, seed, frame.wobble);
}

function drawHero(out: DisplayList, element: ScoreElement, radius: number, grow: number, fade: number, tear: number, seed: number): void {
  const place = heroPlaced(element.radius) / Math.max(element.radius, 1e-6);
  const at = Math.max(0, radius * place * frame.heroContract * frame.heroKick);
  const beat = 1 + 0.45 * frame.heroPulse;
  const width = -element.weight * frame.heroWeight * (1 + 0.5 * frame.ignite) * beat / REFERENCE_HEIGHT;
  const glow = frame.heroGlow * frame.heroHalo * (0.25 + 1.75 * frame.ignite) * beat;
  if (frame.heroFill > 0 && fold.plain) out.push(PRIMITIVE.fill, origin.x, origin.y, at * fold.scale, 0, 0, 0, glow * 0.3, element.colour, fade * frame.heroFill * HERO_FILL * (0.3 + frame.ignite), 0, seed);
  if (frame.heroSplit > 0) {
    const apart = frame.heroSplit * (0.25 + 0.75 * frame.ignite);
    drawCurve(out, at * (1 + apart), element.angle, TAU * grow, width * 0.62, glow * 0.6, element.colour, fade, tear, seed);
    drawCurve(out, at * (1 - apart), element.angle, TAU * grow, width * 0.62, glow * 0.6, element.colour, fade, tear, seed);
    return;
  }
  drawCurve(out, at, element.angle, TAU * grow, width, glow, element.colour, fade, tear, seed);
}

function drawSpoke(out: DisplayList, element: ScoreElement, angle: number, inner: number, reach: number, width: number, colour: number, alpha: number, tear: number, seed: number, fall: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Retract style: the far end falls in, the near end runs out, or the line simply fades.
  const near = frame.retract === 1 ? inner + reach * fall : inner;
  const far = frame.retract === 0 ? inner + reach * (1 - fall) : inner + reach;
  const shown = frame.retract === 2 ? alpha * (1 - fall) : alpha;
  mapPoint(cos * near, sin * near);
  const x = point.x;
  const y = point.y;
  mapPoint(cos * far, sin * far);
  out.push(PRIMITIVE.segment, x, y, point.x, point.y, 0, width, LINE_GLOW, colour, shown, tear, seed);
  if (frame.endNodes > 0) out.push(PRIMITIVE.dot, point.x, point.y, END_NODE * frame.endNodes * (1 - fall), 0, 0, 0, LINE_GLOW * 2, element.colour > 0 ? element.colour : 1, shown, tear, seed);
}

/** A heavy block of colour. It waits dim through the Build and takes the light at the Peak. */
function drawBand(out: DisplayList, element: ScoreElement, radius: number, spin: number, grow: number, fade: number, colour: number, tear: number, seed: number, fall: number): void {
  const light = frame.bandLight * (1 - smooth(fall / 0.42));
  if (light <= 0.002) return;
  const direction = element.zone % 2 ? -1 : 1;
  const start = element.angle + spin * 1.4 + direction * frame.bandSnap;
  drawCurve(out, radius, start, element.length * grow, -element.weight, BAND_GLOW * frame.ignite, colour, fade * light * frame.ringAlpha, tear, seed);
}

/** A bright head on a line as it is drawn, so Draw reads as something being made. */
function drawHead(out: DisplayList, radius: number, angle: number, colour: number, alpha: number): void {
  mapPoint(Math.cos(angle) * radius, Math.sin(angle) * radius);
  out.push(PRIMITIVE.dot, point.x, point.y, 0.0052, 0, 0, 0, 0.9, colour, alpha, 0, 0);
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
  setOrigin(false);
  out.push(PRIMITIVE.dot, origin.x, origin.y, POINT_RADIUS, 0, 0, 0, POINT_GLOW, element.colour, alpha, 0, seed);
  const open = smooth(within(progress, frame.seedEnd, frame.drawEnd)) * (1 - within(progress, frame.peakEnd, frame.collapseEnd));
  if (open > 0) out.push(PRIMITIVE.ring, origin.x, origin.y, element.radius * open * frame.breath, 0, 0, element.weight * frame.ringWeight, LINE_GLOW, element.colour, open * frame.ringAlpha, frame.tear, seed);
}

/** Negative space: below the middle the reserve marks come in; above it, symmetric wedges of the design clear. */
function carved(element: ScoreElement, seed: number): boolean {
  const space = frame.negative;
  if (element.reserve) return seed >= (0.5 - space) * 2;
  if (space <= 0.5 || element.group === 'ring' || element.group === 'hero' || element.group === 'hub' || element.slot === 0 && element.group === 'tick') return false;
  return Math.abs(Math.sin((element.angle - frame.axis) * frame.symmetry * 0.5)) < (space - 0.5) * 1.7;
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
  const seed = instanceSeed(frame.seed, index);
  if (carved(element, seed)) return;

  // `exit` is when an element starts to fall. Every element lands on the point at the end of Collapse.
  const fall = within(progress, element.exit, frame.collapseEnd);
  setFold(fall, seed);
  setOrigin(element.origin === 1);
  const grow = smooth(entry);
  const tear = frame.tear * (0.35 + 0.65 * seed);
  const jitter = element.group === 'ring' || element.group === 'arc' ? frame.spacing * JITTER_RADIUS * (seed * 2 - 1) : 0;
  // The Peak's wave runs out through the rings on every beat.
  const crest = frame.wave > 0 ? frame.wave * Math.exp(-40 * (element.radius / frame.outer - frame.wavePlace) * (element.radius / frame.outer - frame.wavePlace)) : 0;
  const radius = Math.max(0, (element.radius + jitter) * frame.breath * (1 + crest) + frame.vibration * Math.sin((frame.beat * 2 + seed) * TAU));
  const spin = element.fixed ? 0 : element.zone % 2 ? -(frame.spin + frame.ratchet) * frame.counter : frame.spin + frame.ratchet;
  const fade = clamp(entry * 3, 0, 1) * (1 - fall * fall);
  const colour = agedColour(element.group === 'hero' ? element.colour : accentOf(element.colour, seed), element.enter);

  switch (element.group) {
    case 'hero': {
      drawHero(out, element, radius, grow, fade, tear, seed);
      break;
    }
    case 'band': {
      drawBand(out, element, radius, spin, grow, fade, colour, tear, seed, fall);
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
      if (element.group === 'arc') drawCurve(out, shownRadius, start, element.length * turn, width, LINE_GLOW, colour, shownAlpha, tear, seed, frame.wobble);
      else drawRing(out, shownRadius, start, TAU * turn, width, colour, shownAlpha, tear, seed);
      if (frame.alive && style === 0 && grow < 1 && fall <= 0) drawHead(out, shownRadius, start + (element.group === 'arc' ? element.length : TAU) * turn, 1, shownAlpha);
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
      mapPoint(cos * radius, sin * radius);
      const x = point.x;
      const y = point.y;
      mapPoint(cos * end, sin * end);
      out.push(PRIMITIVE.segment, x, y, point.x, point.y, 0, element.weight * frame.spokeWeight * bold, LINE_GLOW, colour, alpha, tear, seed);
      break;
    }
    case 'spoke': {
      const swept = smooth(within(progress, element.enter, element.enter + ENTER_SPAN / frame.sweep));
      const angle = element.angle + frame.spokeOffset + spin * 0.5;
      const inner = radius + (HUB_REACH - radius) * frame.inner;
      const span = (radius + element.length * frame.breath - inner) * frame.outerReach * (1 - frame.lengthJitter * seed * 0.7) * swept;
      const alpha = fade * frame.spokeAlpha * (1 - frame.rhythmDepth * (1 - frame.spokePulse));
      const width = element.weight * frame.spokeWeight;
      if (element.colour === 2) {
        // A composed twin: the pair opens and closes about its shared centre line.
        const inSector = (((element.angle - frame.axis) % (TAU / frame.symmetry)) + TAU / frame.symmetry) % (TAU / frame.symmetry);
        const side = inSector < TAU / frame.symmetry / 2 ? 1 : -1;
        drawSpoke(out, element, angle + side * (frame.twinGap - COMPOSED_TWIN_GAP) / 2, inner, span, width, colour, alpha, tear, seed, fall);
      } else {
        drawSpoke(out, element, angle, inner, span, width, colour, alpha, tear, seed, fall);
        if (seed < frame.twinShare) drawSpoke(out, element, angle + frame.twinGap, inner, span, width, colour, alpha, tear, seed, fall);
      }
      if (frame.alive && swept < 1 && fall <= 0) drawHead(out, inner + span, angle, 1, alpha);
      break;
    }
    case 'node': {
      const angle = (element.fixed ? element.angle : element.angle + spin) + frame.nodeJitter * (instanceSeed(frame.seed, index + 7919) - 0.5) * 6;
      const home = frame.snap > 0 && !element.fixed ? radius + (nearestRing(element.radius) * frame.breath - radius) * frame.snap : radius;
      const place = home + frame.nodeJitter * (instanceSeed(frame.seed, index + 104729) - 0.5);
      const size = element.length * frame.nodeSize * grow * (1 - fall);
      const twinkle = frame.twinkle > 0 ? 1 - frame.twinkle * (0.5 + 0.5 * Math.sin((frame.beat * (0.5 + seed) + seed) * TAU * 1.5)) : 1;
      const light = chaseLight(element, seed);
      const alpha = fade * frame.nodeAlpha * twinkle * Math.min(light, 1) * (1 - frame.rhythmDepth * (1 - frame.nodePulse));
      const shape = frame.nodeShape === 0 ? element.shape === 'square' : frame.nodeShape === 2;
      const kind = shape ? PRIMITIVE.square : PRIMITIVE.dot;
      const tint = frame.nodeAccent > 0 && instanceSeed(frame.seed, index + 1299709) < frame.nodeAccent ? 1 : colour;
      mapPoint(Math.cos(angle) * place, Math.sin(angle) * place);
      out.push(kind, point.x, point.y, size, angle, 0, 0, frame.nodeGlow * Math.max(light, 1), tint, alpha, tear, seed);
      break;
    }
  }
}

/** What keeps a composed form moving between its hits: rings leaving the centre and an arm sweeping the structure. */
function drawLife(out: DisplayList): void {
  const dying = 1 - smooth(within(frame.progress, frame.peakEnd, frame.peakEnd + (frame.collapseEnd - frame.peakEnd) * LIFE_FADE));
  const life = frame.life * dying;
  if (!frame.alive || life <= 0 || frame.progress <= frame.seedEnd) return;
  setFold(0, 0);
  setOrigin(false);
  const reach = frame.outer * 1.2;
  const beats = frame.beat * 0.5;
  for (let k = 0; k < PINGS; k++) {
    const part = beats + k / PINGS;
    const age = part - Math.floor(part);
    const alpha = (1 - age) * (1 - age) * life * 0.7 * frame.ringAlpha;
    if (frame.rings > 0 && alpha > 0.01) drawCurve(out, reach * Math.sqrt(age), frame.axis, TAU, 1.6, 0.28, 1, alpha, frame.tear, 0);
  }
  if (!frame.hasSpokes || frame.spokeAlpha <= 0) return;
  const arm = frame.axis + frame.rotation * frame.beat * TAU / 8;
  for (let k = 0; k < ARM_TRAIL; k++) {
    const angle = arm - k * ARM_STEP;
    mapPoint(Math.cos(angle) * HUB_REACH, Math.sin(angle) * HUB_REACH);
    const x = point.x;
    const y = point.y;
    mapPoint(Math.cos(angle) * reach, Math.sin(angle) * reach);
    out.push(PRIMITIVE.segment, x, y, point.x, point.y, 0, k === 0 ? 2 : 1, k === 0 ? 0.5 : 0.1, 2, life * frame.spokeAlpha * (1 - k / ARM_TRAIL) * (1 - k / ARM_TRAIL) * 0.85, frame.tear, 0);
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
  frame.hasSpokes = false;
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].group === 'spoke') frame.hasSpokes = true;
    else if (elements[i].group === 'ring' && frame.rings < MAX_RINGS) ringRadii[frame.rings++] = elements[i].radius;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < elements.length; i++) {
      if (passOf(elements[i]) === pass) drawElement(out, elements[i], i);
    }
  }
  if (elements.length > 0) drawLife(out);
}
