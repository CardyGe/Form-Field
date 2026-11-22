export type Vec2 = { x: number; y: number };
export type SymmetryGroup = 'rosette' | 'pmm' | 'p3m1' | 'p4m' | 'p6m';
export const SYMMETRY_GROUPS: SymmetryGroup[] = ['rosette', 'pmm', 'p3m1', 'p4m', 'p6m'];

const S3 = Math.sqrt(3);

/** Walls are half-planes n.p <= d, as [nx, ny, d] before normalising. */
const RAW: Record<Exclude<SymmetryGroup, 'rosette'>, { a: Vec2; b: Vec2; walls: [number, number, number][] }> = {
  pmm: { a: { x: 1, y: 0 }, b: { x: 0, y: 1 }, walls: [[-1, 0, 0], [1, 0, 0.5], [0, -1, 0], [0, 1, 0.5]] },
  p4m: { a: { x: 1, y: 0 }, b: { x: 0, y: 1 }, walls: [[0, -1, 0], [1, 0, 0.5], [-1, 1, 0]] },
  p3m1: { a: { x: 1.5, y: S3 / 2 }, b: { x: 0, y: S3 }, walls: [[0, -1, 0], [S3, 1, S3], [-S3, 1, 0]] },
  p6m: { a: { x: 1, y: 0 }, b: { x: 0.5, y: S3 / 2 }, walls: [[0, -1, 0], [1, 0, 0.5], [-1, S3, 0]] },
};

const normalise = (walls: [number, number, number][]) =>
  walls.map(([nx, ny, d]): [number, number, number] => { const l = Math.hypot(nx, ny); return [nx / l, ny / l, d / l]; });

export const GROUP_TABLES: Record<Exclude<SymmetryGroup, 'rosette'>, { a: Vec2; b: Vec2; walls: [number, number, number][] }> = {
  pmm: { ...RAW.pmm, walls: normalise(RAW.pmm.walls) },
  p4m: { ...RAW.p4m, walls: normalise(RAW.p4m.walls) },
  p3m1: { ...RAW.p3m1, walls: normalise(RAW.p3m1.walls) },
  p6m: { ...RAW.p6m, walls: normalise(RAW.p6m.walls) },
};

/** Matches the shader's pass cap. */
const MAX_PASSES = 6;
const MIN_RADIUS = 1e-12;

export function foldPoint(
  group: SymmetryGroup,
  p: Vec2,
  sectors: number,
): { p: Vec2; linear: [number, number, number, number]; reflections: number } {
  if (group === 'rosette') {
    const n = Math.min(24, Math.max(3, Math.round(sectors)));
    const w = Math.PI / n;
    const r = Math.hypot(p.x, p.y);
    if (r === 0) return { p: { x: 0, y: 0 }, linear: [1, 0, 0, 1], reflections: 0 };
    const k = Math.floor(Math.atan2(p.y, p.x) / (2 * w));
    const t0 = Math.atan2(p.y, p.x) - k * 2 * w; // angle inside [0, 2w)
    const flip = t0 > w;
    const t = flip ? 2 * w - t0 : t0;
    // rotation by -2wk brings the point into the first double wedge
    const c = Math.cos(2 * w * k), s = -Math.sin(2 * w * k);
    let m00 = c, m01 = -s, m10 = s, m11 = c;
    if (flip) {
      // then reflect across the line at angle w: [[cos 2w, sin 2w], [sin 2w, -cos 2w]]
      const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      const a00 = c2 * m00 + s2 * m10, a01 = c2 * m01 + s2 * m11;
      const a10 = s2 * m00 - c2 * m10, a11 = s2 * m01 - c2 * m11;
      m00 = a00; m01 = a01; m10 = a10; m11 = a11;
    }
    return { p: { x: r * Math.cos(t), y: r * Math.sin(t) }, linear: [m00, m01, m10, m11], reflections: flip ? 1 : 0 };
  }

  const { a, b, walls } = GROUP_TABLES[group];
  // reduce by the nearest lattice vector once (rounding in lattice coordinates)
  const det = a.x * b.y - a.y * b.x;
  const ru = Math.round((p.x * b.y - p.y * b.x) / det);
  const rv = Math.round((a.x * p.y - a.y * p.x) / det);
  let x = p.x - (ru * a.x + rv * b.x);
  let y = p.y - (ru * a.y + rv * b.y);
  let m00 = 1, m01 = 0, m10 = 0, m11 = 1;
  let reflections = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const over = w[0] * x + w[1] * y - w[2];
      if (over > 0) {
        x -= 2 * over * w[0];
        y -= 2 * over * w[1];
        // linear = R * linear, with R = I - 2 n n^T
        const r00 = 1 - 2 * w[0] * w[0], r01 = -2 * w[0] * w[1], r11 = 1 - 2 * w[1] * w[1];
        const n00 = r00 * m00 + r01 * m10, n01 = r00 * m01 + r01 * m11;
        const n10 = r01 * m00 + r11 * m10, n11 = r01 * m01 + r11 * m11;
        m00 = n00; m01 = n01; m10 = n10; m11 = n11;
        reflections++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { p: { x, y }, linear: [m00, m01, m10, m11], reflections };
}

export function sanitiseSpiral(a: number, b: number): { a: number; b: number } {
  const ra = Math.round(a), rb = Math.round(b);
  return ra === 0 && rb === 0 ? { a: 0, b: 1 } : { a: ra, b: rb };
}

/**
 * Log-spiral coordinates. w = log z, gamma = b - i a ln(lambda)/(2 pi),
 * tau = (Re(gamma w)/ln lambda, Im(gamma w)/(2 pi)). One turn moves tau by exactly (a, b).
 * Requires lambda > 1 and sanitised a, b.
 */
export function spiralTau(z: Vec2, a: number, b: number, lambda: number): Vec2 {
  const lnL = Math.log(lambda);
  const wr = Math.log(Math.max(Math.hypot(z.x, z.y), MIN_RADIUS));
  const wi = Math.atan2(z.y, z.x);
  const gi = -a * lnL / (2 * Math.PI);
  return { x: (b * wr - gi * wi) / lnL, y: (b * wi + gi * wr) / (2 * Math.PI) };
}

/** Circle-parity discs, in tile units. Each radius is under half a tile, so a disc never meets its own image. */
export const PARITY_RADII = [0.33, 0.29, 0.24];

/** How far the group of discs rocks about its middle, in radians. Keeps the two outer discs apart. */
const PARITY_ROCK = 0.18;
const PARITY_HOME = [[0, 0], [-0.25, 0.25], [0.25, -0.25]];

/**
 * Disc centres at a loop phase, flat as x0, y0, x1, y1, x2, y2. The discs move as one rigid group, gliding
 * and rocking, so their overlaps and therefore the tile's coverage hold still while every edge keeps moving.
 * Every term is a whole multiple of the phase.
 */
export function parityCentres(phase: number): number[] {
  const turn = PARITY_ROCK * Math.sin(phase), c = Math.cos(turn), s = Math.sin(turn);
  const x = 0.5 + 0.07 * Math.cos(phase), y = 0.5 + 0.07 * Math.sin(phase);
  return PARITY_HOME.flatMap(([hx, hy]) => [x + c * hx - s * hy, y + s * hx + c * hy]);
}

const PARITY_ROWS = 128;
const nearestWrap = (v: number) => v - Math.floor(v + 0.5);

/**
 * The true tile average of the parity mask at this phase: its area, and its integral against the
 * ink blend .5 + .5 cos(2 pi (x + y)). Each row toggles at the disc edges and is integrated exactly along x.
 */
export function parityAverage(phase: number): { coverage: number; ink: number } {
  const centres = parityCentres(phase), toggles = new Float64Array(6);
  let length = 0, moment = 0;
  for (let row = 0; row < PARITY_ROWS; row++) {
    const y = (row + 0.5) / PARITY_ROWS;
    let count = 0, inside = false;
    for (let d = 0; d < 3; d++) {
      const h = nearestWrap(y - centres[d * 2 + 1]), squared = PARITY_RADII[d] ** 2 - h * h;
      if (squared <= 0) continue;
      const half = Math.sqrt(squared), x = centres[d * 2];
      if (Math.abs(nearestWrap(x)) < half) inside = !inside;
      for (const edge of [x - half, x + half]) toggles[count++] = edge - Math.floor(edge);
    }
    toggles.subarray(0, count).sort();
    let from = 0;
    for (let i = 0; i <= count; i++) {
      const to = i < count ? toggles[i] : 1;
      if (inside) {
        length += to - from;
        moment += (Math.sin(2 * Math.PI * (to + y)) - Math.sin(2 * Math.PI * (from + y))) / (2 * Math.PI);
      }
      inside = !inside;
      from = to;
    }
  }
  const coverage = length / PARITY_ROWS;
  return { coverage, ink: 0.5 * coverage + 0.5 * moment / PARITY_ROWS };
}
