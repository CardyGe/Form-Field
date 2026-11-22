/** Euclidean rhythm via Bjorklund's method. Hits clamp to 0..steps; the pattern starts on a hit before rotation. */
export function euclid(hits: number, steps: number, rotation = 0): boolean[] {
  const n = Math.max(0, Math.floor(steps));
  if (n === 0) return [];
  const k = Math.min(n, Math.max(0, Math.floor(hits)));
  let a: boolean[][] = Array.from({ length: k }, () => [true]);
  let b: boolean[][] = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1 && a.length > 0) {
    const m = Math.min(a.length, b.length);
    const merged = Array.from({ length: m }, (_, i) => [...a[i], ...b[i]]);
    const rest = a.length > b.length ? a.slice(m) : b.slice(m);
    a = merged;
    b = rest;
  }
  const pattern = [...a, ...b].flat();
  const r = ((Math.floor(rotation) % n) + n) % n;
  return pattern.map((_, i) => pattern[(i - r + n) % n]);
}

/** Power-of-two subdivision that tightens from `from` to `to` as progress goes 0..1, never decreasing. */
export function subdivisionAt(progress: number, from: number, to: number): number {
  const lo = Math.log2(Math.max(1, from));
  const hi = Math.max(lo, Math.log2(Math.max(1, to)));
  const p = Math.min(1, Math.max(0, progress));
  const exponent = Math.min(Math.floor(hi), Math.floor(lo + (hi - lo) * p + 1e-9));
  return 2 ** Math.max(Math.floor(lo), exponent);
}
