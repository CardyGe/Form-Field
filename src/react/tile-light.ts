import { CELL_AUDIO_SOURCES, isCellWave } from '../core/graphics';
import type { Layer } from '../shared/types';
import type { Signals } from './signals';

export function usesTileLightAudio(layer: Layer): boolean {
  return layer.visible && layer.kind === 'graphic' && isCellWave(layer.params.style, layer.params.variant)
    && (layer.params.cellAudioAmount > 0 || !!layer.modulations.cellAudioAmount);
}

/** Slow the input into a swell so individual beats colour the reflections without sharp changes. */
export class TileLightAudio {
  private previous: number | undefined;
  private readonly levels: Signals = {};

  advance(signals: Signals, now: number): Signals {
    const elapsed = (now - (this.previous ?? now)) / 1000;
    const restarted = this.previous === undefined || elapsed < 0 || elapsed > .5;
    const dt = restarted ? 1 / 60 : Math.min(.12, elapsed);
    this.previous = now;

    for (const { signal } of CELL_AUDIO_SOURCES) {
      const value = signals[signal];
      const target = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
      const from = restarted ? 0 : (this.levels[signal] ?? 0);
      const timeConstant = target > from ? .085 : .36;
      const next = from + (target - from) * (1 - Math.exp(-dt / timeConstant));
      this.levels[signal] = next > .0001 ? next : 0;
    }
    return this.levels;
  }
}
