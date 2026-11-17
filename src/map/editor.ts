import { MAX_NAME_LENGTH, MAX_SHAPES, STAGE_SIZE, type Point, type Shape, type ShowDocument } from './show';
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
  | { type: 'delete'; shapeId: string }
  | { type: 'duplicate'; shapeId: string; id: string }
  | { type: 'reorder'; shapeId: string; to: 'front' | 'back' | 'forward' | 'backward' };

export type EditResult = { ok: true; show: ShowDocument } | { ok: false; reason: string };

const refuse = (reason: string): EditResult => ({ ok: false, reason });

function nextName(show: ShowDocument): string {
  const names = new Set(show.shapes.map(s => s.name));
  let n = show.shapes.length + 1;
  while (names.has(`Shape ${n}`)) n++;
  return `Shape ${n}`;
}

const COPY_STEP = { x: 20 / STAGE_SIZE.width, y: 20 / STAGE_SIZE.height }; // 20 projector pixels

/** "Name copy", shortened so it stays within the name limit. */
const copyName = (name: string) => `${name.slice(0, MAX_NAME_LENGTH - ' copy'.length)} copy`;

/** The corners moved 20 projector pixels down and right, or up and left on an axis where that would leave the stage. */
function copyPoints(points: Point[]): Point[] {
  const step = (values: number[], size: number) => Math.max(...values) + size <= 1 ? size : Math.min(...values) - size >= 0 ? -size : 0;
  const dx = step(points.map(p => p.x), COPY_STEP.x), dy = step(points.map(p => p.y), COPY_STEP.y);
  return points.map(p => clampToStage({ x: p.x + dx, y: p.y + dy }));
}

/** The edited copy and the shape whose outline must be checked, or why the edit cannot be made at all. */
type Staged = { show: ShowDocument; touched: Shape | null } | { reason: string };

/** Makes the change on a copy, without checking the outline. The input is never changed. */
function stage(show: ShowDocument, action: EditAction): Staged {
  const next = structuredClone(show);

  if (action.type === 'addRectangle') {
    if (next.shapes.length >= MAX_SHAPES) return { reason: 'too-many-shapes' };
    if (next.shapes.some(s => s.id === action.id)) return { reason: 'duplicate-id' };
    const shape: Shape = { id: action.id, name: nextName(next), points: rectangleFromDrag(clampToStage(action.a), clampToStage(action.b)), colour: action.colour, visible: true, locked: false, sourceId: null };
    next.shapes.push(shape);
    return { show: next, touched: shape };
  }

  const at = next.shapes.findIndex(s => s.id === action.shapeId);
  if (at < 0) return { reason: 'not-found' };
  const shape: Shape = next.shapes[at];

  if (action.type === 'setVisible') { shape.visible = action.visible; return { show: next, touched: null }; }
  // A copy leaves the original untouched, so a locked shape can be copied; the copy starts unlocked, just above it.
  if (action.type === 'duplicate') {
    if (next.shapes.length >= MAX_SHAPES) return { reason: 'too-many-shapes' };
    if (next.shapes.some(s => s.id === action.id)) return { reason: 'duplicate-id' };
    const copy: Shape = { ...structuredClone(shape), id: action.id, name: copyName(shape.name), visible: true, locked: false, points: copyPoints(shape.points) };
    next.shapes.splice(at + 1, 0, copy);
    return { show: next, touched: copy };
  }
  if (action.type === 'setLocked') { shape.locked = action.locked; return { show: next, touched: null }; }

  // Lock protects everything else, deleting included.
  if (shape.locked) return { reason: 'locked' };

  switch (action.type) {
    case 'delete': next.shapes.splice(at, 1); return { show: next, touched: null };
    case 'rename':
      if (action.name.length > MAX_NAME_LENGTH) return { reason: 'name-too-long' };
      shape.name = action.name; return { show: next, touched: null };
    case 'setColour': shape.colour = action.colour; return { show: next, touched: null };
    case 'reorder': {
      // Later in the list is drawn on top. At the edge already, nothing moves.
      next.shapes.splice(at, 1);
      const to = action.to === 'front' ? next.shapes.length : action.to === 'back' ? 0
        : action.to === 'forward' ? Math.min(next.shapes.length, at + 1) : Math.max(0, at - 1);
      next.shapes.splice(to, 0, shape);
      return { show: next, touched: null };
    }
    case 'movePoint':
    case 'nudgePoint': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= shape.points.length) return { reason: 'not-found' };
      shape.points[action.index] = action.type === 'movePoint'
        ? clampToStage(action.to)
        : nudge(shape.points[action.index], action.dxPx, action.dyPx);
      return { show: next, touched: shape };
    }
    case 'moveShape': {
      // Shift by the whole requested amount, limited so no point leaves the stage.
      const xs = shape.points.map(p => p.x), ys = shape.points.map(p => p.y);
      const dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), action.dx));
      const dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), action.dy));
      shape.points = shape.points.map(p => clampToStage({ x: p.x + dx, y: p.y + dy })); // clamp only absorbs rounding
      return { show: next, touched: shape };
    }
  }
}

/** Applies one action to a copy of the show. The input is never changed. */
export function applyEdit(show: ShowDocument, action: EditAction): EditResult {
  const staged = stage(show, action);
  if ('reason' in staged) return refuse(staged.reason);
  if (staged.touched) {
    const valid = isValidOutline(staged.touched.points);
    if (!valid.ok) return refuse(valid.reason);
  }
  return { ok: true, show: staged.show };
}

/**
 * The show an edit would leave, even when its outline would be refused, so the operator screen can draw
 * the refused outline in red. Null when the edit is refused for any other reason, or changes no outline.
 */
export function attemptEdit(show: ShowDocument, action: EditAction): { show: ShowDocument; shapeId: string } | null {
  const staged = stage(show, action);
  if ('reason' in staged || !staged.touched) return null;
  return { show: staged.show, shapeId: staged.touched.id };
}
