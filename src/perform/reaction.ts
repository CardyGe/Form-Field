import type { Signals } from '../react/signals';
import type { Clip } from './types';

/** What one zone's look is doing to the sound right now. Task 12 adds the ceiling's bloom and breath as further fields. */
export interface ReactionState { envelope: number; burst: number }

/** Seconds for audio reaction to rise and to fall: quick with the kick, a little slower to let go. */
const ENVELOPE = { attack: .03, release: .2 };
/** Seconds for a burst to rise and fall. The room's follows the kick at once; the ceiling's is slow. */
export const BURST_TIMES = { room: { on: .01, off: .18 }, ceiling: { on: 2, off: 4 } };
/** A held burst lifts a zone by this much, and by the kick pulse on top. */
const BURST_BASE = .5, BURST_KICK = .5;
/** The most a zone may exceed its fader, as a share of it. */
const MAX_LIFT = .6;
/** Reaction and bursts add up to this share to a free clip's speed. */
const SPEED_FOLD = .5;
const BANDS: Record<Clip['audioBand'], string> = { bass: 'audio.bass', mid: 'audio.mids', high: 'audio.highs', level: 'audio.level' };

const unit = (n: number | undefined) => n === undefined || !Number.isFinite(n) ? 0 : Math.min(1, Math.max(0, n));
const toward = (value: number, target: number, seconds: number, tau: number) => value + (target - value) * (1 - Math.exp(-seconds / tau));
const lift = (r: ReactionState) => Math.min(1, unit(r.envelope) + unit(r.burst));

export function bandSignal(signals: Signals, band: Clip['audioBand']): number {
  return unit(signals[BANDS[band]]);
}

/** One step of a zone's reaction. `amount` is the Audio knob; `held` is the Red button; `pulse` is the kick. */
export function stepReaction(s: ReactionState, band: number, amount: number, held: boolean, pulse: number, seconds: number, burstTimes = BURST_TIMES.room): ReactionState {
  const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const target = unit(amount) * unit(band);
  const envelope = toward(unit(s.envelope), target, dt, target > s.envelope ? ENVELOPE.attack : ENVELOPE.release);
  const burstTarget = held ? BURST_BASE + BURST_KICK * unit(pulse) : 0;
  const burst = toward(unit(s.burst), burstTarget, dt, burstTarget > s.burst ? burstTimes.on : burstTimes.off);
  return { envelope: envelope < 1e-4 ? 0 : envelope, burst: burst < 1e-4 ? 0 : burst };
}

/** Fader 0 and master 0 are black. The wall applies master itself, so it only gates here. */
export function zoneBrightness(fader: number, master: number, r: ReactionState): number {
  const f = unit(fader);
  if (f === 0 || unit(master) === 0) return 0;
  return f * (1 + MAX_LIFT * lift(r));
}

/** For free clips only: a locked clip's speed must stay 0.5, 1 or 2 or it scrubs the loop. */
export function reactionSpeed(base: number, r: ReactionState): number {
  return base * (1 + SPEED_FOLD * lift(r));
}
