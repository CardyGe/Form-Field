// Stage 4 editing: placement, pins, sharing instruments, look, stage corners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, attemptEdit, type EditAction } from '../src/map/editor';
import { createShow, type CurvePoint, type ShowDocument } from '../src/map/show';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const refused = (show: ShowDocument, action: EditAction, reason: string) => assert.deepEqual(applyEdit(show, action), { ok: false, reason });
const add = (show: ShowDocument, id: string, points: CurvePoint[]) => ok(show, { type: 'addShape', id, points, colour: '#ff0000' });
const shapeOf = (show: ShowDocument, id: string) => show.shapes.find(s => s.id === id)!;
const play = (show: ShowDocument, id: string, sourceId: string) => ok(show, { type: 'setContent', shapeId: id, content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId, seed: 1 } });

test('placement: values are clamped; Pin on a four-point shape follows its corners, on any other shape starts at its box', () => {
  let show = add(createShow(), 'a', sq(.2, .2, .4, .4));
  show = ok(show, { type: 'setPlacement', shapeId: 'a', placement: { zoom: 9, turn: -500, offset: { x: .1, y: 3 } } });
  assert.deepEqual(shapeOf(show, 'a').placement, { kind: 'fit', zoom: 4, offset: { x: .1, y: 1 }, turn: -180, pin: null });
  show = ok(show, { type: 'setPlacement', shapeId: 'a', placement: { kind: 'pin' } });
  assert.equal(shapeOf(show, 'a').placement.pin, null);
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  assert.deepEqual(shapeOf(tri, 't').placement.pin, sq(.2, .2, .6, .6));
});

test('a pin handle moves; one that would fold the pin is refused and shown red', () => {
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  tri = ok(tri, { type: 'movePin', shapeId: 't', index: 1, to: { x: .65, y: .15 } });
  assert.deepEqual(shapeOf(tri, 't').placement.pin![1], { x: .65, y: .15 });
  const fold: EditAction = { type: 'movePin', shapeId: 't', index: 0, to: { x: .7, y: .7 } };
  refused(tri, fold, 'pin-folded');
  assert.deepEqual(attemptEdit(tri, fold)?.shapeIds, ['t']);
  // A four-point shape on Pin uses its own corners: a corner move that would fold them is refused too.
  let quad = add(createShow(), 'q', sq(.2, .2, .4, .4));
  quad = ok(quad, { type: 'setPlacement', shapeId: 'q', placement: { kind: 'pin' } });
  refused(quad, { type: 'movePin', shapeId: 'q', index: 0, to: { x: .1, y: .1 } }, 'pin-own-corners');
  refused(quad, { type: 'movePoint', shapeId: 'q', index: 0, to: { x: .35, y: .35 } }, 'pin-folded');
});

test('a stored pin moves, scales and turns with its shape', () => {
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  tri = ok(tri, { type: 'moveShapes', shapeIds: ['t'], dx: .1, dy: 0 });
  assert.ok(Math.abs(shapeOf(tri, 't').placement.pin![0].x - .3) < 1e-12);
  tri = ok(tri, { type: 'transformShapes', shapeIds: ['t'], matrix: [-1, 0, 0, 1, 1920, 0] });
  assert.ok(Math.abs(shapeOf(tri, 't').placement.pin![0].x - .7) < 1e-12);
});

test('sharing: a shape plays another’s instrument; its own is let go; deleting one sharer keeps it for the other', () => {
  let show = add(add(createShow(), 'a', sq(.1, .1, .3, .3)), 'b', sq(.5, .5, .7, .7));
  show = play(play(show, 'a', 'sa'), 'b', 'sb');
  show = ok(show, { type: 'shareSource', shapeId: 'b', withShapeId: 'a' });
  assert.equal(shapeOf(show, 'b').sourceId, 'sa');
  assert.deepEqual(show.sources.map(s => s.id), ['sa']);
  const one = ok(show, { type: 'delete', shapeId: 'a' });
  assert.deepEqual(one.sources.map(s => s.id), ['sa']);
  // Make separate gives a copy; on the only player it changes nothing.
  const apart = ok(show, { type: 'makeSeparate', shapeId: 'b', sourceId: 'sb2' });
  assert.equal(shapeOf(apart, 'b').sourceId, 'sb2');
  assert.deepEqual(apart.sources.map(s => s.id).sort(), ['sa', 'sb2']);
  assert.equal(ok(one, { type: 'makeSeparate', shapeId: 'b', sourceId: 'x' }), one);
  // Not with a shape that plays nothing, and not for a Blocker.
  const plain = add(show, 'c', sq(.8, .1, .9, .2));
  refused(plain, { type: 'shareSource', shapeId: 'a', withShapeId: 'c' }, 'nothing-to-share');
  const blocker = ok(plain, { type: 'setBlocker', shapeId: 'c', blocker: true });
  refused(blocker, { type: 'shareSource', shapeId: 'c', withShapeId: 'a' }, 'blocker');
});

test('look: brightness 0 to 200 %, tint a colour', () => {
  let show = add(createShow(), 'a', sq(.1, .1, .3, .3));
  show = ok(show, { type: 'setLook', shapeId: 'a', brightness: 5, tint: '#ffd0a0' });
  assert.equal(shapeOf(show, 'a').brightness, 2);
  assert.equal(shapeOf(show, 'a').tint, '#ffd0a0');
  refused(show, { type: 'setLook', shapeId: 'a', tint: 'warm' }, 'bad-colour');
});

test('stage corners: set, move, refuse crossing, and reset even when every shape is locked', () => {
  let show = add(createShow(), 'a', sq(.1, .1, .3, .3));
  show = ok(show, { type: 'moveStageCorner', index: 0, to: { x: .02, y: .01 } });
  assert.deepEqual(show.stageCorners![0], { x: .02, y: .01 });
  assert.deepEqual(show.stageCorners![2], { x: 1, y: 1 });
  refused(show, { type: 'moveStageCorner', index: 0, to: { x: 1.2, y: 1.2 } }, 'corners-folded');
  show = ok(show, { type: 'setLocked', shapeId: 'a', locked: true });
  assert.equal(ok(show, { type: 'setStageCorners', corners: null }).stageCorners, null);
});

// Review fixes.
test('copies carry their pin with them: duplicate, mirror; grid cells use their own corners', () => {
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  const dup = ok(tri, { type: 'duplicate', shapeId: 't', id: 'c' });
  assert.ok(Math.abs(shapeOf(dup, 'c').placement.pin![0].x - (.2 + 20 / 1920)) < 1e-12);
  const mir = ok(tri, { type: 'mirrorShapes', shapeIds: ['t'], axis: 'vertical', ids: ['m'], sourceIds: ['sm'] });
  assert.ok(Math.abs(Math.max(...shapeOf(mir, 'm').placement.pin!.map(p => p.x)) - .8) < 1e-12);
  let quad = add(createShow(), 'q', sq(.2, .2, .6, .6));
  quad = ok(quad, { type: 'setPlacement', shapeId: 'q', placement: { kind: 'pin' } });
  const grid = ok(quad, { type: 'makeGrid', shapeId: 'q', rows: 2, cols: 2, gapPx: 0, ids: ['a', 'b', 'c', 'd'], sourceIds: ['1', '2', '3', '4'], groupId: 'g' });
  assert.ok(grid.shapes.every(s => s.placement.pin === null));
});

test('a four-point shape always pins by its own corners; gaining a point gives it pin handles at its box', () => {
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  // A new point on a straight side cannot carry a picture: the shape keeps handles at its box.
  const four = ok(tri, { type: 'insertPoint', shapeId: 't', side: 2, t: .5 });
  assert.deepEqual(shapeOf(four, 't').placement.pin, sq(.2, .2, .6, .6));
  // Once its four corners can carry the picture, it pins by them.
  const bent = ok(four, { type: 'movePoint', shapeId: 't', index: 3, to: { x: .25, y: .35 } });
  assert.equal(shapeOf(bent, 't').placement.pin, null);
  let quad = add(createShow(), 'q', sq(.2, .2, .4, .4));
  quad = ok(quad, { type: 'setPlacement', shapeId: 'q', placement: { kind: 'pin' } });
  const five = ok(quad, { type: 'insertPoint', shapeId: 'q', side: 0, t: .5 });
  assert.deepEqual(shapeOf(five, 'q').placement.pin, sq(.2, .2, .4, .4));
});

test('pin handles: only while pinned, never NaN; stage corners stay within reach; sharing with itself changes nothing', () => {
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  refused(tri, { type: 'movePin', shapeId: 't', index: 0, to: { x: Number.NaN, y: .1 } }, 'not-found');
  const fit = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'fit' } });
  refused(fit, { type: 'movePin', shapeId: 't', index: 0, to: { x: .1, y: .1 } }, 'not-pinned');
  refused(createShow(), { type: 'setStageCorners', corners: [{ x: -2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, 'corners-outside');
  let show = play(add(createShow(), 'a', sq(.1, .1, .3, .3)), 'a', 'sa');
  assert.equal(ok(show, { type: 'shareSource', shapeId: 'a', withShapeId: 'a' }), show);
});

test('a stored pin cannot be carried past half a stage off the edge; nudging one stage corner is one undo step', async () => {
  let tri = add(createShow(), 't', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]);
  tri = ok(tri, { type: 'setPlacement', shapeId: 't', placement: { kind: 'pin' } });
  tri = ok(tri, { type: 'movePin', shapeId: 't', index: 1, to: { x: 1.45, y: .2 } });
  refused(tri, { type: 'moveShapes', shapeIds: ['t'], dx: .3, dy: 0 }, 'pin-outside');
  const { mapReducer, initialMapState } = await import('../src/map/state');
  let state = initialMapState(add(createShow(), 'a', sq(.1, .1, .3, .3)));
  for (let i = 0; i < 5; i++) state = mapReducer(state, { type: 'edit', action: { type: 'moveStageCorner', index: 0, to: { x: .01 * (i + 1), y: 0 } } });
  assert.equal(state.past.length, 1);
  state = mapReducer(state, { type: 'edit', action: { type: 'moveStageCorner', index: 1, to: { x: .95, y: 0 } } });
  assert.equal(state.past.length, 2);
});

test('Make a grid with one picture across the cells: every cell plays the shape’s own instrument, laid across the group', () => {
  let show = play(add(createShow(), 'a', sq(.1, .1, .5, .5)), 'a', 'sa');
  const ids = ['c1', 'c2', 'c3', 'c4'];
  show = ok(show, { type: 'makeGrid', shapeId: 'a', rows: 2, cols: 2, gapPx: 10, ids, sourceIds: ids.map(i => `s-${i}`), groupId: 'g', spread: true });
  assert.ok(show.shapes.every(s => s.sourceId === 'sa' && s.placement.kind === 'across-group' && s.groupId === 'g'));
  assert.deepEqual(show.sources.map(s => s.id), ['sa']);
  // Without spreading, each cell its own copy, as before.
  const copies = ok(play(add(createShow(), 'a', sq(.1, .1, .5, .5)), 'a', 'sa'), { type: 'makeGrid', shapeId: 'a', rows: 1, cols: 2, gapPx: 0, ids: ['x', 'y'], sourceIds: ['sx', 'sy'], groupId: 'g' });
  assert.deepEqual(copies.shapes.map(s => s.sourceId), ['sx', 'sy']);
});

test('linked shapes are one instrument: a new look on one changes them all, unless asked for that shape only', () => {
  let show = play(add(createShow(), 'a', sq(.1, .1, .5, .5)), 'a', 'sa');
  const ids = ['c1', 'c2', 'c3', 'c4'];
  show = ok(show, { type: 'makeGrid', shapeId: 'a', rows: 2, cols: 2, gapPx: 0, ids, sourceIds: ids.map(i => `s-${i}`), groupId: 'g', spread: true });
  const before = show.sources[0];
  // Linked (the default): the shared instrument becomes the new look, for every cell, keeping its place in the show.
  const all = ok(show, { type: 'setContent', shapeId: 'c2', content: { kind: 'preset', presetId: 'salt-mandala', sourceId: 'new', seed: 3 } });
  assert.ok(all.shapes.every(s => s.sourceId === 'sa'));
  assert.equal(all.sources.length, 1);
  assert.equal(all.sources[0].revision, before.revision + 1);
  assert.notEqual(all.sources[0].project.name, before.project.name);
  // That shape only: it gets its own instrument; the others keep theirs.
  const one = ok(show, { type: 'setContent', shapeId: 'c2', content: { kind: 'preset', presetId: 'salt-mandala', sourceId: 'new', seed: 3, linked: false } });
  assert.deepEqual(one.shapes.map(s => s.sourceId), ['sa', 'new', 'sa', 'sa']);
  // Linked, the grid pattern or plain colour goes to every cell too.
  const plain = ok(show, { type: 'setContent', shapeId: 'c1', content: { kind: 'colour' } });
  assert.ok(plain.shapes.every(s => s.sourceId === null && s.fill === 'colour'));
  const alone = ok(show, { type: 'setContent', shapeId: 'c1', content: { kind: 'colour', linked: false } });
  assert.deepEqual(alone.shapes.map(s => s.sourceId), [null, 'sa', 'sa', 'sa']);
});

test('a linked change is refused while any linked shape is locked', () => {
  let show = play(add(createShow(), 'a', sq(.1, .1, .5, .5)), 'a', 'sa');
  show = ok(show, { type: 'makeGrid', shapeId: 'a', rows: 1, cols: 2, gapPx: 0, ids: ['x', 'y'], sourceIds: ['sx', 'sy'], groupId: 'g', spread: true });
  show = ok(show, { type: 'setLocked', shapeId: 'y', locked: true });
  refused(show, { type: 'setContent', shapeId: 'x', content: { kind: 'preset', presetId: 'salt-mandala', sourceId: 'n', seed: 1 } }, 'locked');
});
