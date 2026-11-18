/**
 * What a press on the operator stage grabs, and what dragging a box handle does. Pure, so the rules are tested;
 * MapPanel turns pointer events into these questions and the answers into edits.
 */
import { STAGE_SIZE, isShapeLocked, isShapeShown, type Group, type Point, type Shape } from './show';
import { flatten, hitShape, nearestSide, ringBounds, rotateAbout, scaleAbout, type Matrix } from './outline';
import { ownCornersPinnable } from './placement';

type Shapes = { shapes: Shape[]; groups: Group[] };
/** The selected shapes; ring and index name the chosen point of the first one (ring -1 is its outline). */
export interface Selection { ids: string[]; ring: number; index: number | null }
export type BoxHandle = 'nw' | 'ne' | 'se' | 'sw' | 'turn';
export type Picked =
  | { kind: 'handle'; shapeId: string; ring: number; index: number; which: 'in' | 'out' }
  | { kind: 'point'; shapeId: string; ring: number; index: number }
  | { kind: 'pin'; shapeId: string; index: number }
  | { kind: 'box'; handle: BoxHandle }
  | { kind: 'side'; shapeId: string; ring: number; index: number; t: number }
  | { kind: 'shape'; shapeId: string }
  | { kind: 'empty' };
/** Distances in stage pixels: how close counts as on a point, how far the box handles sit outside the box, how far above it the turn handle is. */
export interface Reach { reachPx: number; outsetPx: number; turnPx: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }

const toPx = (p: Point): Point => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const rings = (shape: Shape) => [shape.points, ...shape.holes];

/** The box around the selected shapes' outlines, in stage pixels; null when none is selected. */
export function selectionBox(show: Shapes, ids: string[]): Box | null {
  const shapes = show.shapes.filter(s => ids.includes(s.id));
  if (!shapes.length) return null;
  const b = ringBounds(shapes.map(s => s.points));
  return { x0: b.x0 * STAGE_SIZE.width, y0: b.y0 * STAGE_SIZE.height, x1: b.x1 * STAGE_SIZE.width, y1: b.y1 * STAGE_SIZE.height };
}

/** Where the box's handles are drawn and grabbed, in stage pixels. */
export function boxHandles(box: Box, reach: Pick<Reach, 'outsetPx' | 'turnPx'>): Record<BoxHandle, Point> {
  const o = reach.outsetPx;
  return {
    nw: { x: box.x0 - o, y: box.y0 - o }, ne: { x: box.x1 + o, y: box.y0 - o },
    se: { x: box.x1 + o, y: box.y1 + o }, sw: { x: box.x0 - o, y: box.y1 + o },
    turn: { x: (box.x0 + box.x1) / 2, y: box.y0 - o - reach.turnPx },
  };
}

/** What a press at `at` (stage fractions) grabs: the chosen point's handles, points, box handles, sides, a shape, or nothing. */
export function pick(at: Point, show: Shapes, selection: Selection, reach: Reach): Picked {
  const p = toPx(at);
  const selected = show.shapes.filter(s => selection.ids.includes(s.id) && isShapeShown(show, s));
  const editable = selected.length === selection.ids.length && selected.length > 0 && !selected.some(s => isShapeLocked(show, s));
  const single = editable && selected.length === 1 ? selected[0] : null;

  if (single && selection.index !== null) {
    const point = rings(single)[selection.ring + 1]?.[selection.index];
    if (point) for (const which of ['out', 'in'] as const) {
      const h = point[which];
      if (h && dist(p, toPx({ x: point.x + h.x, y: point.y + h.y })) <= reach.reachPx) return { kind: 'handle', shapeId: single.id, ring: selection.ring, index: selection.index, which };
    }
  }
  if (single) {
    let best: { ring: number; index: number; d: number } | null = null;
    rings(single).forEach((ring, r) => ring.forEach((point, index) => {
      const d = dist(p, toPx(point));
      if (d <= reach.reachPx && (!best || d < best.d)) best = { ring: r - 1, index, d };
    }));
    if (best) { const b = best as { ring: number; index: number }; return { kind: 'point', shapeId: single.id, ring: b.ring, index: b.index }; }
  }
  // A pinned shape that does not pin by its own corners has four handles of its own.
  if (single && single.placement.kind === 'pin' && single.placement.pin && !ownCornersPinnable(single)) {
    const i = single.placement.pin.findIndex(q => dist(p, toPx(q)) <= reach.reachPx);
    if (i >= 0) return { kind: 'pin', shapeId: single.id, index: i };
  }
  if (editable) {
    const box = selectionBox(show, selected.map(s => s.id))!;
    const handles = boxHandles(box, reach);
    for (const handle of ['turn', 'nw', 'ne', 'se', 'sw'] as const) if (dist(p, handles[handle]) <= reach.reachPx) return { kind: 'box', handle };
  }
  if (single) {
    let best: { ring: number; index: number; t: number; distance: number } | null = null;
    rings(single).forEach((ring, r) => {
      const near = nearestSide(at, ring);
      if (near.distance <= reach.reachPx && (!best || near.distance < best.distance)) best = { ring: r - 1, ...near };
    });
    if (best) { const b = best as { ring: number; index: number; t: number }; return { kind: 'side', shapeId: single.id, ring: b.ring, index: b.index, t: b.t }; }
  }
  // The last shape in the list is drawn on top, so it is the one picked.
  const hit = [...show.shapes].reverse().find(s => isShapeShown(show, s) && hitShape(at, s.points, s.holes));
  return hit ? { kind: 'shape', shapeId: hit.id } : { kind: 'empty' };
}

/**
 * The transform a box handle asks for, in stage pixels. A corner scales from the opposite corner (Shift keeps the
 * proportions); the turn handle turns about the box's centre (Shift in 15 degree steps).
 */
export function transformFor(handle: BoxHandle, start: Point, now: Point, box: Box, shift: boolean): Matrix {
  if (handle === 'turn') {
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    let angle = Math.atan2(now.y - c.y, now.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x);
    if (shift) { const step = Math.PI / 12; angle = Math.round(angle / step) * step; }
    return rotateAbout(c, angle);
  }
  const pivot = { x: handle === 'nw' || handle === 'sw' ? box.x1 : box.x0, y: handle === 'nw' || handle === 'ne' ? box.y1 : box.y0 };
  const factor = (n: number, s: number, p: number) => {
    const f = Math.abs(s - p) < 1e-9 ? 1 : (n - p) / (s - p);
    return Math.abs(f) < 0.01 ? Math.sign(f || 1) * 0.01 : f;
  };
  let sx = factor(now.x, start.x, pivot.x), sy = factor(now.y, start.y, pivot.y);
  if (shift) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * s; sy = Math.sign(sy) * s; }
  return scaleAbout(pivot, sx, sy);
}

/** The shown shapes wholly inside the box from `a` to `b` (stage fractions), in list order. */
export function marqueeSelect(show: Shapes, a: Point, b: Point): string[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return show.shapes.filter(s => isShapeShown(show, s) && flatten(s.points).every(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)).map(s => s.id);
}
