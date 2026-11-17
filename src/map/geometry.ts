// show.ts imports isValidOutline too, so nothing from show.ts is read while this module loads, only inside functions.
import { STAGE_SIZE, MAX_POINTS, MIN_OUTLINE_AREA, type Point } from './show';
export { MIN_OUTLINE_AREA };
// Two corners closer than this are the same corner; the outline has collapsed there.
const SAME_POINT = 1e-9;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function edgesMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const overlap =
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  return overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function hasCrossing(points: Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (edgesMeet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Enclosed area in stage fractions squared (always positive). */
function outlineArea(points: Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

const hasRepeatedCorner = (points: Point[]) =>
  points.some((a, i) => { const b = points[(i + 1) % points.length]; return Math.hypot(a.x - b.x, a.y - b.y) < SAME_POINT; });

export function isValidOutline(points: Point[]): { ok: true } | { ok: false; reason: 'crossing' | 'collapsed' | 'too-few' | 'too-many' | 'outside' } {
  if (points.length < 3) return { ok: false, reason: 'too-few' };
  if (points.length > MAX_POINTS) return { ok: false, reason: 'too-many' };
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return { ok: false, reason: 'outside' };
  // The same rules for every corner count, from 3 to MAX_POINTS.
  if (hasRepeatedCorner(points)) return { ok: false, reason: 'collapsed' };
  if (hasCrossing(points)) return { ok: false, reason: 'crossing' };
  if (outlineArea(points) < MIN_OUTLINE_AREA) return { ok: false, reason: 'collapsed' };
  return { ok: true };
}

/** Four corners, clockwise from the top-left of the drag box. */
export function rectangleFromDrag(a: Point, b: Point): Point[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

export function clampToStage(point: Point): Point {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

/** Move by projector pixels (screen y is down), clamped to the stage. */
export function nudge(point: Point, dxPx: number, dyPx: number): Point {
  return clampToStage({ x: point.x + dxPx / STAGE_SIZE.width, y: point.y + dyPx / STAGE_SIZE.height });
}

export function pointInPolygon(point: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function stageFromPointer(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): Point {
  // A canvas that is not laid out yet has no size; answer the origin rather than NaN.
  const fraction = (offset: number, size: number) => (size > 0 ? offset / size : 0);
  return clampToStage({ x: fraction(clientX - rect.left, rect.width), y: fraction(clientY - rect.top, rect.height) });
}

/** How many stage pixels one pixel of the displayed canvas covers. An unlaid-out canvas counts as 1. */
export function stagePixelsPerScreenPixel(displayedWidth: number): number {
  return displayedWidth > 0 ? STAGE_SIZE.width / displayedWidth : 1;
}

export function parsePixelField(text: string, range: { min: number; max: number }): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.min(range.max, Math.max(range.min, n));
}
