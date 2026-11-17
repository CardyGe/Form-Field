/**
 * Stage drawing. stageCommands is pure (no canvas, no DOM) and returns plain
 * commands in draw order, in stage pixels. paint only translates them to Canvas 2D.
 * invalidIds is for the operator screen; the caller decides what the wall gets.
 */
import { STAGE_SIZE, type Point, type ShowDocument } from './show';

export interface DrawOptions {
  blackout: boolean; testGrid: boolean; identifyId: string | null; crosshair: Point | null;
  selectedId: string | null; selectedIndex: number | null; outlinesOnly: boolean; invalidIds: string[];
}
/** rect: points = [top-left, bottom-right]; line: points = [from, to]. */
export interface PathCommand {
  kind: 'fill' | 'stroke' | 'text' | 'line' | 'rect';
  shapeId?: string; points?: Point[]; colour?: string; text?: string; at?: Point; width?: number;
}

const GRID = 'rgba(255,255,255,0.35)';
const GRID_NUMBER = 'rgba(255,255,255,0.7)';
const HANDLE = 8;

const px = (p: Point): Point => ({ x: p.x * STAGE_SIZE.width, y: p.y * STAGE_SIZE.height });

export function stageCommands(show: ShowDocument, options: DrawOptions): PathCommand[] {
  const { width: W, height: H } = STAGE_SIZE;
  if (options.blackout) {
    return [{ kind: 'rect', colour: '#000000', points: [{ x: 0, y: 0 }, { x: W, y: H }] }];
  }
  const out: PathCommand[] = [];
  const invalid = new Set(options.invalidIds);

  for (const s of show.shapes) {
    if (!s.visible) continue;
    const points = s.points.map(px);
    if (invalid.has(s.id)) out.push({ kind: 'stroke', shapeId: s.id, points, colour: '#ff0000', width: 3 });
    // The test grid shows each shape's outline in its colour instead of content: no fills.
    else if (options.outlinesOnly || options.testGrid) out.push({ kind: 'stroke', shapeId: s.id, points, colour: s.colour, width: 2 });
    else out.push({ kind: 'fill', shapeId: s.id, points, colour: s.colour });
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
      if (!s.visible || s.points.length === 0) continue;
      out.push({ kind: 'text', text: s.name, at: px(s.points[0]), colour: '#ffffff' });
    }
  }

  const identified = show.shapes.find((s) => s.id === options.identifyId);
  if (identified && identified.visible) {
    out.push({ kind: 'stroke', shapeId: identified.id, points: identified.points.map(px), colour: '#ffffff', width: 6 });
  }

  const selected = show.shapes.find((s) => s.id === options.selectedId);
  if (selected && selected.visible) {
    out.push({ kind: 'stroke', shapeId: selected.id, points: selected.points.map(px), colour: '#ffd400', width: 2 });
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

export function paint(ctx: CanvasRenderingContext2D, show: ShowDocument, options: DrawOptions): void {
  ctx.clearRect(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, STAGE_SIZE.width, STAGE_SIZE.height);
  const trace = (pts: Point[], close: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (close) ctx.closePath();
  };
  for (const c of stageCommands(show, options)) {
    const pts = c.points ?? [];
    switch (c.kind) {
      case 'fill': ctx.fillStyle = c.colour ?? '#fff'; trace(pts, true); ctx.fill(); break;
      case 'stroke': ctx.strokeStyle = c.colour ?? '#fff'; ctx.lineWidth = c.width ?? 1; trace(pts, true); ctx.stroke(); break;
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
