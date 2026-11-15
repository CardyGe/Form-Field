import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyFinish, applyPreset, createLayer, createProject, finishSupported, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { GLOW_KEYS } from '../src/core/finishing';
import { bloomLevelSize, bloomWeights, glowActive, supportsGlow } from '../src/rendering/bloom';

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

test('blur levels keep their share of the frame on small renders', () => {
  assert.deepEqual(bloomLevelSize(0, 1920, 1080), { width: 960, height: 540, reach: 1 });
  assert.deepEqual(bloomLevelSize(4, 1920, 1080), { width: 60, height: 34, reach: 1 });
  const tiny = bloomLevelSize(0, 36, 20);
  assert.deepEqual([tiny.width, tiny.height], [36, 20]);
  assert.ok(Math.abs(tiny.reach - 20 / 540) < 1e-9);
  assert.deepEqual(bloomLevelSize(4, 2, 1), { width: 4, height: 2, reach: 2 / 34 });
});

test('glow looks apply, replace other finishes and clear', () => {
  const layer = createLayer('liquid');
  const glowing = applyFinish(layer, 'finish-soft-glow');
  assert.deepEqual([glowing.params.glowMix, glowing.params.glowThreshold, glowing.params.glowSize], [.8, .6, .4]);
  const tunnel = applyFinish(glowing, 'finish-tunnel');
  assert.equal(tunnel.params.glowMix, 0);
  const trails = applyFinish(tunnel, 'finish-glowing-trails');
  assert.deepEqual([trails.params.echo, trails.params.echoBlend, trails.params.glowMix], [.85, 2, .9]);
  assert.equal(applyFinish(trails, 'finish-none').params.glowMix, 0);
});

test('glow looks are refused where glow is not supported, other looks are not', () => {
  const scope = createLayer('scope');
  assert.equal(finishSupported(scope, 'finish-soft-glow'), false);
  assert.equal(finishSupported(scope, 'finish-terraces'), true);
  assert.throws(() => applyFinish(scope, 'finish-dream-haze'));
});

test('variations never switch glow on, and keep an authored glow near where it was set', () => {
  const unlocked = { palette: false, structure: false, motion: false, material: false };
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let i = 0; i < 6; i++) {
      const varied = varyLayer(layer, 1, unlocked, 2000 + i);
      for (const key of GLOW_KEYS) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
  const glowing = applyFinish(createLayer('liquid'), 'finish-hot-highlights');
  for (let i = 0; i < 40; i++) {
    const varied = varyLayer(glowing, 1, unlocked, 3000 + i);
    assert.equal(varied.params.glowMix, 1.5);
    assert.equal(varied.params.glowTint, 0);
    assert.ok(Math.abs(varied.params.glowThreshold - .8) <= .1201, `threshold ${varied.params.glowThreshold}`);
    assert.ok(Math.abs(varied.params.glowSize - .2) <= .1201, `size ${varied.params.glowSize}`);
  }
});
