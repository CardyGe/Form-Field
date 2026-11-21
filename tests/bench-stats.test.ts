import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize, summarizeSamples } from '../src/core/bench-stats';

test('percentiles are nearest-rank, so they are frame times that happened', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(values, .95), 95);
  assert.equal(percentile(values, .99), 99);
  assert.equal(percentile(values, 1), 100);
  assert.equal(percentile([7], .95), 7);
  assert.ok(Number.isNaN(percentile([], .5)));
});

test('summaries sort their input and ignore non-finite values', () => {
  const s = summarize([4, 1, 3, 2, NaN, Infinity]);
  assert.deepEqual({ count: s.count, min: s.min, median: s.median, max: s.max, mean: s.mean }, { count: 4, min: 1, median: 2.5, max: 4, mean: 2.5 });
  assert.equal(summarize([]).count, 0);
});

test('a frame total is the sum of its passes, and repeated passes add up', () => {
  const t = summarizeSamples([
    { frame: 0, pass: 'source:fractal', ms: 2 }, { frame: 0, pass: 'composite', ms: .5 }, { frame: 0, pass: 'source:fractal', ms: 1 },
    { frame: 1, pass: 'source:fractal', ms: 4 }, { frame: 1, pass: 'composite', ms: .5 },
  ]);
  assert.equal(t.total.count, 2);
  assert.equal(t.total.min, 3.5); assert.equal(t.total.max, 4.5);
  assert.equal(t.passes['source:fractal'].median, 3.5);
  assert.equal(t.passes.composite.count, 2);
});

test('frames that lost a section are left out, so totals never undercount', () => {
  const t = summarizeSamples([
    { frame: 0, pass: 'a', ms: 1 }, { frame: 0, pass: 'b', ms: 1 },
    { frame: 1, pass: 'a', ms: 1 },
  ], new Set([1]));
  assert.equal(t.total.count, 1);
  assert.equal(t.total.median, 2);
});
