import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset, createLayer, createProject, parameterDefinitions, PRESETS, validateProject } from '../src/core/project';
import { SMOKE_CLOUD_SCHEMES, cloudBeats, cloudHit, cloudLoopBlend, cloudSettings, cloudSteps } from '../src/rendering/smoke-cloud-model';

const defaults = createLayer('smokecloud').params;

test('Smoke Cloud is a saved layer with its own controls', () => {
  const layer = createLayer('smokecloud');
  assert.equal(layer.name, 'Smoke Cloud');
  const project = { ...createProject(), layers: [layer] };
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  for (const key of ['cloudSmoke', 'cloudTurbulence', 'cloudShear', 'cloudPlumes', 'cloudPunch', 'cloudLife', 'cloudCore', 'cloudRing', 'cloudChannels', 'cloudOuter', 'cloudSparkle', 'exposure'])
    assert.ok(parameterDefinitions('smokecloud').some(d => d.key === key), key);
});

test('every colour scheme is a distinct preset', () => {
  assert.equal(SMOKE_CLOUD_SCHEMES.length, 15);
  assert.equal(new Set(SMOKE_CLOUD_SCHEMES.map(s => s.palette.join())).size, 15);
  for (const scheme of SMOKE_CLOUD_SCHEMES) {
    const preset = PRESETS.find(p => p.id === scheme.id);
    assert.equal(preset?.kind, 'smokecloud', scheme.id);
    assert.equal(applyPreset(createLayer('smokecloud'), scheme.id).palette.length, 6);
  }
});

test('each main control changes its simulation setting', () => {
  for (const [key, field] of [['cloudSmoke', 'emit'], ['cloudTurbulence', 'turbulence'], ['cloudShear', 'shear'], ['cloudPlumes', 'plumes'], ['cloudPunch', 'punch'], ['cloudLife', 'dyeLife'], ['cloudOuter', 'outer'], ['cloudSparkle', 'sparkle']] as const) {
    const low = cloudSettings({ ...defaults, [key]: .05 })[field], high = cloudSettings({ ...defaults, [key]: 1 })[field];
    assert.ok(high >= low * 2, `${key}: ${low} to ${high}`);
  }
});

test('automatic beats never exceed the flash limit', () => {
  for (const loop of [.5, 1, 2, 4, 10, 60]) assert.ok(cloudBeats(64, loop) / loop <= 2.5, `loop ${loop}`);
  assert.equal(cloudBeats(20, 10), 20);
  assert.equal(cloudBeats(4, .1), 1);
});

test('the beat repeats exactly each loop and snaps on', () => {
  for (const t of [0, .03, 1.1, 4.7, 9.99]) assert.deepEqual(cloudHit(t, 10, 20), cloudHit(t + 10, 10, 20));
  assert.ok(cloudHit(.05, 10, 20).level > .8);
  assert.ok(cloudHit(.45, 10, 20).level < .1);
});

test('stepping and the loop blend are bounded', () => {
  assert.equal(cloudSteps(1 / 60), 1);
  assert.equal(cloudSteps(5), 2);
  assert.equal(cloudLoopBlend(0, 10).weight, 0);
  assert.equal(cloudLoopBlend(1.5, 10).weight, 1);
  assert.ok(cloudLoopBlend(0, 1).blendSeconds <= .25);
});
