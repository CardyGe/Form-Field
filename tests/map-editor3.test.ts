// Stage 3 editing: drawing tools, points, curves, holes, joined corners, several shapes at once, grids, groups, edges, photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, attemptEdit, type EditAction } from '../src/map/editor';
import { createShow, isShapeLocked, MAX_SHAPES, STAGE_SIZE, type CurvePoint, type ShowDocument } from '../src/map/show';
import { ellipseRing, scaleAbout, rotateAbout } from '../src/map/outline';

const W = STAGE_SIZE.width, H = STAGE_SIZE.height;
const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => {
  const r = applyEdit(show, action);
  assert.ok(r.ok, `refused: ${!r.ok && r.reason}`);
  return r.show;
};
const refused = (show: ShowDocument, action: EditAction, reason: string) => {
  const r = applyEdit(show, action);
  assert.deepEqual(r, { ok: false, reason });
};
const add = (show: ShowDocument, id: string, points: CurvePoint[]) => ok(show, { type: 'addShape', id, points, colour: '#ff0000' });
const shapeOf = (show: ShowDocument, id: string) => show.shapes.find(s => s.id === id)!;
const two = () => add(add(createShow(), 'a', sq(.1, .1, .3, .3)), 'b', sq(.5, .5, .7, .7));

test('addShape adds any outline, curved too, and refuses a crossing one', () => {
  const show = add(createShow(), 'e', ellipseRing({ x: .2, y: .2 }, { x: .4, y: .5 }));
  assert.equal(shapeOf(show, 'e').points.length, 4);
  assert.equal(shapeOf(show, 'e').name, 'Shape 1');
  assert.deepEqual(shapeOf(show, 'e').holes, []);
  refused(createShow(), { type: 'addShape', id: 'x', points: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: .5, y: 0 }, { x: 0, y: .5 }], colour: '#ff0000' }, 'crossing');
});

test('addHole cuts a hole in the shape; one that sticks out, or on a locked shape, is refused; undo is just the show before', () => {
  const show = add(createShow(), 'a', sq(.1, .1, .6, .6));
  const holed = ok(show, { type: 'addHole', shapeId: 'a', points: sq(.2, .2, .3, .3) });
  assert.equal(shapeOf(holed, 'a').holes.length, 1);
  assert.equal(shapeOf(show, 'a').holes.length, 0, 'the input is never changed');
  refused(show, { type: 'addHole', shapeId: 'a', points: sq(.5, .5, .7, .7) }, 'hole-outside');
  const locked = ok(show, { type: 'setLocked', shapeId: 'a', locked: true });
  refused(locked, { type: 'addHole', shapeId: 'a', points: sq(.2, .2, .3, .3) }, 'locked');
});

test('points: insert on a side, remove, switch to a curve and back, move a handle; hole points too', () => {
  let show = add(createShow(), 'a', sq(.1, .1, .6, .6));
  show = ok(show, { type: 'insertPoint', shapeId: 'a', side: 0, t: .5 });
  assert.deepEqual(shapeOf(show, 'a').points[1], { x: .35, y: .1 });
  show = ok(show, { type: 'setCurve', shapeId: 'a', index: 1, curved: true });
  assert.ok(shapeOf(show, 'a').points[1].in);
  show = ok(show, { type: 'moveHandle', shapeId: 'a', index: 1, which: 'out', to: { x: .45, y: .05 }, mirror: true });
  assert.ok(Math.abs(shapeOf(show, 'a').points[1].out!.y - -.05) < 1e-12);
  show = ok(show, { type: 'removePoint', shapeId: 'a', index: 1 });
  assert.equal(shapeOf(show, 'a').points.length, 4);
  // Holes are edited the same way, by ring number.
  show = ok(show, { type: 'addHole', shapeId: 'a', points: sq(.2, .2, .3, .3) });
  show = ok(show, { type: 'movePoint', shapeId: 'a', ring: 0, index: 2, to: { x: .32, y: .33 } });
  assert.deepEqual(shapeOf(show, 'a').holes[0][2], { x: .32, y: .33 });
  show = ok(show, { type: 'insertPoint', shapeId: 'a', ring: 0, side: 0, t: .5 });
  assert.equal(shapeOf(show, 'a').holes[0].length, 5);
});

test('removing points: an outline cannot go below three; a hole that would goes away whole', () => {
  let show = add(createShow(), 'a', [{ x: .1, y: .1 }, { x: .6, y: .1 }, { x: .3, y: .6 }]);
  refused(show, { type: 'removePoint', shapeId: 'a', index: 0 }, 'too-few');
  show = ok(show, { type: 'addHole', shapeId: 'a', points: [{ x: .25, y: .15 }, { x: .35, y: .15 }, { x: .3, y: .25 }] });
  show = ok(show, { type: 'removePoint', shapeId: 'a', ring: 0, index: 0 });
  assert.deepEqual(shapeOf(show, 'a').holes, []);
});

test('a hole point dragged outside its shape is refused, and attemptEdit names the shape for the red outline', () => {
  let show = add(createShow(), 'a', sq(.1, .1, .6, .6));
  show = ok(show, { type: 'addHole', shapeId: 'a', points: sq(.2, .2, .3, .3) });
  const action: EditAction = { type: 'movePoint', shapeId: 'a', ring: 0, index: 2, to: { x: .8, y: .8 } };
  refused(show, action, 'hole-outside');
  assert.deepEqual(attemptEdit(show, action)?.shapeIds, ['a']);
});

test('joined corners: corners on the same spot move together; a locked one stays; a refused move moves nothing', () => {
  // Two squares sharing an edge: a's right corners sit on b's left corners.
  let show = add(add(createShow(), 'a', sq(.1, .1, .3, .3)), 'b', sq(.3, .1, .5, .3));
  const moved = ok(show, { type: 'movePoint', shapeId: 'a', index: 1, to: { x: .32, y: .08 }, joined: true });
  assert.deepEqual(shapeOf(moved, 'b').points[0], { x: .32, y: .08 });
  assert.deepEqual(shapeOf(moved, 'b').points[3], { x: .3, y: .3 }, 'only the corner on the same spot');
  // Without joined, only the dragged corner moves.
  assert.deepEqual(shapeOf(ok(show, { type: 'movePoint', shapeId: 'a', index: 1, to: { x: .32, y: .08 } }), 'b').points[0], { x: .3, y: .1 });
  // Nudged together, by projector pixels.
  const nudged = ok(show, { type: 'nudgePoint', shapeId: 'a', index: 2, dxPx: 0, dyPx: 10, joined: true });
  assert.ok(Math.abs(shapeOf(nudged, 'b').points[3].y - (.3 + 10 / H)) < 1e-12);
  // A locked neighbour keeps its corner.
  const locked = ok(show, { type: 'setLocked', shapeId: 'b', locked: true });
  assert.deepEqual(shapeOf(ok(locked, { type: 'movePoint', shapeId: 'a', index: 1, to: { x: .32, y: .08 }, joined: true }), 'b').points[0], { x: .3, y: .1 });
  // Pulling the shared corner across b's far side would cross b: nothing moves.
  show = ok(show, { type: 'addShape', id: 'c', points: sq(.7, .7, .8, .8), colour: '#00ff00' });
  refused(show, { type: 'movePoint', shapeId: 'a', index: 1, to: { x: .6, y: .2 }, joined: true }, 'crossing');
  assert.deepEqual(attemptEdit(show, { type: 'movePoint', shapeId: 'a', index: 1, to: { x: .6, y: .2 }, joined: true })?.shapeIds.sort(), ['a', 'b']);
});

test('several shapes: move, delete, duplicate in order, flip, scale and turn', () => {
  let show = two();
  show = ok(show, { type: 'moveShapes', shapeIds: ['a', 'b'], dx: .1, dy: 0 });
  assert.ok(Math.abs(shapeOf(show, 'a').points[0].x - .2) < 1e-12 && Math.abs(shapeOf(show, 'b').points[0].x - .6) < 1e-12);
  // Limited so every point stays on the stage.
  const far = ok(show, { type: 'moveShapes', shapeIds: ['a', 'b'], dx: 1, dy: 0 });
  assert.ok(Math.abs(shapeOf(far, 'b').points[1].x - 1) < 1e-12);
  const copies = ok(show, { type: 'duplicateShapes', shapeIds: ['a', 'b'], ids: ['a2', 'b2'], sourceIds: ['s1', 's2'] });
  assert.deepEqual(copies.shapes.map(s => s.id), ['a', 'a2', 'b', 'b2']);
  const dragged = ok(show, { type: 'duplicateShapes', shapeIds: ['a'], ids: ['a3'], sourceIds: ['s3'], offset: { dx: 0, dy: .2 } });
  assert.ok(Math.abs(shapeOf(dragged, 'a3').points[0].y - .3) < 1e-12);
  // Flip left to right about the selection's centre (x from .2 to .8 → centre .5): a lands where b was.
  const flipped = ok(show, { type: 'transformShapes', shapeIds: ['a', 'b'], matrix: scaleAbout({ x: .5 * W, y: .4 * H }, -1, 1) });
  const xs = shapeOf(flipped, 'a').points.map(p => p.x).sort();
  assert.ok(Math.abs(xs[0] - .6) < 1e-12 && Math.abs(xs[3] - .8) < 1e-12);
  // A turn that would put a corner off the stage is refused.
  refused(show, { type: 'transformShapes', shapeIds: ['b'], matrix: rotateAbout({ x: 0, y: 0 }, Math.PI / 2) }, 'outside');
  const gone = ok(show, { type: 'deleteShapes', shapeIds: ['a', 'b'] });
  assert.deepEqual(gone.shapes, []);
  const lockedA = ok(show, { type: 'setLocked', shapeId: 'a', locked: true });
  refused(lockedA, { type: 'deleteShapes', shapeIds: ['a', 'b'] }, 'locked');
  refused(lockedA, { type: 'moveShapes', shapeIds: ['a', 'b'], dx: .01, dy: 0 }, 'locked');
});

test('mirror copies land across the stage centre line', () => {
  const show = ok(two(), { type: 'mirrorShapes', shapeIds: ['a'], axis: 'vertical', ids: ['m'], sourceIds: ['sm'] });
  const xs = shapeOf(show, 'm').points.map(p => p.x).sort();
  assert.ok(Math.abs(xs[0] - .7) < 1e-12 && Math.abs(xs[3] - .9) < 1e-12);
  const below = ok(two(), { type: 'mirrorShapes', shapeIds: ['a'], axis: 'horizontal', ids: ['m'], sourceIds: ['sm'] });
  assert.ok(Math.abs(Math.max(...shapeOf(below, 'm').points.map(p => p.y)) - .9) < 1e-12);
});

test('Make a grid: cells replace the shape in a new group, each with its own copy of the instrument', () => {
  let show = add(createShow(), 'a', sq(.1, .1, .5, .5));
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'src', seed: 1 } });
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], sourceIds = ids.map(id => `s-${id}`);
  const grid = ok(show, { type: 'makeGrid', shapeId: 'a', rows: 2, cols: 3, gapPx: 10, ids, sourceIds, groupId: 'g' });
  assert.deepEqual(grid.shapes.map(s => s.id), ids);
  assert.ok(grid.shapes.every(s => s.groupId === 'g'));
  assert.equal(grid.groups[0].name, 'Shape 1');
  assert.deepEqual(grid.shapes.map(s => s.sourceId), sourceIds);
  assert.deepEqual(grid.sources.map(s => s.id).sort(), [...sourceIds].sort(), 'the original source is let go');
  assert.equal(grid.shapes[0].name, 'Shape 1 1');
});

test('Make a grid is refused whole past the limits, for curves, and for a gap too wide', () => {
  const show = add(createShow(), 'a', sq(.1, .1, .5, .5));
  const big = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
  // 64 shapes already would leave no room: 63 others + 4 cells.
  let full = show;
  for (let i = 0; i < MAX_SHAPES - 1; i++) full = add(full, `x${i}`, sq(.6 + (i % 8) * .04, .1 + Math.floor(i / 8) * .1, .62 + (i % 8) * .04, .15 + Math.floor(i / 8) * .1));
  refused(full, { type: 'makeGrid', shapeId: 'a', rows: 2, cols: 2, gapPx: 0, ids: big(4), sourceIds: big(4), groupId: 'g' }, 'too-many-shapes');
  const curved = ok(show, { type: 'setCurve', shapeId: 'a', index: 0, curved: true });
  refused(curved, { type: 'makeGrid', shapeId: 'a', rows: 2, cols: 2, gapPx: 0, ids: big(4), sourceIds: big(4), groupId: 'g' }, 'not-four-corners');
  refused(show, { type: 'makeGrid', shapeId: 'a', rows: 2, cols: 2, gapPx: 2000, ids: big(4), sourceIds: big(4), groupId: 'g' }, 'collapsed');
  refused(show, { type: 'makeGrid', shapeId: 'a', rows: 1, cols: 1, gapPx: 0, ids: big(1), sourceIds: big(1), groupId: 'g' }, 'bad-grid');
});

test('groups: members are brought together, hidden and locked together, reordered as a block, and dropped when empty', () => {
  let show = add(two(), 'c', sq(.8, .1, .9, .2));
  show = ok(show, { type: 'group', shapeIds: ['a', 'c'], groupId: 'g', name: 'Windows' });
  assert.deepEqual(show.shapes.map(s => s.id), ['a', 'c', 'b']);
  show = ok(show, { type: 'setGroupLocked', groupId: 'g', locked: true });
  assert.equal(isShapeLocked(show, shapeOf(show, 'c')), true);
  refused(show, { type: 'moveShapes', shapeIds: ['c'], dx: .01, dy: 0 }, 'locked');
  show = ok(show, { type: 'setGroupLocked', groupId: 'g', locked: false });
  show = ok(show, { type: 'reorderGroup', groupId: 'g', to: 'front' });
  assert.deepEqual(show.shapes.map(s => s.id), ['b', 'a', 'c']);
  // A grouped shape moves only within its group.
  show = ok(show, { type: 'reorder', shapeId: 'a', to: 'front' });
  assert.deepEqual(show.shapes.map(s => s.id), ['b', 'c', 'a']);
  // An ungrouped shape steps over a whole group.
  show = ok(show, { type: 'reorder', shapeId: 'b', to: 'forward' });
  assert.deepEqual(show.shapes.map(s => s.id), ['c', 'a', 'b']);
  show = ok(show, { type: 'renameGroup', groupId: 'g', name: 'Left windows' });
  assert.equal(show.groups[0].name, 'Left windows');
  const gone = ok(show, { type: 'deleteShapes', shapeIds: ['a', 'c'] });
  assert.deepEqual(gone.groups, []);
  const ungrouped = ok(show, { type: 'ungroup', groupId: 'g' });
  assert.ok(ungrouped.shapes.every(s => s.groupId === null));
  assert.deepEqual(ungrouped.groups, []);
});

test('a duplicate of a grouped shape stays in its group', () => {
  const show = ok(two(), { type: 'group', shapeIds: ['a', 'b'], groupId: 'g', name: 'G' });
  const copy = ok(show, { type: 'duplicateShapes', shapeIds: ['a'], ids: ['a2'], sourceIds: ['s'] });
  assert.deepEqual(copy.shapes.map(s => [s.id, s.groupId]), [['a', 'g'], ['a2', 'g'], ['b', 'g']]);
});

test('blocker, soft edge, border', () => {
  let show = add(createShow(), 'a', sq(.1, .1, .5, .5));
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'src', seed: 1 } });
  show = ok(show, { type: 'setBlocker', shapeId: 'a', blocker: true });
  assert.equal(shapeOf(show, 'a').sourceId, null);
  assert.deepEqual(show.sources, []);
  refused(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'src2', seed: 1 } }, 'blocker');
  show = ok(show, { type: 'setSoftEdge', shapeId: 'a', px: 500 });
  assert.equal(shapeOf(show, 'a').softEdge, 200);
  show = ok(show, { type: 'setBorder', shapeId: 'a', border: { width: 8, colour: 'palette', glow: 60 } });
  assert.deepEqual(shapeOf(show, 'a').border, { width: 8, colour: 'palette', glow: 40 });
  refused(show, { type: 'setBorder', shapeId: 'a', border: { width: 8, colour: 'blue', glow: 0 } }, 'bad-colour');
});

test('photo: set, fade and take away; anything but a JPEG or PNG picture is refused', () => {
  const data = 'data:image/jpeg;base64,/9j/4AAQ';
  let show = ok(createShow(), { type: 'setPhoto', photo: { data, opacity: .5 } });
  show = ok(show, { type: 'setPhotoOpacity', opacity: 2 });
  assert.deepEqual(show.photo, { data, opacity: 1 });
  refused(show, { type: 'setPhoto', photo: { data: 'file:///etc/passwd', opacity: .5 } }, 'bad-photo');
  assert.equal(ok(show, { type: 'setPhoto', photo: null }).photo, null);
});

// Review fixes.
test('a turn that would stretch a handle past the stage is refused, so the file reopens as it was', () => {
  let show = add(createShow(), 'a', sq(.1, .45, .15, .55));
  show = ok(show, { type: 'moveHandle', shapeId: 'a', index: 1, which: 'out', to: { x: 1, y: .45 }, mirror: false });
  refused(show, { type: 'transformShapes', shapeIds: ['a'], matrix: rotateAbout({ x: 240, y: 540 }, Math.PI / 2) }, 'outside');
});

test('a copy of a shape in a locked group goes just after the group, on its own', () => {
  let show = ok(add(two(), 'c', sq(.8, .1, .9, .2)), { type: 'group', shapeIds: ['a', 'b'], groupId: 'g', name: 'G' });
  show = ok(show, { type: 'setGroupLocked', groupId: 'g', locked: true });
  const copy = ok(show, { type: 'duplicate', shapeId: 'a', id: 'a2' });
  assert.deepEqual(copy.shapes.map(s => [s.id, s.groupId]), [['a', 'g'], ['b', 'g'], ['a2', null], ['c', null]]);
});

test('new shapes keep their own copy of the handles; names lose control characters', () => {
  const points: CurvePoint[] = [{ x: .1, y: .1, out: { x: .05, y: 0 } }, { x: .5, y: .1 }, { x: .3, y: .5 }];
  const show = ok(createShow(), { type: 'addShape', id: 'a', points, colour: '#ff0000', name: 'Door\u0001' });
  points[0].out!.x = .9;
  assert.equal(show.shapes[0].points[0].out!.x, .05);
  assert.equal(show.shapes[0].name, 'Door');
});
