import test from 'node:test';
import assert from 'node:assert/strict';
import { delayOrder, stagedTime, TIMING_KEYS } from '../src/core/timing';
import { applyPreset, createLayer, createProject, PRESETS, validateProject } from '../src/core/project';
const TAU = Math.PI * 2;

test('staged time is the loop clock unchanged at neutral settings', () => {
  for (let i = 0; i < 200; i++) { const t = i / 200 * TAU * 3; assert.equal(stagedTime(t, Math.random(), 0, 0), t); }
});

test('staged time closes every cycle exactly and never runs backwards', () => {
  for (const spread of [0, .3, 1]) for (const pause of [0, .2, .5, 1]) for (const order of [0, .25, 1]) {
    for (let i = 0; i < 50; i++) {
      const t = i / 50 * TAU;
      assert.ok(Math.abs(stagedTime(t + TAU, order, spread, pause) - stagedTime(t, order, spread, pause) - TAU) < 1e-9);
    }
    let previous = -Infinity;
    for (let i = 0; i <= 400; i++) { const v = stagedTime(i / 400 * TAU, order, spread, pause); assert.ok(v >= previous - 1e-12); previous = v; }
  }
});

test('delay order spans 0 to 1 for each shape', () => {
  for (const shape of [0, 1, 2]) {
    for (let i = 0; i < 100; i++) { const v = delayOrder((Math.random() - .5) * 16 / 9, Math.random() - .5, 16 / 9, shape); assert.ok(v >= 0 && v <= 1); }
  }
  assert.equal(delayOrder(-8 / 9, 0, 16 / 9, 0), 0); assert.equal(delayOrder(8 / 9, 0, 16 / 9, 0), 1);
  assert.equal(delayOrder(0, 0, 16 / 9, 1), 0);
});

test('older Surface, Graphic and Relief layers open with timing off', () => {
  for (const kind of ['surface', 'graphic', 'relief'] as const) {
    const project = { ...createProject(), layers: [createLayer(kind)] };
    for (const key of [...TIMING_KEYS, 'panelMix']) delete project.layers[0].params[key];
    const opened = validateProject(JSON.parse(JSON.stringify(project)));
    for (const key of TIMING_KEYS) assert.equal(opened.layers[0].params[key], 0, `${kind} ${key}`);
    if (kind === 'relief') assert.equal(opened.layers[0].params.panelMix, 0);
  }
});

test('Surface, Graphic and Relief presets with staged motion have it enabled', () => {
  for (const preset of PRESETS.filter(p => ['surface', 'graphic', 'relief'].includes(p.kind) && !['recursion-tunnel', 'time-terraces', 'offset-fold'].includes(p.id))) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    assert.ok(layer.params.delaySpread > 0 || layer.params.pause > 0, preset.id);
  }
});
