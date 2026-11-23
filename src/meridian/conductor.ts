/**
 * The Conductor: a steady musical clock read from the app's tempo signals. TempoClock re-anchors on every onset, so its
 * phase is treated as an opinion. Small errors are slewed, a large one must persist for two beats, and the beat never jumps.
 */
export interface ConductorInput { dt: number; signals: Readonly<Record<string, number>>; params: Readonly<Record<string, number>> }
export interface ConductorFrame { beats: number; bpm: number; status: 'locked' | 'holding' | 'free'; beatPhase: number; pulse: number; bass: number; mids: number; highs: number; level: number; energy: number }

const MAX_SLEW = 0.08;       // The most a correction may change the clock's speed.
const SLEW_GAIN = 0.8;       // Speed change per beat of phase error.
const SMALL_PHASE = 0.07;    // Beats. Below this an error is ordinary onset jitter.
const SAME_PHASE = 0.12;     // Beats. A disagreement within this of the last one is the same disagreement.
const PERSIST_BEATS = 2;
const SAME_TEMPO = 0.04;     // Within this share, tempo is refined rather than changed.
const SAME_PENDING = 0.03;
const FOLD = 0.06;           // How near to half or double counts as half or double.
const TEMPO_FOLLOW = 1.5;    // Seconds, for refining a tempo that already agrees.
const TEMPO_GLIDE = 0.08;    // Share of the tempo an accepted change may travel per beat.
const LOST_BEATS = 8;        // With sound but no onset for this long, the clock holds.
const CONFIDENCE_RISE = 1, CONFIDENCE_FALL = 1.2; // Seconds.
const ENERGY_RISE = 5, ENERGY_FALL = 9;           // Seconds.
const MIN_ATTACK = 0.012, MIN_RELEASE = 0.06, LOST_RELEASE = 0.6;
const QUIET = 1e-4;

const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);
const wrap = (value: number): number => value - Math.round(value);
const unit = (value: number | undefined): number => (finite(value) ? clamp(value, 0, 1) : 0);
const follow = (from: number, to: number, dt: number, tau: number): number => { const next = to + (from - to) * Math.exp(-dt / tau); return to === 0 && next < QUIET ? 0 : next; };

export class Conductor {
  private readonly frame: ConductorFrame = { beats: 0, bpm: 124, status: 'free', beatPhase: 0, pulse: 0, bass: 0, mids: 0, highs: 0, level: 0, energy: 0 };
  private heard = false; private sinceOnset = Infinity; private lastPulse = 0; private confidence = 0; private rawPulse = 0;
  private pendingBpm = 0; private pendingBeats = 0; private targetBpm = 0;
  private suspect = 0; private suspectBeats = 0; private correcting = false;

  reset(beats = 0): void {
    const f = this.frame;
    f.beats = finite(beats) ? beats : 0; f.beatPhase = f.beats - Math.floor(f.beats); f.status = 'free';
    f.pulse = f.bass = f.mids = f.highs = f.level = f.energy = 0;
    this.heard = false; this.sinceOnset = Infinity; this.lastPulse = 0; this.confidence = 0; this.rawPulse = 0;
    this.pendingBpm = this.pendingBeats = this.targetBpm = this.suspect = this.suspectBeats = 0; this.correcting = false;
  }

  update(input: ConductorInput): ConductorFrame {
    const f = this.frame, { dt, signals, params } = input;
    if (!finite(dt) || dt < 0) return f;
    const score = finite(params.scoreBpm) ? clamp(params.scoreBpm, 20, 400) : 124;
    const beat = signals['tempo.beat'], phase = signals['tempo.phase'], measured = signals['tempo.bpm'], rawPulse = signals['beat.pulse'], level = signals['audio.level'];
    const hasTempo = finite(beat) && finite(phase) && finite(measured) && measured > 0, hasAudio = finite(level);
    const pulseNow = finite(rawPulse) ? rawPulse : 0;
    if (pulseNow > 0.5 && pulseNow > this.lastPulse + 0.2) this.sinceOnset = 0;
    this.lastPulse = pulseNow;
    const trusted = hasTempo && (!hasAudio || this.sinceOnset < LOST_BEATS);
    if (trusted) this.heard = true;
    if (!this.heard) f.bpm = score;

    const nominal = f.bpm / 60 * dt;
    let slew = 0;
    if (trusted) {
      const ratio = measured / f.bpm, factor = Math.abs(ratio * 2 - 1) < FOLD * 2 ? 2 : Math.abs(ratio / 2 - 1) < FOLD ? 0.5 : 1;
      this.followTempo(measured * factor, nominal, dt);
      slew = this.phaseSlew(beat + phase, factor, nominal);
    } else { this.pendingBeats = 0; this.suspectBeats = 0; this.correcting = false; }

    const step = f.bpm / 60 * dt * (1 + slew);
    f.beats += step; f.beatPhase = f.beats - Math.floor(f.beats);
    if (this.sinceOnset !== Infinity) this.sinceOnset += step;
    f.status = trusted ? 'locked' : this.heard ? 'holding' : 'free';
    this.react(dt, signals, params, hasAudio && trusted, hasAudio, pulseNow);
    return f;
  }

  private followTempo(tempo: number, beats: number, dt: number): void {
    const f = this.frame;
    if (this.targetBpm > 0) {
      if (Math.abs(tempo - this.targetBpm) / this.targetBpm > SAME_PENDING) this.targetBpm = 0;
      else {
        const most = f.bpm * TEMPO_GLIDE * beats;
        f.bpm += clamp(this.targetBpm - f.bpm, -most, most);
        if (f.bpm === this.targetBpm) this.targetBpm = 0;
        return;
      }
    }
    if (Math.abs(tempo - f.bpm) / f.bpm < SAME_TEMPO) { f.bpm = tempo + (f.bpm - tempo) * Math.exp(-dt / TEMPO_FOLLOW); this.pendingBeats = 0; return; }
    if (this.pendingBeats === 0 || Math.abs(tempo - this.pendingBpm) / this.pendingBpm > SAME_PENDING) { this.pendingBpm = tempo; this.pendingBeats = 0; }
    this.pendingBeats += beats;
    if (this.pendingBeats >= PERSIST_BEATS) { this.targetBpm = tempo; this.pendingBeats = 0; }
  }

  private phaseSlew(position: number, factor: number, beats: number): number {
    // The reading is for this frame, so it is compared with where this frame's step will land.
    let error = wrap(position * factor - (this.frame.beats + beats));
    if (factor === 0.5) { const other = wrap(error + 0.5); if (Math.abs(other) < Math.abs(error)) error = other; }
    if (Math.abs(error) < SMALL_PHASE) { this.suspectBeats = 0; this.correcting = false; return clamp(error * SLEW_GAIN, -MAX_SLEW, MAX_SLEW); }
    if (this.correcting) return clamp(error * SLEW_GAIN, -MAX_SLEW, MAX_SLEW);
    if (this.suspectBeats === 0 || Math.abs(wrap(error - this.suspect)) > SAME_PHASE) { this.suspect = error; this.suspectBeats = 0; }
    this.suspectBeats += beats;
    if (this.suspectBeats >= PERSIST_BEATS) { this.correcting = true; this.suspectBeats = 0; }
    return 0;
  }

  private react(dt: number, signals: Readonly<Record<string, number>>, params: Readonly<Record<string, number>>, live: boolean, sounding: boolean, pulse: number): void {
    const f = this.frame;
    const attack = Math.max(MIN_ATTACK, (finite(params.reactionAttack) ? params.reactionAttack : 20) / 1000);
    const release = Math.max(sounding ? MIN_RELEASE : LOST_RELEASE, (finite(params.reactionRelease) ? params.reactionRelease : 250) / 1000);
    const envelope = (from: number, to: number) => follow(from, to, dt, to > from ? attack : release);
    f.bass = envelope(f.bass, sounding ? unit(signals['audio.bass']) : 0);
    f.mids = envelope(f.mids, sounding ? unit(signals['audio.mids']) : 0);
    f.highs = envelope(f.highs, sounding ? unit(signals['audio.highs']) : 0);
    f.level = envelope(f.level, sounding ? unit(signals['audio.level']) : 0);
    f.energy = follow(f.energy, sounding ? f.level : 0, dt, f.level > f.energy ? ENERGY_RISE : ENERGY_FALL);
    this.confidence = follow(this.confidence, live ? 1 : 0, dt, live ? CONFIDENCE_RISE : CONFIDENCE_FALL);
    this.rawPulse = envelope(this.rawPulse, sounding ? unit(pulse) : 0);
    const wave = 0.5 + 0.5 * Math.cos(Math.PI * 2 * f.beatPhase), grid = wave * wave * wave;
    const snap = finite(params.reactionBeatSnap) ? clamp(params.reactionBeatSnap, 0, 1) : 0.5;
    const shaped = (grid * snap + this.rawPulse * (1 - snap)) * this.confidence;
    f.pulse = shaped < QUIET ? 0 : shaped;
  }
}
