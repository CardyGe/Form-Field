import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
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

// Output messages
import { acceptMapMessage, toWire, MAP_MESSAGE_LIMIT } from '../src/map/messages';

test('acceptMapMessage accepts each known message type', () => {
  assert.ok(acceptMapMessage({ type: 'show', show: createShow() }));
  assert.ok(acceptMapMessage({ type: 'blackout', on: true }));
  assert.ok(acceptMapMessage({ type: 'testGrid', on: false }));
  assert.ok(acceptMapMessage({ type: 'identify', shapeId: 'a' }));
  assert.ok(acceptMapMessage({ type: 'identify', shapeId: null }));
  assert.ok(acceptMapMessage({ type: 'crosshair', point: { x: 0.5, y: 0.5 }, shapeId: 'a' }));
});

test('acceptMapMessage accepts a crosshair with a null point', () => {
  assert.ok(acceptMapMessage({ type: 'crosshair', point: null, shapeId: null }));
});

test('acceptMapMessage refuses unknown types, bad fields and non-objects', () => {
  assert.equal(acceptMapMessage({ type: 'explode' }), false);
  assert.equal(acceptMapMessage({ type: 'blackout', on: 'yes' }), false);
  assert.equal(acceptMapMessage({ type: 'identify', shapeId: 3 }), false);
  assert.equal(acceptMapMessage({ type: 'crosshair', point: { x: 1 }, shapeId: null }), false);
  assert.equal(acceptMapMessage({ type: 'show' }), false);
  assert.equal(acceptMapMessage(null), false);
  assert.equal(acceptMapMessage([]), false);
});

test('acceptMapMessage refuses a message over the size limit and one that cannot be stringified', () => {
  const show = { ...createShow(), padding: 'n'.repeat(MAP_MESSAGE_LIMIT) };
  assert.equal(acceptMapMessage({ type: 'show', show }), false);
  const loop: Record<string, unknown> = { type: 'blackout', on: true };
  loop.self = loop;
  assert.equal(acceptMapMessage(loop), false);
});

import { autosaveSchedule } from '../src/map/autosave';

test('autosaveSchedule: two saves within 200 ms write once, with the latest value', async () => {
  const written: string[] = [];
  const schedule = autosaveSchedule<string>(value => { written.push(value); }, 50);
  schedule.save('first');
  await new Promise(r => setTimeout(r, 20));
  schedule.save('second');
  await new Promise(r => setTimeout(r, 120));
  assert.deepEqual(written, ['second']);
});

test('autosaveSchedule: flush writes a pending value at once and cancel drops it', async () => {
  const written: string[] = [];
  const schedule = autosaveSchedule<string>(value => { written.push(value); }, 50);
  schedule.save('a');
  schedule.flush();
  assert.deepEqual(written, ['a']);
  schedule.save('b');
  schedule.cancel();
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(written, ['a']);
});

import { canEdit } from '../src/map/autosave';

test('autosaveSchedule: a flush before the delay writes once and the timer does not write again', async () => {
  const written: string[] = [];
  const schedule = autosaveSchedule<string>(value => { written.push(value); }, 50);
  schedule.save('x');
  schedule.flush();
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(written, ['x']);
});

test('canEdit: edits are refused until the saved show has loaded', () => {
  assert.equal(canEdit(false), false);
  assert.equal(canEdit(true), true);
});

test('mapReducer: an edit followed by undo returns the original show, and redo brings it back', async () => {
  const { mapReducer, initialMapState } = await import('../src/map/state');
  const start = createShow();
  let state = initialMapState(start);
  state = mapReducer(state, { type: 'edit', action: rect('a') });
  assert.equal(state.show.shapes.length, 1);
  assert.equal(state.refusal, null);
  state = mapReducer(state, { type: 'undo' });
  assert.deepEqual(state.show, start);
  state = mapReducer(state, { type: 'redo' });
  assert.equal(state.show.shapes.length, 1);
  // a refused edit changes nothing but records why; a new edit clears redo
  const refused = mapReducer(state, { type: 'edit', action: { type: 'delete', shapeId: 'nope' } });
  assert.equal(refused.show, state.show);
  assert.equal(refused.refusal, 'not-found');
  state = mapReducer(mapReducer(state, { type: 'undo' }), { type: 'edit', action: rect('b') });
  assert.equal(state.future.length, 0);
  assert.equal(mapReducer(initialMapState(start), { type: 'undo' }).show, start);
});

test('autosaveSchedule: a flush while a write is in flight resolves only after that write finishes', async () => {
  let release!: () => void;
  const written: string[] = [];
  const schedule = autosaveSchedule<string>(value => new Promise<void>(resolve => { release = () => { written.push(value); resolve(); }; }), 10);
  schedule.save('slow');
  await new Promise(r => setTimeout(r, 30)); // the timer has started the write; it has not finished
  let flushed = false;
  const flushing = schedule.flush().then(() => { flushed = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(flushed, false);
  release();
  await flushing;
  assert.equal(flushed, true);
  assert.deepEqual(written, ['slow']);
});

test('autosaveSchedule: flush rejects when the write fails, and the next flush writes the value again', async () => {
  const attempts: string[] = [];
  let fail = true;
  const schedule = autosaveSchedule<string>(async value => { attempts.push(value); if (fail) throw new Error('disk full'); }, 10);
  schedule.save('a');
  await assert.rejects(schedule.flush(), /disk full/);
  fail = false;
  await schedule.flush();
  assert.deepEqual(attempts, ['a', 'a']);
});

test('autosaveSchedule: a failed timer write makes the next flush reject until it succeeds', async () => {
  let fail = true;
  const schedule = autosaveSchedule<string>(async () => { if (fail) throw new Error('disk full'); }, 10);
  schedule.save('a');
  await new Promise(r => setTimeout(r, 40));
  await assert.rejects(schedule.flush(), /disk full/);
  fail = false;
  await schedule.flush();
  await schedule.flush(); // nothing waiting and the last write succeeded
});

test('toWire: a 64-shape show with full-precision corners fits in one message after rounding', () => {
  const colours = ['#ff3b30', '#34c759', '#0a84ff', '#ffcc00', '#bf5af2', '#ff9f0a'];
  const shapes = Array.from({ length: 64 }, (_, i) => {
    // Corners as a drag leaves them: long fractions such as 0.31770833333333337.
    const x0 = (37 + i * 23.3) / 1920 + 1 / 3e5, y0 = (41 + i * 13.7) / 1080 + 1 / 7e5;
    const x1 = x0 + 211.7 / 1920, y1 = y0 + 97.3 / 1080;
    return { id: `shape-m3k9x2a${(i % 36).toString(36)}-${(1e6 + i * 7919).toString(36)}`, name: `Stage left panel ${i + 1}`, colour: colours[i % colours.length], visible: true, locked: false, sourceId: null,
      points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
  });
  const show: ShowDocument = { ...createShow(), shapes };
  // Rounding makes the message smaller; it is not what makes it fit (see the worst-case test).
  assert.ok(JSON.stringify(toWire(show)).length < JSON.stringify(show).length);
  const wire = { type: 'show' as const, show: toWire(show) };
  assert.ok(JSON.stringify(wire).length < MAP_MESSAGE_LIMIT, `${JSON.stringify(wire).length} bytes`);
  assert.ok(acceptMapMessage(wire));
  // Rounded to four places, so within 0.2 projector pixels; the held show is untouched.
  const p = wire.show.shapes[5].points[2], q = show.shapes[5].points[2];
  assert.ok(Math.abs(p.x - q.x) * 1920 <= 0.0961 && Math.abs(p.y - q.y) * 1080 <= 0.0541);
  assert.equal(String(p.x).split('.')[1].length <= 4, true);
  assert.equal(show.shapes[5].points[2], q);
});

// Audit fixes: limits that keep every valid show on the wall, Lock, and refused outlines.
import { attemptEdit } from '../src/map/editor';
import { MAX_NAME_LENGTH, MAX_ID_LENGTH, MAX_POINTS } from '../src/map/show';

test('the largest valid show still fits in one message, rounded or not', () => {
  // 64 shapes of 32 corners, names and ids at their limits, corners at full precision.
  const shapes = Array.from({ length: MAX_SHAPES }, (_, i) => ({
    id: 'i'.repeat(MAX_ID_LENGTH - 3) + String(i).padStart(3, '0'), name: 'n'.repeat(MAX_NAME_LENGTH), colour: '#ff9f0a', visible: true, locked: false, sourceId: null,
    points: Array.from({ length: MAX_POINTS }, (_, k) => ({ x: 0.5 + 0.3 * Math.cos(k / MAX_POINTS * 2 * Math.PI) + i / 1e7 + 1 / 3e5, y: 0.5 + 0.3 * Math.sin(k / MAX_POINTS * 2 * Math.PI) + 1 / 7e5 })),
  }));
  const show: ShowDocument = { ...createShow(), shapes };
  assert.ok(acceptMapMessage({ type: 'show', show }), `${JSON.stringify(show).length} bytes unrounded`);
  assert.ok(acceptMapMessage({ type: 'show', show: toWire(show) }));
});

test('a locked shape cannot be deleted', () => {
  const locked = applyEdit(withShape(), { type: 'setLocked', shapeId: 'a', locked: true });
  assert.ok(locked.ok);
  assert.deepEqual(applyEdit(locked.show, { type: 'delete', shapeId: 'a' }), { ok: false, reason: 'locked' });
  const unlocked = applyEdit(locked.show, { type: 'setLocked', shapeId: 'a', locked: false });
  assert.ok(unlocked.ok);
  assert.ok(applyEdit(unlocked.show, { type: 'delete', shapeId: 'a' }).ok);
});

test('names are limited in length', () => {
  const show = withShape();
  assert.ok(applyEdit(show, { type: 'rename', shapeId: 'a', name: 'n'.repeat(MAX_NAME_LENGTH) }).ok);
  assert.deepEqual(applyEdit(show, { type: 'rename', shapeId: 'a', name: 'n'.repeat(MAX_NAME_LENGTH + 1) }), { ok: false, reason: 'name-too-long' });
});

test('attemptEdit gives the refused outline, so the operator screen can draw it in red', () => {
  const show = withShape(); // square 0.1..0.3
  // Top-left corner pulled past the right side: its new edge from the bottom-left corner crosses the right edge.
  const bowtie: EditAction = { type: 'movePoint', shapeId: 'a', index: 0, to: { x: 0.35, y: 0.2 } };
  assert.deepEqual(applyEdit(show, bowtie), { ok: false, reason: 'crossing' });
  const attempt = attemptEdit(show, bowtie);
  assert.ok(attempt);
  assert.equal(attempt.shapeId, 'a');
  assert.deepEqual(attempt.show.shapes[0].points[0], { x: 0.35, y: 0.2 });
  // The held show is untouched.
  assert.deepEqual(show.shapes[0].points[0], { x: 0.1, y: 0.1 });
  // Refusals that are not about the outline give nothing to draw.
  const locked = applyEdit(show, { type: 'setLocked', shapeId: 'a', locked: true });
  assert.ok(locked.ok);
  assert.equal(attemptEdit(locked.show, bowtie), null);
  assert.equal(attemptEdit(show, { type: 'movePoint', shapeId: 'zzz', index: 0, to: { x: 0.4, y: 0.4 } }), null);
  // A valid edit gives its result too.
  const fine = attemptEdit(show, { type: 'movePoint', shapeId: 'a', index: 0, to: { x: 0.05, y: 0.05 } });
  assert.ok(fine);
  assert.deepEqual(fine.show.shapes[0].points[0], { x: 0.05, y: 0.05 });
});

// Context menu actions: duplicate and stacking order.
test('duplicate copies a shape 20 projector pixels down and right, just above the original', () => {
  let show = withShape();
  const second = applyEdit(show, rect('b', { x: 0.6, y: 0.6 }, { x: 0.7, y: 0.7 }));
  assert.ok(second.ok); show = second.show;
  const r = applyEdit(show, { type: 'duplicate', shapeId: 'a', id: 'a2' });
  assert.ok(r.ok);
  assert.deepEqual(r.show.shapes.map(s => s.id), ['a', 'a2', 'b']);
  const copy = r.show.shapes[1], original = r.show.shapes[0];
  assert.equal(copy.name, `${original.name} copy`);
  assert.equal(copy.locked, false);
  assert.equal(copy.visible, true);
  assert.equal(copy.colour, original.colour);
  copy.points.forEach((p, i) => {
    assert.ok(Math.abs((p.x - original.points[i].x) * 1920 - 20) < 1e-6);
    assert.ok(Math.abs((p.y - original.points[i].y) * 1080 - 20) < 1e-6);
  });
});

test('duplicate near the bottom-right corner goes up and left instead, so the copy stays on the stage', () => {
  const r0 = applyEdit(createShow(), rect('a', { x: 0.9, y: 0.9 }, { x: 1, y: 1 }));
  assert.ok(r0.ok);
  const r = applyEdit(r0.show, { type: 'duplicate', shapeId: 'a', id: 'a2' });
  assert.ok(r.ok);
  const copy = r.show.shapes[1], original = r.show.shapes[0];
  assert.ok(Math.abs((original.points[0].x - copy.points[0].x) * 1920 - 20) < 1e-6);
  assert.ok(Math.abs((original.points[0].y - copy.points[0].y) * 1080 - 20) < 1e-6);
  assert.ok(copy.points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
});

test('duplicate: a locked shape can be copied (the copy is unlocked); limits and ids are checked; long names stay within the limit', () => {
  const locked = applyEdit(withShape(), { type: 'setLocked', shapeId: 'a', locked: true });
  assert.ok(locked.ok);
  const r = applyEdit(locked.show, { type: 'duplicate', shapeId: 'a', id: 'a2' });
  assert.ok(r.ok);
  assert.equal(r.show.shapes[1].locked, false);
  assert.deepEqual(applyEdit(locked.show, { type: 'duplicate', shapeId: 'zzz', id: 'x' }), { ok: false, reason: 'not-found' });
  assert.deepEqual(applyEdit(locked.show, { type: 'duplicate', shapeId: 'a', id: 'a' }), { ok: false, reason: 'duplicate-id' });
  const named = applyEdit(withShape(), { type: 'rename', shapeId: 'a', name: 'n'.repeat(MAX_NAME_LENGTH) });
  assert.ok(named.ok);
  const longCopy = applyEdit(named.show, { type: 'duplicate', shapeId: 'a', id: 'a2' });
  assert.ok(longCopy.ok);
  assert.ok(longCopy.show.shapes[1].name.length <= MAX_NAME_LENGTH);
  let full = createShow();
  for (let i = 0; i < MAX_SHAPES; i++) { const step = applyEdit(full, rect(`s${i}`)); assert.ok(step.ok); full = step.show; }
  assert.deepEqual(applyEdit(full, { type: 'duplicate', shapeId: 's0', id: 'x' }), { ok: false, reason: 'too-many-shapes' });
});

test('reorder moves a shape to the front, back, one forward or one back; a locked shape stays put', () => {
  let show = createShow();
  for (const id of ['a', 'b', 'c']) { const r = applyEdit(show, rect(id)); assert.ok(r.ok); show = r.show; }
  const order = (to: 'front' | 'back' | 'forward' | 'backward', id = 'a') => {
    const r = applyEdit(show, { type: 'reorder', shapeId: id, to });
    assert.ok(r.ok, to);
    return r.show.shapes.map(s => s.id).join('');
  };
  assert.equal(order('front'), 'bca');
  assert.equal(order('forward'), 'bac');
  assert.equal(order('back', 'c'), 'cab');
  assert.equal(order('backward', 'c'), 'acb');
  // Already at the edge: nothing moves, and nothing is refused.
  assert.equal(order('back'), 'abc');
  assert.equal(order('front', 'c'), 'abc');
  const locked = applyEdit(show, { type: 'setLocked', shapeId: 'a', locked: true });
  assert.ok(locked.ok);
  assert.deepEqual(applyEdit(locked.show, { type: 'reorder', shapeId: 'a', to: 'front' }), { ok: false, reason: 'locked' });
});
