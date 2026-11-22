/**
 * Beats from the bass: an onset is a sudden rise in bass energy (spectral flux) above an adaptive threshold, at most one
 * every 0.25 s. The tempo is read from the gaps between onsets (their median, folded into 70–180 BPM) once there are four.
 */
const MIN_GAP = 0.25, WINDOW = 1, PULSE_DECAY = 0.15;

export class BeatDetector {
  private prev = 0;
  private flux: { t: number; v: number }[] = [];
  private recent: { t: number; v: number }[] = [];
  private onsets: number[] = [];
  private last = -Infinity;
  count = 0;

  /** One frame's bass energy at time t (seconds). */
  update(bass: number, t: number): { onset: boolean; strength: number } {
    const v = Number.isFinite(bass) ? Math.max(0, bass) : 0;
    const f = Math.max(0, v - this.prev);
    this.prev = v;
    this.flux = this.flux.filter(x => t - x.t <= WINDOW);
    this.recent = this.recent.filter(x => t - x.t <= 2 * WINDOW);
    const mean = this.flux.reduce((a, x) => a + x.v, 0) / (this.flux.length || 1);
    const sd = Math.sqrt(this.flux.reduce((a, x) => a + (x.v - mean) ** 2, 0) / (this.flux.length || 1));
    const loudest = Math.max(v, ...this.recent.map(x => x.v));
    // Above its own recent spread, and a real share of the recent bass, so a steady hum never counts.
    // With about a sixth of a second heard, above an absolute floor, so room noise after silence is not a beat.
    const onset = this.flux.length >= 10 && f > 0.002 && f > mean + 1.5 * sd && f > 0.1 * loudest && t - this.last >= MIN_GAP;
    this.flux.push({ t, v: f });
    this.recent.push({ t, v });
    if (onset) { this.last = t; this.count++; this.onsets.push(t); if (this.onsets.length > 16) this.onsets.shift(); }
    return { onset, strength: f };
  }

  /** The beat pulse (1 at an onset, fading over 0.15 s), the beat count, and the tempo once trusted. */
  state(t: number): { pulse: number; count: number; bpm: number | null } {
    const pulse = this.last === -Infinity ? 0 : Math.exp(-(t - this.last) / PULSE_DECAY);
    return { pulse, count: this.count, bpm: this.bpm() };
  }

  private bpm(): number | null {
    if (this.onsets.length < 4) return null;
    const gaps = this.onsets.slice(1).map((t, i) => t - this.onsets[i]).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (!(median > 0)) return null;
    let bpm = 60 / median;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return bpm;
  }
}
