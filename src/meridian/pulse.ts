import type { DisplayList } from './display-list';
import { createRandom } from './random';
import { euclid } from './rhythm';
import { PRIMITIVE } from './types';

/**
 * Pulse: Meridian's step sequencer. A phrase is a grid of 32nd-note ticks. Some ticks are hits, and each hit deals one
 * designed cell from a seeded deck: a few rings, a set of spokes, a hero ring, a lattice. Between hits the picture
 * holds still. A phrase goes sparse, dense, flurry, line, dot, and the next phrase is a new composition.
 * Everything here is a pure function of seed, params and musical time, so any frame can be drawn in any order.
 */

export const SCORE_STYLE_PULSE = 0;
export const SCORE_STYLE_DENSE = 1;
export const TICKS_PER_BEAT = 8;
export const TICKS_PER_BAR = 32;
export const MAX_PULSE_BARS = 16;
const MAX_TICKS = MAX_PULSE_BARS * TICKS_PER_BAR;
const TAU = Math.PI * 2;
const LADDER = 8;
const DECK = 8;
const SLOTS = 4; // Compositions kept ready, so two Meridian layers do not recompile each other every frame.
const MAX_RINGS = 7;
const MAX_SPOKES = 18;
const REFERENCE_HEIGHT = 1080;
const FLASH_GAP_SECONDS = 0.34; // Hero ignitions are at least this far apart, so they stay under three a second at any speed.
const GUARD_WEIGHT = 1.5;
const GUARD_TICK_SECONDS = 0.04;
const GUARD_COUNT = 1.5;
const BUSY_COUNT = 1.3; // Past this much on screen, or this much Chaos, spokes change only on the flash grid.
const BUSY_CHAOS = 0.7;
const EASE_SECONDS = 0.05; // The very short move from one cell to the next.
const HERO_DECAY_SECONDS = 0.15;
const TWIN_GAP = 1.15 * Math.PI / 180;
/** The schemes a phrase may take its accents from. Base lines stay white. */
const ACCENT_SCHEMES = [1, 2, 4, 5, 7, 8, 11, 12];

const SOLO = 0, RINGS = 1, RINGS_SPOKES = 2, SPOKES = 3, CROSS = 4, GHOST = 5, CONTRACT = 6, LATTICE = 7;
const SECTION_DECKS: readonly (readonly number[])[] = [
  [SOLO, SOLO, RINGS, GHOST, SPOKES, RINGS, SOLO, CROSS],
  [RINGS_SPOKES, RINGS, SPOKES, GHOST, CROSS, RINGS_SPOKES, CONTRACT, SOLO],
  [RINGS_SPOKES, LATTICE, RINGS_SPOKES, CONTRACT, LATTICE, CROSS, GHOST, SPOKES],
  [RINGS_SPOKES, CONTRACT, LATTICE, RINGS, SPOKES, CONTRACT, CROSS, RINGS_SPOKES],
];
const SECTION_HITS: readonly (readonly number[])[] = [[3, 4, 5], [5, 6, 7], [7, 9, 11]];
const HERO_CHANCE = [0.14, 0.38, 0.6, 0.75];
const SYMMETRIES = [3, 4, 4, 5, 6, 6, 7, 8];
const RATIOS = [1.25, 1.33, 1.414, 1.5];

export interface PulseClock { phrase: number; tick: number; frac: number; ticks: number; tickSeconds: number }
export interface PulseTransport { phrase: number; at: number; ticks: number; lastPhase: number | null }

class Composition {
  seed = -1; phrase = -1; ticks = 0; used = 0;
  readonly hit = new Uint8Array(MAX_TICKS);
  readonly random = new Float32Array(MAX_TICKS * 4);
  readonly ladder = new Float32Array(LADDER);
  readonly deck = new Uint8Array(SECTION_DECKS.length * DECK);
  symmetry = 4; turn = 0; drift = 0; lineAngle = 0; latticeRows = 2; scheme = 1; heroRung = 3;
  buildAt = 0; fullAt = 0; flurryAt = 0; lineAt = 0; dotAt = 0;
}

class Cell {
  kind = SOLO; rings = 0; spokes = 0; heroRadius = 0; ghostRadius = 0; hub = 0; lattice = 0; colour = 0; torn = 0; tornRadius = 0;
  readonly ringRadius = new Float32Array(MAX_RINGS);
  readonly ringHeavy = new Uint8Array(MAX_RINGS);
  readonly spokeAngle = new Float32Array(MAX_SPOKES);
  readonly spokeFrom = new Float32Array(MAX_SPOKES);
  readonly spokeTo = new Float32Array(MAX_SPOKES);
  readonly spokeTwin = new Uint8Array(MAX_SPOKES);
  readonly spokeBoth = new Uint8Array(MAX_SPOKES);
}

const slots = Array.from({ length: SLOTS }, () => new Composition());
const before = new Cell();
const now = new Cell();
const macro = { density: 0.5, tension: 0.5, chaos: 0.5, weight: 1, glitch: 0.5, heat: 0.5, scale: 1, heroEvery: 8, count: 1, guarded: false, flashGuard: true, busy: false };
let useCounter = 0;

const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);
const unit = (value: number | undefined, fallback = 0.5): number => (Number.isFinite(value) ? clamp(value as number, 0, 1) : fallback);

/** Speed: a quarter to four times the hit rate, with the centre as written. */
export function pulseRate(speed: number | undefined): number {
  return 4 ** (unit(speed) * 2 - 1);
}

export function pulseTickSeconds(params: Readonly<Record<string, number>>): number {
  const bpm = Number.isFinite(params.scoreBpm) ? clamp(params.scoreBpm, 20, 400) : 124;
  return 60 / bpm / TICKS_PER_BEAT / pulseRate(params.macroSpeed);
}

export function pulsePhraseTicks(params: Readonly<Record<string, number>>): number {
  const bars = Number.isFinite(params.scorePulseBars) ? Math.round(clamp(params.scorePulseBars, 1, MAX_PULSE_BARS)) : 4;
  return bars * TICKS_PER_BAR;
}

export function isPulse(params: Readonly<Record<string, number>>): boolean {
  return Math.round(params.scoreStyle ?? SCORE_STYLE_PULSE) === SCORE_STYLE_PULSE;
}

/**
 * The clock for an export or any exact frame: a whole number of phrases fills the duration, so the last frame meets the
 * first. The tempo bends by the small amount that takes.
 */
export function exactClock(turn: number, duration: number, params: Readonly<Record<string, number>>, out: PulseClock): PulseClock {
  const written = pulseTickSeconds(params), wanted = pulsePhraseTicks(params);
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 10;
  const total = Math.max(TICKS_PER_BAR, Math.round(seconds / written / 2) * 2);
  const phrases = Math.max(1, Math.round(total / wanted));
  const ticks = clamp(Math.floor(total / phrases / 2) * 2, TICKS_PER_BAR, MAX_TICKS);
  const along = (Number.isFinite(turn) ? ((turn % 1) + 1) % 1 : 0) * phrases;
  const phrase = Math.min(phrases - 1, Math.floor(along));
  const at = (along - phrase) * ticks;
  out.phrase = params.scoreLoopPhrase >= 0.5 ? 0 : phrase;
  out.tick = Math.min(ticks - 1, Math.floor(at));
  out.frac = at - out.tick;
  out.ticks = ticks;
  out.tickSeconds = seconds / (phrases * ticks);
  return out;
}

export function createTransport(): PulseTransport {
  return { phrase: 0, at: 0, ticks: 0, lastPhase: null };
}

/**
 * The clock for the interactive preview. It runs from real tempo and keeps going past the project's loop point, so each
 * phrase is new. A paused phase stands still, and a scrub moves musical time by the same distance.
 */
export function advanceTransport(transport: PulseTransport, phase: number, duration: number, params: Readonly<Record<string, number>>, out: PulseClock): PulseClock {
  const ticks = pulsePhraseTicks(params), tickSeconds = pulseTickSeconds(params), hold = params.scoreLoopPhrase >= 0.5;
  if (transport.ticks !== ticks) {
    if (transport.ticks > 0) transport.at *= ticks / transport.ticks;
    transport.ticks = ticks;
  }
  if (transport.lastPhase !== null && Number.isFinite(phase) && Number.isFinite(duration) && duration > 0) {
    let moved = (phase - transport.lastPhase) % TAU;
    if (moved > Math.PI) moved -= TAU;
    else if (moved < -Math.PI) moved += TAU;
    transport.at += (moved / TAU) * duration / tickSeconds;
  }
  if (Number.isFinite(phase)) transport.lastPhase = phase;
  if (hold) transport.at = ((transport.at % ticks) + ticks) % ticks;
  else {
    const turns = Math.floor(transport.at / ticks);
    transport.phrase = Math.max(0, transport.phrase + turns);
    transport.at -= turns * ticks;
  }
  out.phrase = transport.phrase;
  out.tick = Math.min(ticks - 1, Math.floor(transport.at));
  out.frac = transport.at - out.tick;
  out.ticks = ticks;
  out.tickSeconds = tickSeconds;
  return out;
}

function mix(seed: number, phrase: number): number {
  let hash = Math.imul((seed >>> 0) ^ 0x51ed270b, 0x2c1b3c6d) ^ Math.imul(phrase + 1, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}

/** Fills one slot. This runs once when a phrase begins, not every frame. */
function compile(slot: Composition, seed: number, phrase: number, ticks: number): void {
  const random = createRandom(mix(seed, phrase));
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  slot.seed = seed; slot.phrase = phrase; slot.ticks = ticks;
  slot.symmetry = pick(SYMMETRIES);
  slot.turn = random() * TAU;
  slot.drift = random() < 0.45 ? 0 : (random() < 0.5 ? -1 : 1) * (0.0007 + random() * 0.0013);
  slot.lineAngle = pick([Math.PI / 2, Math.PI / 2, 0, Math.PI / 4, -Math.PI / 4]);
  slot.latticeRows = 2 + Math.floor(random() * 2);
  slot.scheme = pick(ACCENT_SCHEMES);
  const first = 0.085 + random() * 0.03, ratio = pick(RATIOS);
  for (let i = 0; i < LADDER; i++) slot.ladder[i] = first * ratio ** i;
  // The hero lives on the first rung that fills most of the frame's height.
  slot.heroRung = 0;
  while (slot.heroRung < LADDER - 2 && slot.ladder[slot.heroRung] < 0.27) slot.heroRung++;
  slot.buildAt = Math.round(ticks * (0.14 + random() * 0.07));
  slot.fullAt = Math.round(ticks * (0.42 + random() * 0.1));
  slot.flurryAt = Math.round(ticks * (0.7 + random() * 0.05));
  slot.lineAt = Math.round(ticks * 0.86);
  slot.dotAt = Math.round(ticks * 0.93);
  SECTION_DECKS.forEach((deck, section) => {
    const order = [...deck];
    for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(random() * (i + 1)), held = order[i]; order[i] = order[k]; order[k] = held; }
    for (let i = 0; i < DECK; i++) slot.deck[section * DECK + i] = order[i];
  });
  for (let i = 0; i < ticks * 4; i++) slot.random[i] = random();
  slot.hit.fill(0, 0, ticks);
  // One Euclidean pattern per section, on sixteenths, restated each bar with a seeded rotation.
  const patterns = SECTION_HITS.map(options => euclid(pick(options), 16, Math.floor(random() * 16)));
  for (let tick = 0; tick < slot.lineAt; tick += 2) {
    const section = tick < slot.buildAt ? 0 : tick < slot.fullAt ? 1 : tick < slot.flurryAt ? 2 : 3;
    const sixteenth = (tick / 2) % 16;
    if (section === 3 || patterns[section][sixteenth] || sixteenth === 0) slot.hit[tick] = 1;
  }
  // The flurry doubles to every tick for its last stretch.
  for (let tick = Math.round(slot.flurryAt + (slot.lineAt - slot.flurryAt) * 0.55); tick < slot.lineAt; tick++) slot.hit[tick] = 1;
  slot.hit[0] = 1;
}

function compositionFor(seed: number, phrase: number, ticks: number): Composition {
  let oldest = slots[0];
  for (let i = 0; i < SLOTS; i++) {
    const slot = slots[i];
    if (slot.seed === seed && slot.phrase === phrase && slot.ticks === ticks) { slot.used = ++useCounter; return slot; }
    if (slot.used < oldest.used) oldest = slot;
  }
  compile(oldest, seed, phrase, ticks);
  oldest.used = ++useCounter;
  return oldest;
}

/** The accent scheme this phrase takes when the palette is left to the seed: a number into MERIDIAN_SCHEMES, from 1. */
export function pulseScheme(seed: number, clock: PulseClock): number {
  return compositionFor(seed, clock.phrase, clock.ticks).scheme;
}

/** How far through the phrase the final dot begins, for the Mark. */
export function pulseRestStart(seed: number, clock: PulseClock): number {
  const composition = compositionFor(seed, clock.phrase, clock.ticks);
  return composition.dotAt / composition.ticks;
}

/** Heat also opens the light: at zero the picture is plain white line, at full it glows. */
export function applyPulseLight(source: Readonly<Record<string, number>>, live: Record<string, number>): void {
  const heat = unit(source.macroHeat);
  live.lightBloomAmount = (live.lightBloomAmount ?? 0.6) * (0.5 + heat * 1.6);
  live.lightLineGlow = (live.lightLineGlow ?? 0.5) * (0.4 + heat * 1.2);
  live.colourSaturation = heat <= 0 ? 0 : Math.min(2, (live.colourSaturation ?? 1) * (0.55 + heat * 1.1));
  live.colourFringe = (live.colourFringe ?? 0.2) * Math.max(0, heat - 0.5) * 2; // White lines stay white until Heat is past the centre.
  // Below the centre, Weight may go finer than the usual floor, or the fader would have nothing to thin.
  live.outputMinLineWidth = Math.max(0.6, (live.outputMinLineWidth ?? 1.5) * Math.min(1, 4.2 ** (unit(source.macroWeight) * 2 - 1)));
}

// HOT PATH: everything below runs every frame and must not allocate.

function sectionOf(composition: Composition, tick: number): number {
  return tick < composition.buildAt ? 0 : tick < composition.fullAt ? 1 : tick < composition.flurryAt ? 2 : 3;
}

function heroAt(composition: Composition, tick: number): boolean {
  if (tick >= composition.lineAt || tick % macro.heroEvery !== 0) return false;
  const base = HERO_CHANCE[sectionOf(composition, tick)], tension = macro.tension;
  const chance = tension <= 0.5 ? base * (0.08 + 1.84 * tension) : base + (1 - base) * (tension - 0.5) * 2;
  return composition.random[tick * 4 + 1] < chance;
}

function hitAt(composition: Composition, tick: number): boolean {
  // Heavy lines changing very fast are a large flash in themselves, so the Flash guard holds them to the hero's grid.
  if (macro.guarded) return tick === 0 || (tick < composition.lineAt && tick % macro.heroEvery === 0);
  if (composition.hit[tick] === 1 || heroAt(composition, tick)) return true;
  // Chaos adds hits the grid did not write, some of them off the sixteenth.
  const chaos = macro.chaos;
  return chaos > 0.5 && tick < composition.lineAt && composition.random[tick * 4 + 3] < (chaos - 0.5) * 0.62;
}

function lastHit(composition: Composition, from: number): number {
  for (let tick = from; tick > 0; tick--) if (hitAt(composition, tick)) return tick;
  return 0;
}

function fillRings(cell: Cell, composition: Composition, count: number, start: number, stride: number, jitter: number): void {
  const wanted = Math.min(MAX_RINGS, count), heavy = jitter < 0.62 ? Math.floor(jitter / 0.62 * wanted) : -1;
  for (let i = 0; i < wanted; i++) {
    const rung = composition.ladder[(start + i * stride) % LADDER];
    const shake = 1 + macro.chaos * macro.chaos * (composition.random[(i * 7 + Math.floor(jitter * 97)) * 4 % (composition.ticks * 4)] - 0.5) * 0.7;
    cell.ringRadius[i] = rung * shake;
    cell.ringHeavy[i] = i === heavy ? 1 : 0;
  }
  cell.rings = wanted;
}

/** Spokes are mostly long diameters, evenly fanned and a little off true, with some floating clear of the centre. */
function fillSpokes(cell: Cell, composition: Composition, count: number, offset: number, seedValue: number): void {
  const wanted = Math.min(MAX_SPOKES, count), chaos = macro.chaos;
  const base = (offset / (composition.symmetry * 2)) * Math.PI;
  for (let i = 0; i < wanted; i++) {
    const shade = composition.random[(i * 11 + Math.floor(seedValue * 131)) * 4 % (composition.ticks * 4)];
    cell.spokeAngle[i] = base + (i * Math.PI) / wanted + (chaos * 0.28 + chaos * chaos) * (shade - 0.5);
    cell.spokeFrom[i] = shade < 0.62 ? 0 : composition.ladder[1 + Math.floor((shade - 0.62) / 0.38 * 4)];
    cell.spokeTo[i] = 1.3;
    cell.spokeTwin[i] = shade < 0.2 ? 1 : 0;
    cell.spokeBoth[i] = shade > 0.9 ? 0 : 1;
  }
  cell.spokes = wanted;
}

function spokesOf(kind: number, section: number): number {
  if (kind === RINGS_SPOKES) return 2 + section;
  if (kind === SPOKES) return 3 + section * 2;
  if (kind === CROSS) return 2;
  if (kind === GHOST) return section;
  if (kind === CONTRACT) return section + 1;
  if (kind === LATTICE) return 1 + section;
  return 0;
}

function fillCell(cell: Cell, composition: Composition, tick: number): void {
  const at = tick * 4, r = composition.random, a = r[at], c = r[at + 2], d = r[at + 3];
  const section = sectionOf(composition, tick), kind = composition.deck[section * DECK + Math.floor(a * DECK)];
  const more = macro.count, home = composition.heroRung, start = Math.max(0, home - 2) + Math.floor(c * 3);
  cell.kind = kind;
  cell.heroRadius = 0; cell.ghostRadius = 0; cell.lattice = 0; cell.torn = 0;
  cell.hub = section === 0 ? (c < 0.5 ? 0 : 1) : 1 + Math.floor(c * 3);
  cell.colour = 0;
  let rings = 1, spokes = 0, stride = 1, ringStart = start;
  if (kind === SOLO) { rings = 1; ringStart = Math.max(0, home - 1) + Math.floor(c * 3); }
  else if (kind === RINGS) { rings = 2 + section; stride = 1 + Math.floor(d * 2); }
  else if (kind === RINGS_SPOKES) { rings = 2 + section; spokes = 2 + section; stride = 1 + Math.floor(d * 2); ringStart = Math.max(0, home - 2) + Math.floor(c * 3); }
  else if (kind === SPOKES) { rings = c < 0.4 ? 1 : 0; spokes = 3 + section * 2; }
  else if (kind === CROSS) { rings = 1 + (section > 0 ? 1 : 0); spokes = 2; ringStart = Math.max(0, home - 1) + Math.floor(c * 2); stride = 2; }
  else if (kind === GHOST) { rings = 2; spokes = section; ringStart = Math.max(0, home - 1) + Math.floor(c * 2); cell.ghostRadius = composition.ladder[home + Math.floor(d * 2)] * 1.05; }
  else if (kind === CONTRACT) { rings = 2 + Math.floor(d * 2); spokes = section + 1; ringStart = 0; }
  else if (kind === LATTICE) { rings = 1 + Math.floor(d * 2); spokes = 1 + section; cell.lattice = 1; ringStart = home; }

  const scaledRings = rings === 0 ? (more > 1.6 ? 1 : 0) : Math.max(1, Math.round(rings * more));
  fillRings(cell, composition, scaledRings, ringStart, stride, c);
  // A busy picture keeps its spokes between grid ticks, so a hit there cannot relight most of the frame.
  const grid = macro.busy ? tick - (tick % macro.heroEvery) : tick;
  if (grid !== tick) spokes = spokesOf(composition.deck[sectionOf(composition, grid) * DECK + Math.floor(r[grid * 4] * DECK)], sectionOf(composition, grid));
  const spokeSeed = r[grid * 4 + 3];
  fillSpokes(cell, composition, Math.round(spokes * more), Math.floor(spokeSeed * composition.symmetry * 2), spokeSeed);
  if (macro.density > 0.72 && section > 0) cell.lattice = 1;
  if (macro.density < 0.2) cell.lattice = 0;

  if (heroAt(composition, tick)) {
    cell.heroRadius = composition.ladder[home + Math.floor(c * 2)] * (1 + macro.chaos * macro.chaos * (d - 0.5) * 0.4);
    cell.ghostRadius = c < 0.6 ? cell.heroRadius * (1.07 + d * 0.06) : 0;
    const accentChance = macro.heat <= 0 ? 0 : macro.heat * macro.heat * macro.heat * 1.4;
    cell.colour = r[at + 1] * 2.1 % 1 < accentChance ? (d < 0.5 ? 1 : 2) : 0;
  }
  // A tear belongs to a hero. High Glitch can also tear the largest ring of a plain hit, for the same brief moment.
  const glitch = macro.glitch;
  if (glitch > 0) {
    const roll = r[at + 2] * 3.7 % 1;
    if (cell.heroRadius > 0 && roll < glitch * glitch * glitch * 0.8 + 0.01) { cell.torn = 1; cell.tornRadius = cell.heroRadius; }
    else if (glitch > 0.6 && cell.rings > 0 && section > 0 && (!macro.flashGuard || tick % macro.heroEvery === 0) && roll < (glitch - 0.6) * 2.2) {
      cell.torn = 1;
      let largest = 0;
      for (let i = 0; i < cell.rings; i++) if (cell.ringRadius[i] > largest && cell.ringRadius[i] < 0.62) largest = cell.ringRadius[i];
      cell.tornRadius = largest;
      if (largest <= 0) cell.torn = 0;
    }
  }
}

function ring(out: DisplayList, radius: number, width: number, glow: number, colour: number, alpha: number, seed: number): void {
  out.push(PRIMITIVE.ring, 0, 0, radius, 0, seed * TAU, -width / REFERENCE_HEIGHT, glow, colour, alpha, 0, seed);
}

function line(out: DisplayList, angle: number, from: number, to: number, width: number, colour: number, alpha: number, seed: number): void {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  out.push(PRIMITIVE.segment, cos * from, sin * from, cos * to, sin * to, 0, -width / REFERENCE_HEIGHT, 0.12, colour, alpha, 0, seed);
}

function drawHub(out: DisplayList, cell: Cell, scale: number, thin: number): void {
  const size = 0.016 * scale;
  if (cell.hub === 0) { out.push(PRIMITIVE.dot, 0, 0, size * 0.32, 0, 0, 0, 0.3, 0, 1, 0, 0.1); return; }
  ring(out, size, thin * (cell.hub === 3 ? 2.6 : 1.1), 0.2, 0, 1.25, 0.2);
  if (cell.hub >= 2) out.push(PRIMITIVE.dot, 0, 0, size * 0.34, 0, 0, 0, 0.3, 0, 1, 0, 0.3);
  if (cell.hub === 2) ring(out, size * 1.75, thin, 0.1, 0, 0.5, 0.4);
}

function drawLattice(out: DisplayList, composition: Composition, turn: number, tick: number, scale: number): void {
  const rows = composition.latticeRows + (macro.density > 0.75 ? 1 : 0), heat = macro.heat;
  const colour = heat < 0.12 ? 0 : composition.phrase % 2 === 0 ? 1 : 2;
  const alpha = 0.55 + heat * 0.6;
  for (let row = 0; row < rows; row++) {
    const radius = composition.ladder[Math.min(LADDER - 1, composition.heroRung - 1 + row)] * scale, count = composition.symmetry * (row === 0 ? 1 : 2);
    const shift = row % 2 ? Math.PI / count : 0;
    for (let k = 0; k < count; k++) {
      const twinkle = composition.random[(tick + k * 3 + row * 17) % composition.ticks * 4];
      if (twinkle < 0.16) continue;
      const angle = turn + shift + k * TAU / count;
      out.push(PRIMITIVE.dot, Math.cos(angle) * radius, Math.sin(angle) * radius, (0.0022 + 0.0014 * twinkle) * Math.max(0.7, macro.weight * 0.8), 0, 0, 0, 0.35 + heat * 0.7, colour, alpha, 0, twinkle);
    }
  }
}

/** A hero ring in pieces: arcs thrown off their circle, in the accent colours. Only this ring breaks. */
function drawTorn(out: DisplayList, composition: Composition, radius: number, width: number, tick: number, energy: number): void {
  const glitch = macro.glitch, pieces = 5 + Math.floor(glitch * 9), reach = 0.012 + glitch * 0.05;
  const coloured = macro.heat > 0;
  let start = composition.random[tick * 4 + 2] * TAU;
  for (let i = 0; i < pieces; i++) {
    const a = composition.random[(tick + i * 5 + 1) % composition.ticks * 4], b = composition.random[((tick + i * 7 + 2) % composition.ticks) * 4 + 1];
    const sweep = (TAU / pieces) * (0.55 + a * 0.9);
    const slip = (b - 0.5) * reach, cx = (a - 0.5) * reach * 1.4, cy = (b - 0.5) * reach * 0.7;
    const colour = coloured ? (i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2) : 0;
    const thick = -width * (0.75 + b * 0.9) / REFERENCE_HEIGHT;
    out.push(PRIMITIVE.arc, cx, cy, radius * (1 + slip), start, sweep, thick, 0.25 + energy * 0.85, colour, 1.15, 0, a);
    if (coloured && i % 2 === 0) out.push(PRIMITIVE.arc, cx - slip * 0.6, cy + slip * 0.4, radius * (1 - slip * 0.7), start + sweep * 0.2, sweep * 0.6, thick * 0.55, 0.3, i % 4 === 0 ? 2 : 1, 0.9, 0, b);
    start += TAU / pieces + (a - 0.5) * 0.12;
  }
}

function drawCollapse(out: DisplayList, composition: Composition, tick: number, frac: number): void {
  const scale = Math.min(macro.scale, 1.6), weight = Math.max(0.7, Math.min(macro.weight, 2));
  if (tick < composition.dotAt) {
    // The whole picture has become one thick bar, and it shortens in steps.
    const span = Math.max(1, composition.dotAt - composition.lineAt), step = Math.floor(((tick - composition.lineAt) / span) * 5);
    const half = (0.13 * (1 - step / 5) + 0.012) * scale;
    const cos = Math.cos(composition.lineAngle), sin = Math.sin(composition.lineAngle);
    out.push(PRIMITIVE.segment, -cos * half, -sin * half, cos * half, sin * half, 0, -11 * weight / REFERENCE_HEIGHT, 0.45, 0, 1.3, 0, 0.5);
    return;
  }
  // The dot breathes once with the last beat, then the next phrase opens from it.
  const rest = (tick + frac - composition.dotAt) / Math.max(1, composition.ticks - composition.dotAt);
  out.push(PRIMITIVE.dot, 0, 0, (0.0085 - 0.0035 * rest) * scale, 0, 0, 0, 0.45, 0, 1.2, 0, 0.5);
}

function readMacros(params: Readonly<Record<string, number>>, tickSeconds: number): void {
  macro.density = unit(params.macroDensity);
  macro.tension = unit(params.macroTension);
  macro.chaos = unit(params.macroOrder);
  macro.glitch = unit(params.macroGlitch);
  macro.heat = unit(params.macroHeat);
  macro.weight = 4.2 ** (unit(params.macroWeight) * 2 - 1);
  macro.scale = 2.5 ** (unit(params.macroScale) * 2 - 1);
  // 0 leaves a bare ring, the centre is as written, full is about two and a half times as much.
  macro.count = macro.density <= 0.5 ? 0.12 + macro.density * 1.76 : 1 + (macro.density - 0.5) * 3;
  macro.heroEvery = Math.max(2, Math.ceil(FLASH_GAP_SECONDS / (tickSeconds * 4)) * 4);
  macro.flashGuard = params.safetyFlashGuard !== 0;
  macro.busy = macro.flashGuard && (macro.count > BUSY_COUNT || macro.chaos > BUSY_CHAOS);
  macro.guarded = macro.flashGuard && macro.weight > GUARD_WEIGHT && (tickSeconds < GUARD_TICK_SECONDS || macro.count > GUARD_COUNT);
}

/** Whether the hero ignites on this tick. The flash limit is a property of this schedule. */
export function pulseHeroFires(seed: number, clock: PulseClock, params: Readonly<Record<string, number>>, tick: number): boolean {
  readMacros(params, clock.tickSeconds);
  return heroAt(compositionFor(seed >>> 0, clock.phrase, clock.ticks), tick);
}

export function evaluatePulse(seed: number, clock: PulseClock, params: Readonly<Record<string, number>>, out: DisplayList): void {
  out.clear();
  readMacros(params, clock.tickSeconds);
  const composition = compositionFor(seed >>> 0, clock.phrase, clock.ticks), tick = Math.min(clock.tick, clock.ticks - 1);
  if (tick >= composition.lineAt) { drawCollapse(out, composition, tick, clock.frac); return; }
  const hit = lastHit(composition, tick), previous = hit > 0 ? lastHit(composition, hit - 1) : 0;
  fillCell(now, composition, hit);
  if (previous !== hit) fillCell(before, composition, previous); else before.rings = 0, before.spokes = 0;

  const age = (tick - hit + clock.frac) * clock.tickSeconds;
  const move = clamp(age / EASE_SECONDS, 0, 1), ease = 1 - (1 - move) * (1 - move) * (1 - move);
  const squeeze = 1 - macro.tension * 0.3 * Math.exp(-age / 0.075);
  const scale = macro.scale * squeeze;
  const thin = 1.45 * macro.weight, medium = 3.1 * macro.weight, spoke = 1.1 * macro.weight;
  const turn = composition.turn + composition.drift * (tick + clock.frac);
  // Brief at any setting: at most six ticks. Under the guard a torn ring stays torn until the next hit, because mending it would relight it.
  const tornFor = macro.guarded ? Infinity : Math.round(2 + macro.glitch * macro.glitch * 4) * clock.tickSeconds;

  for (let i = 0; i < now.spokes; i++) {
    const angle = turn + now.spokeAngle[i], from = now.spokeFrom[i] * macro.scale, to = now.spokeTo[i] * macro.scale * (i < before.spokes ? 1 : 0.94 + 0.06 * ease);
    const tint = macro.heat > 0.7 && (i + hit) % 5 === 0 ? 1 : 0;
    line(out, angle, from, to, spoke, tint, 0.8, i * 0.07);
    if (now.spokeBoth[i]) line(out, angle + Math.PI, from, to, spoke, tint, 0.8, i * 0.09);
    if (now.spokeTwin[i]) line(out, angle + TWIN_GAP, from, to, spoke, tint, 0.55, i * 0.11);
  }
  if (now.lattice) drawLattice(out, composition, turn, hit, scale);
  for (let i = 0; i < now.rings; i++) {
    const target = now.ringRadius[i], radius = (i < before.rings ? before.ringRadius[i] + (target - before.ringRadius[i]) * ease : target) * scale;
    const heavy = now.ringHeavy[i] === 1;
    ring(out, radius, heavy ? medium : thin, heavy ? 0.16 : 0.08, 0, heavy ? 1.5 : 1.08, i * 0.13);
  }
  if (now.ghostRadius > 0) ring(out, now.ghostRadius * scale, medium * 1.25, 0.05, 0, 0.3, 0.77);
  if (now.heroRadius > 0 && !(now.torn && age < tornFor)) {
    const energy = Math.exp(-age / HERO_DECAY_SECONDS);
    const width = (3.2 + 11 * energy) * Math.max(0.55, macro.weight);
    ring(out, now.heroRadius * scale, width, 0.3 + 1.5 * energy * (0.6 + macro.heat * 0.8), energy > 0.28 ? now.colour : 0, 1.05 + 0.45 * energy, 0.9);
  }
  if (now.torn && age < tornFor) {
    const energy = Math.exp(-age / HERO_DECAY_SECONDS);
    drawTorn(out, composition, now.tornRadius * scale, (4 + 9 * energy) * Math.max(0.6, macro.weight), macro.guarded ? hit : hit + Math.floor(age / clock.tickSeconds), energy);
  }
  drawHub(out, now, Math.max(0.65, Math.min(macro.scale, 1.7)), Math.max(1.2, thin));
}
