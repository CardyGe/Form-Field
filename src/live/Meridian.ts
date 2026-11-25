/**
 * Meridian Live: the slow living structure of Meridian's Evolve, moved by the people in the room.
 *
 * The camera picture never reaches this look. People are read from the people, movement and stillness textures as a small
 * presence grid (meridian-presence.ts), turned into anonymous bodies and interactions (src/meridian/live-core.ts), and drawn by
 * the same MeridianRenderer as the Studio instrument, with music through the same Conductor. Live's output then goes through
 * the wall's flash limiter in LiveRenderer.
 */
import * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings } from './settings';
import type { Passes } from './passes';
import type { Signals } from '../react/signals';
import { PresenceGrid } from './meridian-presence';
import { MeridianRenderer, type MeridianRuntime } from '../rendering/MeridianRenderer';
import { MeridianLiveCore } from '../meridian/live-core';
import { GRID_HEIGHT, GRID_WIDTH } from '../meridian/bodies';
import { LIVE_CAPACITY } from '../meridian/interactions';
import { MERIDIAN_DEFAULTS } from '../meridian/parameters';
import { FULL_QUALITY, type MeridianQuality } from '../meridian/governor';
import type { Layer } from '../shared/types';

/** The Evolve clock's loop length here: Live never loops, it only needs a phase that moves on in real time. */
const DURATION = 600;
const TAU = Math.PI * 2;
const NO_SIGNALS: Signals = {};

export class Meridian implements Look {
  /** This frame's sound, beat, tempo and MIDI, set by LiveRenderer. */
  signals: Signals = NO_SIGNALS;
  /** What the quality governor allows this frame, set by LiveRenderer. Never touches line width or the flash limiter. */
  quality: Readonly<MeridianQuality> = FULL_QUALITY;
  private readonly picture = new MeridianRenderer();
  private readonly target: THREE.WebGLRenderTarget;
  private readonly presence: PresenceGrid;
  private readonly core = new MeridianLiveCore();
  private readonly layer: Layer;
  private readonly runtime: MeridianRuntime;
  private readonly draw: (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;
  private values: LiveSettings['meridian'] | null = null;
  private time = 0;
  private sinceGrid = 0;
  private step_ = 0;
  private drawMs = 0;

  constructor(private readonly passes: Passes, private width: number, private height: number) {
    this.target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.presence = new PresenceGrid(passes);
    this.layer = {
      id: 'live-meridian', name: 'Meridian', kind: 'meridian', visible: true, opacity: 1, blend: 'normal', transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      mask: { kind: 'none', softness: 0, invert: false, size: 1 },
      params: { ...MERIDIAN_DEFAULTS }, palette: [], modulations: {},
    };
    this.draw = (material, target) => passes.draw(material, target);
    this.runtime = {
      live: true, duration: DURATION, capacity: LIVE_CAPACITY,
      influence: (list, frame, aspect) => { if (this.values) this.core.influence(list, frame.beats, frame.bpm, aspect, this.time, this.step_, this.layer.params); },
    };
  }

  get output(): THREE.Texture { return this.target.texture; }

  step(seconds: number, time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const started = performance.now();
    this.values = settings.meridian; this.time = time; this.step_ = seconds;
    this.core.step(seconds, { fresh: feed.fresh, peopleReady: feed.peopleReady, peopleFailed: feed.peopleStatus.state === 'failed' });
    this.sinceGrid += seconds;
    const grid = this.presence.update(feed, this.core.mode);
    if (grid) { this.core.grid(grid, GRID_WIDTH, GRID_HEIGHT, this.sinceGrid, settings.meridian as unknown as Readonly<Record<string, number>>); this.sinceGrid = 0; }
    this.core.params(settings.meridian as unknown as Readonly<Record<string, number>> & { preset: string | null }, this.layer.params);
    this.layer.palette = settings.meridian.palette;
    const music = settings.meridian.liveMusic >= 0.5, signals = this.signals;
    const external = signals['tempo.external'] === 1;
    // The same rule as Map and the Studio: music is heard only when there is sound or a tempo from MIDI, tap or a number.
    this.runtime.signals = music && (external || signals['audio.level'] !== undefined) ? signals : undefined;
    this.runtime.externalTempo = music && external;
    this.runtime.dt = seconds;
    const phase = ((time % DURATION) / DURATION) * TAU;
    this.picture.setQuality(this.quality);
    this.picture.draw(this.passes.renderer, this.layer, phase, this.width, this.height, this.target, this.draw, this.runtime);
    this.drawMs = this.drawMs * 0.95 + (performance.now() - started) * 0.05;
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; this.target.setSize(width, height); }

  /** Clear forgets the room: bodies, charges and what waits for the beat. Rings and wakes fade out; the structure carries on. */
  clear(): void { this.core.clear(); }

  /** Read-only state for the operator and the scripted checks: numbers and words, never a picture. */
  diagnostics(): { bodies: number; attract: number; readbackMs: number; gridMs: number; status: string; mode: string; cameraLost: boolean; links: number; merges: number; throws: number; releases: number; charge: number; crowd: number; drawMs: number; qualityReduced: boolean; qualityLevel: number; positions: { id: number; x: number; y: number; energy: number; stillness: number }[] } {
    const f = this.core.frame;
    return { bodies: f.bodies, attract: f.attract, readbackMs: this.presence.readbackMs, gridMs: this.presence.intervalMs, status: this.core.status, mode: this.core.mode, cameraLost: this.core.cameraLost,
      links: f.links, merges: f.merges, throws: f.throws, releases: f.releases, charge: f.charge, crowd: f.crowdEnergy, drawMs: this.drawMs, qualityReduced: this.quality.reduced, qualityLevel: this.quality.level,
      positions: this.core.bodies.map(b => ({ id: b.id, x: b.x, y: b.y, energy: b.energy, stillness: b.stillness })) };
  }

  dispose(): void { this.picture.dispose(); this.presence.dispose(); this.target.dispose(); }
}
