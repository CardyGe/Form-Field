import test from 'node:test';
import assert from 'node:assert/strict';
import { landing, sourceSizeFor } from '../src/map/placement';
import { apply } from '../src/map/homography';
import { createShow, shapeExtras, STAGE_SIZE, type CurvePoint, type Placement, type Shape } from '../src/map/show';

const W = STAGE_SIZE.width, H = STAGE_SIZE.height;
const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const shape = (id: string, points: CurvePoint[], placement: Partial<Placement> = {}, over: Partial<Shape> = {}): Shape => {
  const base = shapeExtras();
  return { id, name: id, colour: '#ffffff', visible: true, locked: false, sourceId: null, points, ...base, placement: { ...base.placement, ...placement }, ...over };
};
const show = (...shapes: Shape[]) => ({ ...createShow(), shapes });
const at = (s: Shape, u: number, v: number, sh = show(s)) => apply(landing(s, sh).h, { x: u, y: v });
const close = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 1e-6) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;

test('Fit covers the shape’s box; zoom 2 doubles it about its centre; Move shifts it', () => {
  const s = shape('a', sq(.25, .25, .5, .5));
  assert.ok(close(at(s, 0, 0), { x: .25 * W, y: .25 * H }) && close(at(s, 1, 1), { x: .5 * W, y: .5 * H }));
  const z = shape('a', sq(.25, .25, .5, .5), { zoom: 2 });
  assert.ok(close(at(z, 0, 0), { x: .125 * W, y: .125 * H }) && close(at(z, 1, 1), { x: .625 * W, y: .625 * H }));
  const m = shape('a', sq(.25, .25, .5, .5), { offset: { x: .1, y: -.05 } });
  assert.ok(close(at(m, 0, 0), { x: .35 * W, y: .2 * H }));
  assert.equal(landing(s, show(s)).perspective, false);
});

test('Turn 90 degrees turns the picture about the box centre in projector pixels', () => {
  const s = shape('a', sq(.25, .25, .5, .5), { turn: 90 });
  const c = { x: .375 * W, y: .375 * H };
  const tl = at(s, 0, 0);
  // The top-left corner of the picture goes to the top-right, a quarter turn clockwise on screen.
  assert.ok(close(tl, { x: c.x + .125 * H, y: c.y - .125 * W }, 1e-6));
});

test('Across stage covers the whole stage; Across group covers the group’s members; no group means the stage', () => {
  const a = shape('a', sq(.1, .1, .2, .2), { kind: 'across-stage' });
  assert.ok(close(at(a, 0, 0), { x: 0, y: 0 }) && close(at(a, 1, 1), { x: W, y: H }));
  const g1 = shape('g1', sq(.1, .1, .2, .2), { kind: 'across-group' }, { groupId: 'g' });
  const g2 = shape('g2', sq(.5, .4, .6, .7), { kind: 'across-group' }, { groupId: 'g' });
  const sh = { ...show(g1, g2), groups: [{ id: 'g', name: 'G', visible: true, locked: false }] };
  assert.ok(close(at(g1, 0, 0, sh), { x: .1 * W, y: .1 * H }) && close(at(g1, 1, 1, sh), { x: .6 * W, y: .7 * H }));
  const alone = shape('x', sq(.1, .1, .2, .2), { kind: 'across-group' });
  assert.ok(close(at(alone, 1, 1), { x: W, y: H }));
});

test('Pin uses a four-point shape’s own corners from its top-left, whichever way it was drawn; other shapes use the stored pin or their box', () => {
  const quad = [{ x: .6, y: .7 }, { x: .65, y: .2 }, { x: .2, y: .25 }, { x: .25, y: .6 }];
  const s = shape('a', quad, { kind: 'pin' });
  const l = landing(s, show(s));
  assert.equal(l.perspective, true);
  assert.ok(close(at(s, 0, 0), { x: .2 * W, y: .25 * H }), 'the top-left corner first');
  assert.ok(close(at(s, 1, 0), { x: .65 * W, y: .2 * H }), 'then clockwise');
  const tri = shape('t', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }], { kind: 'pin' });
  assert.ok(close(at(tri, 0, 0), { x: .2 * W, y: .2 * H }) && close(at(tri, 1, 1), { x: .6 * W, y: .6 * H }));
  const stored = shape('t', [{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }], { kind: 'pin', pin: [{ x: .3, y: .2 }, { x: .6, y: .25 }, { x: .6, y: .6 }, { x: .2, y: .55 }] });
  assert.ok(close(at(stored, 1, 0), { x: .6 * W, y: .25 * H }));
});

test('a shared picture is drawn at the largest place it lands, kept within the stage and at least 64 pixels', () => {
  const small = landing(shape('a', sq(.1, .1, .2, .2)), show());
  const big = landing(shape('b', sq(.1, .1, .6, .5)), show());
  assert.deepEqual(sourceSizeFor([small, big], 1), { width: 960, height: 432 });
  assert.deepEqual(sourceSizeFor([small], .5), { width: 96, height: 64 });
  const stage = landing(shape('c', sq(.1, .1, .2, .2), { kind: 'across-stage', zoom: 2 }), show());
  assert.deepEqual(sourceSizeFor([stage], 1), { width: 1920, height: 1080 });
});
