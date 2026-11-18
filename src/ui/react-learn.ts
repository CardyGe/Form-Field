/**
 * Learn: the next MIDI control or note that moves is taken for a link or a trigger. Only one thing learns at a time;
 * starting another, or cancelling, lets the first go. MIDI is switched on when learning starts.
 */
import { useEffect, useState } from 'react';
import type { ReactivityEngine } from '../react/engine';

let current: { key: string; cancel: () => void } | null = null;
const watchers = new Set<() => void>();
const changed = () => { for (const w of watchers) w(); };

export function startLearning(engine: ReactivityEngine, key: string, take: (signal: string) => void): void {
  current?.cancel();
  if (!engine.prefs.midi) engine.setPrefs({ midi: true });
  const mine = { key, cancel: () => { engine.midi.learn(null); if (current === mine) { current = null; changed(); } } };
  current = mine;
  engine.midi.learn(signal => { if (current === mine) { current = null; changed(); } take(signal); });
  changed();
}
export function stopLearning(): void { current?.cancel(); }

/** Which key is learning now (or null), kept current. */
export function useLearning(): string | null {
  const [key, setKey] = useState<string | null>(current?.key ?? null);
  useEffect(() => {
    const watch = () => setKey(current?.key ?? null);
    watchers.add(watch);
    return () => { watchers.delete(watch); };
  }, []);
  // Leaving the screen while learning stops it.
  useEffect(() => () => { if (current && !watchers.size) current.cancel(); }, []);
  return key;
}
