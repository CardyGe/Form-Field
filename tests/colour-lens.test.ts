import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyFinish, applyPreset, createLayer, finishSupported, createProject, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { SPLIT_KEYS, GRADIENT_KEYS, GRADE_KEYS, KEY_KEYS, GRADE_PARAMETERS, KEY_PARAMETERS, FINISH_KEYS } from '../src/core/finishing';
import { balanceControlVisible, gradientControlVisible, keyControlVisible, splitControlVisible, gradientStops, gradientTone, keyCoverage, lensActive, spectralWeights, whiteBalance } from '../src/rendering/colour-lens';

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

test('neutral white balance changes nothing, and keeps brightness when moved', () => {
  assert.deepEqual(whiteBalance(0, 0), [1, 1, 1]);
  const warm = whiteBalance(1, 0), luma = (c: number[]) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  assert.ok(warm[0] > 1 && warm[2] < 1);
  assert.ok(Math.abs(luma(warm) - 1) < 1e-9);
  assert.ok(whiteBalance(0, 1)[1] < 1, 'positive tint moves towards magenta');
});
test('key coverage keeps the range, feathers its edges and inverts', () => {
  assert.equal(keyCoverage(.5, .25, .75, 0, 0), 1);
  assert.equal(keyCoverage(.1, .25, .75, 0, 0), 0);
  assert.equal(keyCoverage(.1, .25, .75, 0, 1), 1);
  const edge = keyCoverage(.25, .25, .75, .2, 0);
  assert.ok(edge > 0 && edge < 1);
});
test('key coverage leaves the open ends of the range open', () => {
  assert.equal(keyCoverage(0, 0, .5, .2, 0), 1, 'black is inside a range that starts at 0');
  assert.equal(keyCoverage(1, .5, 1, .2, 0), 1, 'white is inside a range that ends at 1');
});
test('grading and key turn the lens pass on, and variations never switch them on', () => {
  const layer = createLayer('surface');
  for (const params of [{ gradeTemperature: .2 } as Record<string, number>, { gradeTint: -.2 }, { gradeShadowTint: .3 }, { gradeHighlightTint: .3 }, { keyMix: 1 }])
    assert.equal(lensActive({ ...layer, params: { ...layer.params, ...params } }), true);
  for (const key of ['gradeTemperature', 'gradeTint', 'gradeShadowTint', 'gradeHighlightTint', 'keyMix'])
    assert.equal(lensActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  assert.equal(lensActive(layer), false);
  const varied = varyLayer(layer, 1, { palette:false, structure:false, motion:false, material:false }, 2);
  for (const key of [...GRADE_KEYS, ...KEY_KEYS]) assert.equal(varied.params[key], layer.params[key]);
});
test('grade and key controls follow the brief, migrate and stay hidden on graphic layers', () => {
  const find = (key: string) => [...GRADE_PARAMETERS, ...KEY_PARAMETERS].find(d => d.key === key)!;
  assert.equal(GRADE_KEYS.length, 6); assert.equal(KEY_KEYS.length, 8);
  assert.deepEqual([find('gradeShadowColour').min, find('gradeShadowColour').max, find('gradeShadowColour').default], [1, 6, 1]);
  assert.equal(find('gradeHighlightColour').default, 2);
  assert.deepEqual([find('keyLow').default, find('keyHigh').default, find('keySoftness').default, find('keyHue').default, find('keyHueRange').default], [.25, 1, .1, 120, 40]);
  for (const key of [...GRADE_KEYS, ...KEY_KEYS]) { assert.ok(FINISH_KEYS.includes(key), key); assert.equal(find(key).section, 'Material'); }
  const graphic = createLayer('graphic');
  assert.equal(visibleParameterDefinitions(graphic).some(d => [...GRADE_KEYS, ...KEY_KEYS].includes(d.key)), false);
  assert.equal(lensActive({ ...graphic, params: { ...graphic.params, keyMix: 1, gradeTemperature: 1 } }), false);
  const project = createProject();
  for (const layer of project.layers) for (const key of [...GRADE_KEYS, ...KEY_KEYS]) delete layer.params[key];
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.layers[0].params.keyMix, 0); assert.equal(migrated.layers[0].params.keyLow, .25);
});

test('split controls appear only when they apply', () => {
  const on = (params: Record<string, number>) => ({ ...createLayer('surface'), params: { ...createLayer('surface').params, splitAmount: 8, ...params } });
  assert.equal(splitControlVisible(createLayer('surface'), 'splitAmount'), true);
  assert.equal(splitControlVisible(createLayer('surface'), 'splitAngle'), false);
  assert.equal(splitControlVisible(on({ splitShape: 1 }), 'splitAngle'), false);
  assert.equal(splitControlVisible(on({ splitShape: 2 }), 'splitThreshold'), true);
  assert.equal(splitControlVisible(on({ splitShape: 3 }), 'splitTravel'), true);
  assert.equal(splitControlVisible(on({ splitShape: 0 }), 'splitWaves'), false);
  assert.equal(splitControlVisible(on({ splitOrder: 0 }), 'splitBlocks'), false);
  assert.equal(splitControlVisible(on({ splitOrder: 2 }), 'splitBlocks'), true);
  assert.equal(splitControlVisible(createLayer('surface'), 'splitOrder'), true);
  const animated = { ...createLayer('surface'), modulations: { splitAmount: {} as never } };
  assert.equal(splitControlVisible(animated, 'splitShape'), true);
});
test('gradient controls appear only once the map is on', () => {
  const layer = createLayer('surface');
  assert.equal(gradientControlVisible(layer, 'gradMix'), true);
  assert.equal(gradientControlVisible(layer, 'gradPalette'), false);
  assert.equal(gradientControlVisible({ ...layer, params: { ...layer.params, gradMix: .5 } }, 'gradKeep'), true);
  assert.equal(gradientControlVisible({ ...layer, modulations: { gradMix: {} as never } }, 'gradOffset'), true);
});
test('colour balance swatches appear only with their tint', () => {
  const layer = createLayer('surface');
  assert.equal(balanceControlVisible(layer, 'gradeTemperature'), true);
  assert.equal(balanceControlVisible(layer, 'gradeShadowTint'), true);
  assert.equal(balanceControlVisible(layer, 'gradeShadowColour'), false);
  assert.equal(balanceControlVisible(layer, 'gradeHighlightColour'), false);
  const tinted = { ...layer, params: { ...layer.params, gradeShadowTint: .4 } };
  assert.equal(balanceControlVisible(tinted, 'gradeShadowColour'), true);
  assert.equal(balanceControlVisible(tinted, 'gradeHighlightColour'), false);
  assert.equal(balanceControlVisible({ ...layer, modulations: { gradeHighlightTint: {} as never } }, 'gradeHighlightColour'), true);
});
test('key controls follow the key and its mode', () => {
  const layer = createLayer('surface');
  assert.equal(keyControlVisible(layer, 'keyMix'), true);
  for (const key of ['keyMode', 'keyLow', 'keySoftness', 'keyHue', 'keyInvert']) assert.equal(keyControlVisible(layer, key), false);
  const on = (keyMode: number) => ({ ...layer, params: { ...layer.params, keyMix: 1, keyMode } });
  assert.equal(keyControlVisible(on(0), 'keyLow'), true);
  assert.equal(keyControlVisible(on(0), 'keyHue'), false);
  assert.equal(keyControlVisible(on(1), 'keyHueRange'), true);
  assert.equal(keyControlVisible(on(1), 'keyHigh'), false);
  assert.equal(keyControlVisible(on(1), 'keySoftness'), true);
  assert.equal(keyControlVisible({ ...layer, modulations: { keyMix: {} as never } }, 'keyMode'), true);
});
test('colour looks apply, replace other finishes and clear', () => {
  const layer = applyFinish(createLayer('surface'), 'finish-anamorphic');
  assert.deepEqual([layer.params.glowMix, layer.params.glowThreshold, layer.params.glowSize, layer.params.glowStreak], [.4, 1, .1, 2]);
  const mapped = applyFinish(layer, 'finish-neon-map');
  assert.deepEqual([mapped.params.glowStreak, mapped.params.gradMix], [0, 1]);
  assert.equal(applyFinish(mapped, 'finish-none').params.gradMix, 0);
  assert.equal(finishSupported(createLayer('scope'), 'finish-anamorphic'), false);
});
