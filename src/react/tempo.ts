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
  /** Misses, less hits, that lose a lock. Kicks with an off-beat between them never get there; off-beats alone do, and the clock then holds its phase. */
  maxMisses: 8,
  /** Onset gaps: the longest that counts, how closely gaps must agree, and how many agree to start. */
  maxGap: 2, agree: 0.06, startGaps: 2,
  /** A tempo this close to the current one is the same tempo, so onset gaps can never re-phase the clock. */
  sameTempo: 0.03,
  /** Gaps that must show a different tempo before it is taken, and the share of them that must agree. A lock asks for more. */
  holdingGaps: 12, lockedGaps: 24, dominantShare: 0.75,
  /** A candidate this close to the current tempo, or this close to a 3:2 or 4:3 ratio of it, may be a rhythm rather than a new tempo. */
  nearTempo: 0.05, ratioTolerance: 0.03,
  /** Such a candidate must hold for this many of its beats, in the octave at or below the current tempo, so a fast pulse takes at least as long as this many current beats. */
  confirmBeats: 32,
  /** Seconds a candidate survives without being seen. */
  candidateGrace: 2,
  /** While holding, how close onsets must land to the kept grid to count as the music returning to it, in beats. */
  holdWindow: 0.08,
  /** Tight onsets in a row, with no loose one, before the grid is trusted enough to keep. */
  keepAfter: 4,
  /** Onsets heard before choosing a beat phase: with one phase heard, and with both. Both phases need this many onsets. */
  scoreOnsets: 8, scoreBothOnsets: 12, scoreMinEach: 3, scoreShare: 0.75,
  /** How much stronger, per onset, one phase must be to be called the beat. Closer than this it stays unlocked. */
  scoreMargin: 1.25,
  /** Near the ceiling a lock needs this many gaps, and a measured tempo this far above the ceiling is really over it. */
  ceilingGaps: 16, ceilingNear: 0.97, ceilingSlack: 0.6,
};
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
/** Could this tempo just be a rhythm over the current one: near it, or at 3:2 or 4:3? */
function mayBeRhythm(candidate: number, current: number): boolean {
  const offset = Math.abs(octaveOffset(candidate, current));
  return offset <= Math.log2(1 + FOLLOW.nearTempo) || Math.abs(offset - Math.log2(4 / 3)) <= Math.log2(1 + FOLLOW.ratioTolerance);
}
interface PhaseScore { on: number; off: number; onCount: number; offCount: number; hits: number; heard: number }
const newScore = (): PhaseScore => ({ on: 0, off: 0, onCount: 0, offCount: 0, hits: 0, heard: 0 });
const newFollow = () => ({ state: 'holding' as FollowState, hasTempo: false, accepted: 0, misses: 0, lastAccepted: -Infinity, lastHeard: -Infinity, gaps: [] as number[], score: null as PhaseScore | null, held: false, candidate: null as { bpm: number; from: number; seen: number } | null, kept: null as { t: number; beats: number; bpm: number } | null, tightRun: 0 });

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
   * An onset while following. Until there is a tempo it starts from the hint or the onset gaps, then scores the two
   * possible beat phases. After that only onsets near the beat count. The phase moves again only after real silence or
   * a clearly different tempo, so an off-beat breakdown cannot flip it.
   */
  followOnset(t: number, bpmHint: number | null, strength = 1): void {
    if (this.source !== 'follow' || this.follow.state === 'manual') return;
    const f = this.follow, gap = t - f.lastHeard, weight = Number.isFinite(strength) && strength > 0 ? strength : 1;
    f.lastHeard = t;
    if (gap > FOLLOW.maxGap) f.gaps = [];
    else if (gap > 0) { f.gaps.push(gap); if (f.gaps.length > FOLLOW.lockedGaps) f.gaps.shift(); }
    if (!f.hasTempo) {
      const bpm = bpmHint && Number.isFinite(bpmHint) && bpmHint > 0 ? foldMeasured(bpmHint)
        : f.gaps.length >= FOLLOW.startGaps ? dominantBpm(f.gaps.slice(-FOLLOW.startGaps), 1) : null;
      if (bpm !== null) this.startFollowing(t, bpm, weight);
      return;
    }
    if (gap >= FOLLOW.silence) { this.startFollowing(t, this.bpm, weight); return; }
    const over = this.overCeiling();
    if (over !== null) { this.startFollowing(t, over, weight); return; }
    const changed = this.changedTempo(t);
    if (changed !== null) { this.startFollowing(t, changed, weight); return; }
    if (f.score) { this.scorePhase(t, weight, f.score); return; }
    const beats = this.beatsAt(t), error = beats - Math.round(beats);
    if (f.held) { this.heldOnset(t, beats, error); return; }
    if (Math.abs(error) > FOLLOW.window) {
      // A locked clock ignores it, unless misses keep outweighing hits. Either way the phase stays where it is.
      if (f.state === 'locked') {
        if (++f.misses >= FOLLOW.maxMisses) this.holdGrid();
      } else f.accepted = Math.max(0, f.accepted - 0.5);
      return;
    }
    this.correct(t, beats, error, Math.max(1, Math.round((t - f.lastAccepted) * this.bpm / 60)));
    f.misses = Math.max(0, f.misses - 1);
    if (++f.accepted >= FOLLOW.lockAfter && this.mayLock()) f.state = 'locked';
    // Loose hits can be a rhythm pulling the clock, so only a run of tight ones updates the grid a hold goes back to.
    f.tightRun = Math.abs(error) <= FOLLOW.holdWindow ? f.tightRun + 1 : 0;
    if (f.state === 'locked' && f.tightRun >= FOLLOW.keepAfter && this.anchor) f.kept = { ...this.anchor, bpm: this.bpm };
  }
  /** Leaves a lock but keeps its tempo and phase, untouched, until the music comes back to them or a new tempo is confirmed. */
  private holdGrid(): void {
    const f = this.follow;
    if (f.state === 'locked' && f.kept) { this.anchor = { t: f.kept.t, beats: f.kept.beats }; this.bpm = f.kept.bpm; }
    f.state = 'holding'; f.held = true; f.accepted = 0; f.misses = 0; f.tightRun = 0;
  }
  /** While holding a kept grid nothing moves it. Enough onsets tight on it, with no rival tempo, restore the lock. */
  private heldOnset(t: number, beats: number, error: number): void {
    const f = this.follow;
    if (Math.abs(error) > FOLLOW.holdWindow) { f.accepted = Math.max(0, f.accepted - 0.5); return; }
    f.lastAccepted = t;
    if (++f.accepted < FOLLOW.lockAfter || f.candidate || !this.mayLock()) return;
    f.state = 'locked'; f.held = false; f.misses = 0;
    this.correct(t, beats, error, 1);
  }
  /** Near the ceiling a lock waits until enough gaps have shown the tempo is not above it. */
  private mayLock(): boolean {
    return this.bpm < FOLLOW.max * FOLLOW.ceilingNear || this.follow.gaps.length >= FOLLOW.ceilingGaps;
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
    this.follow.lastAccepted = t;
  }
  /**
   * A tempo clearly different from the current one, once it has lasted. A candidate that could be a rhythm over the
   * current tempo (triplets, dotted notes) must hold for 32 of its beats, and the clock is not LOCKED meanwhile.
   */
  private changedTempo(t: number): number | null {
    const f = this.follow;
    if (f.candidate && t - f.candidate.seen > FOLLOW.candidateGrace) f.candidate = null;
    if (f.gaps.length < FOLLOW.holdingGaps) return null;
    const bpm = dominantBpm(f.gaps.slice(-FOLLOW.holdingGaps), FOLLOW.dominantShare);
    if (bpm === null) return null;
    if (sameTempo(bpm, this.bpm, FOLLOW.sameTempo)) { f.candidate = null; return null; }
    if (bpm > FOLLOW.max && this.bpm >= FOLLOW.max * FOLLOW.ceilingNear) return null;
    if (mayBeRhythm(bpm, this.bpm)) {
      if (!f.candidate || !sameTempo(bpm, f.candidate.bpm, FOLLOW.nearTempo)) f.candidate = { bpm, from: t, seen: t };
      f.candidate.seen = t;
      if (f.state === 'locked') this.holdGrid();
      let slow = bpm;
      while (slow > this.bpm * (1 + FOLLOW.agree)) slow /= 2;
      return (t - f.candidate.from) * slow / 60 >= FOLLOW.confirmBeats ? bpm : null;
    }
    f.candidate = null;
    if (f.state !== 'locked') return bpm;
    if (f.gaps.length < FOLLOW.lockedGaps) return null;
    const sustained = dominantBpm(f.gaps, FOLLOW.dominantShare);
    return sustained !== null && !sameTempo(sustained, this.bpm, FOLLOW.sameTempo) ? sustained : null;
  }
  /**
   * Before a lock: is the beat on the first onset, or half a beat from it? The phase with the stronger onsets on average
   * is the beat, so a phase cannot win by having more of them. With no clear winner it keeps listening and does not lock.
   */
  private scorePhase(t: number, weight: number, score: PhaseScore): void {
    const f = this.follow, beats = this.beatsAt(t), nearest = Math.round(beats * 2) / 2, error = beats - nearest;
    score.heard++;
    if (Math.abs(error) <= FOLLOW.window) {
      score.hits++;
      if (Number.isInteger(nearest)) { score.on += weight; score.onCount++; } else { score.off += weight; score.offCount++; }
      this.correct(t, beats, error, Math.max(0.5, Math.round((t - f.lastAccepted) * this.bpm / 30) / 2));
    }
    const both = score.onCount > 0 && score.offCount > 0;
    if (score.heard < (both ? FOLLOW.scoreBothOnsets : FOLLOW.scoreOnsets)) return;
    const onMean = score.onCount ? score.on / score.onCount : 0, offMean = score.offCount ? score.off / score.offCount : 0;
    const clear = both
      ? Math.min(score.onCount, score.offCount) >= FOLLOW.scoreMinEach && Math.max(onMean, offMean) >= FOLLOW.scoreMargin * Math.min(onMean, offMean)
      : score.onCount + score.offCount > 0;
    if (!clear) { f.score = newScore(); return; }
    if (offMean > onMean) this.anchor = { t, beats: this.beatsAt(t) + 0.5 };
    f.accepted = score.hits >= FOLLOW.scoreShare * score.heard ? FOLLOW.lockAfter - 1 : 0;
    f.score = null;
  }
  /** Takes a tempo, puts a provisional beat on this onset, and starts scoring which phase is the real one. */
  private startFollowing(t: number, bpm: number, weight: number): void {
    this.anchor = { t, beats: Math.round(this.beatsAt(t)) };
    this.bpm = Math.min(FOLLOW.max, bpm);
    this.lastT = t;
    this.follow = { ...this.follow, state: 'holding', hasTempo: true, accepted: 0, misses: 0, lastAccepted: t, lastHeard: t, gaps: [], held: false, candidate: null, kept: null, tightRun: 0, score: { ...newScore(), on: weight, onCount: 1, hits: 1, heard: 1 } };
  }
  /** Each frame: with no accepted onset for a while the clock is holding, free-running at the last tempo. */
  followTick(t: number): void {
    const f = this.follow;
    if (this.source !== 'follow' || f.state === 'manual' || t - f.lastAccepted < FOLLOW.silence) return;
    if (f.state === 'locked') this.holdGrid();
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
    this.follow = { ...this.follow, state: 'holding', accepted: 0, misses: 0, lastAccepted: t, lastHeard: t, gaps: [], score: null, held: false, candidate: null, kept: null, tightRun: 0 };
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
