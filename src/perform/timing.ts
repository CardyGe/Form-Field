/** Launch timing: pure sums on a snapshot of the clock, so a launch can be given an exact time ahead of the beat. */
import type { FollowState } from '../react/tempo';
import type { Quantize } from './types';
import { BEATS_PER_BAR } from './types';

export interface ClockSnapshot { anchorMs: number; anchorBeat: number; bpm: number; state: FollowState; barOffset: number }

/** Human presses land slightly late: this long after a boundary still counts as that boundary. */
export const LATE_GRACE_MS = 100;
const ON_TIME_MS = 1e-6;

export const quantizeBeats: Record<Quantize, number> = { '1/4': 1, '1/2': 2, '1bar': BEATS_PER_BAR, '2bar': BEATS_PER_BAR * 2, '4bar': BEATS_PER_BAR * 4 };

export function beatAt(c: ClockSnapshot, nowMs: number): number { return c.anchorBeat + (nowMs - c.anchorMs) * c.bpm / 60000; }
export function msAtBeat(c: ClockSnapshot, beat: number): number { return c.anchorMs + (beat - c.anchorBeat) * 60000 / c.bpm; }

/** The boundary a press at nowMs launches on. The grid starts from the bar offset, so "This is the 1" re-times launches. */
export function nextBoundary(c: ClockSnapshot, nowMs: number, q: Quantize, graceMs = LATE_GRACE_MS): { beat: number; atMs: number; late: boolean } {
  const size = quantizeBeats[q];
  const previous = c.barOffset + Math.floor((beatAt(c, nowMs) - c.barOffset) / size + 1e-9) * size;
  const previousMs = msAtBeat(c, previous);
  if (nowMs - previousMs <= ON_TIME_MS) return { beat: previous, atMs: previousMs, late: false };
  if (nowMs - previousMs <= graceMs) return { beat: previous, atMs: nowMs, late: true };
  const beat = previous + size;
  return { beat, atMs: msAtBeat(c, beat), late: false };
}

/** Beats to take off the beat count when placing a locked clip launched now, so it lines up with the corrected bar. */
export function launchPhaseOffset(c: ClockSnapshot): number { return c.barOffset; }
