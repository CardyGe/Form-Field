/**
 * Live's links: sound, the beat, tempo and MIDI driving the sliders of Live's looks (and sensitivity), applied to a copy
 * of the settings for one frame. The settings themselves stay as the operator set them.
 *   live.paint.<key> | live.smoke.<key> | live.relief.<key> | live.signal.<key> | live.sensitivity
 */
import { evaluate, readLinkWith, type Link } from '../react/links';
import type { Signals } from '../react/signals';
import { PAINT_CONTROLS, RELIEF_CONTROLS, SENSITIVITY, SIGNAL_CONTROLS, SMOKE_CONTROLS, type LiveControl, type LiveSettings } from './settings';

export const MAX_LIVE_LINKS = 64;
type Section = 'paint' | 'smoke' | 'relief' | 'signal';
// A function, not a table: settings.ts imports this file, so its controls are only ready once both have loaded.
const controls = (s: Section): readonly LiveControl<string>[] => ({ paint: PAINT_CONTROLS, smoke: SMOKE_CONTROLS, relief: RELIEF_CONTROLS, signal: SIGNAL_CONTROLS })[s];
const LABELS: Record<Section, string> = { paint: 'Paint', smoke: 'Smoke', relief: 'Relief', signal: 'Signal Melt' };

export function liveTargetRange(target: string): { min: number; max: number; label: string } | null {
  if (target === 'live.sensitivity') return { min: SENSITIVITY.min, max: SENSITIVITY.max, label: 'Sensitivity' };
  const m = /^live\.(paint|smoke|relief|signal)\.([A-Za-z0-9]{1,40})$/.exec(target);
  if (!m) return null;
  const c = controls(m[1] as Section).find(x => x.key === m[2]);
  return c ? { min: c.min, max: c.max, label: `${LABELS[m[1] as Section]} · ${c.label}` } : null;
}
export const readLiveLink = (raw: unknown): Link | null => readLinkWith(raw, t => !!liveTargetRange(t));

export class LiveModulator {
  private readonly state = new Map<string, number>();
  /** The settings to draw this frame: a copy with the links applied, or the settings themselves when none apply. */
  apply(settings: LiveSettings, signals: Signals, dt: number): LiveSettings {
    const links = settings.links.filter(l => l.on);
    if (!links.length) return settings;
    const out: LiveSettings = { ...settings, paint: { ...settings.paint }, smoke: { ...settings.smoke }, relief: { ...settings.relief }, signal: { ...settings.signal } };
    for (const target of new Set(links.map(l => l.target))) {
      const range = liveTargetRange(target);
      if (!range) continue;
      const group = links.filter(l => l.target === target);
      if (target === 'live.sensitivity') { out.sensitivity = evaluate(settings.sensitivity, range, group, signals, this.state, dt); continue; }
      const [, section, key] = target.split('.') as [string, Section, string];
      const values = out[section] as unknown as Record<string, number>;
      if (typeof values[key] === 'number') values[key] = evaluate(values[key], range, group, signals, this.state, dt);
    }
    for (const id of [...this.state.keys()]) if (!settings.links.some(l => l.id === id)) this.state.delete(id);
    return out;
  }
}

/** Ready-made reactions for the look on screen. Each adds an ordinary link. */
export const LIVE_REACTIONS = {
  'movement-bass': { label: 'Movement on the bass', input: 'audio.bass', amount: 0.35, attackMs: 20, releaseMs: 250, keys: { paint: 'response', smoke: 'response', relief: 'reach', signal: 'response' } },
  'glow-beat': { label: 'Glow on the beat', input: 'beat.pulse', amount: 0.4, attackMs: 0, releaseMs: 160, keys: { paint: 'spread', smoke: 'emit', relief: 'edgeLight', signal: 'halo' } },
} as const;
export type LiveReaction = keyof typeof LIVE_REACTIONS;

export function liveReactionLinks(settings: LiveSettings, reaction: LiveReaction, ids: string[]): Link[] {
  const r = LIVE_REACTIONS[reaction], section = settings.look as Section;
  const preferred = `live.${section}.${r.keys[section]}`;
  const target = liveTargetRange(preferred) ? preferred : `live.${section}.${controls(section)[0].key}`;
  return [{ id: ids[0], input: r.input, target, mode: 'modulate', amount: r.amount, low: 0, high: 1, attackMs: r.attackMs, releaseMs: r.releaseMs, on: true, name: r.label }];
}

/** The targets for the links list: the look on screen's sliders, then sensitivity. */
export function liveTargetOptions(look: LiveSettings['look']): { target: string; label: string }[] {
  return [...controls(look as Section).map(c => ({ target: `live.${look}.${c.key}`, label: `${LABELS[look as Section]} · ${c.label}` })), { target: 'live.sensitivity', label: 'Sensitivity' }];
}
