/**
 * Kaleidoscope symmetry: maps any point of the plane to the matching point of
 * one fundamental domain, so sampling a picture there repeats it under the group.
 *
 * Only the groups whose fundamental domain is bounded entirely by mirrors are
 * here: the rosette D_n and the wallpaper groups pmm, p4m, p3m1 and p6m. Every
 * edge being a mirror is what makes the fold continuous for any picture, with
 * no seam where neighbouring copies meet.
 *
 * Every group is folded the same way:
 *   1. translate to the nearest point of the group's lattice (wallpaper groups only);
 *   2. fold by the point group D_k about that lattice point.
 * Both steps are piecewise isometries, so the fold's local linear part `m` is a
 * rotation or reflection. Carrying `m` lets the renderer turn screen-space
 * derivatives of the unfolded point into exact texture footprints at the
 * folded point, with no derivative spike along fold lines.
 *
 * The shader in src/rendering/kaleidoscope.ts implements the same steps;
 * tests/symmetry.test.ts checks this version for continuity and invariance.
 */

export const SYMMETRY_GROUPS = ['Rosette', 'pmm', 'p3m1', 'p4m', 'p6m'] as const;
export const SYMMETRY_LABELS = ['Rosette mirrors', 'Rectangles (pmm)', 'Triangles (p3m1)', 'Squares (p4m)', 'Hexagons (p6m)'];

export interface FoldSettings {
  /** Index into SYMMETRY_GROUPS. */
  group: number;
  /** Rosette only: mirror count n of D_n; the picture shows 2n copies. */
  segments: number;
  /** Wallpaper groups: size of the fundamental domain, in units of picture height. */
  cell: number;
  /** pmm only: width / height of the fundamental rectangle. */
  cellAspect: number;
}

export type Vec2 = [number, number];
/** Row-major 2×2 matrix [a, b, c, d] acting as (x, y) -> (a x + b y, c x + d y). */
export type Mat2 = [number, number, number, number];

const SQRT3 = Math.sqrt(3);
const multiply = (a: Mat2, b: Mat2): Mat2 => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
const apply = (m: Mat2, p: Vec2): Vec2 => [m[0] * p[0] + m[1] * p[1], m[2] * p[0] + m[3] * p[1]];

/**
 * D_n about the origin: mirrors through the origin at angles 0 and π/n (and
 * their images). The result lies in the wedge 0 ≤ angle ≤ π/n.
 */
export function foldDihedral(p: Vec2, n: number): { q: Vec2; m: Mat2 } {
  const wedge = Math.PI / n;
  const angle = Math.atan2(p[1], p[0]);
  const turn = -2 * wedge * Math.floor(angle / (2 * wedge));
  const c = Math.cos(turn), s = Math.sin(turn);
  let m: Mat2 = [c, -s, s, c];
  if (angle + turn > wedge) {
    const c2 = Math.cos(2 * wedge), s2 = Math.sin(2 * wedge);
    m = multiply([c2, s2, s2, -c2], m);
  }
  return { q: apply(m, p), m };
}

/** The nearest point of the rectangular lattice with these periods, subtracted. */
export function reduceRect(p: Vec2, px: number, py: number): Vec2 {
  return [p[0] - px * Math.floor(p[0] / px + .5), p[1] - py * Math.floor(p[1] / py + .5)];
}

/**
 * The nearest point of the hexagonal lattice with spacing `spacing`, subtracted.
 * Basis a1 = spacing·(√3/2, 1/2), a2 = spacing·(0, 1): its Voronoi cells are
 * hexagons with corners at angles 0°, 60°, … and circumradius spacing/√3.
 * The nearest lattice point is a corner of the containing 60° rhombus.
 */
export function reduceHex(p: Vec2, spacing: number): Vec2 {
  const u = p[0] / (spacing * SQRT3 / 2), v = (p[1] - u * spacing / 2) / spacing;
  const u0 = Math.floor(u), v0 = Math.floor(v);
  let best: Vec2 = p, distance = Infinity;
  for (const du of [0, 1]) for (const dv of [0, 1]) {
    const a = u0 + du, b = v0 + dv;
    const d: Vec2 = [p[0] - a * spacing * SQRT3 / 2, p[1] - a * spacing / 2 - b * spacing];
    const dd = d[0] * d[0] + d[1] * d[1];
    if (dd < distance) { distance = dd; best = d; }
  }
  return best;
}

/**
 * Lattice periods for each wallpaper group. Rectangular groups use periods of
 * twice the fundamental rectangle. Hexagonal groups use spacing cell·√3, so
 * the Voronoi hexagon has circumradius `cell`: p3m1's mirror triangle has side
 * `cell`, and p6m's 30-60-90 triangle has its long leg along a hexagon radius.
 */
export function latticeOf(settings: FoldSettings): { kind: 'none' } | { kind: 'rect'; px: number; py: number } | { kind: 'hex'; spacing: number } {
  const group = Math.round(settings.group), cell = settings.cell;
  if (group === 1) return { kind: 'rect', px: 2 * cell * settings.cellAspect, py: 2 * cell };
  if (group === 3) return { kind: 'rect', px: 2 * cell, py: 2 * cell };
  if (group === 2 || group === 4) return { kind: 'hex', spacing: cell * SQRT3 };
  return { kind: 'none' };
}

/** Point-group order k of D_k used after lattice reduction. */
export function pointGroupOf(settings: FoldSettings): number {
  return [Math.max(1, Math.round(settings.segments)), 2, 3, 4, 6][Math.round(settings.group)] ?? 1;
}

export function fold(p: Vec2, settings: FoldSettings): { q: Vec2; m: Mat2 } {
  const lattice = latticeOf(settings);
  const local = lattice.kind === 'rect' ? reduceRect(p, lattice.px, lattice.py) : lattice.kind === 'hex' ? reduceHex(p, lattice.spacing) : p;
  return foldDihedral(local, pointGroupOf(settings));
}
