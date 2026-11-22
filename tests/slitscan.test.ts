import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_LOOKS, FINISH_SHOWCASE_IDS, applyFinish, PRESETS, applyPreset, parameterDefinitions, createLayer, createProject, validateProject, varyLayer } from '../src/core/project';
import { SLIT_KEYS } from '../src/core/finishing';
import { SLIT_SHAPES, slitActive, sliceDelays, supportsSlitScan, sliceCount, slicePhase, sliceSourceRenders, echoWeights, channelSliceCounts, medianOf, medianTargetSize, slitControlVisible } from '../src/rendering/slitscan';
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
  const slits = FINISH_LOOKS.filter(f => (f.params.slitShift ?? 0) !== 0);
  assert.equal(slits.length, 8);
  assert.ok(slitActive(applyPreset(createLayer('surface'), FINISH_SHOWCASE_IDS[1])));
  for (const finish of slits) {
    const layer = applyFinish(applyFinish(createLayer('fractal'), 'finish-tunnel'), finish.id);
    assert.ok(slitActive(layer), finish.id);
    assert.equal(layer.params.echo, 0, 'A time finish replaces a feedback finish');
    const project = { ...createProject(), highlights: 'exact' as const, layers: [layer] };
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  }
});

test('variations never switch time displacement on or change its map, scroll or slice count', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, unlocked, entropy);
      for (const key of ['slitShift', 'slitShape', 'slitScroll', 'slitSlices', 'slitMode', 'slitDirection']) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
      if (!layer.params.slitShift) for (const key of SLIT_KEYS) assert.equal(varied.params[key], layer.params[key], `${preset.id} hidden ${key}`);
    }
  }
});

test('median uses an odd slice count of at most nine', () => {
  assert.equal(sliceCount({ slitMode: 2, slitSlices: 12 }), 9);
  assert.equal(sliceCount({ slitMode: 2, slitSlices: 4 }), 5);
  assert.equal(sliceCount({ slitMode: 2, slitSlices: 2 }), 3);
  assert.equal(sliceCount({ slitMode: 0, slitSlices: 12 }), 12);
  assert.equal(sliceDelays({ params: { slitMode: 2, slitShift: 1, slitSpan: 32, slitSlices: 12 } }).length, 9);
});
test('slices reach backward by default and forward in Future, wrapped to the loop', () => {
  const TAU = Math.PI * 2;
  assert.ok(Math.abs(slicePhase(0, 10, 100, 0) - TAU * .9) < 1e-9);
  assert.ok(Math.abs(slicePhase(TAU * .95, 10, 100, 1) - TAU * .05) < 1e-9);
});
test('echo weights sum to one and fade with age', () => {
  const w = echoWeights(5, .5);
  assert.ok(Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-9);
  assert.ok(w.every((v, i) => i === 0 || v < w[i - 1]));
  assert.deepEqual(echoWeights(4, 1), [.25, .25, .25, .25]);
});
test('colour reach gives red the shortest memory and blue all of it', () => {
  assert.deepEqual(channelSliceCounts(9, 1), [9, 9, 9]);
  assert.deepEqual(channelSliceCounts(9, .4), [4, 7, 9]);
  assert.deepEqual(channelSliceCounts(3, .1), [1, 2, 3]);
});
test('median handles odd and even counts', () => {
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([4, 1, 3, 2]), 2.5);
  assert.equal(medianOf([7]), 7);
});
test('median slices fit the memory budget at any size', () => {
  assert.deepEqual(medianTargetSize(3840, 2160, 9), { width: 3840, height: 2160 });
  const big = medianTargetSize(7680, 4320, 9);
  assert.ok(big.width * big.height * 8 * 9 <= 768 * 1024 * 1024);
  assert.ok(Math.abs(big.width / big.height - 16 / 9) < .01);
});
test('older time displacement settings keep their meaning', () => {
  const project = createProject();
  const layer = project.layers[0];
  layer.params.slitShift = 1; layer.params.slitShape = 4;
  for (const key of ['slitMode','slitDirection','slitDecay','slitReach','slitTwist','slitZoom','slitChroma']) delete layer.params[key];
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  assert.deepEqual([migrated.slitShape, migrated.slitMode, migrated.slitDirection, migrated.slitTwist], [4, 0, 0, 0]);
});

test('the Brightness map counts its driver as one more source render', () => {
  assert.equal(sliceSourceRenders({ params: { slitSlices: 12, slitShape: 2 } }), 12);
  assert.equal(sliceSourceRenders({ params: { slitSlices: 12, slitShape: 5 } }), 13);
});

test('statistical time modes render no Brightness driver', () => {
  const params = { slitShift: 1, slitSpan: 30, slitSlices: 7, slitShape: 5 };
  assert.equal(sliceSourceRenders({ params: { ...params, slitMode: 0 } }), 8);
  for (const slitMode of [1, 3, 4]) assert.equal(sliceSourceRenders({ params: { ...params, slitMode } }), 7);
  assert.equal(sliceSourceRenders({ params: { ...params, slitMode: 2 } }), 7);
  assert.equal(sliceSourceRenders({ params: { ...params, slitMode: 2, slitSlices: 12 } }), 9);
});

test('the time mode is rounded the same way when counting slices', () => {
  assert.equal(sliceCount({ slitMode: 1.6, slitSlices: 12 }), 9);
  assert.equal(sliceCount({ slitMode: 2.4, slitSlices: 4 }), 5);
  assert.equal(sliceCount({ slitMode: 2.6, slitSlices: 12 }), 12);
});

test('time controls appear only for the mode that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, slitShift: 1, ...params } });
  assert.equal(slitControlVisible(base, 'slitShift'), true);
  assert.equal(slitControlVisible(base, 'slitMode'), false);
  assert.equal(slitControlVisible(on({ slitMode: 0 }), 'slitTwist'), true);
  assert.equal(slitControlVisible(on({ slitMode: 1 }), 'slitTwist'), false);
  assert.equal(slitControlVisible(on({ slitMode: 1 }), 'slitDecay'), true);
  assert.equal(slitControlVisible(on({ slitMode: 2 }), 'slitReach'), true);
  assert.equal(slitControlVisible(on({ slitMode: 2 }), 'slitSmooth'), false);
  assert.equal(slitControlVisible(on({ slitShape: 4 }), 'slitBlocks'), true);
  assert.equal(slitControlVisible(on({ slitShape: 6 }), 'slitBlocks'), true);
  assert.equal(slitControlVisible(on({ slitShape: 2 }), 'slitBlocks'), false);
  assert.equal(slitControlVisible(on({ slitMode: 1, slitShape: 4 }), 'slitBlocks'), false);
  assert.equal(slitControlVisible(on({ slitMode: 0 }), 'slitDecay'), false);
  for (const mode of [3, 4]) assert.equal(slitControlVisible(on({ slitMode: mode }), 'slitReach'), true);
  for (const key of ['slitSpan', 'slitSlices', 'slitMode', 'slitDirection']) for (const mode of [0, 1, 2, 3, 4]) assert.equal(slitControlVisible(on({ slitMode: mode }), key), true, `${key} ${mode}`);
  const modulated = { ...base, modulations: { ...base.modulations, slitShift: { source: 'lfo' } as never } };
  assert.equal(slitControlVisible(modulated, 'slitSpan'), true);
});

test('the five new time looks exist with their exact recipes', () => {
  const find = (id: string) => FINISH_LOOKS.find(f => f.id === id)!.params;
  assert.deepEqual(find('finish-time-vortex'), { slitShift: 1, slitSpan: 60, slitShape: 2, slitSlices: 16, slitSmooth: 1, slitTwist: .5, slitZoom: .2, slitChroma: .25 });
  assert.deepEqual(find('finish-ghost-median'), { slitShift: 1, slitSpan: 60, slitMode: 2, slitSlices: 9, slitReach: .4 });
  assert.deepEqual(find('finish-long-exposure'), { slitShift: 1, slitSpan: 45, slitMode: 4, slitSlices: 16 });
  assert.deepEqual(find('finish-premonition'), { slitShift: 1, slitSpan: 24, slitMode: 1, slitDirection: 1, slitSlices: 8, slitDecay: .7 });
  assert.deepEqual(find('finish-brightness-time'), { slitShift: 1, slitSpan: 60, slitShape: 5, slitSlices: 16, slitSmooth: 1 });
});
