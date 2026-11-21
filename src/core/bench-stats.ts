/**
 * Numbers for the benchmark harness: summaries of per-frame timings, and the
 * comparison that says whether two runs agree.
 *
 * A "sample" is one timed section of one frame, e.g. { frame: 12, pass: 'composite', ms: 0.41 }.
 * A frame's total is the sum of its sections. The timer covers each frame with
 * back-to-back sections, so the sum is the whole frame's GPU time.
 */

export interface Summary { count: number; min: number; median: number; mean: number; p95: number; p99: number; max: number }
export interface PassSample { frame: number; pass: string; ms: number }
export interface CaseTimings { total: Summary; passes: Record<string, Summary> }

/**
 * Nearest-rank percentile on sorted values: the smallest value with at least
 * p of the values at or below it. No interpolation, so a reported p95 is a
 * frame time that really happened.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(values: readonly number[]): Summary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: NaN, median: NaN, mean: NaN, p95: NaN, p99: NaN, max: NaN };
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length, min: sorted[0], median, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p95: percentile(sorted, .95), p99: percentile(sorted, .99), max: sorted[sorted.length - 1],
  };
}

/**
 * Per-pass and per-frame summaries. A pass that runs several times in a frame
 * (one source pass per layer, for example) is added up within that frame.
 * Frames listed in `incomplete` lost a section (a disjoint GPU timer) and are
 * left out of the totals, so a total never undercounts.
 */
export function summarizeSamples(samples: readonly PassSample[], incomplete: ReadonlySet<number> = new Set()): CaseTimings {
  const frames = new Map<number, Map<string, number>>();
  for (const s of samples) {
    if (incomplete.has(s.frame)) continue;
    let passes = frames.get(s.frame);
    if (!passes) frames.set(s.frame, passes = new Map());
    passes.set(s.pass, (passes.get(s.pass) ?? 0) + s.ms);
  }
  const byPass = new Map<string, number[]>(), totals: number[] = [];
  for (const passes of frames.values()) {
    let total = 0;
    for (const [pass, ms] of passes) { total += ms; let list = byPass.get(pass); if (!list) byPass.set(pass, list = []); list.push(ms); }
    totals.push(total);
  }
  const passes: Record<string, Summary> = {};
  for (const [pass, list] of [...byPass].sort(([a], [b]) => a.localeCompare(b))) passes[pass] = summarize(list);
  return { total: summarize(totals), passes };
}
