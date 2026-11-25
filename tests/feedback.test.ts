import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_LOOKS, FINISH_SHOWCASE_IDS, applyFinish, finishSupported, PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer } from '../src/core/project';
import { FEEDBACK_KEYS } from '../src/core/finishing';
import { phaseAtFrame } from '../src/core/timeline';
import { echoAppliedInSource, echoFade, echoSettings, feedbackActive, frameAtPhase, historyFrames, persistence, supportsFeedback, warmupFrames, MAX_PERSISTENCE } from '../src/rendering/feedback';
import { KALEIDOSCOPE_INPUT } from '../src/core/project';
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

const kaleidoscope = (input: number, params: Record<string, number> = {}) => {
  const layer = createLayer('kaleidoscope');
  Object.assign(layer.params, { input }, params);
  return layer;
};

test('a Kaleidoscope on the feedback input runs the feedback history only while echo is up', () => {
  assert.equal(feedbackActive(kaleidoscope(KALEIDOSCOPE_INPUT.feedback, { echo: .5 })), true);
  assert.equal(feedbackActive(kaleidoscope(KALEIDOSCOPE_INPUT.feedback, { echo: 0 })), false);
  assert.equal(echoAppliedInSource(kaleidoscope(KALEIDOSCOPE_INPUT.feedback, { echo: .5 })), true);
  assert.equal(echoAppliedInSource(kaleidoscope(KALEIDOSCOPE_INPUT.feedback, { echo: 0 })), false);
});

test('echoAppliedInSource is false for every other input and kind', () => {
  for (const input of [KALEIDOSCOPE_INPUT.motif, KALEIDOSCOPE_INPUT.image, KALEIDOSCOPE_INPUT.below]) {
    assert.equal(echoAppliedInSource(kaleidoscope(input, { echo: .5 })), false, `input ${input}`);
  }
  for (const kind of ['surface', 'fractal', 'image', 'glitchtunnel', 'oil'] as const) {
    const layer = createLayer(kind); layer.params.echo = .5; layer.params.input = KALEIDOSCOPE_INPUT.feedback;
    assert.equal(echoAppliedInSource(layer), false, kind);
  }
});

test('the layer-below input keeps no echo history, so its loop stays exact', () => {
  assert.equal(feedbackActive(kaleidoscope(KALEIDOSCOPE_INPUT.below, { echo: .5 })), false);
  const animated = kaleidoscope(KALEIDOSCOPE_INPUT.below);
  animated.modulations.echo = { kind: 'sine', cycles: 1, phase: 0, amount: .2, points: [] };
  assert.equal(feedbackActive(animated), false);
  assert.equal(feedbackActive(kaleidoscope(KALEIDOSCOPE_INPUT.motif, { echo: .5 })), true, 'the generic echo still runs on the motif');
  assert.equal(feedbackActive(kaleidoscope(KALEIDOSCOPE_INPUT.image, { echo: .5 })), true, 'and on an image');
});

test('on the feedback input the gain and warm-up follow persistence, even with held echo', () => {
  const held = { echo: 1, echoKeep: 1, echoZoom: 1.02, echoRotate: 3, echoDriftX: .1, echoFrame: .4, echoWindow: .4 };
  const layer = kaleidoscope(KALEIDOSCOPE_INPUT.feedback, held);
  const settings = echoSettings(layer, 1);
  assert.equal(echoFade(settings), persistence(layer), 'never the held gain of 1');
  assert.ok(echoFade(settings) <= MAX_PERSISTENCE);
  assert.equal(historyFrames(settings), warmupFrames(persistence(layer)));
  for (const key of ['echoKeep', 'echoZoom', 'echoRotate', 'echoDriftX', 'echoFrame', 'echoWindow']) assert.equal(settings[key], undefined, key);
  const generic = kaleidoscope(KALEIDOSCOPE_INPUT.motif, held);
  assert.equal(echoFade(echoSettings(generic, 1)), 1, 'other inputs keep held echo');
});
