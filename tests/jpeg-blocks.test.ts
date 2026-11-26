import test from 'node:test';
import assert from 'node:assert/strict';
import { blockGrid, dct8, idct8, jpegSamples, quantStep } from '../src/rendering/jpeg-blocks';

test('the 8-point transform round-trips', () => {
  const row = [0, .1, .5, .9, 1, .3, .2, .7];
  idct8(dct8(row)).forEach((v, i) => assert.ok(Math.abs(v - row[i]) < 1e-9));
});
test('a flat row has energy only in the first term', () => {
  const c = dct8(new Array(8).fill(.5));
  assert.ok(c.slice(1).every(v => Math.abs(v) < 1e-12));
});
test('the transform keeps energy, so a row and its terms have the same length', () => {
  const row = [.3, .8, .1, .4, .9, .2, .6, .5], c = dct8(row);
  const length = (v: number[]) => Math.hypot(...v);
  assert.ok(Math.abs(length(row) - length(c)) < 1e-12);
});
test('lower quality means coarser steps, more so for fine detail and colour', () => {
  assert.ok(quantStep(0, 0, false) > quantStep(0, 1, false));
  assert.ok(quantStep(63, .5, false) > quantStep(1, .5, false));
  assert.ok(quantStep(10, .5, true) >= quantStep(10, .5, false));
});
test('colour steps are never finer than brightness steps, and steps never pass a whole range', () => {
  for (const quality of [0, .2, .5, .8, 1]) for (let i = 0; i < 64; i++) {
    assert.ok(quantStep(i, quality, true) >= quantStep(i, quality, false));
    assert.ok(quantStep(i, quality, true) <= 1 && quantStep(i, quality, false) > 0);
  }
});
test('block grids are sized in 1080-line pixels', () => {
  assert.deepEqual(blockGrid(1920, 1080, 8), { cols: 240, rows: 135 });
  assert.deepEqual(blockGrid(3840, 2160, 8), { cols: 240, rows: 135 });
  assert.deepEqual(blockGrid(960, 540, 12), { cols: 160, rows: 90 });
  // A part block at the right and bottom edges still counts.
  assert.deepEqual(blockGrid(1920, 1080, 7), { cols: 275, rows: 155 });
});
test('a block under 8 output pixels takes one sample per output pixel, so the grid follows the frame', () => {
  assert.deepEqual(jpegSamples(8, 1080), { n: 8, nc: 8 });
  assert.deepEqual(jpegSamples(8, 540), { n: 4, nc: 8 });
  assert.deepEqual(jpegSamples(4, 540), { n: 2, nc: 4 });
  assert.deepEqual(jpegSamples(4, 2160), { n: 8, nc: 8 });
  assert.deepEqual(jpegSamples(4, 270), { n: 1, nc: 2 });
  assert.deepEqual(jpegSamples(7, 540), { n: 4, nc: 7 });
});
