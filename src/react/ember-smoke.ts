import type { Layer } from '../shared/types';
import type { Signals } from './signals';

export const EMBER_SMOKE_INPUTS = ['beat.count', 'beat.pulse', 'audio.bass', 'audio.highs'] as const;
export const EMBER_LIVE_PUFFS = 4;
const MAX_AGE = 2.3;

export interface SmokeBeat { id: number; age: number; strength: number }
export interface SmokeAudioFrame {
  bass: number;
  highs: number;
  beats: readonly SmokeBeat[];
}

export function usesEmberSmokeAudio(layer: Layer): boolean {
  return layer.visible && layer.kind === 'scope' && layer.params.scopeMode === 1 &&
    (layer.params.emberSmoke > 0 || !!layer.modulations.emberSmoke) &&
    (layer.params.emberSmokeResponse > 0 || !!layer.modulations.emberSmokeResponse);
}

const level = (v: number) => Math.max(0, Math.min(1, v || 0));
const follow = (from: number, to: number, dt: number, release: number) =>
  from + (to - from) * (1 - Math.exp(-dt / (to > from ? .055 : release)));

/** The same beat can reach several display frames. Emit once, and carry each plume forward in seconds. */
export class EmberSmokeAudio {
  private lastBeat: number | undefined;
  private lastTime: number | undefined;
  private readonly frame: SmokeAudioFrame = { bass: 0, highs: 0, beats: [] };

  advance(signals: Signals, now: number): SmokeAudioFrame {
    const dt = this.lastTime === undefined ? 1 / 60 : Math.max(0, Math.min(.12, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const bass = level(signals['audio.bass']), highs = level(signals['audio.highs']);
    this.frame.bass = follow(this.frame.bass, bass, dt, .38);
    this.frame.highs = follow(this.frame.highs, highs, dt, .20);
    const beats = this.frame.beats.filter(beat => (beat.age += dt) < MAX_AGE);
    const count = signals['beat.count'];
    if (this.lastBeat !== undefined && count > this.lastBeat && signals['beat.pulse'] > .22) {
      // Infer the elapsed part of the existing beat pulse to absorb skipped display frames.
      const age = -.15 * Math.log(level(signals['beat.pulse']));
      beats.unshift({ id: count, age, strength: .66 + .34 * bass });
      if (beats.length > EMBER_LIVE_PUFFS) beats.length = EMBER_LIVE_PUFFS;
    }
    this.lastBeat = count;
    this.frame.beats = beats;
    return this.frame;
  }
}
