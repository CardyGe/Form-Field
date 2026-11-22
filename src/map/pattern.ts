/**
 * The grid pattern a new shape shows, like a test card: lines in the shape's colour, about every 80 projector
 * pixels, with the centre lines bolder. On a four-corner shape without curves the lines follow its corners, so a
 * shape that is not square to the object shows it at once; other shapes get straight lines across their box.
 */
import { STAGE_SIZE, type Point, type Shape } from './show';
import { isCurved, ringBounds } from './outline';

/** In stage pixels. */
export interface PatternLine { a: Point; b: Point; major: boolean }

const SPACING_PX = 80;
const MAX_HALF = 8;
const toPx = (p: Point): Point => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** An even number of divisions, so the middle line falls on the centre. */
const divisions = (lengthPx: number) => 2 * Math.min(MAX_HALF, Math.max(1, Math.round(lengthPx / (SPACING_PX * 2))));

export function patternLines(shape: Shape): { lines: PatternLine[]; diagonals: PatternLine[] } {
  const lines: PatternLine[] = [];
  if (shape.points.length === 4 && !shape.points.some(isCurved)) {
    const [q0, q1, q2, q3] = shape.points.map(toPx);
    const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const nu = divisions((len(q0, q1) + len(q3, q2)) / 2), nv = divisions((len(q0, q3) + len(q1, q2)) / 2);
    for (let k = 1; k < nu; k++) lines.push({ a: lerp(q0, q1, k / nu), b: lerp(q3, q2, k / nu), major: k * 2 === nu });
    for (let k = 1; k < nv; k++) lines.push({ a: lerp(q0, q3, k / nv), b: lerp(q1, q2, k / nv), major: k * 2 === nv });
    return { lines, diagonals: [{ a: q0, b: q2, major: false }, { a: q1, b: q3, major: false }] };
  }
  const b = ringBounds([shape.points]);
  const x0 = b.x0 * STAGE_SIZE.width, x1 = b.x1 * STAGE_SIZE.width, y0 = b.y0 * STAGE_SIZE.height, y1 = b.y1 * STAGE_SIZE.height;
  const nu = divisions(x1 - x0), nv = divisions(y1 - y0);
  for (let k = 1; k < nu; k++) { const x = x0 + (x1 - x0) * k / nu; lines.push({ a: { x, y: y0 }, b: { x, y: y1 }, major: k * 2 === nu }); }
  for (let k = 1; k < nv; k++) { const y = y0 + (y1 - y0) * k / nv; lines.push({ a: { x: x0, y }, b: { x: x1, y }, major: k * 2 === nv }); }
  return { lines, diagonals: [] };
}

/** `#rrggbb` at an opacity, for the dim background behind the lines. */
const tint = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;

/**
 * Draws the pattern in stage pixels onto a context the caller has already clipped to the shape: a dim fill of the
 * colour, the lines, a bold inner outline and the shape's name in the middle.
 */
export function drawPattern(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, shape: Shape, outline: Path2D): void {
  const b = ringBounds([shape.points]);
  const box = { x: b.x0 * STAGE_SIZE.width, y: b.y0 * STAGE_SIZE.height, w: (b.x1 - b.x0) * STAGE_SIZE.width, h: (b.y1 - b.y0) * STAGE_SIZE.height };
  ctx.save();
  ctx.fillStyle = '#000000'; ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = tint(shape.colour, 0.2); ctx.fillRect(box.x, box.y, box.w, box.h);
  const { lines, diagonals } = patternLines(shape);
  ctx.strokeStyle = tint(shape.colour, 0.45); ctx.lineWidth = 2;
  ctx.beginPath(); for (const l of diagonals) { ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); } ctx.stroke();
  ctx.strokeStyle = shape.colour;
  for (const major of [false, true]) {
    ctx.lineWidth = major ? 5 : 2;
    ctx.beginPath(); for (const l of lines) if (l.major === major) { ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); } ctx.stroke();
  }
  // Twice the width, inside the clip: a 4 px edge on the shape's own outline.
  ctx.lineWidth = 8; ctx.stroke(outline);
  const size = Math.max(10, Math.min(36, box.h / 6, box.w / Math.max(4, shape.name.length * 0.7)));
  ctx.font = `600 ${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  ctx.lineWidth = Math.max(3, size / 5); ctx.strokeStyle = '#000000'; ctx.strokeText(shape.name, c.x, c.y);
  ctx.fillStyle = '#ffffff'; ctx.fillText(shape.name, c.x, c.y);
  ctx.restore();
}

/**
 * The grid pattern drawn flat on a w × h picture, for a pinned shape: seen through the pin's perspective, its evenly
 * spaced lines bunch up towards the far side, as a real grid painted on an angled surface does. The name is left out
 * here: it would be stretched by the perspective.
 */
export function drawFlatPattern(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, colour: string, landedPx: { w: number; h: number }): void {
  ctx.save();
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tint(colour, 0.2); ctx.fillRect(0, 0, w, h);
  // Spacing follows the size the picture lands at on the stage, so a pinned grid matches an unpinned one.
  const nu = divisions(landedPx.w), nv = divisions(landedPx.h);
  const sx = w / Math.max(1, landedPx.w), sy = h / Math.max(1, landedPx.h);
  ctx.strokeStyle = tint(colour, 0.45); ctx.lineWidth = 2 * sx;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h); ctx.stroke();
  ctx.strokeStyle = colour;
  for (const major of [false, true]) {
    ctx.beginPath();
    for (let k = 1; k < nu; k++) if ((k * 2 === nu) === major) { const x = w * k / nu; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.lineWidth = (major ? 5 : 2) * sx; ctx.stroke();
    ctx.beginPath();
    for (let k = 1; k < nv; k++) if ((k * 2 === nv) === major) { const y = h * k / nv; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.lineWidth = (major ? 5 : 2) * sy; ctx.stroke();
  }
  ctx.lineWidth = 8 * Math.max(sx, sy); ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}
