/**
 * One tempo clock for the show: the beat's phase (0..1), the beat count and the bar, at a BPM taken from the chosen
 * source: the detected beat, tap tempo, MIDI clock (24 ticks a beat), or a fixed number.
 */
export type TempoSource = 'beat' | 'tap' | 'midi' | 'fixed';
export interface TempoState { bpm: number; phase: number; beat: number; bar: number }
export const BPM_RANGE = { min: 40, max: 240 };
const TAP_RESET = 2;

export class TempoClock {
  source: TempoSource = 'fixed';
  bpm = 120;
  /** Beats are counted from an anchor: at time t, `beats` had passed. */
  private anchor: { t: number; beats: number } | null = null;
  private taps: number[] = [];
  private midi = { running: false, ticks: 0, last: 0, gaps: [] as number[] };

  /** A new source carries the beat count on from where it was, so beat triggers and synced loops do not jump. */
  setSource(source: TempoSource): void {
    if (source === this.source) return;
    const beats = this.currentBeats(this.lastT);
    this.source = source;
    this.anchor = { t: this.lastT, beats };
    if (source === 'midi') this.midi.ticks = Math.round(beats * 24);
  }
  private currentBeats(t: number): number { return this.source === 'midi' ? this.midi.ticks / 24 : this.beatsAt(t); }
  /** A new tempo from the last moment the clock was read, so the beat count carries on without a jump. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    if (this.anchor) this.anchor = { t: this.lastT, beats: this.beatsAt(this.lastT) };
    this.bpm = Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, bpm));
  }
  private lastT = 0;
  private beatsAt(t: number): number { return this.anchor ? this.anchor.beats + (t - this.anchor.t) * this.bpm / 60 : 0; }
  /** Starts a beat at time t, keeping the count. */
  private downbeat(t: number): void { this.anchor = { t, beats: this.anchor ? Math.round(this.beatsAt(t)) : 0 }; this.lastT = t; }

  /** A tap (seconds). Four taps set the tempo; each tap starts a beat. */
  tap(t: number): void {
    if (this.taps.length && t - this.taps[this.taps.length - 1] > TAP_RESET) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > 4) this.taps.shift();
    if (this.taps.length >= 2) {
      const gaps = this.taps.slice(1).map((x, i) => x - this.taps[i]);
      const bpm = 60 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
      // Keep the count running: re-anchor at the old tempo, then change it.
      this.downbeat(t);
      this.setBpm(bpm);
    } else this.downbeat(t);
  }

  /** The detected beat (from BeatDetector): an onset starts a beat, and a trusted tempo is taken. */
  detected(t: number, bpm: number | null): void {
    if (this.source !== 'beat') return;
    this.downbeat(t);
    if (bpm) this.setBpm(bpm);
  }

  midiStart(t: number): void { this.midi = { running: true, ticks: 0, last: t, gaps: [] }; this.anchor = { t, beats: 0 }; }
  /** Continue: carries on from where Stop left it. */
  midiContinue(t: number): void { this.midi.running = true; this.midi.last = t; }
  midiStop(): void { this.midi.running = false; }
  midiTick(t: number): void {
    // Many devices send clock all the time: while stopped it does not move the beat.
    if (!this.midi.running) return;
    const gap = t - this.midi.last;
    if (gap > 0 && gap < 0.25) { this.midi.gaps.push(gap); if (this.midi.gaps.length > 48) this.midi.gaps.shift(); }
    this.midi.last = t;
    this.midi.ticks++;
    if (this.source === 'midi' && this.midi.gaps.length >= 6) {
      const mean = this.midi.gaps.reduce((a, b) => a + b, 0) / this.midi.gaps.length;
      this.bpm = Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, 60 / (mean * 24)));
    }
  }

  /** Where the clock is at time t (seconds). */
  advance(t: number): TempoState {
    if (!this.anchor) this.anchor = { t, beats: 0 };
    this.lastT = t;
    const beats = this.source === 'midi' ? this.midi.ticks / 24 : this.beatsAt(t);
    const beat = Math.floor(beats + 1e-9);
    return { bpm: this.bpm, phase: beats - beat, beat, bar: beats / 4 };
  }
}
