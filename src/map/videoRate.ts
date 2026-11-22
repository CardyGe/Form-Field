/**
 * Stage 6: how fast a video loop plays. With Loop with the tempo, the clip is stretched or squeezed to last the chosen
 * number of beats. A rate outside the Speed range (0.1 to 4×) cannot be played well, so the nearest beat count that
 * fits is used instead, and reported so the screen can say so.
 */
import { SPEED_RANGE, TEMPO_SYNC_BEATS } from './show';

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
