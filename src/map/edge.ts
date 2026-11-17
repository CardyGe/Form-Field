/** The pure parts of a shape's edge: when its fade picture must be made again, at what size, and its border colour. */
import type { Shape } from './show';

/** The fade picture depends only on the outline, the holes and the soft edge. */
export const fadeKey = (shape: Shape): string => JSON.stringify([shape.points, shape.holes, shape.softEdge]);

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
