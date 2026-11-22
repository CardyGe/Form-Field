import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { SPLIT_KEYS, GRADIENT_KEYS } from '../src/core/finishing';
import { gradientStops, gradientTone, lensActive, spectralWeights } from '../src/rendering/colour-lens';

test('colour and lens are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(lensActive(layer), false);
    for (const key of [...SPLIT_KEYS, ...GRADIENT_KEYS]) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.layers[0].params.splitAmount, 0);
  assert.equal(migrated.layers[0].params.gradMix, 0);
});
test('lens runs when animated from zero and never on graphic patterns', () => {
  const layer = createLayer('surface');
  assert.equal(lensActive({ ...layer, modulations: { splitAmount: {} as never } }), true);
  assert.equal(lensActive({ ...layer, params: { ...layer.params, gradMix: .4 } }), true);
  assert.equal(lensActive({ ...layer, params: { ...layer.params, splitOrder: 2 } }), true);
  const graphic = createLayer('graphic');
  assert.equal(lensActive({ ...graphic, params: { ...graphic.params, splitAmount: 8 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => [...SPLIT_KEYS, ...GRADIENT_KEYS].includes(d.key)), false);
});
test('three spectral samples are pure red, green and blue', () => {
  assert.deepEqual(spectralWeights(3).map(s => s.weight), [[1,0,0],[0,1,0],[0,0,1]]);
  assert.deepEqual(spectralWeights(3).map(s => s.offset), [-.5,0,.5]);
});
test('spectral weights keep neutral colour at every sample count', () => {
  for (let n = 3; n <= 15; n++) for (const c of [0,1,2]) {
    const sum = spectralWeights(n).reduce((a, s) => a + s.weight[c], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${n}:${c}`);
  }
});
test('gradient tone is perceptual, bounded, and bent by the midpoint', () => {
  assert.equal(gradientTone(0, .5), 0);
  assert.equal(gradientTone(1, .5), 1);
  assert.equal(gradientTone(8, .5), 1);
  assert.ok(Math.abs(gradientTone(Math.pow(.5, 2.2), .5) - .5) < 1e-9);
  assert.ok(gradientTone(.2, .25) > gradientTone(.2, .75));
});
test('layer palette stops run dark to bright, authored palettes keep their order', () => {
  assert.deepEqual(gradientStops(0, ['#ffffff','#000000','#808080']), ['#000000','#808080','#ffffff']);
  assert.deepEqual(gradientStops(3, []), ['#050026','#1ae6f2','#ff33cc']);
});
test('variations never switch colour effects on or change their choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette:false, structure:false, motion:false, material:false }, entropy);
      for (const key of [...SPLIT_KEYS, ...GRADIENT_KEYS]) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
      for (const key of ['glowSpread','glowStreak','glowStreakShape']) if (!layer.params.glowMix) assert.equal(varied.params[key], layer.params[key]);
    }
  }
});
