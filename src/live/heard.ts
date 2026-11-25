import type { Signals } from '../react/signals';
import type { TempoSource } from '../react/tempo';

/**
 * The signals as Meridian hears them. Whether the tempo stands on its own (MIDI clock, tap, a fixed number) travels
 * with the signals, so Meridian's Conductor keeps the beat with no sound and through quiet breakdowns.
 * Map and Live use the same rule. The engine's own signals are never changed.
 */
export function heardSignals(now: Signals, tempo: TempoSource): Signals {
  return tempo !== 'beat' ? { ...now, 'tempo.external': 1 } : now;
}

/** Only the signals a screen uses, so a controller with many knobs never floods the look or the window message. */
export function onlySignals(signals: Signals, used: ReadonlySet<string>): Signals {
  return Object.fromEntries(Object.entries(signals).filter(([k]) => used.has(k)));
}
