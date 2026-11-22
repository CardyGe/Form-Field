import type { Signals } from '../react/signals';
import { MORPH_LOOKS } from './looks';
import { MACROS, neutralMacros, type MacroKey } from './macros';
import type { MidimixMap } from './midimix-map';
import type { MorphPerformer } from './performer';

const PICKUP = .015, QUEUE_TIMEOUT_SECONDS = 1, DEFAULT_MORPH_SECONDS = 4, MAX_MORPH_SECONDS = 16;

export interface MidimixView {
  active: boolean;
  macros: Record<MacroKey, number>;
  lights: { amber: boolean[]; red: boolean[]; queued: number | null };
}

/**
 * Morphogen mode on the MIDImix: knob row 1 plays the macros, ambers morph between looks, reds are the performance moves.
 * Faders are never read here, so brightness and the master always stay under the hand.
 */
export class MidimixMode {
  private active = false;
  private readonly pressed = new Map<string, boolean>();
  private readonly knobs = new Map<MacroKey, number>();
  private readonly caught = new Set<MacroKey>();
  private readonly owned = new Map<MacroKey, number>();
  private lastCurrent: Record<MacroKey, number> | null = null;
  private held = false;
  private look: number | null = null;
  private queued: number | null = null;
  private queuedAtBeat = 0;
  private queuedFor = 0;
  private morphSeconds = DEFAULT_MORPH_SECONDS;
  private mutations = 0;

  constructor(private readonly map: MidimixMap, private readonly performer: MorphPerformer) {}

  private rose(signals: Signals, name: string): boolean {
    const down = (signals[name] ?? 0) > 0, was = this.pressed.get(name) ?? false;
    this.pressed.set(name, down);
    return down && !was;
  }

  update(signals: Signals, seconds: number, current: Record<MacroKey, number> = neutralMacros()): MidimixView {
    const solo = (signals[this.map.solo] ?? 0) > 0;
    if (this.rose(signals, this.map.sendAll) && solo) {
      this.active = !this.active;
      this.caught.clear();
    }
    // An on-screen slider that moves takes its macro back from the knob.
    for (const key of MACROS) if (this.lastCurrent && current[key] !== this.lastCurrent[key]) { this.owned.delete(key); this.caught.delete(key); }
    this.lastCurrent = { ...current };

    const amber = this.map.amber.map(name => this.rose(signals, name)), red = this.map.red.map(name => this.rose(signals, name));
    if (this.active) {
      MACROS.forEach((key, strip) => this.followKnob(key, signals[this.map.knobs[0][strip]], current[key]));
      const time = signals[this.map.knobs[1][0]];
      if (time !== undefined) this.morphSeconds = time * MAX_MORPH_SECONDS;
      amber.forEach((rose, index) => { if (rose && index < MORPH_LOOKS.length) this.queue(index, signals); });
      if (red[0]) { this.held = !this.held; this.performer.hold(this.held); }
      if (red[1]) this.performer.mutate(++this.mutations);
      if (red[2]) this.performer.scramble();
      if (red[3]) this.performer.undo();
    }
    this.launch(signals, seconds);
    const macros = Object.fromEntries(MACROS.map(key => [key, this.owned.get(key) ?? current[key]])) as Record<MacroKey, number>;
    return { active: this.active, macros, lights: { amber: this.map.amber.map((_, i) => this.active && this.look === i), red: this.map.red.map((_, i) => this.active && i === 0 && this.held), queued: this.queued } };
  }

  /** Pickup: a knob changes its macro only after it reaches the value now playing, so the picture cannot jump. */
  private followKnob(key: MacroKey, knob: number | undefined, current: number): void {
    if (knob === undefined) return;
    const previous = this.knobs.get(key), value = this.owned.get(key) ?? current;
    this.knobs.set(key, knob);
    if (!this.caught.has(key)) {
      const crossed = previous !== undefined && (previous - value) * (knob - value) <= 0;
      if (!crossed && Math.abs(knob - value) > PICKUP) return;
      this.caught.add(key);
    }
    this.owned.set(key, knob);
  }

  private queue(index: number, signals: Signals): void {
    if ((signals['tempo.bpm'] ?? 0) > 0 && signals['tempo.beat'] !== undefined) { this.queued = index; this.queuedAtBeat = signals['tempo.beat']; this.queuedFor = 0; }
    else this.fire(index);
  }

  private launch(signals: Signals, seconds: number): void {
    if (this.queued === null) return;
    this.queuedFor += seconds;
    if (signals['tempo.beat'] !== this.queuedAtBeat || this.queuedFor >= QUEUE_TIMEOUT_SECONDS) { const index = this.queued; this.queued = null; this.fire(index); }
  }

  private fire(index: number): void { this.look = index; this.performer.morphTo(index, this.morphSeconds); }
}
