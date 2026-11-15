'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { measureSeam, describeSeam, seamFrames, measureEdges, describeEdges } = require('./seam-check.cjs');

const WIDTH = 512;
const N = 60;

// A travelling sine wave whose phase is phaseOf(frameIndex).
function frame(phase) {
  const values = new Float32Array(WIDTH);
  for (let x = 0; x < WIDTH; x++) values[x] = 0.5 + 0.4 * Math.sin((x / WIDTH) * 2 * Math.PI * 6 + phase);
  return values;
}
const around = phaseOf => seamFrames(N).map(index => frame(phaseOf(index)));

test('seam frames sit either side of the loop point', () => {
  assert.deepEqual(seamFrames(60), [54, 55, 56, 57, 58, 59, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(seamFrames(8), [4, 5, 6, 7, 0, 1, 2, 3]);
  assert.deepEqual(seamFrames(5), []);
});

test('a loop whose phase closes exactly is clean', () => {
  const result = measureSeam(around(i => (2 * Math.PI * i) / N));
  assert.equal(result.status, 'clean');
  assert.ok(Math.abs(result.jump.ratio - 1) < 0.05, `jump ratio ${result.jump.ratio}`);
  assert.match(describeSeam(result), /clean/);
});

test('a loop that stops short of its start pops at the seam', () => {
  // Travels 80% of a cycle and then snaps back.
  const result = measureSeam(around(i => (2 * Math.PI * 0.8 * i) / N));
  assert.equal(result.status, 'seam');
  assert.ok(result.jump.ratio > 5, `jump ratio ${result.jump.ratio}`);
  assert.match(describeSeam(result), /jumps/);
});

test('motion that reverses at the loop point is a hitch even without a pop', () => {
  // Ping-pong: forward for half the loop, back for the other half.
  const triangle = i => 2 * Math.PI * 0.25 * (i < N / 2 ? i / (N / 2) : 2 - i / (N / 2));
  const result = measureSeam(around(triangle));
  assert.ok(result.jump.ratio < 1.5, `jump ratio ${result.jump.ratio}`);
  assert.equal(result.status, 'seam');
  assert.match(describeSeam(result), /changes speed/);
});

test('still and near-still loops pass despite meaningless ratios', () => {
  assert.equal(measureSeam(around(() => 1)).status, 'clean');
  // Sub-code-value shimmer that happens to peak at the seam.
  const tiny = around(() => 1).map((values, k) => values.map(v => v + (k === 6 ? 0.002 : 0)));
  assert.equal(measureSeam(tiny).status, 'clean');
});

test('skipped and failed checks are described plainly', () => {
  assert.match(describeSeam({ status: 'skipped' }), /too short/);
  assert.match(describeSeam({ status: 'error', message: 'decode failed' }), /decode failed/);
});

test('held film frames are not mistaken for a seam', () => {
  // A 12 fps film clock inside a 30 fps loop: the picture changes on some frames and repeats on others.
  const filmFrames = N * 12 / 30;
  const held = i => (2 * Math.PI * Math.floor((i / N) * filmFrames)) / filmFrames;
  assert.equal(measureSeam(around(held)).status, 'clean');
});

test('a wrapping image passes the edge check', () => {
  const w = 64, h = 32, f = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) f[(y * w + x) * 3 + c] = .5 + .4 * Math.sin(2 * Math.PI * x / w) * Math.cos(2 * Math.PI * y / h);
  assert.equal(measureEdges(f, w, h).status, 'clean');
});
test('a ramp fails left/right only', () => {
  const w = 64, h = 32, f = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) f.fill((i % w) / w, i * 3, i * 3 + 3);
  const r = measureEdges(f, w, h);
  assert.equal(r.status, 'seam'); assert.equal(r.horizontal.visible, true); assert.equal(r.vertical.visible, false);
  assert.match(describeEdges(r), /^Visible tile seam: left\/right/);
});
test('a flat image is clean', () => { assert.equal(measureEdges(new Float32Array(16 * 16 * 3).fill(.3), 16, 16).status, 'clean'); });
test('edge results are described plainly', () => {
  const m = (ratio, visible) => ({ seam: 0, typical: 0, ratio, visible });
  assert.equal(describeEdges({ status: 'clean', horizontal: m(.94, false), vertical: m(1, false) }), 'Tile edges clean (left/right 0.9×, top/bottom 1.0× of a normal pixel step).');
  assert.equal(describeEdges({ status: 'seam', horizontal: m(3.21, true), vertical: m(1, false) }), 'Visible tile seam: left/right 3.2× a normal pixel step.');
  assert.equal(describeEdges({ status: 'seam', horizontal: m(3.21, true), vertical: m(2, true) }), 'Visible tile seam: left/right 3.2× and top/bottom 2.0× a normal pixel step.');
  assert.match(describeEdges({ status: 'error', message: 'decode failed' }), /decode failed/);
});
