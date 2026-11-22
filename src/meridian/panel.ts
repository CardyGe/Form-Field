import { isTypingTarget } from '../map/keys';
import type { Layer, ParameterDefinition } from '../shared/types';
import { MERIDIAN_FIXED, MERIDIAN_MOVES, MERIDIAN_PARAMETERS, PERFORMANCE_GROUP } from './parameters';
import { createRandom } from './random';
import { MERIDIAN_SCHEMES } from './schemes';

export const SEED_SLOTS = 8;
const slotKey = (slot: number) => `seedSlot${slot}`;
const isSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < SEED_SLOTS;
const isSeedSlotKey = (key: string) => key.startsWith('seedSlot');
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The deep parameters. Macros, moves and the seed bank have their own controls at the top of the panel. */
export const PANEL_PARAMETERS: readonly ParameterDefinition[] = MERIDIAN_PARAMETERS.filter((d) => d.group !== PERFORMANCE_GROUP && !isSeedSlotKey(d.key));

const OFF_ON = ['Off', 'On'];
const SWATCHES = ['Swatch 1', 'Swatch 2', 'Swatch 3', 'Swatch 4', 'Swatch 5', 'Swatch 6'];
const SCHEMES = MERIDIAN_SCHEMES.map((scheme) => scheme.name);
/** Stepped parameters that are named choices, so they show as dropdowns. */
export const MERIDIAN_CHOICES: Readonly<Record<string, readonly string[]>> = {
  scoreStyle: ['Pulse', 'Dense', 'Evolve'],
  scoreHoldShape: OFF_ON,
  scoreLoopPhrase: OFF_ON,
  scoreQuantise: ['At once', 'Beat', 'Bar', 'Phrase'],
  scoreAutopilot: OFF_ON,
  ringDrawOnStyle: ['Sweep round', 'Fade in', 'Grow out', 'Snap on'],
  spokeRetractStyle: ['To centre', 'To edge', 'Fade'],
  nodeShape: ['As designed', 'Dots', 'Squares'],
  nodeChasePattern: ['Round', 'Outwards', 'Inwards', 'Scattered'],
  colourPalette: ['Layer swatches', ...SCHEMES, 'Seed chooses'],
  colourBase: SWATCHES,
  colourAccent: SWATCHES,
  colourPeakPalette: ['Same as main', ...SCHEMES, 'Seed chooses'],
  outputMono: OFF_ON,
  outputTransparent: OFF_ON,
  safetyFlashGuard: OFF_ON,
};

/** Definitions by group, in order. Every word of the query must appear in the label, group or description. */
export function filterParameters(definitions: readonly ParameterDefinition[], query: string): Map<string, ParameterDefinition[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, ParameterDefinition[]>();
  for (const d of definitions) {
    const group = d.group ?? d.section;
    const text = `${d.label} ${group} ${d.description ?? ''}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) continue;
    const members = groups.get(group);
    if (members) members.push(d); else groups.set(group, [d]);
  }
  return groups;
}

export function toggleGroupLock(layer: Layer, group: string): Layer {
  const locks = layer.meridian?.locks ?? [];
  return { ...layer, meridian: { ...layer.meridian, locks: locks.includes(group) ? locks.filter((lock) => lock !== group) : [...locks, group] } };
}

/** What Mutate may move: the drawing itself. Score, framing, output setup and audio calibration stay as the performer set them. */
const MUTATED_GROUPS = ['Rings', 'Spokes', 'Nodes', 'Hero', 'Rhythm', 'Glitch', 'Light', 'Colour'];
const MUTABLE = MERIDIAN_PARAMETERS.filter((d) => MUTATED_GROUPS.includes(d.group as string) && d.step !== 1 && !d.structural && !d.momentary && !MERIDIAN_FIXED.includes(d.key));
/** At full Variation, the furthest a value moves, as a share of its working reach. */
const MUTATE_REACH = 0.35;

/**
 * Mutate nudges unlocked drawing values around where they are, by the Variation amount, and keeps the composition.
 * Reseed writes `seed` as the new active seed, unless Score is locked. Neither touches macros, moves, safety or the bank.
 */
export function applyLockedVariation(layer: Layer, seed: number, mode: 'mutate' | 'reseed'): Layer {
  const locks = layer.meridian?.locks ?? [];
  if (mode === 'reseed') return locks.includes('Score') ? layer : { ...layer, params: { ...layer.params, seed: (seed >>> 0) || 1 } };
  const random = createRandom(seed), params = { ...layer.params };
  const variation = clamp(layer.params.scoreVariation ?? 0, 0, 1);
  for (const d of MUTABLE) {
    const swing = random() * 2 - 1;
    if (locks.includes(d.group as string) || layer.modulations[d.key]) continue;
    const span = d.max - d.min, value = params[d.key] ?? d.default;
    // Wide ranges are relative to the value, so a weight of 1 on a 0 to 16 slider is not thrown across the room.
    const reach = Math.min(span, Math.max(Math.abs(value) * 2, span * 0.25));
    const moved = value + swing * variation * MUTATE_REACH * reach;
    params[d.key] = clamp(Number((d.min + Math.round((moved - d.min) / d.step) * d.step).toFixed(7)), d.min, d.max);
  }
  return { ...layer, params };
}

/** The largest seed a slot can hold, and so the largest Reseed picks. */
export const MAX_STORED_SEED = MERIDIAN_PARAMETERS.find((d) => d.key === slotKey(0))!.max;

/** Stores the active seed. 0 marks an empty slot, so seed 0 cannot be stored, nor a seed too large for a slot. */
export function storeSeed(layer: Layer, slot: number): Layer {
  const seed = layer.params.seed;
  if (!isSlot(slot) || !seed || seed > MAX_STORED_SEED) return layer;
  return { ...layer, params: { ...layer.params, [slotKey(slot)]: seed } };
}

/** Makes a stored seed the active one. An empty slot returns the same layer. */
export function recallSeed(layer: Layer, slot: number): Layer {
  const seed = isSlot(slot) ? layer.params[slotKey(slot)] : 0;
  if (!seed) return layer;
  return { ...layer, params: { ...layer.params, seed } };
}

/**
 * Between two captures. Stepped and structural values switch at the midpoint, because a structural value
 * in motion would recompose the design on every step of the drag.
 */
export function morph(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, amount: number, definitions: readonly ParameterDefinition[]): Record<string, number> {
  const t = clamp(Number.isFinite(amount) ? amount : 0, 0, 1), result: Record<string, number> = {};
  for (const d of definitions) {
    const from = a[d.key] ?? b[d.key] ?? d.default, to = b[d.key] ?? a[d.key] ?? d.default;
    const value = d.step === 1 || d.structural ? (t < 0.5 ? from : to) : t === 1 ? to : from + (to - from) * t;
    result[d.key] = clamp(value, d.min, d.max);
  }
  return result;
}

/** A/B holds the look. Safety, output setup, moves and the seed bank are never crossfaded. */
const MORPHED = MERIDIAN_PARAMETERS.filter((d) => d.group !== 'Safety' && d.group !== 'Output' && !d.momentary && !isSeedSlotKey(d.key));

export function captureMorph(layer: Layer, side: 'morphA' | 'morphB'): Layer {
  const capture = Object.fromEntries(MORPHED.map((d) => [d.key, layer.params[d.key] ?? d.default]));
  // The look on screen is now that end of the morph, so the slider moves there too.
  return { ...layer, meridian: { locks: [], ...layer.meridian, [side]: capture, morphAmount: side === 'morphA' ? 0 : 1 } };
}

/** Moves the layer to `amount` between its captures, leaving locked groups alone. Without both captures nothing changes. */
export function applyMorph(layer: Layer, amount: number): Layer {
  const state = layer.meridian;
  if (!state?.morphA || !state.morphB) return layer;
  const { morphA, morphB, locks } = state;
  const definitions = MORPHED.filter((d) => !locks.includes(d.group as string) && d.key in morphA && d.key in morphB);
  return { ...layer, params: { ...layer.params, ...morph(morphA, morphB, amount, definitions) }, meridian: { ...state, morphAmount: clamp(amount, 0, 1) } };
}

export type MoveKey = (typeof MERIDIAN_MOVES)[number];
export type PerformanceAction = MoveKey | `recall:${number}`;
const MOVE_KEYS: Readonly<Record<string, MoveKey>> = { n: 'moveNext', h: 'moveHold', d: 'moveDrop', c: 'moveCollapse', m: 'moveMutate', r: 'moveReseed' };

/** Which physical keys hold which action. A key's character changes with Shift, its code does not. */
export class KeyHolds {
  private readonly byCode = new Map<string, PerformanceAction>();

  down(code: string, action: PerformanceAction): void {
    this.byCode.set(code, action);
  }

  /** The action this key lets go of, or null if it held none or another key still holds it. */
  up(code: string): PerformanceAction | null {
    const action = this.byCode.get(code);
    if (!action || !this.byCode.delete(code)) return null;
    return [...this.byCode.values()].includes(action) ? null : action;
  }

  clear(): PerformanceAction[] {
    const actions = [...new Set(this.byCode.values())];
    this.byCode.clear();
    return actions;
  }
}

/** The move a key plays. A slider keeps the keyboard live, so moves still fire straight after a drag; text boxes and dropdowns do not. */
export function performanceShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: { tagName?: string; type?: string; isContentEditable?: boolean } | null }): PerformanceAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (isTypingTarget(e.target) && e.target?.type !== 'range') return null;
  if (/^[1-8]$/.test(e.key)) return `recall:${Number(e.key) - 1}`;
  return MOVE_KEYS[e.key.toLowerCase()] ?? null;
}
