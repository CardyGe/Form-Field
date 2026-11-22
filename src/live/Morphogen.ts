/** Morphogen as a Live look: hands the room's movement to the engine and shows its picture. */
import type * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { Passes } from './passes';
import type { LiveSettings } from './settings';
import { MorphEngine } from '../morphogen/engine';
import { macrosFrom } from '../morphogen/macros';
import { MorphPerformer } from '../morphogen/performer';

export class Morphogen implements Look {
  private readonly engine: MorphEngine;
  private readonly performer = new MorphPerformer();
  private cue: LiveSettings['morphogenCue'] | null = null;

  constructor(passes: Passes, width: number, height: number) { this.engine = new MorphEngine(passes, width, height); }

  get output(): THREE.Texture { return this.engine.output; }
  get ready(): boolean { return this.engine.ready; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    this.followCue(settings.morphogenCue);
    const played = this.performer.frame(seconds, settings.morphogen, macrosFrom(settings.morphogen));
    this.engine.step(seconds, time, played.params, { flow: feed.flow, people: feed.peopleReady ? feed.people : null, ...played.input });
  }

  /** Fires each move once. Counters already set when the look opens are history, not new moves. */
  private followCue(next: LiveSettings['morphogenCue']): void {
    const last = this.cue;
    this.cue = next;
    this.performer.hold(next.hold);
    if (!last) return;
    if (next.cue !== last.cue) this.performer.morphTo(next.look, next.seconds);
    if (next.mutate !== last.mutate) this.performer.mutate(next.mutate);
    if (next.undo !== last.undo) this.performer.undo();
    if (next.scramble !== last.scramble) this.performer.scramble();
  }

  resize(width: number, height: number): void { this.engine.resize(width, height); }
  clear(): void { this.engine.clear(); }
  dispose(): void { this.engine.dispose(); }
}
