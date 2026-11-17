import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flatten, shapeValidity, hitShape, nearestSide, insertPoint, removePoint, setCurve, moveHandle, ellipseRing, triangleRing,
  squareBox, transformRing, scaleAbout, rotateAbout, gridCells, ringBounds, isCurved, CURVE_STEPS,
} from '../src/map/outline';
import { STAGE_SIZE, type CurvePoint } from '../src/map/show';
import { pointInPolygon } from '../src/map/geometry';

const W = STAGE_SIZE.width, H = STAGE_SIZE.height;
const px = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });
const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test('a square is valid, and a straight ring flattens to its own corners', () => {
  const s = sq(.2, .2, .6, .6);
  assert.deepEqual(shapeValidity(s, []), { ok: true });
  assert.deepEqual(flatten(s), s.map(({ x, y }) => ({ x, y })));
});

test('a curved side flattens into CURVE_STEPS pieces, through its end points', () => {
  const s = sq(.2, .2, .6, .6);
  s[0] = { ...s[0], out: { x: .1, y: -.1 } };
  const flat = flatten(s);
  assert.equal(flat.length, 4 + CURVE_STEPS - 1);
  assert.deepEqual(flat[0], { x: .2, y: .2 });
  assert.ok(near(flat[CURVE_STEPS].x, .6, 1e-12) && near(flat[CURVE_STEPS].y, .2, 1e-12));
  assert.ok(isCurved(s[0]) && !isCurved(s[1]));
});

test('a curve bulging across the opposite side is a crossing; an S-curve side is valid', () => {
  const s = sq(.2, .2, .6, .6);
  // The top side bends down past the bottom side.
  s[0] = { ...s[0], out: { x: 0, y: .7 } }; s[1] = { ...s[1], in: { x: 0, y: .7 } };
  assert.deepEqual(shapeValidity(s, []), { ok: false, reason: 'crossing' });
  const t = sq(.2, .2, .6, .6);
  t[0] = { ...t[0], out: { x: .1, y: -.1 } }; t[1] = { ...t[1], in: { x: -.1, y: .1 } };
  assert.deepEqual(shapeValidity(t, []), { ok: true });
});

test('holes: inside is valid; touching the outline, overlapping, nested or too many are refused', () => {
  const outer = sq(.1, .1, .9, .9);
  assert.deepEqual(shapeValidity(outer, [sq(.3, .3, .5, .5)]), { ok: true });
  assert.deepEqual(shapeValidity(outer, [sq(.05, .3, .5, .5)]), { ok: false, reason: 'hole-outside' });
  assert.deepEqual(shapeValidity(outer, [sq(.3, .3, .5, .5), sq(.4, .4, .6, .6)]), { ok: false, reason: 'holes-overlap' });
  assert.deepEqual(shapeValidity(outer, [sq(.3, .3, .7, .7), sq(.4, .4, .5, .5)]), { ok: false, reason: 'holes-overlap' });
  const nine = Array.from({ length: 9 }, (_, i) => sq(.12 + i * .08, .4, .17 + i * .08, .45));
  assert.deepEqual(shapeValidity(outer, nine), { ok: false, reason: 'too-many-holes' });
  assert.deepEqual(shapeValidity(outer, [[{ x: .3, y: .3 }, { x: .5, y: .5 }, { x: .5, y: .3 }, { x: .3, y: .5 }]]), { ok: false, reason: 'crossing' });
});

test('more than 32 points in the outline and holes together are too many', () => {
  const circle = (cx: number, cy: number, r: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(i / n * Math.PI * 2), y: cy + r * Math.sin(i / n * Math.PI * 2) }));
  assert.deepEqual(shapeValidity(circle(.5, .5, .4, 24), [circle(.5, .5, .1, 8)]), { ok: true });
  assert.deepEqual(shapeValidity(circle(.5, .5, .4, 24), [circle(.5, .5, .1, 9)]), { ok: false, reason: 'too-many' });
});

test('hit test: inside the outline but in a hole is a miss', () => {
  const outer = sq(.1, .1, .9, .9), hole = sq(.3, .3, .5, .5);
  assert.equal(hitShape({ x: .2, y: .2 }, outer, [hole]), true);
  assert.equal(hitShape({ x: .4, y: .4 }, outer, [hole]), false);
  assert.equal(hitShape({ x: .95, y: .4 }, outer, [hole]), false);
});

test('nearest side reports the side and how far along it', () => {
  const s = sq(.2, .2, .6, .6);
  const near1 = nearestSide({ x: .4, y: .21 }, s);
  assert.equal(near1.index, 0);
  assert.ok(near(near1.t, .5, .02));
  assert.ok(near(near1.distance, .01 * H, .5));
});

test('inserting a point on a curved side keeps the curve where it was', () => {
  const s = sq(.2, .2, .6, .6);
  s[0] = { ...s[0], out: { x: .1, y: -.15 } }; s[1] = { ...s[1], in: { x: -.05, y: -.1 } };
  const before = flatten(s, 200).map(px);
  const after = insertPoint(s, 0, .37);
  assert.equal(after.length, 5);
  // Every point of the new outline lies on the old one.
  for (const p of flatten(after, 50).map(px)) {
    const d = Math.min(...before.map(q => Math.hypot(p.x - q.x, p.y - q.y)));
    assert.ok(d < 0.5 + 2, `off the old curve by ${d}`);
  }
  // On a straight side the new point is a corner halfway along.
  const straight = insertPoint(sq(.2, .2, .6, .6), 1, .5);
  assert.deepEqual(straight[2], { x: .6, y: .4 });
});

test('removing a point leaves the others; smooth handles are in line', () => {
  const s = sq(.2, .2, .6, .6);
  assert.equal(removePoint(s, 1).length, 3);
  const curved = setCurve(s, 1, true)[1];
  assert.ok(curved.in && curved.out);
  const a = px(curved.in!), b = px(curved.out!);
  assert.ok(Math.abs(a.x * b.y - a.y * b.x) < 1e-6, 'in and out point in opposite directions');
  assert.ok(a.x * b.x + a.y * b.y < 0);
  const corner = setCurve(setCurve(s, 1, true), 1, false)[1];
  assert.deepEqual(corner, { x: .6, y: .2 });
});

test('moving a handle mirrors the other one unless asked not to', () => {
  const s = setCurve(sq(.2, .2, .6, .6), 1, true);
  const otherLength = Math.hypot(px(s[1].out!).x, px(s[1].out!).y);
  const mirrored = moveHandle(s, 1, 'in', { x: .5, y: .1 }, true)[1];
  const i = px(mirrored.in!), o = px(mirrored.out!);
  assert.ok(Math.abs(i.x * o.y - i.y * o.x) < 1e-6 && i.x * o.x + i.y * o.y < 0);
  assert.ok(near(Math.hypot(o.x, o.y), otherLength, 1e-6), 'the other handle keeps its length');
  const free = moveHandle(s, 1, 'in', { x: .5, y: .1 }, false)[1];
  assert.deepEqual(free.out, s[1].out);
  assert.ok(near(free.in!.x, -.1, 1e-12) && near(free.in!.y, -.1, 1e-12));
});

test('an ellipse is four curve points that stay within 0.3 % of a true ellipse', () => {
  const ring = ellipseRing({ x: .2, y: .2 }, { x: .6, y: .8 });
  assert.equal(ring.length, 4);
  assert.ok(ring.every(isCurved));
  const cx = .4 * W, cy = .5 * H, rx = .2 * W, ry = .3 * H;
  for (const p of flatten(ring, 32).map(px)) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    assert.ok(Math.abs(r - 1) < 0.003, `radius ${r}`);
  }
  assert.deepEqual(shapeValidity(ring, []), { ok: true });
});

test('a triangle has its tip at the top centre; a square box is square in projector pixels', () => {
  assert.deepEqual(triangleRing({ x: .2, y: .2 }, { x: .6, y: .8 }), [{ x: .4, y: .2 }, { x: .6, y: .8 }, { x: .2, y: .8 }]);
  const b = squareBox({ x: .1, y: .1 }, { x: .3, y: .2 });
  assert.ok(near((b.x - .1) * W, (b.y - .1) * H, 1e-6));
  const up = squareBox({ x: .5, y: .5 }, { x: .4, y: .3 });
  assert.ok(near((.5 - up.x) * W, (.5 - up.y) * H, 1e-6));
});

test('turning a quarter and back, or flipping twice, changes nothing', () => {
  const s = setCurve(sq(.3, .3, .5, .6), 2, true);
  const centre = { x: .4 * W, y: .45 * H };
  const back = transformRing(transformRing(s, rotateAbout(centre, Math.PI / 2)), rotateAbout(centre, -Math.PI / 2));
  const flipped = transformRing(transformRing(s, scaleAbout(centre, -1, 1)), scaleAbout(centre, -1, 1));
  for (const r of [back, flipped]) r.forEach((p, i) => {
    assert.ok(near(p.x, s[i].x, 1e-9) && near(p.y, s[i].y, 1e-9));
    if (s[i].in) assert.ok(near(p.in!.x, s[i].in!.x, 1e-9) && near(p.in!.y, s[i].in!.y, 1e-9));
  });
  // A quarter turn about the centre keeps lengths in projector pixels, so a 0.2 × 0.3 box becomes 0.3·H/W × 0.2·W/H.
  const b = ringBounds([transformRing(sq(.3, .3, .5, .6), rotateAbout(centre, Math.PI / 2))]);
  assert.ok(near((b.x1 - b.x0) * W, .3 * H, 1e-6) && near((b.y1 - b.y0) * H, .2 * W, 1e-6));
});

test('a 2 × 2 grid with no gap tiles the shape; a gap leaves that many pixels', () => {
  const cells = gridCells(sq(.2, .2, .6, .6), 2, 2, 0)!;
  assert.equal(cells.length, 4);
  assert.deepEqual(cells[0], sq(.2, .2, .4, .4));
  const gapped = gridCells(sq(.2, .2, .6, .6), 2, 2, 20)!;
  assert.equal(gridCells(sq(.2, .2, .6, .6), 2, 2, 800), null);
  assert.ok(near((gapped[1][0].x - gapped[0][1].x) * W, 20, 1e-6));
  assert.ok(near((gapped[2][0].y - gapped[0][3].y) * H, 20, 1e-6));
  // The outer edge stays where it was.
  assert.ok(near(gapped[0][0].x, .2, 1e-12) && near(gapped[3][2].y, .6, 1e-12));
});

test('grid cells of a skewed four-corner shape share corners and stay inside it', () => {
  const quad = [{ x: .2, y: .25 }, { x: .7, y: .2 }, { x: .65, y: .7 }, { x: .25, y: .6 }];
  const cells = gridCells(quad, 3, 2, 0)!;
  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0][1], cells[1][0]);
  assert.deepEqual(cells[0][2], cells[2][1]);
  for (const cell of cells) for (const p of cell) assert.ok(pointInPolygon({ x: (p.x * 2 + .45) / 3, y: (p.y * 2 + .44) / 3 }, quad));
});

test('a grid follows the outline from its top-left corner, whichever way it was drawn', () => {
  const backwards = [{ x: .6, y: .6 }, { x: .6, y: .2 }, { x: .2, y: .2 }, { x: .2, y: .6 }];
  assert.deepEqual(gridCells(backwards, 1, 2, 0)![0], sq(.2, .2, .4, .6));
});
