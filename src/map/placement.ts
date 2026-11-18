/**
 * Where a shape's picture lands on the stage, in projector pixels: a transform from the picture's own square
 * (0..1 each way, origin top-left) onto the stage. Fit and the Across placements are plain (no perspective);
 * Pin is perspective onto four corners. Pure.
 */
import { STAGE_SIZE, type Group, type Point, type Shape } from './show';
import { orderQuad, ringBounds } from './outline';
import { apply, isPinnable, squareToQuad, type H3 } from './homography';

export interface Landing { h: H3; perspective: boolean }

const toPx = (p: Point): Point => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });
const boxOf = (shapes: Shape[]) => {
  const b = ringBounds(shapes.map(s => s.points));
  return { x: b.x0 * STAGE_SIZE.width, y: b.y0 * STAGE_SIZE.height, w: (b.x1 - b.x0) * STAGE_SIZE.width, h: (b.y1 - b.y0) * STAGE_SIZE.height };
};

/** A box with zoom, move and turn: the picture's square laid on it, as a plain transform. */
function boxLanding(box: { x: number; y: number; w: number; h: number }, shape: Shape): Landing {
  const { zoom, offset, turn } = shape.placement;
  const c = { x: box.x + box.w / 2 + offset.x * STAGE_SIZE.width, y: box.y + box.h / 2 + offset.y * STAGE_SIZE.height };
  const r = turn * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const w = box.w * zoom, h = box.h * zoom;
  // The picture's u and v directions on the stage, and its top-left corner.
  const u = { x: w * cos, y: w * sin }, v = { x: -h * sin, y: h * cos };
  const tl = { x: c.x - u.x / 2 - v.x / 2, y: c.y - u.y / 2 - v.y / 2 };
  return { h: [u.x, v.x, tl.x, u.y, v.y, tl.y, 0, 0, 1], perspective: false };
}

/** A four-point shape whose own corners can carry a picture pins by them. */
export const ownCornersPinnable = (shape: Shape): boolean => shape.points.length === 4 && isPinnable(orderQuad(shape.points).map(toPx)).ok;
/** The four corners a Pin uses, in projector pixels: the shape's own four points when they can carry a picture, else its stored pin, else its box. */
export function pinCorners(shape: Shape): Point[] {
  if (ownCornersPinnable(shape)) return orderQuad(shape.points).map(toPx);
  if (shape.placement.pin) return shape.placement.pin.map(toPx);
  const b = boxOf([shape]);
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}

export function landing(shape: Shape, show: { shapes: Shape[]; groups: Group[] }): Landing {
  const kind = shape.placement.kind;
  if (kind === 'pin') {
    const h = squareToQuad(pinCorners(shape));
    if (h) return { h, perspective: true };
    // A pin that cannot carry a picture (the editor refuses these) falls back to Fit, never to nothing.
  }
  if (kind === 'across-stage' || (kind === 'across-group' && shape.groupId === null)) return boxLanding({ x: 0, y: 0, w: STAGE_SIZE.width, h: STAGE_SIZE.height }, shape);
  if (kind === 'across-group') return boxLanding(boxOf(show.shapes.filter(s => s.groupId === shape.groupId)), shape);
  return boxLanding(boxOf([shape]), shape);
}

/** Sizes go up in steps, so dragging a shape does not resize its instrument (and reset its history) on every move. */
const SIZE_STEP = 16;
const MIN_SIDE = 64;
const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The pixel size to draw a source at: the largest place it lands (its picture's side lengths on the stage), times the governor's scale. */
export function sourceSizeFor(landings: Landing[], scale: number): { width: number; height: number } {
  let w = 0, h = 0;
  for (const l of landings) {
    const p00 = apply(l.h, { x: 0, y: 0 }), p10 = apply(l.h, { x: 1, y: 0 }), p01 = apply(l.h, { x: 0, y: 1 }), p11 = apply(l.h, { x: 1, y: 1 });
    w = Math.max(w, len(p00, p10), len(p01, p11));
    h = Math.max(h, len(p00, p01), len(p10, p11));
  }
  const side = (span: number, stage: number) => Math.min(stage, Math.max(MIN_SIDE, Math.ceil(span * scale / SIZE_STEP) * SIZE_STEP));
  return { width: side(w, STAGE_SIZE.width), height: side(h, STAGE_SIZE.height) };
}

/**
 * Live in Map: Live draws at its own shape (16:9). On a place of another shape its picture covers it and the overflow
 * is cropped, never stretched. Maps the landing's 0..1 square onto the centred part of the picture that covers it.
 */
export function coverCrop(landAspect: number, pictureAspect: number): H3 {
  if (!(landAspect > 0) || !(pictureAspect > 0) || Math.abs(landAspect - pictureAspect) < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (landAspect < pictureAspect) { const w = landAspect / pictureAspect; return [w, 0, (1 - w) / 2, 0, 1, 0, 0, 0, 1]; }
  const h = pictureAspect / landAspect;
  return [1, 0, 0, 0, h, (1 - h) / 2, 0, 0, 1];
}

/** Width over height of the place a picture lands, in stage pixels (measured along its first two sides). */
export function landingAspect(l: Landing): number {
  const o = apply(l.h, { x: 0, y: 0 }), x = apply(l.h, { x: 1, y: 0 }), y = apply(l.h, { x: 0, y: 1 });
  const w = Math.hypot(x.x - o.x, x.y - o.y), h = Math.hypot(y.x - o.x, y.y - o.y);
  return w > 0 && h > 0 ? w / h : 1;
}
