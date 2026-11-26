import test from 'node:test';
import assert from 'node:assert/strict';
import { BLUE_NOISE_SIZE, blueNoise } from '../src/rendering/print-screen';

test('the blue-noise tile uses every threshold once and has no low-frequency clumps', () => {
  const n = blueNoise();
  assert.equal(BLUE_NOISE_SIZE, 64);
  assert.equal(n.length, 4096);
  const counts = new Array(256).fill(0); for (const v of n) counts[v]++;
  assert.ok(counts.every(c => c === 16), 'each byte value appears 16 times');
  const mean = (x0: number, y0: number) => { let s = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s += n[(y0 + y) * 64 + x0 + x]; return s / 256; };
  for (const [x, y] of [[0, 0], [16, 32], [48, 48]]) assert.ok(Math.abs(mean(x, y) - 127.5) < 6);
});
