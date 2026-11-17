import test from 'node:test';
import assert from 'node:assert/strict';
import { joinedAnchors, snapMove, snapPoint } from '../src/map/snap';
import { createShow, shapeExtras, STAGE_SIZE, type CurvePoint, type Shape } from '../src/map/show';

const W = STAGE_SIZE.width, H = STAGE_SIZE.height;
const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const shape = (id: string, points: CurvePoint[], over: Partial<Shape> = {}): Shape => ({ id, name: id, colour: '#ffffff', visible: true, locked: false, sourceId: null, points, ...shapeExtras(), ...over });
const show = (...shapes: Shape[]) => ({ ...createShow(), shapes });
const px = (x: number, y: number) => ({ x: x / W, y: y / H });
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) * W < 1e-6 && Math.abs(a.y - b.y) * H < 1e-6;

test('a point snaps to a nearby corner before a nearer side', () => {
  const s = show(shape('a', sq(.2, .2, .4, .4)));
  // 6 px from the corner (384, 216), 2 px from the top side.
  const r = snapPoint(px(384 + 6, 216 - 2), s, { shapeIds: [] }, 10);
  assert.equal(r.target?.kind, 'point');
  assert.ok(close(r.at, px(384, 216)));
});

test('a point snaps to a side when no corner is in reach, and to nothing past the reach', () => {
  const s = show(shape('a', sq(.2, .2, .4, .4)));
  const r = snapPoint(px(500, 216 + 4), s, { shapeIds: [] }, 10);
  assert.equal(r.target?.kind, 'side');
  assert.ok(close(r.at, px(500, 216)));
  const none = snapPoint(px(500, 216 + 40), s, { shapeIds: [] }, 10);
  assert.equal(none.target, null);
  assert.ok(close(none.at, px(500, 256)));
});

test('stage edges and centre lines snap each direction on its own', () => {
  const r = snapPoint(px(5, 300), show(), { shapeIds: [] }, 10);
  assert.equal(r.target?.kind, 'edge');
  assert.ok(close(r.at, px(0, 300)));
  const c = snapPoint(px(963, 538), show(), { shapeIds: [] }, 10);
  assert.equal(c.target?.kind, 'centre');
  assert.ok(close(c.at, px(960, 540)));
});

test('the shape being edited, and hidden shapes, are not snapped to', () => {
  const s = show(shape('a', sq(.2, .2, .4, .4)), shape('h', sq(.6, .6, .7, .7), { visible: false }));
  assert.equal(snapPoint(px(384 + 3, 216), s, { shapeIds: ['a'] }, 10).target, null);
  assert.equal(snapPoint(px(.6 * W + 3, .6 * H), s, { shapeIds: [] }, 10).target, null);
});

test('a moved shape snaps so its nearest corner lands on a target', () => {
  const s = show(shape('a', sq(.2, .2, .4, .4)), shape('b', sq(.5, .2, .6, .4)));
  // Moving b left so its top-left corner comes within 5 px of a's top-right corner.
  const moving = sq(.5, .2, .6, .4);
  const dx = (.4 * W + 5 - .5 * W) / W;
  const r = snapMove(moving, dx, 0, s, { shapeIds: ['b'] }, 10);
  assert.ok(Math.abs((.5 + r.dx) * W - .4 * W) < 1e-6);
  assert.ok(Math.abs(r.dy) < 1e-12);
  assert.equal(r.target?.kind, 'point');
});

test('joined corners are the other shapes’ corners on the same spot, holes included', () => {
  const s = show(
    shape('a', sq(.1, .1, .3, .3)),
    shape('b', sq(.3, .1, .5, .3)),
    shape('c', sq(.0, .0, .6, .6), { holes: [sq(.3 + .1 / W, .3, .35, .35)] }),
  );
  const joined = joinedAnchors(s, 'a', { x: .3, y: .1 });
  assert.deepEqual(joined, [{ shapeId: 'b', ring: -1, index: 0 }]);
  // Within half a projector pixel counts as the same spot.
  assert.deepEqual(joinedAnchors(s, 'a', { x: .3, y: .3 }).map(j => j.shapeId).sort(), ['b', 'c']);
});
