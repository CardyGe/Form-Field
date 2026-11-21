/**
 * Placement maths for Map stage 4: where a shape's picture sits. Pure, so it is tested with node:test.
 *
 * Pin: four corners take the picture with perspective. A homography maps the picture's rectangle to the four corners;
 * the picture is then drawn as a grid of small triangles, each mapped affinely (the standard Canvas 2D route to
 * perspective). Stage corners use the same grid to re-pin the whole stage on the wall.
 */
import type { Point } from './show';

export type Quad = [Point, Point, Point, Point];
/** a b c / d e f: maps (x, y) to (a x + c y + e, b x + d y + f), as CanvasRenderingContext2D.setTransform. */
export type Affine = [number, number, number, number, number, number];
export interface Rect { x: number; y: number; w: number; h: number }

/** Solves an n×n linear system in place by Gaussian elimination with partial pivoting. Null when singular. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/**
 * The homography (row-major 3×3, h[8] = 1) that maps the four src points to the four dst points, in order.
 * Null when the points are degenerate (three collinear, or two equal).
 */
export function homography(src: Point[], dst: Point[]): number[] | null {
  const m: number[][] = [], r: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); r.push(u);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y]); r.push(v);
  }
  const h = solve(m, r);
  return h ? [...h, 1] : null;
}

export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** The affine map that takes the three src points to the three dst points, or null when they are collinear. */
export function affineFromTriangle(src: Point[], dst: Point[]): Affine | null {
  const [s0, s1, s2] = src;
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return null;
  // Solve for the 2×3 map M with M·(s,1) = d for each vertex, via the inverse of the source vertices.
  const solveAxis = (d0: number, d1: number, d2: number) => {
    const ka = (d1 - d0) * (s2.y - s0.y) - (d2 - d0) * (s1.y - s0.y);
    const kb = (s1.x - s0.x) * (d2 - d0) - (s2.x - s0.x) * (d1 - d0);
    return [ka / det, kb / det, d0 - (ka / det) * s0.x - (kb / det) * s0.y] as const;
  };
  const [a, c, e] = solveAxis(dst[0].x, dst[1].x, dst[2].x);
  const [b, d, f] = solveAxis(dst[0].y, dst[1].y, dst[2].y);
  return [a, b, c, d, e, f];
}

/**
 * The triangles that draw a picture of the given size pinned to four corners. The picture (0..w, 0..h) is cut
 * into cols × rows cells; each cell is two triangles. src is the triangle in picture pixels, dst where it lands.
 */
export function pinTriangles(quad: Quad, w: number, h: number, cols: number, rows: number): { src: [Point, Point, Point]; dst: [Point, Point, Point] }[] {
  const toPicture: Point[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const hom = homography(toPicture, quad);
  const out: { src: [Point, Point, Point]; dst: [Point, Point, Point] }[] = [];
  if (!hom) return out;
  const at = (i: number, j: number) => ({ x: (w * i) / cols, y: (h * j) / rows });
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      for (const tri of [[a, b, c], [a, c, d]] as Point[][]) {
        out.push({ src: tri as [Point, Point, Point], dst: tri.map(p => applyHomography(hom, p)) as [Point, Point, Point] });
      }
    }
  }
  return out;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * A pinned quad is usable when it is convex (every corner turns the same way), has the area of at least minArea,
 * and does not fold over itself. A quad that fails keeps the last valid placement on the wall.
 */
export function quadUsable(quad: Point[], minArea: number): boolean {
  if (quad.length !== 4) return false;
  if (quad.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const turns = quad.map((p, i) => cross(p, quad[(i + 1) % 4], quad[(i + 2) % 4]));
  const sign = Math.sign(turns[0]);
  if (sign === 0 || turns.some(t => Math.sign(t) !== sign)) return false;
  let area2 = 0;
  for (let i = 0; i < 4; i++) area2 += quad[i].x * quad[(i + 1) % 4].y - quad[(i + 1) % 4].x * quad[i].y;
  return Math.abs(area2) / 2 >= minArea;
}

/** The bounding rectangle of a set of rectangles, or null when there are none. */
export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Brightness is a multiplier from 0 (black) to 2; tint is a colour mixed in by its amount. Both are clamped.
 * 1 and 0 leave the picture as it is.
 */
export const BRIGHTNESS_RANGE = { min: 0, max: 2 };
export function clampBrightness(value: number): number {
  return Number.isFinite(value) ? Math.min(BRIGHTNESS_RANGE.max, Math.max(BRIGHTNESS_RANGE.min, value)) : 1;
}
