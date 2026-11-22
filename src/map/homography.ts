/**
 * Perspective transforms (3 × 3, row major): x' = (a·x + b·y + c) / (g·x + h·y + i), y' = (d·x + e·y + f) / (…).
 * Used to pin a picture onto four corners, and for the stage corners. Pure.
 */
import type { Point } from './show';

export type H3 = [number, number, number, number, number, number, number, number, number];
export const IDENTITY: H3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function apply(h: H3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function multiply(a: H3, b: H3): H3 {
  const out = new Array(9).fill(0) as H3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function invert(h: H3): H3 | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i, B = -(d * j - f * g), C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const r: H3 = [A, -(b * j - c * i), b * f - c * e, B, a * j - c * g, -(a * f - c * d), C, -(a * i - b * g), a * e - b * d];
  return r.map(v => v / det) as H3;
}

/** Below this area (projector pixels squared) a quad is too flat to carry a picture. */
const MIN_AREA = 100;
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** A quad can carry a picture when it is convex (turning the same way at every corner) and not too flat. */
export function isPinnable(q: Point[]): { ok: true } | { ok: false; reason: 'pin-folded' | 'pin-flat' } {
  if (q.length !== 4 || q.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { ok: false, reason: 'pin-folded' };
  const turns = q.map((p, i) => cross(p, q[(i + 1) % 4], q[(i + 2) % 4]));
  let twice = 0;
  for (let i = 0; i < 4; i++) twice += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
  if (!(turns.every(t => t > 0) || turns.every(t => t < 0))) return { ok: false, reason: 'pin-folded' };
  if (Math.abs(twice) / 2 < MIN_AREA) return { ok: false, reason: 'pin-flat' };
  return { ok: true };
}

/** The transform taking the unit square's corners (0,0), (1,0), (1,1), (0,1) to q[0..3]. Null when q cannot be pinned. */
export function squareToQuad(q: Point[]): H3 | null {
  if (!isPinnable(q).ok) return null;
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** The transform carrying `from`'s four corners onto `to`'s. */
export function quadToQuad(from: Point[], to: Point[]): H3 | null {
  const a = squareToQuad(from), b = squareToQuad(to);
  const ai = a && invert(a);
  return ai && b ? multiply(b, ai) : null;
}
