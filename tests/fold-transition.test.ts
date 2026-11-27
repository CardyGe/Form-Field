import assert from 'node:assert/strict';
import test from 'node:test';
import { FoldTransition } from '../src/rendering/fold-transition';

const settings = (shape: number) => ({ shape, duration: 1, hold: .5, angle: Math.PI, nextBeat: false });

test('directional morphs keep their destination through a rapid series of live choices', () => {
  const clock = new FoldTransition(0);
  assert.deepEqual(clock.update(settings(1), 0, null), { from: 0, to: 1, mix: 0, angle: Math.PI });
  assert.equal(clock.update(settings(2), 500, null).mix, .5);
  assert.deepEqual(clock.update(settings(3), 1000, null), { from: 1, to: 1, mix: 1, angle: 0 });
  assert.equal(clock.update(settings(3), 1499, null).to, 1);
  assert.deepEqual(clock.update(settings(3), 1500, null), { from: 1, to: 3, mix: 0, angle: Math.PI });
  assert.equal(clock.update(settings(3), 2500, null).from, 3);
  assert.equal(clock.pending, false);
});

test('quantization waits for the next beat and uses a 120 BPM fallback without a clock', () => {
  const quantized = { ...settings(2), nextBeat: true, duration: 0 };
  const signal = new FoldTransition(0);
  assert.equal(signal.update(quantized, 100, 2.7).to, 0);
  assert.equal(signal.update(quantized, 400, 2.99).to, 0);
  assert.equal(signal.update(quantized, 420, 3.02).to, 2);
  const fallback = new FoldTransition(0);
  assert.equal(fallback.update(quantized, 140, null).to, 0);
  assert.equal(fallback.update(quantized, 499, null).to, 0);
  assert.equal(fallback.update(quantized, 500, null).to, 2);
});
