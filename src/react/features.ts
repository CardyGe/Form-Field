/**
 * Sound features, from one analyser frame: the energy of the bass, mids and highs, and a level.
 * AutoGain turns each into 0..1 by following its own recent peak, so a quiet room and a loud club both use the full range.
 */
export interface Bands { bass: number; mids: number; highs: number }
export const BANDS = { bass: [20, 150], mids: [150, 2000], highs: [2000, 12000] } as const;

/** RMS of the bins' amplitudes in each band. `db`: the analyser's frequency data in decibels, fftSize / 2 bins. */
export function bandEnergies(db: Float32Array, sampleRate: number, fftSize: number): Bands {
  const width = sampleRate / fftSize;
  const band = ([lo, hi]: readonly [number, number]) => {
    const a = Math.max(1, Math.floor(lo / width)), b = Math.min(db.length - 1, Math.ceil(hi / width));
    let sum = 0, n = 0;
    for (let i = a; i <= b; i++) { const amp = Math.pow(10, db[i] / 20); if (Number.isFinite(amp)) sum += amp * amp; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  };
  return { bass: band(BANDS.bass), mids: band(BANDS.mids), highs: band(BANDS.highs) };
}

/** RMS of a frame of samples. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const v of samples) sum += v * v;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Follows a signal's recent peak (rising at once, falling over about 8 s) and gives the signal over it, 0..1. */
export class AutoGain {
  private peak = 0;
  constructor(private readonly fallSeconds = 8, private readonly floor = 2e-3) {}
  update(value: number, dt: number): number {
    const v = Number.isFinite(value) && value > 0 ? value : 0;
    this.peak = Math.max(v, this.peak * Math.exp(-Math.max(0, dt) / this.fallSeconds));
    return Math.min(1, v / Math.max(this.peak, this.floor));
  }
}
