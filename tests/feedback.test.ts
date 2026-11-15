import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_LOOKS, FINISH_SHOWCASE_IDS, applyFinish, finishSupported, PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer } from '../src/core/project';
import { FEEDBACK_KEYS } from '../src/core/finishing';
import { phaseAtFrame } from '../src/core/timeline';
import { feedbackActive, frameAtPhase, persistence, supportsFeedback, warmupFrames, MAX_PERSISTENCE } from '../src/rendering/feedback';
const unlocked = { palette: false, structure: false, motion: false, material: false };

test('feedback is off by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.echo, 0);
    assert.equal(feedbackActive(layer), false);
    for (const key of FEEDBACK_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.layers[0].params.echo, 0);
  assert.equal(migrated.layers[0].params.echoZoom, .96);
});

test('Super 8 keeps its own feedback controls separate from the feedback node', () => {
  const layer = applyPreset(createLayer('super8'), 'paint-destruction');
  assert.ok(layer.params.feedback > 0, 'Super 8 paint feedback is its own control.');
  assert.equal(layer.params.echo, 0);
  assert.equal(feedbackActive(layer), false);
});

test('warm-up covers the history until it falls below half-float precision', () => {
  assert.equal(warmupFrames(0), 0);
  for (const fade of [.5, .9, MAX_PERSISTENCE]) {
    const frames = warmupFrames(fade);
    assert.ok(fade ** frames <= 1 / 4096, `${fade}: ${frames}`);
    assert.ok(fade ** (frames - 1) > 1 / 4096, 'and no longer than needed');
  }
  assert.ok(warmupFrames(persistence({ params: { echo: 1 } })) < 300, 'The longest warm-up stays practical at 4K.');
});

test('every export frame maps back to its own loop frame, including the wrap', () => {
  for (const total of [1, 7, 300, 1001]) {
    for (let i = 0; i < total; i++) assert.equal(frameAtPhase(phaseAtFrame(i, total), total), i);
    assert.equal(frameAtPhase(Math.PI * 2, total), 0);
  }
});

test('patterns and evolving ink cannot take feedback', () => {
  assert.equal(supportsFeedback(createLayer('graphic')), false);
  assert.equal(supportsFeedback(applyPreset(createLayer('livingink'), 'ink-estuary')), false);
  assert.equal(supportsFeedback(createLayer('surface')), true);
});

test('feedback finishes apply to any supporting layer, replace each other and save as ordinary layers', () => {
  const echoes = FINISH_LOOKS.filter(f => (f.params.echo ?? 0) > 0);
  assert.equal(echoes.length, 5);
  for (const kind of ['surface', 'sculpture', 'fractal', 'oil', 'super8', 'livingink', 'relief', 'resonance', 'texturecuts', 'image'] as const) {
    for (const finish of echoes) {
      const source = createLayer(kind); source.modulations.echoHue = { kind: 'sine', cycles: 1, phase: 0, amount: .2, points: [] };
      const layer = applyFinish(source, finish.id);
      assert.ok(feedbackActive(layer), `${kind} ${finish.id}`);
      assert.equal(layer.modulations.echoHue, undefined, 'A finish replaces modulations of its own controls');
      assert.deepEqual(layer.palette, source.palette); assert.equal(layer.params.seed, source.params.seed);
      const cleared = applyFinish(layer, 'finish-none');
      assert.equal(feedbackActive(cleared), false);
      for (const key of FEEDBACK_KEYS) assert.equal(cleared.params[key], source.params[key], `${kind} ${key} returns to neutral`);
      const project = { ...createProject(), layers: [layer] };
      assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
    }
  }
  assert.equal(finishSupported(createLayer('graphic')), false);
  assert.throws(() => applyFinish(createLayer('graphic'), 'finish-tunnel'), /cannot be applied/);
  assert.throws(() => applyFinish(createLayer('surface'), 'missing'), /Unknown finish/);
  assert.ok(feedbackActive(applyPreset(createLayer('surface'), FINISH_SHOWCASE_IDS[0])));
});

test('variations never switch feedback on or change its blend and frame', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, unlocked, entropy);
      for (const key of ['echo', 'echoBlend', 'echoFrame', 'echoWindow', 'echoStreakAxis', 'echoKeep']) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
      if (!(layer.params.echo > 0)) for (const key of FEEDBACK_KEYS) assert.equal(varied.params[key], layer.params[key], `${preset.id} hidden ${key}`);
    }
  }
});
