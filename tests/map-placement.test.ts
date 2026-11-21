import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, validateShow, validateWireShow, IDENTITY_CORNERS, type ShowDocument } from '../src/map/show';
import { affineFromTriangle, homography, applyHomography, pinTriangles, quadUsable, unionRect, clampBrightness } from '../src/map/placement';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const rect = (id: string): EditAction => ({ type: 'addRectangle', id, a: { x: 0.1, y: 0.1 }, b: { x: 0.3, y: 0.3 }, colour: '#ff0000' });
function withShape(): ShowDocument {
  const r = applyEdit(createShow(), rect('a'));
  assert.ok(r.ok);
  return r.show;
}
const ok = (r: ReturnType<typeof applyEdit>): ShowDocument => {
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.show;
};

test('a homography maps its four source corners onto the destination corners', () => {
  const src = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  const dst = [{ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 320, y: 240 }, { x: 0, y: 200 }];
  const h = homography(src, dst)!;
  src.forEach((p, i) => { const q = applyHomography(h, p); near(q.x, dst[i].x); near(q.y, dst[i].y); });
});

test('a degenerate quad has no homography', () => {
  const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
  assert.equal(homography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], line), null);
});

test('an affine map takes a triangle to its target, and a flat triangle has none', () => {
  const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] as const;
  const dst = [{ x: 5, y: 7 }, { x: 25, y: 7 }, { x: 5, y: 17 }] as const;
  const m = affineFromTriangle([...src], [...dst])!;
  const [a, b, c, d, e, f] = m;
  dst.forEach((p, i) => { near(a * src[i].x + c * src[i].y + e, p.x); near(b * src[i].x + d * src[i].y + f, p.y); });
  assert.equal(affineFromTriangle([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], [...dst]), null);
});

test('a pinned grid of a rectangle onto itself leaves every triangle in place', () => {
  const quad = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }] as const;
  const tris = pinTriangles([...quad], 80, 40, 4, 2);
  assert.equal(tris.length, 4 * 2 * 2);
  for (const t of tris) t.src.forEach((p, i) => { near(t.dst[i].x, p.x); near(t.dst[i].y, p.y); });
});

test('a pinned grid on a skewed quad lands its corners on the pins', () => {
  const quad = [{ x: 100, y: 20 }, { x: 400, y: 60 }, { x: 380, y: 300 }, { x: 60, y: 260 }] as const;
  const tris = pinTriangles([...quad], 200, 150, 8, 8);
  // the picture's corner (0,0) lands on the first pin
  const corner0 = tris.find(t => t.src.some(p => p.x === 0 && p.y === 0))!;
  const at0 = corner0.src.findIndex(p => p.x === 0 && p.y === 0);
  near(corner0.dst[at0].x, quad[0].x); near(corner0.dst[at0].y, quad[0].y);
});

test('quads are usable when convex, the right size, and not folded over', () => {
  assert.ok(quadUsable([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 1e-6));
  assert.ok(!quadUsable([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 1e-6), 'a bow-tie folds over');
  assert.ok(!quadUsable([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 0, y: 0 }], 1e-6), 'collapsed');
  assert.ok(!quadUsable([{ x: 0, y: 0 }, { x: 1e-4, y: 0 }, { x: 1e-4, y: 1e-4 }, { x: 0, y: 1e-4 }], 1e-6), 'too small');
  assert.ok(!quadUsable([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 1e-6), 'three corners');
  assert.ok(!quadUsable([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: NaN, y: 1 }, { x: 0, y: 1 }], 1e-6), 'not finite');
});

test('unionRect spans several rectangles, and nothing gives null', () => {
  assert.deepEqual(unionRect([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 5, h: 30 }]), { x: 0, y: 0, w: 25, h: 35 });
  assert.equal(unionRect([]), null);
});

test('brightness is clamped to 0 to 2, and a bad value is 1', () => {
  assert.equal(clampBrightness(5), 2);
  assert.equal(clampBrightness(-1), 0);
  assert.equal(clampBrightness(NaN), 1);
});

test('a new shape is fit, unpinned, at full brightness with no tint', () => {
  const shape = withShape().shapes[0];
  assert.deepEqual(shape.placement, { mode: 'fit', pins: [] });
  assert.deepEqual(shape.look, { brightness: 1, tint: null, tintAmount: 0.5 });
});

test('pin takes the shape\'s own four corners, or its box when it has more', () => {
  const show = withShape();
  const pinned = ok(applyEdit(show, { type: 'setPlacement', shapeId: show.shapes[0].id, mode: 'pin' }));
  assert.equal(pinned.shapes[0].placement.mode, 'pin');
  assert.equal(pinned.shapes[0].placement.pins.length, 4);
  assert.deepEqual(pinned.shapes[0].placement.pins[0], { x: 0.1, y: 0.1 });
});

test('a pin that folds over is refused, and a corner can be moved', () => {
  const show = withShape();
  const id = show.shapes[0].id;
  const pinned = ok(applyEdit(show, { type: 'setPlacement', shapeId: id, mode: 'pin' }));
  const bad = applyEdit(pinned, { type: 'movePin', shapeId: id, index: 1, to: { x: 0.1, y: 0.4 } });
  assert.equal(bad.ok, false);
  const moved = ok(applyEdit(pinned, { type: 'movePin', shapeId: id, index: 0, to: { x: 0.15, y: 0.12 } }));
  assert.deepEqual(moved.shapes[0].placement.pins[0], { x: 0.15, y: 0.12 });
  const back = ok(applyEdit(moved, { type: 'setPlacement', shapeId: id, mode: 'fit' }));
  assert.equal(back.shapes[0].placement.mode, 'fit');
  assert.deepEqual(back.shapes[0].placement.pins, []);
  assert.equal(applyEdit(back, { type: 'movePin', shapeId: id, index: 0, to: { x: 0.2, y: 0.2 } }).ok, false, 'not pinned');
});

test('brightness and tint are set and clamped', () => {
  const show = withShape();
  const id = show.shapes[0].id;
  const next = ok(applyEdit(show, { type: 'setLook', shapeId: id, look: { brightness: 9, tint: '#00ff00', tintAmount: 2 } }));
  assert.deepEqual(next.shapes[0].look, { brightness: 2, tint: '#00ff00', tintAmount: 1 });
  assert.equal(applyEdit(show, { type: 'setLook', shapeId: id, look: { brightness: 1, tint: 'green', tintAmount: 0.5 } }).ok, false);
});

test('stage corners move one at a time, must form a usable quad, and reset', () => {
  const show = withShape();
  const moved = ok(applyEdit(show, { type: 'setStageCorner', index: 2, to: { x: 0.9, y: 0.95 } }));
  assert.deepEqual(moved.stageCorners[2], { x: 0.9, y: 0.95 });
  assert.equal(applyEdit(show, { type: 'setStageCorner', index: 1, to: { x: 0.0, y: 1 } }).ok, false, 'folds over');
  assert.equal(applyEdit(show, { type: 'setStageCorner', index: 7, to: { x: 0.5, y: 0.5 } }).ok, false);
  const reset = ok(applyEdit(moved, { type: 'resetStageCorners' }));
  assert.deepEqual(reset.stageCorners, IDENTITY_CORNERS);
});

test('a version 3 file opens with fit placement and identity stage corners, not repaired', () => {
  const doc = { format: 'formshow', version: 3, stage: { width: 1920, height: 1080 }, shapes: [{ id: 'a', name: 'A', colour: '#ff0000', visible: true, locked: false, sourceId: null, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }] }], sources: [], groups: [], photo: null };
  const r = validateShow(doc);
  assert.equal(r.repaired, false);
  assert.equal(r.show.version, 4);
  assert.equal(r.show.shapes[0].placement.mode, 'fit');
  assert.deepEqual(r.show.stageCorners, IDENTITY_CORNERS);
});

test('a pin with an unusable quad in a file falls back to fit, and is repaired', () => {
  const doc = { format: 'formshow', version: 4, stage: { width: 1920, height: 1080 }, shapes: [{ id: 'a', name: 'A', colour: '#ff0000', visible: true, locked: false, sourceId: null, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }], placement: { mode: 'pin', pins: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] }, look: { brightness: 1, tint: null, tintAmount: 0.5 } }], sources: [], groups: [], photo: null, stageCorners: IDENTITY_CORNERS };
  const r = validateShow(doc);
  assert.equal(r.show.shapes[0].placement.mode, 'fit');
  assert.equal(r.repaired, true);
});

test('the wall receives placement, look and stage corners', () => {
  let show = withShape();
  show = ok(applyEdit(show, { type: 'setStageCorner', index: 0, to: { x: 0.02, y: 0.03 } }));
  show = ok(applyEdit(show, { type: 'setLook', shapeId: show.shapes[0].id, look: { brightness: 0.5, tint: '#112233', tintAmount: 0.25 } }));
  const wire = validateWireShow(JSON.parse(JSON.stringify(show)));
  assert.deepEqual(wire.stageCorners, show.stageCorners);
  assert.deepEqual(wire.shapes[0].look, show.shapes[0].look);
});
