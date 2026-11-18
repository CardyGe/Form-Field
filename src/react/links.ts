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
