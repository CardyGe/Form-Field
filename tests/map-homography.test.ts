import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, invert, isPinnable, quadToQuad, squareToQuad, multiply } from '../src/map/homography';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 1e-6) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;
const trapezoid = [{ x: 400, y: 200 }, { x: 900, y: 250 }, { x: 1000, y: 800 }, { x: 300, y: 700 }];

test('the unit square lands exactly on the four corners, and its centre where the diagonals cross', () => {
  const h = squareToQuad(trapezoid)!;
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => assert.ok(close(apply(h, { x: u, y: v }), trapezoid[i])));
  // Where the diagonals q0-q2 and q1-q3 cross.
  const [a, b, c, d] = trapezoid;
  const den = (a.x - c.x) * (b.y - d.y) - (a.y - c.y) * (b.x - d.x);
  const t = ((a.x - b.x) * (b.y - d.y) - (a.y - b.y) * (b.x - d.x)) / den;
  const cross = { x: a.x + t * (c.x - a.x), y: a.y + t * (c.y - a.y) };
  assert.ok(close(apply(h, { x: .5, y: .5 }), cross));
});

test('a rectangle gives a plain scale and shift; inverting undoes it', () => {
  const h = squareToQuad([{ x: 100, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 250 }, { x: 100, y: 250 }])!;
  assert.ok(close(apply(h, { x: .25, y: .5 }), { x: 200, y: 150 }));
  const back = invert(h)!;
  for (const p of [{ x: 123, y: 77 }, { x: 480, y: 240 }]) assert.ok(close(apply(h, apply(back, p)), p));
  const hq = squareToQuad(trapezoid)!, iq = invert(hq)!;
  assert.ok(close(apply(multiply(hq, iq), { x: 512, y: 333 }), { x: 512, y: 333 }, 1e-6));
});

test('quad to quad carries one set of corners onto the other', () => {
  const from = [{ x: 0, y: 0 }, { x: 1920, y: 0 }, { x: 1920, y: 1080 }, { x: 0, y: 1080 }];
  const to = [{ x: 30, y: 10 }, { x: 1900, y: 0 }, { x: 1915, y: 1075 }, { x: 0, y: 1060 }];
  const h = quadToQuad(from, to)!;
  from.forEach((p, i) => assert.ok(close(apply(h, p), to[i], 1e-6)));
});

test('a bow-tie, a concave quad and a flat quad cannot be pinned', () => {
  assert.deepEqual(isPinnable(trapezoid), { ok: true });
  assert.deepEqual(isPinnable([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]), { ok: false, reason: 'pin-folded' });
  assert.deepEqual(isPinnable([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 100 }]), { ok: false, reason: 'pin-folded' });
  assert.deepEqual(isPinnable([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: .5 }, { x: 100, y: .5 }]), { ok: false, reason: 'pin-flat' });
  assert.equal(squareToQuad([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]), null);
  // Either way round counts: a quad drawn anticlockwise is fine.
  assert.deepEqual(isPinnable([...trapezoid].reverse()), { ok: true });
});
