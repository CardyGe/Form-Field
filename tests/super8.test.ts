import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset, createLayer, createProject, parameterDefinitions, PRESETS, SUPER8_MODES, SUPER8_PROJECTOR_KEYS, validateProject, varyLayer } from '../src/core/project';
import { super8Clock, super8History, super8Transport, SUPER8_HISTORY } from '../src/rendering/super8-motion';
import { evaluateLayer } from '../src/core/timeline';

const TAU = Math.PI * 2;

test('five Super 8 modes roundtrip with presets, animation, masks and existing sources', () => {
  const presets = PRESETS.filter(p => p.kind === 'super8');
  assert.deepEqual(presets.filter(p => !p.signature).map(p => p.name), SUPER8_MODES);
  for (const preset of presets) {
    const p = createProject();
    const layer = applyPreset(createLayer('super8'), preset.id);
    layer.modulations.texture = { kind: 'sine', cycles: 2, phase: .1, amount: .6, points: [] };
    layer.mask = { kind: 'circle', size: .6, softness: .2, invert: false };
    layer.blend = 'multiply'; layer.opacity = .65;
    p.layers.push(layer, createLayer('oil'), createLayer('sculpture'));
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
    const copy = validateProject(p); copy.layers[1].params.texture = 0;
    assert.equal(p.layers[1].params.texture, preset.params.texture);
  }
});

test('film frame holds remain periodic at exact boundaries and rational-rate durations', () => {
  for (const duration of [.1, 10, 300 * 1001 / 30000, 600]) for (const rate of [1, 12, 18, 24, 48]) {
    const count = Math.max(1, Math.round(duration * rate));
    assert.equal(super8Clock(0, duration, rate).frame, 0);
    assert.deepEqual(super8Clock(0, duration, rate), super8Clock(TAU, duration, rate));
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      const start = index * TAU / count;
      const a = super8Clock(start, duration, rate);
      assert.equal(a.frame, index);
      assert.deepEqual(a, super8Clock(start + TAU / count * .9, duration, rate));
      assert.deepEqual(a, super8Clock(start + TAU, duration, rate));
      assert.deepEqual(a, super8Clock(start - TAU, duration, rate));
    }
  }
  assert.equal(super8Clock(-.001, 10, 18).frame, 179);
  for (const args of [[NaN, 10, 18], [0, 0, 18], [0, 10, 0], [0, 10, 18.5], [0, Infinity, 18]]) {
    assert.throws(() => super8Clock(args[0], args[1], args[2]));
  }
});

test('feedback reconstructs past animated settings and wraps before the first frame', () => {
  const layer = createLayer('super8');
  layer.params.filmFps = 12; layer.params.feedbackSpacing = 3;
  layer.modulations.travel = { kind: 'noise', cycles: 2, phase: .2, amount: .7, points: [] };
  layer.modulations.texture = { kind: 'sine', cycles: 3, phase: 0, amount: .8, points: [] };
  const original = structuredClone(layer);
  const samples = super8History(layer, 0, 10);
  assert.equal(samples.length, SUPER8_HISTORY);
  assert.deepEqual(samples.map(s => s.frame), [0, 117, 114, 111, 108, 105]);
  samples.forEach(sample => assert.deepEqual(sample.layer, evaluateLayer(layer, sample.phase)));
  assert.notEqual(samples[0].layer.params.texture, samples[1].layer.params.texture);
  assert.deepEqual(samples, super8History(layer, TAU, 10));
  super8History(layer, 3.2, 10);
  assert.deepEqual(samples, super8History(layer, 0, 10));
  assert.deepEqual(layer, original);
});

test('Super 8 rejects corrupt controls and discrete Motion routes; variation respects locks', () => {
  const layer = createLayer('super8');
  const project = createProject(); project.layers = [layer];
  for (const [key, value] of [['mode', 5], ['mode', .5], ['filmFps', 0], ['filmFps', 49], ['steps', 2], ['feedback', 1], ['texture', NaN]] as const) {
    const bad = structuredClone(project); bad.layers[0].params[key] = value;
    assert.throws(() => validateProject(bad), new RegExp(key));
  }
  for (const key of ['mode', 'filmFps', 'feedbackSpacing', 'steps', 'substrate']) {
    const bad = structuredClone(project);
    bad.layers[0].modulations[key] = { kind: 'sine', cycles: 1, phase: 0, amount: .5, points: [] };
    assert.throws(() => validateProject(bad), /modulations/);
  }
  const varied = varyLayer(layer, 1, { palette: true, structure: true, motion: true, material: false });
  assert.deepEqual(varied.palette, layer.palette);
  for (const d of parameterDefinitions('super8').filter(d => d.section === 'Motion' || d.section === 'Shape')) {
    assert.equal(varied.params[d.key], layer.params[d.key]);
  }
  assert.deepEqual(validateProject({ ...project, layers: [varied] }).layers[0], varied);
  assert.equal(varyLayer(layer, .4, { palette: false, structure: false, motion: false, material: false }).params.mode, layer.params.mode);
});


test('projector controls migrate absent values to a neutral finish without accepting corrupt values', () => {
  const project = createProject(); project.layers = [createLayer('super8')];
  const legacy = structuredClone(project);
  for (const key of SUPER8_PROJECTOR_KEYS) delete legacy.layers[0].params[key];
  const migrated = validateProject(legacy);
  for (const key of SUPER8_PROJECTOR_KEYS) {
    assert.equal(migrated.layers[0].params[key], parameterDefinitions('super8').find(d => d.key === key)!.default);
    assert.equal(Object.hasOwn(legacy.layers[0].params, key), false);
    const corrupt = structuredClone(project); corrupt.layers[0].params[key] = NaN;
    assert.throws(() => validateProject(corrupt), new RegExp(key));
  }
  for (const key of ['gateMode', 'shutterBlades', 'reelLoops']) {
    const corrupt = structuredClone(project);
    corrupt.layers[0].modulations[key] = { kind: 'sine', cycles: 1, phase: 0, amount: .5, points: [] };
    assert.throws(() => validateProject(corrupt), /modulations/);
  }
  assert.deepEqual(validateProject(migrated), migrated);
});

test('projector advances between held frames, closes the shutter during pull-down and loops exactly', () => {
  for (const duration of [.1, 10, 600]) for (const fps of [1, 18, 48]) {
    const clock = super8Clock(0, duration, fps);
    const tick = TAU / clock.frames;
    const start = super8Transport(0, duration, fps, 1, 1, 2, 3);
    assert.equal(start.pull, 1); assert.equal(start.light, 0); assert.equal(start.fraction, 0);
    const mid = super8Transport(tick*.4, duration, fps, 1, 1, 2, 3);
    assert.equal(mid.frame, start.frame); assert.equal(mid.pull, 0); assert.equal(mid.light, 1);
    assert.ok(mid.roll > start.roll);
    for (const phase of [0, tick, tick*.1, .7, 4.8]) {
      const a = super8Transport(phase, duration, fps, .7, .8, 3, 2);
      assert.deepEqual(a, super8Transport(phase + TAU, duration, fps, .7, .8, 3, 2));
      assert.ok(a.fraction >= 0 && a.fraction < 1 && a.light >= .2-1e-12 && a.light <= 1);
    }
    assert.equal(super8Transport(tick, duration, fps, 1, 1, 2, 0).fraction, 0);
    assert.equal(start.previousPhase, (clock.frames-1)*TAU/clock.frames);
    const neutral = super8Transport(.7, duration, fps, 0, 0, 2, 0);
    assert.equal(neutral.pull, 0); assert.equal(neutral.roll, 0); assert.equal(neutral.light, 1);
  }
});

test('rolling shutter controls default off, so older projects keep their look', () => {
  const legacy = createProject(); legacy.layers = [createLayer('super8')];
  for (const key of ['rollAmount', 'rollBands', 'rollOrigin', 'rollSmear']) delete legacy.layers[0].params[key];
  const restored = validateProject(JSON.parse(JSON.stringify(legacy)));
  assert.equal(restored.layers[0].params.rollAmount, 0);
  assert.equal(restored.layers[0].params.rollSmear, 0);
  const tunnel = applyPreset(createLayer('super8'), 'painted-tunnel');
  assert.equal(SUPER8_MODES[tunnel.params.mode], 'Painted Tunnel');
  assert.ok(tunnel.params.rollAmount > 0 && tunnel.params.rollSmear > 0);
});
