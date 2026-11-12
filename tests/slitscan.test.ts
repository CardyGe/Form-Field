import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIT_LOOK_IDS, PRESETS, applyPreset, parameterDefinitions, createLayer, createProject, validateProject, varyLayer } from '../src/core/project';
import { SLIT_KEYS } from '../src/core/finishing';
import { SLIT_SHAPES, slitActive, sliceDelays, supportsSlitScan } from '../src/rendering/slitscan';
const unlocked = { palette: false, structure: false, motion: false, material: false };

test('time displacement is off by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.slitShift, 0);
    assert.equal(slitActive(layer), false);
    for (const key of SLIT_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.layers[0].params.slitShift, 0);
  assert.equal(migrated.layers[0].params.slitSlices, 12);
});

test('slices run evenly from now to the full span, whichever way the map faces', () => {
  assert.deepEqual(sliceDelays({ params: { slitShift: 1, slitSpan: 30, slitSlices: 4 } }), [0, 10, 20, 30]);
  assert.deepEqual(sliceDelays({ params: { slitShift: -.5, slitSpan: 30, slitSlices: 3 } }), [0, 7.5, 15]);
  assert.equal(sliceDelays({ params: { slitShift: 1, slitSpan: 30, slitSlices: 1 } }).length, 2, 'At least two slices.');
});

test('the delay map choices match the control range', () => {
  const definition = parameterDefinitions('surface').find(d => d.key === 'slitShape')!;
  assert.equal(definition.min, 0);
  assert.equal(definition.max, SLIT_SHAPES.length - 1);
});

test('patterns and evolving ink cannot take time displacement', () => {
  assert.equal(supportsSlitScan(createLayer('graphic')), false);
  assert.equal(supportsSlitScan(applyPreset(createLayer('livingink'), 'ink-estuary')), false);
  assert.equal(supportsSlitScan(createLayer('surface')), true);
});

test('time displacement looks are ordinary saved layers with it switched on', () => {
  assert.equal(SLIT_LOOK_IDS.length, 3);
  for (const id of SLIT_LOOK_IDS) {
    const preset = PRESETS.find(p => p.id === id)!;
    const layer = applyPreset(createLayer(preset.kind), id);
    assert.ok(slitActive(layer), id);
    const project = { ...createProject(), highlights: 'exact' as const, layers: [layer] };
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  }
});

test('variations never switch time displacement on or change its map, scroll or slice count', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, unlocked, entropy);
      for (const key of ['slitShift', 'slitShape', 'slitScroll', 'slitSlices']) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
      if (!layer.params.slitShift) for (const key of SLIT_KEYS) assert.equal(varied.params[key], layer.params[key], `${preset.id} hidden ${key}`);
    }
  }
});
