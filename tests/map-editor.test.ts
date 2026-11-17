import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
import { History } from '../src/map/history';
import { createShow, MAX_SHAPES, type ShowDocument } from '../src/map/show';

const rect = (id: string, a = { x: 0.1, y: 0.1 }, b = { x: 0.3, y: 0.3 }): EditAction => ({ type: 'addRectangle', id, a, b, colour: '#ff0000' });

function withShape(): ShowDocument {
  const r = applyEdit(createShow(), rect('a'));
  assert.ok(r.ok);
  return r.show;
}

test('addRectangle adds numbered, visible, unlocked four-point shapes', () => {
  const r1 = applyEdit(createShow(), rect('a'));
  assert.ok(r1.ok);
  const r2 = applyEdit(r1.show, rect('b'));
  assert.ok(r2.ok);
  assert.deepEqual(r2.show.shapes.map(s => s.name), ['Shape 1', 'Shape 2']);
  const s = r2.show.shapes[0];
  assert.equal(s.points.length, 4);
  assert.equal(s.visible, true);
  assert.equal(s.locked, false);
  assert.equal(s.colour, '#ff0000');
});

test('movePoint that makes a bowtie is refused and leaves the show unchanged', () => {
  const show = withShape();
  const before = structuredClone(show);
  const r = applyEdit(show, { type: 'movePoint', shapeId: 'a', index: 0, to: { x: 0.3, y: 0.3 } });
  assert.deepEqual(r, { ok: false, reason: 'crossing' });
  assert.deepEqual(show, before);
});

test('movePoint with a valid target moves only that point', () => {
  const r = applyEdit(withShape(), { type: 'movePoint', shapeId: 'a', index: 0, to: { x: 0.05, y: 0.05 } });
  assert.ok(r.ok);
  assert.deepEqual(r.show.shapes[0].points[0], { x: 0.05, y: 0.05 });
});

test('unknown shape or point index is not-found', () => {
  const show = withShape();
  assert.deepEqual(applyEdit(show, { type: 'delete', shapeId: 'zzz' }), { ok: false, reason: 'not-found' });
  assert.deepEqual(applyEdit(show, { type: 'movePoint', shapeId: 'a', index: 9, to: { x: 0.2, y: 0.2 } }), { ok: false, reason: 'not-found' });
  assert.deepEqual(applyEdit(show, { type: 'nudgePoint', shapeId: 'a', index: -1, dxPx: 1, dyPx: 0 }), { ok: false, reason: 'not-found' });
});

test('locked shapes refuse move, rename and recolour but allow visibility and lock toggles', () => {
  const locked = applyEdit(withShape(), { type: 'setLocked', shapeId: 'a', locked: true });
  assert.ok(locked.ok);
  const show = locked.show;
  const refused: EditAction[] = [
    { type: 'moveShape', shapeId: 'a', dx: 0.1, dy: 0 },
    { type: 'movePoint', shapeId: 'a', index: 0, to: { x: 0.05, y: 0.05 } },
    { type: 'nudgePoint', shapeId: 'a', index: 0, dxPx: 1, dyPx: 0 },
    { type: 'rename', shapeId: 'a', name: 'x' },
    { type: 'setColour', shapeId: 'a', colour: '#00ff00' },
  ];
  for (const action of refused) assert.deepEqual(applyEdit(show, action), { ok: false, reason: 'locked' }, action.type);
  assert.ok(applyEdit(show, { type: 'setVisible', shapeId: 'a', visible: false }).ok);
  assert.ok(applyEdit(show, { type: 'setLocked', shapeId: 'a', locked: false }).ok);
});

test('moveShape that would leave the stage translates the whole shape without distorting it', () => {
  const show = withShape();
  const r = applyEdit(show, { type: 'moveShape', shapeId: 'a', dx: 5, dy: -5 });
  assert.ok(r.ok);
  const pts = r.show.shapes[0].points;
  assert.equal(Math.max(...pts.map(p => p.x)), 1);
  assert.equal(Math.min(...pts.map(p => p.y)), 0);
  const orig = show.shapes[0].points;
  for (let i = 0; i < pts.length; i++) {
    assert.ok(Math.abs((pts[i].x - pts[0].x) - (orig[i].x - orig[0].x)) < 1e-9);
    assert.ok(Math.abs((pts[i].y - pts[0].y) - (orig[i].y - orig[0].y)) < 1e-9);
  }
});

test('nudgePoint moves by projector pixels', () => {
  const r = applyEdit(withShape(), { type: 'nudgePoint', shapeId: 'a', index: 0, dxPx: 192, dyPx: 108 });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.show.shapes[0].points[0].x - 0.2) < 1e-9);
  assert.ok(Math.abs(r.show.shapes[0].points[0].y - 0.2) < 1e-9);
});

test('rename, setColour, setVisible and delete work', () => {
  let show = withShape();
  const step = (action: EditAction) => { const r = applyEdit(show, action); assert.ok(r.ok); show = r.show; };
  step({ type: 'rename', shapeId: 'a', name: 'Wall' });
  step({ type: 'setColour', shapeId: 'a', colour: '#00ff00' });
  step({ type: 'setVisible', shapeId: 'a', visible: false });
  assert.deepEqual([show.shapes[0].name, show.shapes[0].colour, show.shapes[0].visible], ['Wall', '#00ff00', false]);
  step({ type: 'delete', shapeId: 'a' });
  assert.equal(show.shapes.length, 0);
});

test('adding a 65th shape is refused', () => {
  let show = createShow();
  for (let i = 0; i < MAX_SHAPES; i++) {
    const r = applyEdit(show, rect(`s${i}`));
    assert.ok(r.ok);
    show = r.show;
  }
  assert.deepEqual(applyEdit(show, rect('extra')), { ok: false, reason: 'too-many-shapes' });
});

test('a degenerate rectangle is refused with the outline reason', () => {
  const r = applyEdit(createShow(), rect('flat', { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.5 }));
  assert.equal(r.ok, false);
});

test('applyEdit never mutates its input', () => {
  const show = withShape();
  const before = structuredClone(show);
  applyEdit(show, { type: 'moveShape', shapeId: 'a', dx: 0.1, dy: 0.1 });
  applyEdit(show, { type: 'rename', shapeId: 'a', name: 'x' });
  applyEdit(show, { type: 'delete', shapeId: 'a' });
  applyEdit(show, rect('b'));
  assert.deepEqual(show, before);
});

test('History: commit, undo, redo', () => {
  const h = new History<number>(1);
  assert.equal(h.canUndo(), false);
  h.commit(2); h.commit(3);
  assert.equal(h.present(), 3);
  assert.ok(h.undo()); assert.equal(h.present(), 2);
  assert.ok(h.canRedo());
  assert.ok(h.redo()); assert.equal(h.present(), 3);
  assert.equal(h.redo(), false);
});

test('History: a commit after undo drops the redo branch', () => {
  const h = new History<number>(1);
  h.commit(2); h.commit(3);
  h.undo();
  h.commit(9);
  assert.equal(h.canRedo(), false);
  assert.equal(h.present(), 9);
  h.undo();
  assert.equal(h.present(), 2);
});

test('History: limit 3 keeps the last 3', () => {
  const h = new History<number>(0, 3);
  for (let i = 1; i <= 5; i++) h.commit(i);
  assert.equal(h.present(), 5);
  assert.ok(h.undo()); assert.ok(h.undo());
  assert.equal(h.present(), 3);
  assert.equal(h.undo(), false);
});
