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
  /** How far from the expected beat an onset may land, in beats. Onsets outside it never move the beat or the tempo. */
  window: 0.15,
  phaseGain: 0.25, tempoGain: 0.02,
  /** Seconds without an accepted onset before the clock is holding, and seconds with no onset at all before a fresh start. */
  silence: 4,
  /** Accepted onsets needed to call it locked. */
  lockAfter: 4,
  /** Onset gaps: the longest that counts, how closely gaps must agree, and how many agree to start. */
  maxGap: 2, agree: 0.06, startGaps: 2,
  /** A tempo this close to the running one is the same tempo. */
  sameTempo: 0.03,
  /** Recent gaps that must show another tempo, the share of them that must agree, and how many gaps are kept. */
  tempoGaps: 12, dominantShare: 0.75, keptGaps: 24,
  /** Another tempo is taken only after it has lasted this many of its beats, counted in the octave at or below the running tempo. */
  confirmBeats: 32,
  /** How far a candidate may wander and still be the same candidate, and the seconds it survives without being seen. */
  nearTempo: 0.05, candidateGrace: 2,
  /** Onsets heard before choosing a beat phase: with one phase heard, and with both. Both phases need this many onsets. */
  scoreOnsets: 8, scoreBothOnsets: 12, scoreMinEach: 3, scoreShare: 0.75,
  /** How much stronger, per onset, one phase must be to be called the beat. Closer than this it stays unlocked. */
  scoreMargin: 1.25,
  /** Near the ceiling a lock needs this many gaps, and a measured tempo this far above the ceiling is really over it. */
  ceilingGaps: 16, ceilingNear: 0.97, ceilingSlack: 0.6,
  /** A lock is kept only while this share of the last onsets fit the grid, each within `fit` beats of a beat or a half beat. */
  earnOnsets: 16, earnShare: 0.45, fit: 0.075,
  /** How closely the recent gaps must agree with the running tempo before the phase score may lock. */
  lockTempo: 0.01,
};
/** Does an onset at this beat position fit the grid, on the beat or half way between? */
const FIT = (beats: number): boolean => Math.abs(beats * 2 - Math.round(beats * 2)) / 2 <= FOLLOW.fit;
const foldBpm = (bpm: number): number => {
  let folded = bpm;
  while (folded < FOLLOW.min) folded *= 2;
  while (folded > FOLLOW.max) folded /= 2;
  return folded;
};
/** A measured tempo, which frame timing can read a little over the ceiling. Callers clamp it, and overCeiling checks it. */
const foldMeasured = (bpm: number): number => {
  let folded = bpm;
  while (folded > FOLLOW.max * (1 + FOLLOW.agree)) folded /= 2;
  while (folded < FOLLOW.min) folded *= 2;
  return folded;
};
/** The distance between two tempos in octaves, ignoring whole octaves: 64, 128 and 256 are the same tempo. */
const octaveOffset = (a: number, b: number): number => { const d = Math.log2(a / b); return d - Math.round(d); };
const sameTempo = (a: number, b: number, tolerance: number): boolean => Math.abs(octaveOffset(a, b)) <= Math.log2(1 + tolerance);
/** One frame of timing, as a gap in seconds: two gaps this close can be the same gap. */
const FRAME_GAP = 0.02;
/** The tempo most of these onset gaps agree on, or null if too few of them do. */
function dominantBpm(gaps: number[], share: number): number | null {
  const bpms = gaps.map(gap => 60 / gap);
  let centre = 0, members: number[] = [];
  gaps.forEach((gap, i) => {
    const near = bpms.filter((b, j) => sameTempo(b, bpms[i], Math.max(FOLLOW.agree, FRAME_GAP / Math.min(gap, gaps[j]))));
    if (near.length > members.length) { centre = bpms[i]; members = near; }
  });
  if (!members.length || members.length < share * bpms.length) return null;
  const mean = members.reduce((sum, b) => sum + octaveOffset(b, centre), 0) / members.length;
  return foldMeasured(centre * 2 ** mean);
}
interface PhaseScore { on: number; off: number; onCount: number; offCount: number; hits: number; heard: number }
const newScore = (): PhaseScore => ({ on: 0, off: 0, onCount: 0, offCount: 0, hits: 0, heard: 0 });
const newFollow = () => ({ state: 'holding' as FollowState, hasTempo: false, accepted: 0, lastAccepted: -Infinity, lastHeard: -Infinity, gaps: [] as number[], recent: [] as boolean[], lastError: 0, score: null as PhaseScore | null, candidate: null as { bpm: number; from: number; seen: number } | null });

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

  /**
   * An onset while following. The running beat and tempo are moved only by onsets near the beat, and only gently.
   * Everything else waits: another tempo in the onset gaps puts the clock in HOLDING and is taken only once it has
   * lasted, and only real silence lets the beat start again from the next onset. A fresh start scores the two possible
   * beat phases before it can lock.
   */
  followOnset(t: number, bpmHint: number | null, strength = 1): void {
    if (this.source !== 'follow' || this.follow.state === 'manual') return;
    const f = this.follow, gap = t - f.lastHeard, weight = Number.isFinite(strength) && strength > 0 ? strength : 1;
    f.lastHeard = t;
    if (gap > FOLLOW.maxGap) f.gaps = [];
    else if (gap > 0) { f.gaps.push(gap); if (f.gaps.length > FOLLOW.keptGaps) f.gaps.shift(); }
    if (!f.hasTempo) {
      const bpm = bpmHint && Number.isFinite(bpmHint) && bpmHint > 0 ? foldMeasured(bpmHint)
        : f.gaps.length >= FOLLOW.startGaps ? dominantBpm(f.gaps.slice(-FOLLOW.startGaps), 1) : null;
      if (bpm !== null) this.startFollowing(t, bpm, weight);
      return;
    }
    if (gap >= FOLLOW.silence) { this.startFollowing(t, this.bpm, weight); return; }
    const confirmed = this.confirmedTempo(t);
    if (confirmed !== null) { this.startFollowing(t, confirmed, weight); return; }
    const beats = this.beatsAt(t), error = beats - Math.round(beats);
    f.recent.push(FIT(beats));
    if (f.recent.length > FOLLOW.earnOnsets) f.recent.shift();
    if (f.score) { this.scorePhase(t, weight, f.score); return; }
    // A lock has to keep earning itself: when too few recent onsets fit the grid it is dropped, and nothing moves.
    if (f.state === 'locked' && !this.earned()) { f.state = 'holding'; f.accepted = 0; }
    if (Math.abs(error) > FOLLOW.window) {
      if (f.state !== 'locked') f.accepted = Math.max(0, f.accepted - 0.5);
      return;
    }
    // The pull is the part of the error two onsets in a row agree on. Drift and a nearby tempo are followed in full,
    // and one stray onset near the edge of the window, as a breakdown's rhythm throws up, moves next to nothing.
    const steady = error * f.lastError > 0 ? Math.sign(error) * Math.min(Math.abs(error), Math.abs(f.lastError)) : 0;
    f.lastError = error;
    // A stray onset, loose and correcting nothing, is not accepted: it cannot keep a lock alive or count towards one.
    if (steady === 0 && Math.abs(error) > FOLLOW.fit) return;
    this.correct(t, beats, steady, Math.max(1, Math.round((t - f.lastAccepted) * this.bpm / 60)));
    f.lastAccepted = t;
    if (f.state !== 'locked' && ++f.accepted >= FOLLOW.lockAfter && this.mayLock()) f.state = 'locked';
  }
  /** Enough of the recent onsets fit the grid. Chance fits about 30%, and a steady rhythm on the beat fits far more. */
  private earned(): boolean {
    const { recent } = this.follow;
    return recent.length < FOLLOW.earnOnsets || recent.filter(Boolean).length >= FOLLOW.earnShare * recent.length;
  }
  /** No lock while another tempo is a candidate, while too few onsets fit, or near the ceiling before enough gaps have shown the tempo is not above it. */
  private mayLock(): boolean {
    return !this.follow.candidate && this.earned() && (this.bpm < FOLLOW.max * FOLLOW.ceilingNear || this.follow.gaps.length >= FOLLOW.ceilingGaps);
  }
  /** The recent gaps positively agree with the running tempo: asked of a lock made straight from the phase score. */
  private tempoAgrees(): boolean {
    const { gaps } = this.follow;
    if (gaps.length < FOLLOW.tempoGaps) return false;
    const bpm = dominantBpm(gaps.slice(-FOLLOW.tempoGaps), FOLLOW.dominantShare);
    return bpm !== null && sameTempo(bpm, this.bpm, FOLLOW.lockTempo);
  }
  /**
   * The one rule for every other tempo, whatever its ratio to the running one: while the gaps show it the clock is
   * HOLDING and the running beat and tempo are left alone, and it is returned, to be taken, only once it has lasted
   * 32 of its beats. So a triplet, dotted or 5:4 breakdown of 8 bars passes without moving anything.
   */
  private confirmedTempo(t: number): number | null {
    const f = this.follow;
    if (f.candidate && t - f.candidate.seen > FOLLOW.candidateGrace) f.candidate = null;
    const other = this.overCeiling() ?? this.otherTempo();
    if (other === null) return null;
    if (!f.candidate || !sameTempo(other, f.candidate.bpm, FOLLOW.nearTempo)) f.candidate = { bpm: other, from: t, seen: t };
    f.candidate.seen = t;
    f.state = 'holding';
    f.accepted = 0;
    let slow = other;
    while (slow > this.bpm * (1 + FOLLOW.agree)) slow /= 2;
    return (t - f.candidate.from) * slow / 60 >= FOLLOW.confirmBeats ? other : null;
  }
  /** The tempo most recent gaps agree on, when it is not the running one. Agreeing with the running one ends any candidate. */
  private otherTempo(): number | null {
    const f = this.follow;
    if (f.gaps.length < FOLLOW.tempoGaps) return null;
    const bpm = dominantBpm(f.gaps.slice(-FOLLOW.tempoGaps), FOLLOW.dominantShare);
    if (bpm === null) return null;
    if (sameTempo(bpm, this.bpm, FOLLOW.sameTempo)) { f.candidate = null; return null; }
    // At the ceiling a reading above it is frame timing, unless overCeiling says it is sustained.
    return bpm > FOLLOW.max && this.bpm >= FOLLOW.max * FOLLOW.ceilingNear ? null : bpm;
  }
  /** A sustained tempo above the ceiling, measured over the whole span of gaps so frame timing averages out: returns its half. */
  private overCeiling(): number | null {
    const { gaps } = this.follow;
    if (this.bpm < FOLLOW.max * FOLLOW.ceilingNear || gaps.length < FOLLOW.ceilingGaps) return null;
    let beats = 0, seconds = 0, used = 0;
    for (const gap of gaps) {
      const position = gap * this.bpm / 60, multiple = Math.max(0.5, Math.round(position * 2) / 2);
      if (Math.abs(position - multiple) > 0.2) continue;
      beats += multiple; seconds += gap; used++;
    }
    if (used < FOLLOW.dominantShare * gaps.length) return null;
    const measured = 60 * beats / seconds;
    return measured > FOLLOW.max + FOLLOW.ceilingSlack ? measured / 2 : null;
  }
  /** A gentle pull of phase and tempo toward an onset that landed `error` beats from the grid. */
  private correct(t: number, beats: number, error: number, beatsSince: number): void {
    this.anchor = { t, beats: beats - FOLLOW.phaseGain * error };
    this.bpm = Math.min(FOLLOW.max, Math.max(FOLLOW.min, this.bpm * (1 - FOLLOW.tempoGain * error / beatsSince)));
    this.lastT = t;
  }
  /**
   * After a fresh start: is the beat on the first onset, or half a beat from it? The phase with the stronger onsets on
   * average is the beat, so a phase cannot win by having more of them. A clear winner locks at once. With no clear
   * winner, or with a grid that explains too few of the onsets, it keeps listening and does not lock.
   */
  private scorePhase(t: number, weight: number, score: PhaseScore): void {
    const f = this.follow, beats = this.beatsAt(t), nearest = Math.round(beats * 2) / 2, error = beats - nearest;
    score.heard++;
    if (Math.abs(error) <= FOLLOW.window) {
      score.hits++;
      if (Number.isInteger(nearest)) { score.on += weight; score.onCount++; } else { score.off += weight; score.offCount++; }
      this.correct(t, beats, error, Math.max(0.5, Math.round((t - f.lastAccepted) * this.bpm / 30) / 2));
      f.lastAccepted = t;
    }
    const both = score.onCount > 0 && score.offCount > 0;
    if (score.heard < (both ? FOLLOW.scoreBothOnsets : FOLLOW.scoreOnsets) || f.gaps.length < FOLLOW.tempoGaps) return;
    const onMean = score.onCount ? score.on / score.onCount : 0, offMean = score.offCount ? score.off / score.offCount : 0;
    const clear = score.hits >= FOLLOW.scoreShare * score.heard
      && (!both || (Math.min(score.onCount, score.offCount) >= FOLLOW.scoreMinEach && Math.max(onMean, offMean) >= FOLLOW.scoreMargin * Math.min(onMean, offMean)));
    if (!clear || !this.mayLock() || !this.tempoAgrees()) { f.score = newScore(); return; }
    if (offMean > onMean) this.anchor = { t, beats: this.beatsAt(t) + 0.5 };
    f.score = null;
    f.state = 'locked';
  }
  /** Takes a tempo, puts a provisional beat on this onset, and starts scoring which phase is the real one. */
  private startFollowing(t: number, bpm: number, weight: number): void {
    this.anchor = { t, beats: Math.round(this.beatsAt(t)) };
    this.bpm = Math.min(FOLLOW.max, bpm);
    this.lastT = t;
    this.follow = { state: 'holding', hasTempo: true, accepted: 0, lastAccepted: t, lastHeard: t, gaps: [], recent: [], lastError: 0, candidate: null, score: { ...newScore(), on: weight, onCount: 1, hits: 1, heard: 1 } };
  }
  /** Each frame: with no accepted onset for a while the clock is holding, free-running at the last tempo. Nothing moves. */
  followTick(t: number): void {
    const f = this.follow;
    if (this.source !== 'follow' || f.state === 'manual' || t - f.lastAccepted < FOLLOW.silence) return;
    f.state = 'holding';
    f.accepted = 0;
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
    this.follow = { ...this.follow, state: 'holding', accepted: 0, lastAccepted: t, lastHeard: t, gaps: [], recent: [], lastError: 0, score: null, candidate: null };
  }
  /** "This is the 1": the bar now starts on the nearest beat. Only the offset changes, so running loops never jump. */
  setBarStart(t: number): void {
    const beat = Math.round(this.currentBeats(t));
    this.bars = ((beat % 4) + 4) % 4;
  }
  /** A new show starts with no correction from the last one. */
  clearBarStart(): void { this.bars = 0; }
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
