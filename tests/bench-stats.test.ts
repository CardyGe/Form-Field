import test from 'node:test';
import assert from 'node:assert/strict';
import { agree, summarise } from '../src/core/bench-stats';

test('summarise reports median and nearest-rank percentiles', () => {
  const samples = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = summarise(samples);
  assert.equal(s.count, 100);
  assert.equal(s.p95, 95);
  assert.equal(s.p99, 99);
  assert.equal(s.max, 100);
  assert.equal(s.median, 50.5);
});

test('summarise handles odd counts and unsorted input', () => {
  const s = summarise([5, 1, 3]);
  assert.equal(s.median, 3);
  assert.equal(s.max, 5);
  assert.equal(s.p95, 5);
});

test('summarise rejects empty input and does not mutate its argument', () => {
  assert.throws(() => summarise([]));
  const input = [3, 1, 2];
  summarise(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test('agree compares two values within a relative tolerance', () => {
  assert.equal(agree(10, 10.4, .05), true);
  assert.equal(agree(10, 10.6, .05), false);
  assert.equal(agree(0, 0, .05), true);
});
