/**
 * One tempo clock for the show: the beat's phase (0..1), the beat count and the bar, at a BPM taken from the chosen
 * source: the detected beat, tap tempo, MIDI clock (24 ticks a beat), a fixed number, or, during a show, `follow`:
 * a steady clock that onsets near the beat gently correct and onsets away from it cannot move.
 */
export type TempoSource = 'beat' | 'tap' | 'midi' | 'fixed' | 'follow';
/** `follow` belongs to a running show and is never saved. */
export type SavedTempoSource = Exclude<TempoSource, 'follow'>;
export type FollowState = 'locked' | 'holding' | 'manual';
export interface TempoState { bpm: number; phase: number; beat: number; bar: number }
export const BPM_RANGE = { min: 40, max: 240 };
const TAP_RESET = 2;
const FOLLOW = {
  min: 85, max: 175,
  /** How far from the expected beat an onset may land, in beats. */
  window: 0.15,
  phaseGain: 0.25, tempoGain: 0.02,
  /** Seconds without an accepted onset before the clock is holding. */
  silence: 4,
  /** Accepted onsets needed to call it locked. */
  lockAfter: 4,
  /** Misses, less hits, that lose a lock. Steady syncopation (one off-beat per beat) never gets there. */
  maxMisses: 8,
  /** Onset gaps: the longest that counts, how closely they must agree, and how many to start, or to re-find a lost beat. */
  maxGap: 2, agree: 0.06, startGaps: 2, refindGaps: 4,
};
const foldBpm = (bpm: number): number => {
  let folded = bpm;
  while (folded < FOLLOW.min) folded *= 2;
  while (folded > FOLLOW.max) folded /= 2;
  return folded;
};
const newFollow = () => ({ state: 'holding' as FollowState, hasTempo: false, accepted: 0, misses: 0, lastAccepted: -Infinity, lastOnset: -Infinity, run: [] as number[] });

export class TempoClock {
  source: TempoSource = 'fixed';
  bpm = 120;
  private follow = newFollow();
  private bars = 0;
  /** MIDI clock and the other sources are not following anything, so they read as manual. */
  get followState(): FollowState { return this.source === 'follow' ? this.follow.state : 'manual'; }
  /** Which beat of 0..3 the bar starts on. */
  get barOffset(): number { return this.bars; }
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
    if (source === 'follow') { this.follow = newFollow(); this.bpm = foldBpm(this.bpm); }
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

  /** An onset while following. Until there is a tempo it starts from the hint or the onset gaps; then only onsets near the beat count. */
  followOnset(t: number, bpmHint: number | null): void {
    if (this.source !== 'follow' || this.follow.state === 'manual') return;
    const f = this.follow;
    if (!f.hasTempo) {
      const bpm = bpmHint && Number.isFinite(bpmHint) && bpmHint > 0 ? foldBpm(bpmHint) : this.tempoFromGaps(t, FOLLOW.startGaps);
      if (bpm !== null) this.startFollowing(t, bpm);
      return;
    }
    const beats = this.beatsAt(t), error = beats - Math.round(beats);
    if (Math.abs(error) > FOLLOW.window) {
      // A locked clock ignores it, unless misses keep outweighing hits: then the music has changed under it.
      if (f.state === 'locked') {
        if (++f.misses >= FOLLOW.maxMisses) { f.state = 'holding'; f.accepted = 0; f.misses = 0; }
        return;
      }
      // A clock that lost the music re-finds the beat from a steady run of onsets.
      f.accepted = Math.max(0, f.accepted - 0.5);
      const bpm = this.tempoFromGaps(t, FOLLOW.refindGaps);
      if (bpm !== null) this.startFollowing(t, bpm);
      return;
    }
    const beatsSince = Math.max(1, Math.round((t - f.lastAccepted) * this.bpm / 60));
    this.anchor = { t, beats: beats - FOLLOW.phaseGain * error };
    this.bpm = Math.min(FOLLOW.max, Math.max(FOLLOW.min, this.bpm * (1 - FOLLOW.tempoGain * error / beatsSince)));
    this.lastT = t;
    f.lastAccepted = t; f.lastOnset = t; f.run = []; f.misses = Math.max(0, f.misses - 1);
    if (++f.accepted >= FOLLOW.lockAfter) f.state = 'locked';
  }
  /** The tempo once enough onset gaps in a row agree, or null. */
  private tempoFromGaps(t: number, needed: number): number | null {
    const f = this.follow, gap = t - f.lastOnset;
    f.lastOnset = t;
    if (!(gap > 0) || gap > FOLLOW.maxGap) { f.run = []; return null; }
    const bpm = foldBpm(60 / gap);
    if (f.run.length && Math.abs(bpm / f.run[f.run.length - 1] - 1) > FOLLOW.agree) f.run = [];
    f.run.push(bpm);
    return f.run.length >= needed ? f.run.reduce((a, b) => a + b, 0) / f.run.length : null;
  }
  /** Takes a tempo and puts the nearest beat on this onset. */
  private startFollowing(t: number, bpm: number): void {
    this.anchor = { t, beats: Math.round(this.beatsAt(t)) };
    this.bpm = bpm;
    this.lastT = t;
    this.follow = { ...this.follow, state: 'holding', hasTempo: true, accepted: 1, misses: 0, lastAccepted: t, lastOnset: t, run: [] };
  }
  /** Each frame: with no accepted onset for a while the clock is holding, free-running at the last tempo. */
  followTick(t: number): void {
    const f = this.follow;
    if (this.source !== 'follow' || f.state === 'manual' || t - f.lastAccepted < FOLLOW.silence) return;
    f.state = 'holding';
    f.accepted = 0;
    f.misses = 0;
  }
  /** A tap during a show: the clock is manual until told to follow again. Saved preferences are not touched. */
  manualTap(t: number): void {
    if (this.source !== 'follow') return;
    this.follow.state = 'manual';
    this.tap(t);
    if (this.taps.length >= 2) this.follow.hasTempo = true;
  }
  /** Back to following the music, from the current beat and tempo. */
  resumeFollow(t: number): void {
    if (this.source !== 'follow' || this.follow.state !== 'manual') return;
    this.anchor = { t, beats: this.beatsAt(t) };
    this.bpm = foldBpm(this.bpm);
    this.lastT = t;
    this.follow = { ...this.follow, state: 'holding', accepted: 0, misses: 0, lastAccepted: t, lastOnset: -Infinity, run: [] };
  }
  /** "This is the 1": the bar now starts on the nearest beat. Only the offset changes, so running loops never jump. */
  setBarStart(t: number): void {
    const beat = Math.round(this.currentBeats(t));
    this.bars = ((beat % 4) + 4) % 4;
  }
  snapshot(t: number): { beats: number; bpm: number; state: FollowState; barOffset: number } {
    return { beats: this.currentBeats(t), bpm: this.bpm, state: this.followState, barOffset: this.bars };
  }

  /** While following, MIDI Start from other gear must not move the show's beat count. */
  midiStart(t: number): void { this.midi = { running: true, ticks: 0, last: t, gaps: [] }; if (this.source !== 'follow') this.anchor = { t, beats: 0 }; }
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
