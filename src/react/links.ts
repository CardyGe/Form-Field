/**
 * Links (a signal drives a target) and triggers (a signal fires an action). Pure.
 * modulate: the set value plus the signal times `amount` of the target's range. control: between low and high (fractions
 * of the range), taking over from the set value while the control has been moved.
 */
import type { Signals } from './signals';

export type LinkMode = 'modulate' | 'control';
export interface Link { id: string; input: string; target: string; mode: LinkMode; amount: number; low: number; high: number; attackMs: number; releaseMs: number; on: boolean; name: string }
export type TriggerAction =
  | { kind: 'scene'; sceneId: string } | { kind: 'next-scene' } | { kind: 'previous-scene' }
  | { kind: 'vary'; sourceId: string } | { kind: 'blackout' } | { kind: 'freeze' } | { kind: 'tap' };
/** when 'on': a note going on, or a control rising past halfway. 'beats': every `every` beats of the clock. */
export interface Trigger { id: string; input: string; when: 'on' | 'beats'; every: number; action: TriggerAction; on: boolean }
export interface Range { min: number; max: number }

/** Exponential smoothing with separate rise (attack) and fall (release) times. */
export function smooth(prev: number, target: number, dt: number, attackMs: number, releaseMs: number): number {
  const tau = (target > prev ? attackMs : releaseMs) / 1000;
  if (!(tau > 0)) return target;
  return prev + (target - prev) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

/** The value to draw for one target, given the links that drive it. state keeps each link's smoothed signal between frames. */
export function evaluate(base: number, range: Range, links: Link[], signals: Signals, state: Map<string, number>, dt: number): number {
  const span = range.max - range.min;
  let control: number | null = null, sum = 0;
  for (const l of links) {
    if (!l.on) continue;
    const raw = signals[l.input];
    if (raw === undefined) { if (l.mode === 'modulate') state.delete(l.id); continue; }
    const clamped = Math.min(1, Math.max(0, raw));
    const s = smooth(state.get(l.id) ?? clamped, clamped, dt, l.attackMs, l.releaseMs);
    state.set(l.id, s);
    if (l.mode === 'control') control = range.min + span * (l.low + (l.high - l.low) * s);
    else sum += l.amount * s * span;
  }
  const value = control ?? base + sum;
  return Math.min(range.max, Math.max(range.min, value));
}

/** The actions fired between two frames of signals. */
export function fire(triggers: Trigger[], prev: Signals, now: Signals): TriggerAction[] {
  const out: TriggerAction[] = [];
  for (const t of triggers) {
    if (!t.on) continue;
    const a = prev[t.input], b = now[t.input];
    if (b === undefined) continue;
    if (t.when === 'on' ? (a ?? 0) < 0.5 && b >= 0.5 : a !== undefined && t.every >= 1 && Math.floor(b / t.every) > Math.floor(a / t.every)) out.push(t.action);
  }
  return out;
}

const SIGNAL_NAME = /^[a-z]+(\.[a-z0-9]+){1,3}$/;
const num = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
/** A link read field by field; null when it cannot be read or `targetOk` refuses its target. */
export function readLinkWith(raw: unknown, targetOk: (target: string) => boolean, maxId = 64, maxName = 40): Link | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '' || r.id.length > maxId) return null;
  if (typeof r.input !== 'string' || !SIGNAL_NAME.test(r.input) || r.input.length > 32 || typeof r.target !== 'string' || !targetOk(r.target)) return null;
  return {
    id: r.id, input: r.input, target: r.target, mode: r.mode === 'control' ? 'control' : 'modulate',
    amount: num(r.amount, -1, 1, 0.5), low: num(r.low, 0, 1, 0), high: num(r.high, 0, 1, 1),
    attackMs: num(r.attackMs, 0, 5000, 20), releaseMs: num(r.releaseMs, 0, 5000, 200), on: r.on !== false,
    name: typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxName) : '',
  };
}
