/**
 * Droplet layout for Liquid Light.
 *
 * A repeating square tile is filled with non-overlapping circles whose sizes
 * span a wide range: large droplets are placed first, then each smaller size
 * grows into whatever space is left. The result depends only on the seed, the
 * size range and the density, so it is baked once and reused for every frame.
 *
 * The shader finds droplets through a grid of bins. Each bin lists every
 * droplet that reaches into it, so a pixel reads its own bin and nothing else.
 *
 * Units: 1 is the frame height at Cell size 1.
 */
export const LIQUID_TILE = 3;
export const LIQUID_BINS = 96;
export const LIQUID_SLOTS = 16;
/** Radius of the largest droplets. */
export const LIQUID_MAX_RADIUS = .12;
/** Droplets are listed in bins this far beyond their edge, so a pixel also
 * finds the neighbours that press on the droplet it is in. */
export const LIQUID_REACH = .024;
const REACH = LIQUID_REACH;
const CLASSES = 14;

export interface LiquidPack {
  /** x, y, radius, random per droplet. */
  droplets: Float32Array;
  count: number;
  /** LIQUID_BINS·LIQUID_SLOTS wide, LIQUID_BINS high, RGBA: one droplet per texel, radius 0 when empty. */
  texture: Float32Array;
  /** Share of the tile covered by droplets. */
  coverage: number;
}

export function liquidPackKey(seed: number, sizeRange: number, density: number): string {
  return `${Math.round(seed) % 1_000_003}:${sizeRange.toFixed(2)}:${density.toFixed(3)}`;
}

function random(seed: number): () => number {
  let a = (Math.round(seed) % 1_000_003) * 2654435761 >>> 0;
  return () => {
    a = a + 0x6D2B79F5 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Clear space kept around a droplet of this radius. */
export const liquidGap = (radius: number, density: number) => (.004 + .06 * radius) * (1.6 - density);

export function packDroplets(seed: number, sizeRange: number, density: number): LiquidPack {
  const T = LIQUID_TILE, N = LIQUID_BINS, K = LIQUID_SLOTS, bin = T / N;
  const rand = random(seed);
  const range = Math.max(2, sizeRange), amount = Math.max(0, Math.min(1, density));
  const minRadius = LIQUID_MAX_RADIUS / range;
  const bins = new Int32Array(N * N * K).fill(-1), counts = new Uint8Array(N * N);
  const xs: number[] = [], ys: number[] = [], rs: number[] = [], hs: number[] = [];
  const wrap = (i: number) => ((i % N) + N) % N;
  const delta = (d: number) => d - T * Math.round(d / T);

  /** Distance from a point to the nearest droplet edge, searching no further than `limit`. */
  const clearance = (x: number, y: number, limit: number): number => {
    let best = limit;
    const x0 = Math.floor((x - limit) / bin), x1 = Math.floor((x + limit) / bin);
    const y0 = Math.floor((y - limit) / bin), y1 = Math.floor((y + limit) / bin);
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
      const at = (wrap(by) * N + wrap(bx)) * K;
      for (let s = 0; s < K; s++) {
        const i = bins[at + s];
        if (i < 0) break;
        const d = Math.hypot(delta(x - xs[i]), delta(y - ys[i])) - rs[i];
        if (d < best) best = d;
      }
    }
    return best;
  };

  const place = (x: number, y: number, r: number): boolean => {
    const reach = r + REACH;
    const x0 = Math.floor((x - reach) / bin), x1 = Math.floor((x + reach) / bin);
    const y0 = Math.floor((y - reach) / bin), y1 = Math.floor((y + reach) / bin);
    // A full bin cannot list another droplet, so the droplet is not placed at all.
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) if (counts[wrap(by) * N + wrap(bx)] >= K) return false;
    const index = xs.length;
    xs.push(x); ys.push(y); rs.push(r); hs.push(rand());
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
      const b = wrap(by) * N + wrap(bx);
      bins[b * K + counts[b]++] = index;
    }
    return true;
  };

  for (let c = 0; c < CLASSES; c++) {
    const radius = LIQUID_MAX_RADIUS * Math.pow(1 / range, c / (CLASSES - 1));
    const last = c === CLASSES - 1;
    // Tries per size: enough to cover a share of the tile that falls for the
    // largest sizes (a few big droplets) and rises with density.
    const t = c / (CLASSES - 1), ease = Math.min(1, t / .6);
    const share = (.02 + .63 * amount) * (.07 + .93 * ease * ease * (3 - 2 * ease));
    const tries = Math.ceil(share * T * T / (Math.PI * radius * radius) * (last ? 3 : 1.6));
    for (let i = 0; i < tries; i++) {
      const x = rand() * T, y = rand() * T, wanted = radius * (.82 + .36 * rand());
      const gap = liquidGap(wanted, amount);
      const room = clearance(x, y, wanted + gap) - gap;
      if (room < (last ? minRadius * .8 : wanted * .7)) continue;
      place(x, y, Math.min(wanted, room));
    }
  }

  const count = xs.length, droplets = new Float32Array(count * 4);
  let area = 0;
  for (let i = 0; i < count; i++) {
    droplets.set([xs[i], ys[i], rs[i], hs[i]], i * 4);
    area += Math.PI * rs[i] * rs[i];
  }
  const texture = new Float32Array(N * K * N * 4);
  for (let b = 0; b < N * N; b++) for (let s = 0; s < counts[b]; s++) {
    const i = bins[b * K + s], bx = b % N, by = (b - bx) / N;
    texture.set([xs[i], ys[i], rs[i], hs[i]], (by * N * K + bx * K + s) * 4);
  }
  return { droplets, count, texture, coverage: area / (T * T) };
}
