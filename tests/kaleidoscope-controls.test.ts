import assert from 'node:assert/strict';
import test from 'node:test';
import { SYMMETRY_GROUPS } from '../src/core/kaleidoscope-math';
import { KALEIDOSCOPE_INPUT, parameterDefinitions } from '../src/core/project';
import { KALEIDOSCOPE_MOTIFS, KALEIDOSCOPE_OWN_KEYS, KALEIDOSCOPE_SOURCES, KALEIDOSCOPE_SYMMETRIES, kaleidoscopeHidden } from '../src/ui/kaleidoscope-controls';

test('the on-screen choices match the stored values and the maths', () => {
  assert.equal(KALEIDOSCOPE_SOURCES.length, Object.keys(KALEIDOSCOPE_INPUT).length);
  assert.equal(KALEIDOSCOPE_SYMMETRIES.length, SYMMETRY_GROUPS.length);
  const byKey = Object.fromEntries(parameterDefinitions('kaleidoscope').map(d => [d.key, d]));
  assert.equal(byKey.input.max + 1, KALEIDOSCOPE_SOURCES.length);
  assert.equal(byKey.group.max + 1, KALEIDOSCOPE_SYMMETRIES.length);
  assert.equal(byKey.motif.max + 1, KALEIDOSCOPE_MOTIFS.length);
  assert.deepEqual(KALEIDOSCOPE_SOURCES, ['Motif', 'Image', 'Layer below', 'Feedback']);
  assert.deepEqual(KALEIDOSCOPE_SYMMETRIES, ['Rosette', 'Mirror', 'Triangle', 'Square', 'Hexagon']);
  for (const key of KALEIDOSCOPE_OWN_KEYS) assert.ok(byKey[key], key);
});

test('only the controls that do something for these settings are shown', () => {
  const plain = { input: 0, group: 0, spiral: 0 };
  assert.deepEqual([...kaleidoscopeHidden(plain)].sort(), ['cell', 'spiralA', 'spiralB', 'spiralScale', 'zoomCycles']);
  assert.ok(kaleidoscopeHidden({ ...plain, group: 3 }).has('sectors'));
  assert.ok(!kaleidoscopeHidden({ ...plain, group: 3 }).has('cell'));
  const spiral = kaleidoscopeHidden({ ...plain, spiral: 1 });
  for (const key of ['sectors', 'cell']) assert.ok(spiral.has(key), key);
  for (const key of ['spiralA', 'spiralB', 'spiralScale', 'zoomCycles']) assert.ok(!spiral.has(key), key);
  for (const input of [1, 2]) for (const key of ['motifScale', 'lineWidth']) assert.ok(kaleidoscopeHidden({ ...plain, input }).has(key), `${input} ${key}`);
  for (const input of [0, 3]) for (const key of ['motifScale', 'lineWidth']) assert.ok(!kaleidoscopeHidden({ ...plain, input }).has(key), `${input} ${key}`);
});
