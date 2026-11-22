import test from 'node:test';
import assert from 'node:assert/strict';
import { pick, selectionBox, transformFor, marqueeSelect, type Selection } from '../src/map/gestures';
import { createShow, shapeExtras, STAGE_SIZE, type CurvePoint, type Shape } from '../src/map/show';
import { transformRing } from '../src/map/outline';

const W = STAGE_SIZE.width, H = STAGE_SIZE.height;
const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const shape = (id: string, points: CurvePoint[], over: Partial<Shape> = {}): Shape => ({ id, name: id, colour: '#ffffff', visible: true, locked: false, sourceId: null, points, ...shapeExtras(), ...over });
const show = (...shapes: Shape[]) => ({ ...createShow(), shapes });
const px = (x: number, y: number) => ({ x: x / W, y: y / H });
const none: Selection = { ids: [], ring: -1, index: null };
const reach = { reachPx: 10, outsetPx: 12, turnPx: 30 };

test('a press picks, in order: a handle of the chosen point, a point, a box handle, a side, a shape, then nothing', () => {
  const a = shape('a', sq(.2, .2, .4, .4).map((p, i) => i === 1 ? { ...p, out: { x: 0, y: .05 } } : p), { holes: [sq(.25, .25, .3, .3)] });
  const s = show(a, shape('b', sq(.5, .5, .7, .7)));
  const sel: Selection = { ids: ['a'], ring: -1, index: 1 };
  assert.deepEqual(pick(px(.4 * W, .25 * H + 2), s, sel, reach), { kind: 'handle', shapeId: 'a', ring: -1, index: 1, which: 'out' });
  assert.deepEqual(pick(px(.2 * W + 3, .2 * H), s, sel, reach), { kind: 'point', shapeId: 'a', ring: -1, index: 0 });
  // Hole corners are points too.
  assert.deepEqual(pick(px(.3 * W, .3 * H), s, sel, reach), { kind: 'point', shapeId: 'a', ring: 0, index: 2 });
  // The box handle sits 12 px outside the top-left corner.
  assert.deepEqual(pick(px(.2 * W - 12, .2 * H - 12), s, sel, reach), { kind: 'box', handle: 'nw' });
  assert.deepEqual(pick(px(.3 * W, .2 * H - 12 - 30), s, sel, reach), { kind: 'box', handle: 'turn' });
  const side = pick(px(.3 * W, .4 * H + 3), s, sel, reach);
  assert.equal(side.kind, 'side');
  assert.ok(side.kind === 'side' && side.ring === -1 && side.index === 2);
  assert.deepEqual(pick(px(.6 * W, .6 * H), s, sel, reach), { kind: 'shape', shapeId: 'b' });
  // Inside a hole is not the shape.
  assert.deepEqual(pick(px(.275 * W, .275 * H), s, none, reach), { kind: 'empty' });
  assert.deepEqual(pick(px(.9 * W, .1 * H), s, sel, reach), { kind: 'empty' });
});

test('hidden and locked shapes: hidden cannot be picked; a locked one can be picked but offers no handles', () => {
  const s = show(shape('a', sq(.2, .2, .4, .4), { locked: true }), shape('h', sq(.5, .5, .7, .7), { visible: false }));
  assert.deepEqual(pick(px(.6 * W, .6 * H), s, none, reach), { kind: 'empty' });
  assert.deepEqual(pick(px(.2 * W - 12, .2 * H - 12), s, { ids: ['a'], ring: -1, index: null }, reach), { kind: 'empty' });
  assert.deepEqual(pick(px(.3 * W, .3 * H), s, { ids: ['a'], ring: -1, index: null }, reach), { kind: 'shape', shapeId: 'a' });
});

test('the box around several shapes; scaling from a corner keeps the opposite corner still, Shift keeps proportions', () => {
  const s = show(shape('a', sq(.2, .2, .3, .3)), shape('b', sq(.4, .4, .5, .6)));
  const box = selectionBox(s, ['a', 'b'])!;
  assert.deepEqual(box, { x0: .2 * W, y0: .2 * H, x1: .5 * W, y1: .6 * H });
  // Dragging the south-east handle 30 px right and 0 down doubles... no: scales x by (300+30)/300 about the north-west corner.
  const m = transformFor('se', { x: .5 * W + 12, y: .6 * H + 12 }, { x: .5 * W + 42, y: .6 * H + 12 }, box, false);
  const moved = transformRing(sq(.2, .2, .5, .6), m);
  assert.ok(Math.abs(moved[0].x - .2) < 1e-9 && Math.abs(moved[0].y - .2) < 1e-9);
  assert.ok(Math.abs(moved[2].x * W - (.5 * W + 30 * (576 / 588))) < 1e-6);
  const uniform = transformFor('se', { x: .5 * W + 12, y: .6 * H + 12 }, { x: .5 * W + 42, y: .6 * H + 12 }, box, true);
  assert.ok(Math.abs(uniform[0] - uniform[3]) < 1e-12);
});

test('turning goes round the box centre; Shift turns in 15 degree steps', () => {
  const box = { x0: 100, y0: 100, x1: 300, y1: 300 };
  const m = transformFor('turn', { x: 200, y: 0 }, { x: 400, y: 200 }, box, false);
  assert.ok(Math.abs(Math.atan2(m[1], m[0]) - Math.PI / 2) < 1e-9);
  const stepped = transformFor('turn', { x: 200, y: 0 }, { x: 300, y: 10 }, box, true);
  const deg = Math.atan2(stepped[1], stepped[0]) * 180 / Math.PI;
  assert.ok(Math.abs(deg / 15 - Math.round(deg / 15)) < 1e-9);
});

test('a dragged box selects the shapes wholly inside it', () => {
  const s = show(shape('a', sq(.2, .2, .3, .3)), shape('b', sq(.25, .25, .5, .5)), shape('h', sq(.21, .21, .22, .22), { visible: false }));
  assert.deepEqual(marqueeSelect(s, { x: .1, y: .1 }, { x: .35, y: .35 }), ['a']);
  assert.deepEqual(marqueeSelect(s, { x: .6, y: .6 }, { x: .1, y: .1 }), ['a', 'b']);
});

test('a pinned shape without four corners offers its four pin handles, before its points and the box', () => {
  const tri = shape('t', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }], { placement: { kind: 'pin', zoom: 1, offset: { x: 0, y: 0 }, turn: 0, pin: [{ x: .25, y: .25 }, { x: .55, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }] } });
  const s = show(tri), sel: Selection = { ids: ['t'], ring: -1, index: null };
  assert.deepEqual(pick(px(.25 * W + 3, .25 * H), s, sel, reach), { kind: 'pin', shapeId: 't', index: 0 });
  // A pin handle on the same spot as a point wins while Pin is chosen (handles start on the box's corners).
  assert.deepEqual(pick(px(.6 * W, .6 * H), s, sel, reach), { kind: 'pin', shapeId: 't', index: 2 });
  // Not while it plays Fit.
  const fit = shape('t', tri.points, { placement: { ...tri.placement, kind: 'fit' } });
  assert.notEqual(pick(px(.25 * W + 3, .25 * H), show(fit), sel, reach).kind, 'pin');
});
