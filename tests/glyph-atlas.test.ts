import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceField } from '../src/rendering/glyph-atlas';

test('the distance field is signed, centred on the edge and clamped by spread', () => {
  const w = 16, h = 16, alpha = new Uint8Array(w * h);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) alpha[y * w + x] = 255;
  const f = distanceField(alpha, w, h, 4);
  assert.ok(f[8 * w + 8] > .5, 'inside is above the edge value');
  assert.ok(f[0] < .5, 'outside is below the edge value');
  assert.ok(Math.abs(f[8 * w + 4] - .5) < .2, 'the edge sits near .5');
  assert.ok(f.every(v => v >= 0 && v <= 1));
});
test('an empty glyph gives an all-outside field', () => {
  assert.ok(distanceField(new Uint8Array(64), 8, 8, 4).every(v => v < .5));
});
