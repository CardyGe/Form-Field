/**
 * Signals: what the sound, the beat, the tempo clock and MIDI are doing this frame, as numbers by name:
 * audio.level, audio.bass, audio.mids, audio.highs (0..1); beat.pulse (0..1), beat.count (detected onsets); tempo.phase (0..1), tempo.beat (count),
 * tempo.bpm; midi.cc.<channel>.<number> (0..1); midi.note.<channel>.<number> (velocity 0..1, 0 when off).
 */
export type Signals = Record<string, number>;
export const MAX_SIGNALS = 600;
const NAME = /^[a-z]+(\.[a-z0-9]+){1,3}$/;

/** A signals message the windows may pass on: plain names and finite numbers, bounded. */
export function acceptSignals(value: unknown): value is Signals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_SIGNALS) return false;
  return entries.every(([k, v]) => k.length <= 32 && NAME.test(k) && typeof v === 'number' && Number.isFinite(v));
}

/** Names of the sound and tempo signals, for menus. */
export const SOUND_SIGNALS = [
  ['audio.bass', 'Bass'], ['audio.mids', 'Mids'], ['audio.highs', 'Highs'], ['audio.level', 'Level'],
  ['beat.pulse', 'Beat'], ['tempo.phase', 'Tempo (each beat)'],
] as const;
export function signalLabel(id: string): string {
  const sound = SOUND_SIGNALS.find(([k]) => k === id);
  if (sound) return sound[1];
  const m = id.match(/^midi\.(cc|note)\.(\d+)\.(\d+)$/);
  if (m) return m[1] === 'cc' ? `MIDI control ${m[3]} (ch ${m[2]})` : `MIDI note ${m[3]} (ch ${m[2]})`;
  return id;
}
