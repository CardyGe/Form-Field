/**
 * Stage drawing. stageCommands is pure (no canvas, no DOM) and returns plain
 * commands in draw order, in stage pixels. paint only translates them to Canvas 2D.
 * invalidIds is for the operator screen; the caller decides what the wall gets.
 */
import { STAGE_SIZE, isShapeShown, type Group, type Point, type Ring, type Shape } from './show';

/** Drawing needs only the shapes and groups, so it takes a stored show or the show as the wall receives it. */
type Shapes = { shapes: Shape[]; groups: Group[] };

/**
 * solo: when not empty, only these shapes are drawn (on the wall too). operator: drawing for the operator screen,
 * where a Blocker is hatched so it can still be seen.
 */
export interface DrawOptions {
  blackout: boolean; testGrid: boolean; identifyId: string | null; crosshair: Point | null;
  selectedId: string | null; selectedIndex: number | null; outlinesOnly: boolean; invalidIds: string[];
  solo?: string[]; operator?: boolean;
}
/**
 * rect: points = [top-left, bottom-right]; line: points = [from, to].
 * fill, hatch and stroke: points is the outline's corners; rings is the outline then its holes, with curve handles,
 * all in stage pixels. Holes are cut with the even-odd rule.
 */
export interface PathCommand {
  kind: 'fill' | 'hatch' | 'stroke' | 'text' | 'line' | 'rect';
  shapeId?: string; points?: Point[]; rings?: Ring[]; colour?: string; text?: string; at?: Point; width?: number;
}

/** Whether a shape reaches the picture: shown (with its group), and soloed when anything is. */
export function shownOnWall(show: { groups: Group[] }, shape: Shape, solo: string[] | undefined): boolean {
  return isShapeShown(show, shape) && (!solo || solo.length === 0 || solo.includes(shape.id));
}
/** A ring in stage pixels, handles included. */
export const ringPx = (ring: Ring): Ring => ring.map(p => {
  const q: Ring[number] = { x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height };
  if (p.in) q.in = { x: p.in.x * STAGE_SIZE.width, y: p.in.y * STAGE_SIZE.height };
  if (p.out) q.out = { x: p.out.x * STAGE_SIZE.width, y: p.out.y * STAGE_SIZE.height };
  return q;
});
const outlineOf = (s: Shape) => ({ points: s.points.map(px), rings: [s.points, ...s.holes].map(ringPx) });
const BLOCKER_OUTLINE = '#808080';

const GRID = 'rgba(255,255,255,0.35)';
const GRID_NUMBER = 'rgba(255,255,255,0.7)';
const HANDLE = 8;

const px = (p: Point): Point => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });

export function stageCommands(show: Shapes, options: DrawOptions): PathCommand[] {
  const { width: W, height: H } = STAGE_SIZE;
  if (options.blackout) {
    return [{ kind: 'rect', colour: '#000000', points: [{ x: 0, y: 0 }, { x: W, y: H }] }];
  }
  const out: PathCommand[] = [];
  const invalid = new Set(options.invalidIds);

  const shown = (s: Shape) => shownOnWall(show, s, options.solo);
  for (const s of show.shapes) {
    if (!shown(s)) continue;
    const outline = outlineOf(s);
    if (invalid.has(s.id)) out.push({ kind: 'stroke', shapeId: s.id, ...outline, colour: '#ff0000', width: 3 });
    // The test grid shows each shape's outline in its colour instead of content: no fills.
    else if (options.outlinesOnly || options.testGrid) out.push({ kind: 'stroke', shapeId: s.id, ...outline, colour: s.blocker ? BLOCKER_OUTLINE : s.colour, width: 2 });
    // A Blocker blacks out what is beneath it; on the operator screen it is hatched so it can still be seen.
    else if (s.blocker) out.push({ kind: options.operator ? 'hatch' : 'fill', shapeId: s.id, ...outline, colour: '#000000' });
    else out.push({ kind: 'fill', shapeId: s.id, ...outline, colour: s.colour });
  }

  if (options.testGrid) {
    // Every tenth of the stage, each line numbered with its position in projector pixels.
    for (let i = 1; i < 10; i++) {
      const x = (W * i) / 10, y = (H * i) / 10;
      out.push({ kind: 'line', colour: GRID, width: 1, points: [{ x, y: 0 }, { x, y: H }] });
      out.push({ kind: 'text', text: String(Math.round(x)), at: { x, y: 0 }, colour: GRID_NUMBER });
      out.push({ kind: 'line', colour: GRID, width: 1, points: [{ x: 0, y }, { x: W, y }] });
      out.push({ kind: 'text', text: String(Math.round(y)), at: { x: 0, y }, colour: GRID_NUMBER });
    }
    for (const s of show.shapes) {
      if (!shown(s) || s.points.length === 0) continue;
      out.push({ kind: 'text', text: s.name, at: px(s.points[0]), colour: '#ffffff' });
    }
  }

  const identified = show.shapes.find((s) => s.id === options.identifyId);
  if (identified && shown(identified)) {
    out.push({ kind: 'stroke', shapeId: identified.id, ...outlineOf(identified), colour: '#ffffff', width: 6 });
  }

  // A refused outline keeps its red: the selection outline is not drawn over it.
  const selected = show.shapes.find((s) => s.id === options.selectedId && !invalid.has(s.id));
  if (selected && shown(selected)) {
    out.push({ kind: 'stroke', shapeId: selected.id, ...outlineOf(selected), colour: '#ffd400', width: 2 });
    const p = options.selectedIndex === null ? undefined : selected.points[options.selectedIndex];
    if (p) {
      const c = px(p);
      out.push({ kind: 'rect', shapeId: selected.id, colour: '#ffd400',
        points: [{ x: c.x - HANDLE, y: c.y - HANDLE }, { x: c.x + HANDLE, y: c.y + HANDLE }] });
    }
  }

  if (options.crosshair) {
    const c = px(options.crosshair);
    out.push({ kind: 'line', colour: '#00ffff', width: 2, points: [{ x: c.x, y: 0 }, { x: c.x, y: H }] });
    out.push({ kind: 'line', colour: '#00ffff', width: 2, points: [{ x: 0, y: c.y }, { x: W, y: c.y }] });
  }
  return out;
}

/** Draws stage commands onto a 2D context, in order. */
export function drawCommands(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, commands: PathCommand[]): void {
  const trace = (pts: Point[], close: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (close) ctx.closePath();
  };
  const shapePath = (c: PathCommand) => { ctx.beginPath(); for (const ring of c.rings ?? [c.points ?? []]) traceRing(ctx, ring); };
  for (const c of commands) {
    const pts = c.points ?? [];
    switch (c.kind) {
      case 'fill': ctx.fillStyle = c.colour ?? '#fff'; shapePath(c); ctx.fill('evenodd'); break;
      case 'hatch': {
        ctx.save();
        shapePath(c); ctx.clip('evenodd');
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fill('evenodd');
        // Diagonal lines every 24 stage pixels across the shape's box.
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        ctx.strokeStyle = 'rgba(160,160,160,0.6)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let k = x0 - (y1 - y0); k < x1; k += 24) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = BLOCKER_OUTLINE; ctx.lineWidth = 2; shapePath(c); ctx.stroke();
        break;
      }
      case 'stroke': ctx.strokeStyle = c.colour ?? '#fff'; ctx.lineWidth = c.width ?? 1; shapePath(c); ctx.stroke(); break;
      case 'line': ctx.strokeStyle = c.colour ?? '#fff'; ctx.lineWidth = c.width ?? 1; trace(pts, false); ctx.stroke(); break;
      case 'rect':
        if (pts.length === 2) { ctx.fillStyle = c.colour ?? '#fff'; ctx.fillRect(pts[0].x, pts[0].y, pts[1].x - pts[0].x, pts[1].y - pts[0].y); }
        break;
      case 'text':
        if (c.at) { ctx.fillStyle = c.colour ?? '#fff'; ctx.font = '28px sans-serif'; ctx.fillText(c.text ?? '', c.at.x + 6, c.at.y + 30); }
        break;
    }
  }
}

/** One closed ring onto the current path: straight sides as lines, curved sides as cubic curves. Stage pixels. */
export function traceRing(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | Path2D, ring: Ring): void {
  if (!ring.length) return;
  ctx.moveTo(ring[0].x, ring[0].y);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a.out || b.in) ctx.bezierCurveTo(a.x + (a.out?.x ?? 0), a.y + (a.out?.y ?? 0), b.x + (b.in?.x ?? 0), b.y + (b.in?.y ?? 0), b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  }
  ctx.closePath();
}

/** `background`, when given, is drawn first and stretched to the stage: the operator screen passes the wall's picture. */
export function paint(ctx: CanvasRenderingContext2D, show: Shapes, options: DrawOptions, background?: CanvasImageSource): void {
  ctx.clearRect(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
  if (background) { try { ctx.drawImage(background, 0, 0, STAGE_SIZE.width, STAGE_SIZE.height); } catch { /* a picture that cannot be drawn leaves the black stage */ } }
  drawCommands(ctx, stageCommands(show, options));
}
