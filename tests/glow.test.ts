import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, validateProject, visibleParameterDefinitions } from '../src/core/project';
import { GLOW_KEYS } from '../src/core/finishing';
import { bloomWeights, glowActive, supportsGlow } from '../src/rendering/bloom';

test('glow is off by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.glowMix, 0);
    assert.equal(glowActive(layer), false);
    for (const key of GLOW_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(GLOW_KEYS.map(k => migrated.layers[0].params[k]), [0, .5, .5, 0]);
});

test('glow keys never collide with the Fractal halo', () => {
  assert.deepEqual(GLOW_KEYS, ['glowMix', 'glowThreshold', 'glowSize', 'glowTint']);
});

test('glow runs when the amount is animated from zero', () => {
  const layer = createLayer('surface');
  assert.equal(glowActive({ ...layer, modulations: { glowMix: {} as never } }), true);
  assert.equal(glowActive({ ...layer, params: { ...layer.params, glowMix: .4 } }), true);
});

test('graphic patterns and the oscilloscope take no glow', () => {
  for (const kind of ['graphic', 'scope'] as const) {
    const layer = createLayer(kind);
    assert.equal(supportsGlow(layer), false);
    assert.equal(glowActive({ ...layer, params: { ...layer.params, glowMix: 1 } }), false);
    assert.equal(visibleParameterDefinitions(layer).some(d => GLOW_KEYS.includes(d.key)), false);
  }
  const ink = createLayer('livingink'); ink.params.inkMode = 2;
  assert.equal(GLOW_KEYS.every(k => visibleParameterDefinitions(ink).some(d => d.key === k)), true);
  assert.equal(GLOW_KEYS.every(k => visibleParameterDefinitions(createLayer('liquid')).some(d => d.key === k)), true);
});

test('glow size moves the weights from tight levels to wide ones', () => {
  const close = (a: number[], b: number[]) => { assert.equal(a.length, b.length); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`)); };
  close(bloomWeights(1, 0), [.9, .50625, .225, .05625, 0]);
  close(bloomWeights(1, 1), [.225, .39375, .5625, .73125, .9]);
  close(bloomWeights(1, .5), [.5625, .45, .39375, .39375, .45]);
  close(bloomWeights(2, 0), [1.8, 1.0125, .45, .1125, 0]);
});
