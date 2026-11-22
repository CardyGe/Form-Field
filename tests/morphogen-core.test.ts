import test from 'node:test';
import assert from 'node:assert/strict';
import { MORPH_CONTROLS, defaultMorphParams, validateMorphParams } from '../src/morphogen/params';
import { stableStep } from '../src/morphogen/stability';

test('defaults are inside every control range', () => {
  const d = defaultMorphParams();
  for (const c of MORPH_CONTROLS) {
    assert.ok(d[c.key] >= c.min && d[c.key] <= c.max, c.key);
    assert.ok(c.description.length > 8, `${c.key} needs a plain description`);
  }
});

test('validation repairs bad, missing and out-of-range values', () => {
  const v = validateMorphParams({ wavelength: 9999, drive: 'x', depth: NaN });
  assert.equal(v.wavelength, 32);
  assert.equal(v.drive, .28);
  assert.equal(v.depth, 1);
  assert.deepEqual(validateMorphParams(null), defaultMorphParams());
});

test('whole-number controls validate to whole numbers', () => {
  assert.equal(validateMorphParams({ fieldType: 2.7 }).fieldType, 3);
  assert.equal(validateMorphParams({ palette: 40 }).palette, 11);
});

test('a full parameter set stays small enough for the Live message', () => {
  assert.ok(JSON.stringify(defaultMorphParams()).length < 4096);
});

test('step at the default spacing matches the bound', () => {
  assert.ok(Math.abs(stableStep(12, 0, 0) - .0873) < .0005);
});

/** The solver's update on the CPU: 9-point Laplacian applied twice, periodic edges. */
function run(size: number, steps: number, wavelength: number, alignment: number, asymmetry: number, drive: number): Float64Array {
  const K = (2 * Math.PI / wavelength) ** 2, dt = stableStep(wavelength, alignment, asymmetry);
  let u = new Float64Array(size * size), next = new Float64Array(size * size);
  let random = 12345;
  for (let i = 0; i < u.length; i++) { random = random * 16807 % 2147483647; u[i] = (random / 2147483647 - .5) * .4; }
  const at = (a: Float64Array, x: number, y: number) => a[((y + size) % size) * size + (x + size) % size];
  const lap = (a: Float64Array, x: number, y: number) => .5 * (at(a, x + 1, y) + at(a, x - 1, y) + at(a, x, y + 1) + at(a, x, y - 1))
    + .25 * (at(a, x + 1, y + 1) + at(a, x - 1, y + 1) + at(a, x + 1, y - 1) + at(a, x - 1, y - 1)) - 3 * at(a, x, y);
  const l = new Float64Array(size * size);
  for (let s = 0; s < steps; s++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) l[y * size + x] = K * at(u, x, y) + lap(u, x, y);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = at(u, x, y), operator = K * l[y * size + x] + lap(l, x, y);
      // Diffusion along x stands in for the steering term at full strength.
      const along = alignment * (at(u, x + 1, y) + at(u, x - 1, y) - 2 * v);
      const value = v + dt * (drive * v - operator + asymmetry * v * v - v * v * v + along);
      next[y * size + x] = Math.max(-1.5, Math.min(1.5, value));
    }
    [u, next] = [next, u];
  }
  return u;
}

test('solver stays bounded across extreme parameters', () => {
  for (const wavelength of [7, 32]) for (const alignment of [0, 1]) for (const asymmetry of [0, .7]) for (const drive of [.05, .7]) {
    const u = run(64, 2000, wavelength, alignment, asymmetry, drive);
    let peak = 0;
    for (const v of u) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
    // Pressed against the clamp would mean the update is unstable and only the clamp is holding it.
    assert.ok(peak < 1.45, `λ${wavelength} a${alignment} g${asymmetry} r${drive}: peak ${peak.toFixed(3)}`);
  }
});

test('solver forms stripes at the requested spacing', () => {
  const size = 96, wavelength = 12, u = run(size, 3000, wavelength, 0, .12, .28);
  let best = 0, bestPeriod = 0;
  for (let period = 6; period <= 24; period++) {
    let total = 0;
    for (let ky = 0; ky < 6; ky++) for (let angle = 0; angle < 12; angle++) {
      const t = angle / 12 * Math.PI, k = 2 * Math.PI / period; let re = 0, im = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const p = k * (x * Math.cos(t) + y * Math.sin(t)); re += u[y * size + x] * Math.cos(p); im += u[y * size + x] * Math.sin(p); }
      total = Math.max(total, re * re + im * im);
    }
    if (total > best) { best = total; bestPeriod = period; }
  }
  assert.ok(Math.abs(bestPeriod - wavelength) <= wavelength * .2, `period ${bestPeriod}`);
});
