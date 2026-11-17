/**
 * Snap: while drawing or dragging, a point jumps to another shape's corner, then to its sides, then to the stage's
 * edges and centre lines, when within reach (in projector pixels; the caller converts its screen reach).
 * Joined corners: corners of different shapes on the same spot, which move together.
 */
import { STAGE_SIZE, isShapeShown, type Group, type Point, type Shape } from './show';
import { flatten } from './outline';

export type SnapTarget = { kind: 'point' | 'side' | 'edge' | 'centre'; at: Point };
export interface SnapResult { at: Point; target: SnapTarget | null }
type Shapes = { shapes: Shape[]; groups: Group[] };

/** Corners within this many projector pixels are on the same spot. */
export const JOIN_PX = 0.5;

const toPx = (p: Point): Point => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });
const fromPx = (p: Point): Point => ({ x: p.x / STAGE_SIZE.width, y: p.y / STAGE_SIZE.height });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The shapes that can be snapped to: shown, and not excluded. */
const targets = (show: Shapes, exclude: { shapeIds: string[] }) => show.shapes.filter(s => isShapeShown(show, s) && !exclude.shapeIds.includes(s.id));

/** The nearest corner and the nearest point on a side, in projector pixels. */
function nearestOnShapes(p: Point, shapes: Shape[]): { point: { at: Point; d: number } | null; side: { at: Point; d: number } | null } {
  let point: { at: Point; d: number } | null = null, side: { at: Point; d: number } | null = null;
  for (const shape of shapes) for (const ring of [shape.points, ...shape.holes]) {
    for (const a of ring) { const q = toPx(a), d = dist(p, q); if (!point || d < point.d) point = { at: q, d }; }
    const flat = flatten(ring).map(toPx);
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i], b = flat[(i + 1) % flat.length], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const q = { x: a.x + dx * u, y: a.y + dy * u }, d = dist(p, q);
      if (!side || d < side.d) side = { at: q, d };
    }
  }
  return { point, side };
}

/** Each direction on its own: the nearest stage edge or centre line within reach. */
function nearestLine(value: number, size: number, reach: number): { to: number; kind: 'edge' | 'centre' } | null {
  let best: { to: number; kind: 'edge' | 'centre'; d: number } | null = null;
  for (const [to, kind] of [[0, 'edge'], [size / 2, 'centre'], [size, 'edge']] as const) {
    const d = Math.abs(value - to);
    if (d <= reach && (!best || d < best.d)) best = { to, kind, d };
  }
  return best;
}

export function snapPoint(at: Point, show: Shapes, exclude: { shapeIds: string[] }, reachPx: number): SnapResult {
  const p = toPx(at);
  const { point, side } = nearestOnShapes(p, targets(show, exclude));
  if (point && point.d <= reachPx) return { at: fromPx(point.at), target: { kind: 'point', at: fromPx(point.at) } };
  if (side && side.d <= reachPx) return { at: fromPx(side.at), target: { kind: 'side', at: fromPx(side.at) } };
  const x = nearestLine(p.x, STAGE_SIZE.width, reachPx), y = nearestLine(p.y, STAGE_SIZE.height, reachPx);
  if (!x && !y) return { at, target: null };
  const snapped = fromPx({ x: x?.to ?? p.x, y: y?.to ?? p.y });
  const kind = (x?.kind === 'centre' || y?.kind === 'centre') && !(x?.kind === 'edge' || y?.kind === 'edge') ? 'centre' : 'edge';
  return { at: snapped, target: { kind, at: snapped } };
}

/**
 * A whole shape (or selection) moved by (dx, dy): the move is adjusted so the corner that comes closest to a target
 * lands on it. Corners and sides first; failing those, each direction snaps to the stage lines on its own.
 */
export function snapMove(points: Point[], dx: number, dy: number, show: Shapes, exclude: { shapeIds: string[] }, reachPx: number): { dx: number; dy: number; target: SnapTarget | null } {
  const others = targets(show, exclude);
  let best: { cx: number; cy: number; d: number; kind: 'point' | 'side'; at: Point } | null = null;
  for (const raw of points) {
    const p = toPx({ x: raw.x + dx, y: raw.y + dy });
    const { point, side } = nearestOnShapes(p, others);
    // A corner within reach beats any side.
    for (const [hit, kind] of [[point, 'point'], [side, 'side']] as const) {
      if (!hit || hit.d > reachPx) continue;
      const better = !best || (kind === 'point' && best.kind === 'side') || (kind === best.kind && hit.d < best.d);
      if (better) best = { cx: hit.at.x - p.x, cy: hit.at.y - p.y, d: hit.d, kind, at: hit.at };
    }
  }
  if (best) return { dx: dx + best.cx / STAGE_SIZE.width, dy: dy + best.cy / STAGE_SIZE.height, target: { kind: best.kind, at: fromPx(best.at) } };
  let bx: { c: number; kind: 'edge' | 'centre' } | null = null, by: { c: number; kind: 'edge' | 'centre' } | null = null;
  for (const raw of points) {
    const p = toPx({ x: raw.x + dx, y: raw.y + dy });
    const x = nearestLine(p.x, STAGE_SIZE.width, reachPx), y = nearestLine(p.y, STAGE_SIZE.height, reachPx);
    if (x && (!bx || Math.abs(x.to - p.x) < Math.abs(bx.c))) bx = { c: x.to - p.x, kind: x.kind };
    if (y && (!by || Math.abs(y.to - p.y) < Math.abs(by.c))) by = { c: y.to - p.y, kind: y.kind };
  }
  if (!bx && !by) return { dx, dy, target: null };
  return { dx: dx + (bx?.c ?? 0) / STAGE_SIZE.width, dy: dy + (by?.c ?? 0) / STAGE_SIZE.height, target: { kind: bx?.kind ?? by!.kind, at: { x: 0, y: 0 } } };
}

/** Other shapes' corners on the same spot as `at` (within JOIN_PX). ring -1 is a shape's outline; 0 and up its holes. */
export function joinedAnchors(show: { shapes: Shape[] }, shapeId: string, at: Point): { shapeId: string; ring: number; index: number }[] {
  const p = toPx(at);
  const out: { shapeId: string; ring: number; index: number }[] = [];
  for (const shape of show.shapes) {
    if (shape.id === shapeId) continue;
    [shape.points, ...shape.holes].forEach((ring, r) => ring.forEach((a, index) => {
      if (dist(toPx(a), p) <= JOIN_PX) out.push({ shapeId: shape.id, ring: r - 1, index });
    }));
  }
  return out;
}
