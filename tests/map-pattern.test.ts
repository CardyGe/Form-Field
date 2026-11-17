import test from 'node:test';
import assert from 'node:assert/strict';
import { patternLines } from '../src/map/pattern';
import { shapeExtras, STAGE_SIZE, type CurvePoint, type Shape } from '../src/map/show';

const W = STAGE_SIZE.width, H = STAGE_SIZE.height;
const shape = (points: CurvePoint[]): Shape => ({ id: 'a', name: 'A', colour: '#ff0000', visible: true, locked: false, sourceId: null, points, ...shapeExtras() });
const onSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;

test('a four-corner shape gets lines that run from side to side, following its corners, with centre lines marked', () => {
  const quad = [{ x: .2, y: .25 }, { x: .6, y: .2 }, { x: .55, y: .7 }, { x: .25, y: .6 }];
  const { lines, diagonals } = patternLines(shape(quad));
  const q = quad.map(p => ({ x: p.x * W, y: p.y * H }));
  for (const line of lines) {
    const ends = [line.a, line.b];
    const sides = [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]];
    for (const end of ends) assert.ok(sides.some(([a, b]) => onSegment(end, a, b)), 'each line ends on a side');
  }
  assert.equal(lines.filter(l => l.major).length, 2, 'one centre line each way');
  assert.equal(diagonals.length, 2);
});

test('line spacing follows the shape size: about every 80 projector pixels, an even count so a centre line exists', () => {
  // 768 × 432 px rectangle: 10 columns and 6 rows, so 9 + 5 lines.
  const { lines } = patternLines(shape([{ x: .2, y: .2 }, { x: .6, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]));
  assert.equal(lines.length, 9 + 5);
  // A tiny shape still gets its centre lines.
  const tiny = patternLines(shape([{ x: .2, y: .2 }, { x: .21, y: .2 }, { x: .21, y: .21 }, { x: .2, y: .21 }]));
  assert.equal(tiny.lines.length, 2);
});

test('other shapes get straight lines across their box (clipped when drawn), and no diagonals', () => {
  const { lines, diagonals } = patternLines(shape([{ x: .4, y: .2 }, { x: .6, y: .6 }, { x: .2, y: .6 }]));
  assert.ok(lines.every(l => l.a.x === l.b.x || l.a.y === l.b.y));
  assert.deepEqual(diagonals, []);
});
