/** Morphogen as a Live look: hands the room's movement to the engine, and plays what the performer and MIDImix ask for. */
import type * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { Passes } from './passes';
import type { LiveSettings } from './settings';
import { MorphEngine } from '../morphogen/engine';
import { MACROS, macrosFrom, type MacroKey } from '../morphogen/macros';
import type { MidimixView } from '../morphogen/midimix-mode';
import { MorphogenPlay } from '../morphogen/play';

export class Morphogen implements Look {
  private readonly engine: MorphEngine;
  private play = new MorphogenPlay();
  private signals: Record<string, number> = {};
  private operator: LiveSettings | null = null;
  private view: MidimixView | null = null;

  constructor(passes: Passes, width: number, height: number) { this.engine = new MorphEngine(passes, width, height); }

  get output(): THREE.Texture { return this.engine.output; }
  get ready(): boolean { return this.engine.ready; }
  get midimix(): { active: boolean; look: number | null; queued: number | null } {
    const lights = this.view?.lights;
    return { active: this.view?.active ?? false, look: lights && lights.amber.includes(true) ? lights.amber.indexOf(true) : null, queued: lights?.queued ?? null };
  }

  adoptPlay(play: MorphogenPlay): void { this.play = play; }

  /** `operator` is the settings as set, before sound and MIDI links move them. */
  setSignals(signals: Record<string, number>, operator: LiveSettings): void { this.signals = signals; this.operator = operator; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const operator = (this.operator ?? settings).morphogen, modulated = settings.morphogen;
    this.followCue(settings.morphogenCue);
    this.view = this.play.mode.update(this.signals, seconds, macrosFrom(operator));
    // A sound link on a macro moves it around wherever the knob or slider has put it.
    const macros = Object.fromEntries(MACROS.map(key => [key, Math.max(0, Math.min(1, this.view!.macros[key] + modulated[key] - operator[key]))])) as Record<MacroKey, number>;
    const played = this.play.performer.frame(seconds, operator, macros, modulated);
    this.engine.step(seconds, time, played.params, { flow: feed.flow, people: feed.peopleReady ? feed.people : null, ...played.input });
  }

  /** Fires each move once. Counters already set when the look opens are history, not new moves. */
  private followCue(next: LiveSettings['morphogenCue']): void {
    const last = this.play.cue, performer = this.play.performer;
    this.play.cue = next;
    if (!last) { performer.hold(next.hold); return; }
    if (next.hold !== last.hold) performer.hold(next.hold);
    if (next.cue !== last.cue) performer.morphTo(next.look, next.seconds);
    if (next.mutate !== last.mutate) performer.mutate(next.mutate);
    if (next.undo !== last.undo) performer.undo();
    if (next.scramble !== last.scramble) performer.scramble();
  }

  resize(width: number, height: number): void { this.engine.resize(width, height); }
  clear(): void { this.engine.clear(); }
  dispose(): void { this.engine.dispose(); }
}
