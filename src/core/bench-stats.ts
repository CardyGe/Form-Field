export interface Summary { count: number; median: number; p95: number; p99: number; max: number }

/** Nearest-rank percentile of an ascending array. */
function rank(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

export function summarise(samples: readonly number[]): Summary {
  if (samples.length === 0) throw new Error('Cannot summarise an empty sample set.');
  const sorted = [...samples].sort((a, b) => a - b), n = sorted.length;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { count: n, median, p95: rank(sorted, .95), p99: rank(sorted, .99), max: sorted[n - 1] };
}

/** True when two measurements differ by no more than `tolerance` of the larger one. */
export function agree(a: number, b: number, tolerance: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 || Math.abs(a - b) <= tolerance * scale;
}
