/** Morphogen as a Live look: hands the room's movement to the engine and shows its picture. */
import type * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { Passes } from './passes';
import type { LiveSettings } from './settings';
import { MorphEngine } from '../morphogen/engine';

export class Morphogen implements Look {
  private readonly engine: MorphEngine;

  constructor(passes: Passes, width: number, height: number) { this.engine = new MorphEngine(passes, width, height); }

  get output(): THREE.Texture { return this.engine.output; }
  get ready(): boolean { return this.engine.ready; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    this.engine.step(seconds, time, settings.morphogen, { flow: feed.flow, people: feed.peopleReady ? feed.people : null, impulse: 0, seedBurst: 0 });
  }

  resize(width: number, height: number): void { this.engine.resize(width, height); }
  clear(): void { this.engine.clear(); }
  dispose(): void { this.engine.dispose(); }
}
