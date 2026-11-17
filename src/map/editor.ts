import { MAX_SHAPES, type Point, type Shape, type ShowDocument } from './show';
import { clampToStage, isValidOutline, nudge, rectangleFromDrag } from './geometry';

export type EditAction =
  | { type: 'addRectangle'; id: string; a: Point; b: Point; colour: string }
  | { type: 'movePoint'; shapeId: string; index: number; to: Point }
  | { type: 'moveShape'; shapeId: string; dx: number; dy: number }   // fractions
  | { type: 'nudgePoint'; shapeId: string; index: number; dxPx: number; dyPx: number }
  | { type: 'rename'; shapeId: string; name: string }
  | { type: 'setColour'; shapeId: string; colour: string }
  | { type: 'setVisible'; shapeId: string; visible: boolean }
  | { type: 'setLocked'; shapeId: string; locked: boolean }
  | { type: 'delete'; shapeId: string };

export type EditResult = { ok: true; show: ShowDocument } | { ok: false; reason: string };

const refuse = (reason: string): EditResult => ({ ok: false, reason });

function nextName(show: ShowDocument): string {
  const names = new Set(show.shapes.map(s => s.name));
  let n = show.shapes.length + 1;
  while (names.has(`Shape ${n}`)) n++;
  return `Shape ${n}`;
}

/** Applies one action to a copy of the show. The input is never changed. */
export function applyEdit(show: ShowDocument, action: EditAction): EditResult {
  const next = structuredClone(show);

  if (action.type === 'addRectangle') {
    if (next.shapes.length >= MAX_SHAPES) return refuse('too-many-shapes');
    if (next.shapes.some(s => s.id === action.id)) return refuse('duplicate-id');
    const points = rectangleFromDrag(clampToStage(action.a), clampToStage(action.b));
    const valid = isValidOutline(points);
    if (!valid.ok) return refuse(valid.reason);
    next.shapes.push({ id: action.id, name: nextName(next), points, colour: action.colour, visible: true, locked: false });
    return { ok: true, show: next };
  }

  const at = next.shapes.findIndex(s => s.id === action.shapeId);
  if (at < 0) return refuse('not-found');
  const shape: Shape = next.shapes[at];

  if (action.type === 'delete') {
    next.shapes.splice(at, 1);
    return { ok: true, show: next };
  }
  if (action.type === 'setVisible') { shape.visible = action.visible; return { ok: true, show: next }; }
  if (action.type === 'setLocked') { shape.locked = action.locked; return { ok: true, show: next }; }

  if (shape.locked) return refuse('locked');

  switch (action.type) {
    case 'rename': shape.name = action.name; return { ok: true, show: next };
    case 'setColour': shape.colour = action.colour; return { ok: true, show: next };
    case 'movePoint':
    case 'nudgePoint': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= shape.points.length) return refuse('not-found');
      shape.points[action.index] = action.type === 'movePoint'
        ? clampToStage(action.to)
        : nudge(shape.points[action.index], action.dxPx, action.dyPx);
      break;
    }
    case 'moveShape': {
      // Shift by the whole requested amount, limited so no point leaves the stage.
      const xs = shape.points.map(p => p.x), ys = shape.points.map(p => p.y);
      const dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), action.dx));
      const dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), action.dy));
      shape.points = shape.points.map(p => clampToStage({ x: p.x + dx, y: p.y + dy })); // clamp only absorbs rounding
      break;
    }
  }

  const valid = isValidOutline(shape.points);
  if (!valid.ok) return refuse(valid.reason);
  return { ok: true, show: next };
}
