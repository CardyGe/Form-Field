import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: a plain script module, without types.
import { memoryVerdict, parseFootprint, sampleFaults } from '../scripts/soak-rules.mjs';

const wall = (frames: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  meridian: Object.fromEntries(Object.entries(frames).map(([id, f]) => [id, { frames: f }])), failing: [], restarts: 0, contextLost: false, flashGuard: { on: true, failed: null }, ...extra,
});

test('a healthy wall has no faults', () => assert.deepEqual(sampleFaults(wall({ a: 100, b: 100 }), wall({ a: 700, b: 700 })), []));

test('one source standing still is a fault, even while the others play', () => {
  assert.deepEqual(sampleFaults(wall({ a: 100, b: 100, c: 100 }), wall({ a: 700, b: 100, c: 700 })), ['source b stood still']);
});

test('a source that disappears or starts again from scratch is a fault', () => {
  assert.match(sampleFaults(wall({ a: 100, b: 900 }), wall({ a: 700 })).join(), /source b disappeared/);
  assert.match(sampleFaults(wall({ a: 100, b: 900 }), wall({ a: 700, b: 40 })).join(), /source b started again/);
});

test('a wall restart is a fault; a context lost and recovered in place is not', () => {
  assert.match(sampleFaults(wall({ a: 1 }), wall({ a: 9 }, { restarts: 1 })).join(), /restarted 1/);
  assert.deepEqual(sampleFaults(wall({ a: 1 }, { contextLosses: 0 }), wall({ a: 9 }, { contextLosses: 4 })), []);
});

test('a wall fault seen in two samples is a fault; one seen once is not', () => {
  const failing = [{ id: 'ev', reason: 'the graphics card stopped this instrument' }];
  assert.deepEqual(sampleFaults(wall({ a: 1 }), wall({ a: 9 }, { failing })), []);
  assert.equal(sampleFaults(wall({ a: 1 }, { failing }), wall({ a: 9 }, { failing })).length, 1);
});

test('the limiter must be on and working', () => {
  assert.deepEqual(sampleFaults(wall({ a: 1 }), wall({ a: 9 }, { flashGuard: { on: false, failed: null } })), ['the limiter is not on']);
  assert.match(sampleFaults(wall({ a: 1 }), wall({ a: 9 }, { flashGuard: { on: true, failed: 'shader' } })).join(), /limiter failed/);
});

const series = (minutes: number, at: (m: number) => number) => Array.from({ length: minutes }, (_, i) => ({ minute: i + 1, value: at(i + 1) }));

test('memory is not judged before 100 minutes', () => assert.equal(memoryVerdict(series(90, m => 500 + m * 10)).judged, false));

test('flat memory with noise passes', () => {
  const v = memoryVerdict(series(720, m => 600 + 20 * Math.sin(m / 7)));
  assert.equal(v.judged, true); assert.equal(v.failed, false);
});

test('a steady leak of 15% over the run after the first hour fails, as does a late step', () => {
  // 600 MB at minute 65 growing linearly to 690 MB at minute 720: the averages alone would dilute this.
  const leak = memoryVerdict(series(720, m => 600 + 90 * Math.max(0, m - 65) / 655));
  assert.equal(leak.failed, true, JSON.stringify(leak));
  assert.ok(leak.slopeGrowth > .1);
  const step = memoryVerdict(series(240, m => (m > 200 ? 700 : 600)));
  assert.equal(step.failed, true, JSON.stringify(step));
});

test('a 5% drift passes', () => assert.equal(memoryVerdict(series(720, m => 600 + 30 * Math.max(0, m - 65) / 655)).failed, false));

test('footprint output is read per process, in bytes', () => {
  const text = '======\nElectron Helper (GPU) [123]: 64-bit    Footprint: 251658240 B (16384 bytes per page)\n======\nElectron Helper (Renderer) [456]: 64-bit    Footprint: 1,048,576 B (16384 bytes per page)\n';
  assert.deepEqual(parseFootprint(text), [{ pid: 123, bytes: 251658240 }, { pid: 456, bytes: 1048576 }]);
});
