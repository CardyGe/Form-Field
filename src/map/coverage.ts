/**
 * The 2D pictures the wall's graphics-card compositor reuses until a shape changes: its coverage (outline and holes,
 * with its soft edge), its border, and its own fill (plain colour or grid pattern). Each is drawn over the shape's box.
 */
import { ringPx, traceRing } from './draw';
import { drawFlatPattern, drawPattern } from './pattern';
import { effectiveSoftEdge, fadeSize } from './edge';
import type { Shape } from './show';

export interface Box { x: number; y: number; w: number; h: number }
/** Pictures are at most this many pixels a side, which a shape on a 1920 × 1080 stage never needs. */
const MAX_SIDE = 4096;

export function outlinePath(shape: Shape): Path2D {
  const path = new Path2D();
  for (const ring of [shape.points, ...shape.holes]) traceRing(path, ringPx(ring));
  return path;
}

/** A canvas over the box at `scale` pixels per stage pixel, with its context drawing in stage pixels. */
function over(box: Box, scale: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const w = Math.max(1, Math.min(MAX_SIDE, Math.ceil(box.w * scale))), h = Math.max(1, Math.min(MAX_SIDE, Math.ceil(box.h * scale)));
  const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d')!;
  ctx.setTransform(w / Math.max(box.w, 1e-6), 0, 0, h / Math.max(box.h, 1e-6), -box.x * w / Math.max(box.w, 1e-6), -box.y * h / Math.max(box.h, 1e-6));
  return { canvas, ctx };
}

/**
 * White where the shape shows. With a soft edge: worn back by 0.6 of it and blurred by a quarter of it, then cut by
 * the outline again, so under 1 % is left at the outline; made at half resolution, since a fade is smooth.
 */
export function coveragePicture(shape: Shape, path: Path2D, box: Box): OffscreenCanvas {
  if (shape.softEdge <= 0) {
    const { canvas, ctx } = over(box, 1);
    ctx.fillStyle = '#ffffff'; ctx.fill(path, 'evenodd');
    return canvas;
  }
  const soft = effectiveSoftEdge(shape.softEdge, box), { scale } = fadeSize(box);
  const worn = over(box, scale);
  worn.ctx.fillStyle = '#ffffff'; worn.ctx.fill(path, 'evenodd');
  worn.ctx.globalCompositeOperation = 'destination-out'; worn.ctx.lineWidth = soft * 1.2; worn.ctx.lineJoin = 'round'; worn.ctx.stroke(path);
  const out = over(box, scale), c = out.ctx;
  const t = c.getTransform();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.filter = `blur(${Math.max(0.5, soft / 4 * scale)}px)`;
  c.drawImage(worn.canvas, 0, 0);
  c.filter = 'none';
  c.setTransform(t);
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = '#ffffff'; c.fill(path, 'evenodd');
  return out.canvas;
}

/** The border inside the outline (the outer half of a stroke twice as wide is cut away), with its glow. */
export function borderPicture(shape: Shape, path: Path2D, box: Box, colour: string): OffscreenCanvas {
  const { canvas, ctx } = over(box, 1);
  ctx.save();
  ctx.clip(path, 'evenodd');
  ctx.strokeStyle = colour; ctx.lineWidth = shape.border.width * 2; ctx.lineJoin = 'round';
  if (shape.border.glow > 0) { ctx.shadowColor = colour; ctx.shadowBlur = shape.border.glow; }
  ctx.stroke(path);
  ctx.restore();
  return canvas;
}

/** The grid pattern over the box, its lines following a four-corner shape's corners (Fit and the Across placements). */
export function patternPicture(shape: Shape, path: Path2D, box: Box): OffscreenCanvas {
  const { canvas, ctx } = over(box, 1);
  ctx.save(); ctx.clip(path, 'evenodd'); drawPattern(ctx, shape, path); ctx.restore();
  return canvas;
}

/** The grid pattern flat, for a pinned shape: the perspective bends it. landed: the size it lands at on the stage. */
export function flatPatternPicture(shape: Shape, landed: { w: number; h: number }): OffscreenCanvas {
  const w = Math.max(64, Math.min(2048, Math.ceil(landed.w))), h = Math.max(64, Math.min(2048, Math.ceil(landed.h)));
  const canvas = new OffscreenCanvas(w, h);
  drawFlatPattern(canvas.getContext('2d')!, w, h, shape.colour, landed);
  return canvas;
}
