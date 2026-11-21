import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, latticeOf, pointGroupOf, type FoldSettings, type Vec2 } from '../src/core/symmetry';

const groups: [string, FoldSettings][] = [
  ['D2', { group: 0, segments: 2, cell: .3, cellAspect: 1 }],
  ['D3', { group: 0, segments: 3, cell: .3, cellAspect: 1 }],
  ['D6', { group: 0, segments: 6, cell: .3, cellAspect: 1 }],
  ['D12', { group: 0, segments: 12, cell: .3, cellAspect: 1 }],
  ['D24', { group: 0, segments: 24, cell: .3, cellAspect: 1 }],
  ['pmm', { group: 1, segments: 6, cell: .27, cellAspect: 1.6 }],
  ['p3m1', { group: 2, segments: 6, cell: .31, cellAspect: 1 }],
  ['p4m', { group: 3, segments: 6, cell: .23, cellAspect: 1 }],
  ['p6m', { group: 4, segments: 6, cell: .29, cellAspect: 1 }],
];

// A fixed pseudo-random sequence, so failures reproduce.
let state = 12345;
const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
const randomPoint = (): Vec2 => [(random() - .5) * 6, (random() - .5) * 6];
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rotate = (p: Vec2, a: number): Vec2 => [Math.cos(a) * p[0] - Math.sin(a) * p[1], Math.sin(a) * p[0] + Math.cos(a) * p[1]];
const reflect = (p: Vec2, a: number): Vec2 => [Math.cos(2 * a) * p[0] + Math.sin(2 * a) * p[1], Math.sin(2 * a) * p[0] - Math.cos(2 * a) * p[1]];

for (const [name, settings] of groups) {
  test(`${name}: the fold never moves two nearby points further apart (no seams)`, () => {
    // A piecewise isometry onto a domain whose every edge is a mirror is 1-Lipschitz.
    // A seam would show up as a jump far larger than the step.
    const step = 1e-4;
    for (let i = 0; i < 40000; i++) {
      const p = randomPoint(), a = random() * Math.PI * 2;
      const r: Vec2 = [p[0] + step * Math.cos(a), p[1] + step * Math.sin(a)];
      const jump = distance(fold(p, settings).q, fold(r, settings).q);
      assert.ok(jump <= step * (1 + 1e-6) + 1e-12, `${name}: step ${step} became ${jump} at ${p}`);
    }
  });

  test(`${name}: the fold is unchanged by the group's own symmetries`, () => {
    const lattice = latticeOf(settings), k = pointGroupOf(settings);
    for (let i = 0; i < 4000; i++) {
      const p = randomPoint(), q = fold(p, settings).q;
      const images: Vec2[] = [rotate(p, 2 * Math.PI / k), reflect(p, 0), reflect(p, Math.PI / k)];
      if (lattice.kind === 'rect') images.push([p[0] + lattice.px, p[1]], [p[0], p[1] - lattice.py]);
      if (lattice.kind === 'hex') images.push([p[0] + lattice.spacing * Math.sqrt(3) / 2, p[1] + lattice.spacing / 2], [p[0], p[1] - lattice.spacing]);
      for (const image of images) assert.ok(distance(fold(image, settings).q, q) < 1e-9, `${name}: image of ${p} folds elsewhere`);
    }
  });

  test(`${name}: the linear part matches the fold, so texture footprints are exact`, () => {
    const h = 1e-6, trials = 4000;
    let matched = 0;
    for (let i = 0; i < trials; i++) {
      const p = randomPoint(), { q, m } = fold(p, settings);
      let ok = true;
      for (const d of [[h, 0], [0, h]] as Vec2[]) {
        const moved = fold([p[0] + d[0], p[1] + d[1]], settings).q;
        const predicted: Vec2 = [q[0] + m[0] * d[0] + m[1] * d[1], q[1] + m[2] * d[0] + m[3] * d[1]];
        ok &&= distance(moved, predicted) <= 1e-9;
      }
      if (ok) matched++;
      assert.ok(Math.abs(Math.abs(m[0] * m[3] - m[1] * m[2]) - 1) < 1e-12, `${name}: linear part is not an isometry`);
    }
    // Only points within h of a fold line may cross it (the no-seam test covers those): a tiny fraction.
    assert.ok(matched >= trials * .999, `${name}: linear part matched only ${matched} of ${trials}`);
  });
}

test('folded points stay in one fundamental domain', () => {
  for (const [name, settings] of groups) {
    const k = pointGroupOf(settings), lattice = latticeOf(settings);
    for (let i = 0; i < 4000; i++) {
      const [x, y] = fold(randomPoint(), settings).q;
      const angle = Math.atan2(y, x);
      assert.ok(angle >= -1e-9 && angle <= Math.PI / k + 1e-9, `${name}: angle ${angle} outside the wedge`);
      if (lattice.kind === 'rect') assert.ok(x <= lattice.px / 2 + 1e-9 && y <= lattice.py / 2 + 1e-9, `${name}: outside the cell`);
      if (lattice.kind === 'hex') assert.ok(Math.hypot(x, y) <= lattice.spacing / Math.sqrt(3) + 1e-9, `${name}: outside the hexagon`);
    }
  }
});

test('the seam test catches a fold whose domain has a non-mirror edge', () => {
  // Rotation-only folding (cyclic C_6) leaves a seam where the wedge's two edges meet.
  const cyclic = (p: Vec2): Vec2 => { const w = Math.PI / 3, a = Math.atan2(p[1], p[0]); return rotate(p, -w * Math.floor(a / w)); };
  let worst = 0;
  for (let i = 0; i < 40000; i++) {
    const p = randomPoint(), a = random() * Math.PI * 2;
    worst = Math.max(worst, distance(cyclic(p), cyclic([p[0] + 1e-4 * Math.cos(a), p[1] + 1e-4 * Math.sin(a)])));
  }
  assert.ok(worst > 1e-2, `a seam should jump far more than the step, got ${worst}`);
});
