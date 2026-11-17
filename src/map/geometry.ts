// show.ts imports isValidOutline too, so nothing from show.ts is read while this module loads, only inside functions.
import { STAGE_SIZE, MIN_OUTLINE_AREA, type CurvePoint, type Point } from './show';
import { pointInPolygon, shapeValidity, type Validity } from './outline';
export { MIN_OUTLINE_AREA };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The outline rules for a shape without holes; curved sides are checked as drawn. See outline.ts. */
export function isValidOutline(points: CurvePoint[]): Validity {
  return shapeValidity(points, []);
}
export { pointInPolygon };

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
