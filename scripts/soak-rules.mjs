// The soak's pass and fail rules, kept apart from the app so they can be tested with made-up samples (tests/soak-rules.test.ts).

/**
 * Faults between two wall samples a few seconds apart: a Meridian source that stood still, went back (it started again from
 * scratch), or disappeared; an instrument the wall restarted; a wall fault seen in both samples. Context losses that the wall
 * recovered from in place are not faults, but are counted by the caller.
 */
export function sampleFaults(prev, now) {
  const faults = [];
  if (!now) return ['the wall gave no report'];
  if (!prev) return faults;
  const before = prev.meridian ?? {}, after = now.meridian ?? {};
  for (const id of Object.keys(before)) {
    const a = before[id], b = after[id];
    if (!b) faults.push(`source ${id} disappeared from the wall`);
    else if (b.frames < a.frames) faults.push(`source ${id} started again from scratch (${a.frames} → ${b.frames} frames)`);
    else if (b.frames === a.frames) faults.push(`source ${id} stood still`);
  }
  if ((now.restarts ?? 0) > (prev.restarts ?? 0)) faults.push(`the wall restarted ${(now.restarts ?? 0) - (prev.restarts ?? 0)} instrument(s) after a lost graphics context`);
  const failing = new Set((prev.failing ?? []).map(f => `${f.id}: ${f.reason}`));
  for (const f of now.failing ?? []) if (failing.has(`${f.id}: ${f.reason}`)) faults.push(`a wall fault lasted two samples: ${f.id}: ${f.reason}`);
  if (now.contextLost && prev.contextLost) faults.push('the wall context stayed lost');
  if (now.flashGuard?.failed) faults.push(`limiter failed: ${now.flashGuard.failed}`);
  else if (!now.flashGuard?.on) faults.push('the limiter is not on');
  return faults;
}

const mean = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);

/**
 * Memory after the first hour, for one series of { minute, value }. Judged once the run has gone at least 100 minutes, so the
 * baseline (minutes 61–70) and the final 30 minutes do not overlap. It fails if the final 30 minutes average more than 10% over
 * the baseline, or if the least-squares slope after the first hour, carried over that span, comes to more than 10%: a steady
 * leak is caught by the slope even when averaging would dilute it.
 */
export function memoryVerdict(series, limit = .1) {
  const last = series.length ? series[series.length - 1].minute : 0;
  if (last < 100) return { judged: false, growth: null, slopeGrowth: null, failed: false };
  const base = mean(series.filter(s => s.minute > 60 && s.minute <= 70).map(s => s.value));
  const tail = mean(series.filter(s => s.minute > last - 30).map(s => s.value));
  const after = series.filter(s => s.minute > 60), mx = mean(after.map(s => s.minute)), my = mean(after.map(s => s.value));
  let num = 0, den = 0;
  for (const s of after) { num += (s.minute - mx) * (s.value - my); den += (s.minute - mx) ** 2; }
  const slope = den ? num / den : 0;
  const growth = tail / base - 1, slopeGrowth = slope * (last - 65) / base;
  return { judged: true, growth, slopeGrowth, failed: growth > limit || slopeGrowth > limit };
}

/** The phys_footprint of each process in `footprint -f bytes` output, which counts graphics (IOKit and IOSurface) memory too. */
export function parseFootprint(text) {
  const out = [];
  for (const match of String(text).matchAll(/\[(\d+)\]:.*?Footprint:\s*([\d,]+)\s*B/g)) out.push({ pid: Number(match[1]), bytes: Number(match[2].replace(/,/g, '')) });
  return out;
}
