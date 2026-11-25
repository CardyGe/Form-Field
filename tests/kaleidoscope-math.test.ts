import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_TABLES, SYMMETRY_GROUPS, foldPoint, sanitiseSpiral, spiralTau, type SymmetryGroup } from '../src/core/kaleidoscope-math';

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const range = (s: number) => (rnd() * 2 - 1) * s;
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
const lattice = SYMMETRY_GROUPS.filter(g => g !== 'rosette') as Exclude<SymmetryGroup, 'rosette'>[];

test('every fold stays continuous: a small step never grows', () => {
  const h = 1e-4;
  for (const g of SYMMETRY_GROUPS) {
    for (let i = 0; i < 30000; i++) {
      const p = { x: range(20), y: range(20) };
      const ang = rnd() * Math.PI * 2;
      const q = { x: p.x + h * Math.cos(ang), y: p.y + h * Math.sin(ang) };
      const d = dist(foldPoint(g, p, 7).p, foldPoint(g, q, 7).p);
      assert.ok(d <= h * (1 + 1e-6), `${g} grew ${d / h}`);
    }
  }
});

test('wallpaper folds repeat on their lattice', () => {
  for (const g of lattice) {
    const { a, b } = GROUP_TABLES[g];
    for (let i = 0; i < 2000; i++) {
      const p = { x: range(10), y: range(10) };
      const q = { x: p.x + 3 * a.x - 2 * b.x, y: p.y + 3 * a.y - 2 * b.y };
      assert.ok(dist(foldPoint(g, p, 6).p, foldPoint(g, q, 6).p) < 1e-9, g);
    }
  }
});

test('the linear part is orthogonal and maps a step to the folded step', () => {
  const h = 1e-6;
  for (const g of SYMMETRY_GROUPS) {
    for (let i = 0; i < 2000; i++) {
      const p = { x: range(10), y: range(10) };
      const f = foldPoint(g, p, 5);
      const [m00, m01, m10, m11] = f.linear;
      assert.ok(Math.abs(m00 * m00 + m10 * m10 - 1) < 1e-9);
      assert.ok(Math.abs(m01 * m01 + m11 * m11 - 1) < 1e-9);
      assert.ok(Math.abs(m00 * m01 + m10 * m11) < 1e-9);
      const dx = h, dy = h * 0.5;
      const f2 = foldPoint(g, { x: p.x + dx, y: p.y + dy }, 5);
      // skip steps that cross a wall (different reflection sequence)
      if (f2.reflections !== f.reflections || f2.linear.some((v, k) => Math.abs(v - f.linear[k]) > 1e-9)) continue;
      assert.ok(Math.abs(f2.p.x - f.p.x - (m00 * dx + m01 * dy)) < 1e-10, g);
      assert.ok(Math.abs(f2.p.y - f.p.y - (m10 * dx + m11 * dy)) < 1e-10, g);
    }
  }
});

test('rosettes are continuous for every n from 3 to 24', () => {
  const h = 1e-4;
  for (let n = 3; n <= 24; n++) {
    for (let i = 0; i < 2000; i++) {
      const p = { x: range(5), y: range(5) };
      const ang = rnd() * Math.PI * 2;
      const q = { x: p.x + h * Math.cos(ang), y: p.y + h * Math.sin(ang) };
      assert.ok(dist(foldPoint('rosette', p, n).p, foldPoint('rosette', q, n).p) <= h * (1 + 1e-6), `n=${n}`);
    }
    const r = foldPoint('rosette', { x: 1, y: 0.3 }, n).p;
    const t = Math.atan2(r.y, r.x);
    assert.ok(t <= Math.PI / n + 1e-12 && t >= -1e-12);
  }
});

test('one turn moves the spiral by exactly (a, b)', () => {
  // tau is principal-valued, so compare either side of the branch cut at the same radius:
  // the angle differs by 2 pi - 2 eps, hence tau differs by (a, b) * (1 - eps / pi) exactly.
  const eps = 1e-3, k = 1 - eps / Math.PI;
  for (const lambda of [2, 4, 16, 256]) {
    for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) {
      if (a === 0 && b === 0) continue;
      const r = 0.2 + rnd() * 3;
      const hi = spiralTau({ x: r * Math.cos(Math.PI - eps), y: r * Math.sin(Math.PI - eps) }, a, b, lambda);
      const lo = spiralTau({ x: r * Math.cos(-Math.PI + eps), y: r * Math.sin(-Math.PI + eps) }, a, b, lambda);
      assert.ok(Math.abs(hi.x - lo.x - a * k) < 1e-9 && Math.abs(hi.y - lo.y - b * k) < 1e-9, `${lambda} ${a} ${b}`);
    }
  }
});

test('the exact centre returns finite values', () => {
  for (const g of SYMMETRY_GROUPS) {
    const f = foldPoint(g, { x: 0, y: 0 }, 6);
    assert.ok(Number.isFinite(f.p.x) && Number.isFinite(f.p.y) && f.linear.every(Number.isFinite));
  }
  assert.deepEqual(foldPoint('rosette', { x: 0, y: 0 }, 6).linear, [1, 0, 0, 1]);
  const t = spiralTau({ x: 0, y: 0 }, 1, 2, 4);
  assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
});

test('sanitiseSpiral rounds and refuses (0,0)', () => {
  assert.deepEqual(sanitiseSpiral(0, 0), { a: 0, b: 1 });
  assert.deepEqual(sanitiseSpiral(0.4, -0.2), { a: 0, b: 1 });
  assert.deepEqual(sanitiseSpiral(2.6, -1.4), { a: 3, b: -1 });
});
