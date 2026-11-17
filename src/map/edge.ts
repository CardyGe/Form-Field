/** The pure parts of a shape's edge: when its fade picture must be made again, at what size, and its border colour. */
import type { Shape } from './show';

/**
 * The fade picture depends only on the outline's form, the holes and the soft edge: not on where the shape is,
 * so moving a soft-edged shape reuses its picture.
 */
export function fadeKey(shape: Shape): string {
  const all = [...shape.points, ...shape.holes.flat()];
  const x0 = Math.min(...all.map(p => p.x)), y0 = Math.min(...all.map(p => p.y));
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const rel = (ring: Shape['points']) => ring.map(p => [r(p.x - x0), r(p.y - y0), p.in?.x, p.in?.y, p.out?.x, p.out?.y]);
  return JSON.stringify([rel(shape.points), shape.holes.map(rel), shape.softEdge]);
}

/** The soft edge actually drawn: never more than a shape's narrower side allows, so a thin shape fades but never vanishes. */
export const effectiveSoftEdge = (softEdge: number, box: { w: number; h: number }) => Math.min(softEdge, Math.min(box.w, box.h) / 1.5);

/** Fades are smooth, so half the projector's resolution is plenty; the picture is stretched when drawn. */
const FADE_SCALE = 0.5;
export function fadeSize(box: { w: number; h: number }): { width: number; height: number; scale: number } {
  return { width: Math.max(1, Math.ceil(box.w * FADE_SCALE)), height: Math.max(1, Math.ceil(box.h * FADE_SCALE)), scale: FADE_SCALE };
}

/** 'shape': the shape's own colour; 'palette': the first colour of what it plays (its own colour when it plays none). */
export function borderColour(shape: Shape, palette: string[] | null): string {
  const c = shape.border.colour;
  if (c === 'shape') return shape.colour;
  if (c === 'palette') return palette?.[0] ?? shape.colour;
  return c;
}
