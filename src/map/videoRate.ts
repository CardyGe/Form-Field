/**
 * Stage 6: how fast a video loop plays. With Loop with the tempo, the clip is stretched or squeezed to last the chosen
 * number of beats. A rate outside the Speed range (0.1 to 4×) cannot be played well, so the nearest beat count that
 * fits is used instead, and reported so the screen can say so.
 */
import { SPEED_RANGE, TEMPO_SYNC_BEATS } from './show';
import type { Signals } from '../react/signals';

/**
 * The beat count and tempo a video hears. Map: the clock as it is (whole beats; 120 when the wall has no tempo).
 * Perform: `offset` beats taken off the count, the part of a beat already played counted in, and both the count and
 * the tempo run at `pace`, so a loop of n beats plays as n / pace beats at pace times the rate.
 */
export function videoClock(signals: Signals, pace: number, offset: number): { count: number | undefined; bpm: number } {
  const beat = signals['tempo.beat'], bpm = signals['tempo.bpm'] ?? 120;
  if (pace === 1 && offset === 0) return { count: beat, bpm };
  return { count: beat === undefined ? undefined : (beat + (signals['tempo.phase'] ?? 0) - offset) * pace, bpm: bpm * pace };
}

/** Which loop of `beats` beats the count is in, and how far into it (0 to 1). */
export function videoLoop(count: number, beats: number): { loop: number; into: number } {
  const loop = Math.floor(count / beats);
  return { loop, into: (count - loop * beats) / beats };
}

export function videoRate(durationS: number | null, speed: number, beats: number | null, bpm: number): { rate: number; beats: number | null } {
  if (beats === null || !durationS || !(durationS > 0) || !(bpm > 0)) return { rate: speed, beats: null };
  const rateFor = (n: number) => durationS / (n * 60 / bpm);
  const fits = (r: number) => r >= SPEED_RANGE.min && r <= SPEED_RANGE.max;
  if (fits(rateFor(beats))) return { rate: rateFor(beats), beats };
  const nearest = [...TEMPO_SYNC_BEATS].sort((a, b) => Math.abs(Math.log(a / beats)) - Math.abs(Math.log(b / beats)) || a - b);
  const n = nearest.find(b => fits(rateFor(b)));
  if (n !== undefined) return { rate: rateFor(n), beats: n };
  // Nothing fits (an extreme clip or tempo): the nearest playable rate, still restarting on the chosen beats.
  return { rate: Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, rateFor(beats))), beats };
}
