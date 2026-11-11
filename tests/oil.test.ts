import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset, createLayer, createProject, parameterDefinitions, PRESETS, validateProject, varyLayer } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';
import { oilMotion } from '../src/rendering/oil-motion';

const TAU = Math.PI * 2;
const projectWith = (id = 'acid-slide') => ({ ...createProject(), layers: [applyPreset(createLayer('oil'), id)] });
function closeTree(a: unknown, b: unknown, tolerance = 1e-7): void {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Number.isFinite(a) && Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length); a.forEach((value, i) => closeTree(value, b[i], tolerance));
  } else {
    assert.deepEqual(Object.keys(a as object), Object.keys(b as object));
    for (const key of Object.keys(a as object)) closeTree((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], tolerance);
  }
}

test('Oil looks retain complete saved state, palettes and new controls across JSON roundtrips', () => {
  const presets = PRESETS.filter(p => p.kind === 'oil');
  assert.equal(presets.length, 9);
  for (const preset of presets) {
    const p = projectWith(preset.id);
    p.layers[0].modulations.travel = { kind: 'noise', cycles: 2, phase: .2, amount: .4, points: [] };
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  }
  assert.notDeepEqual(createLayer('oil').palette, createLayer('surface').palette);
  assert.equal(createLayer('oil').name, 'Oil Slides');
  for (const [key, value] of [['lensSize', 0], ['quality', .5], ['substrate', 2], ['drag', Infinity]] as const) {
    const p = projectWith(); p.layers[0].params[key] = value;
    assert.throws(() => validateProject(p));
  }
  const missing = projectWith(); delete missing.layers[0].params.refraction;
  assert.throws(() => validateProject(missing), /refraction/);
});

test('Oil motion is closed and independent of call order, including animated path controls', () => {
  const layer = createLayer('oil');
  layer.modulations.travel = { kind: 'noise', cycles: 2, phase: .2, amount: .4, points: [] };
  layer.modulations.relativeRotation = { kind: 'sine', cycles: 3, phase: .1, amount: .3, points: [] };
  for (const phase of [0, .31, 2.7, TAU - .00001]) {
    const initial = oilMotion(layer, phase);
    oilMotion(layer, 1.3);
    assert.deepEqual(oilMotion(layer, phase), initial);
    closeTree(oilMotion(layer, phase + TAU), initial);
  }
});

test('Oil wrap has matching motion derivatives and zero intrinsic movement really stops', () => {
  const layer = createLayer('oil'), e = .00001;
  const minus = oilMotion(layer, -e), zero = oilMotion(layer, 0), plus = oilMotion(layer, e);
  for (const key of ['x', 'y', 'slideX', 'slideY', 'rotation', 'presence'] as const) {
    assert.ok(Math.abs((zero[key] - minus[key]) / e - (plus[key] - zero[key]) / e) < .001, key);
  }
  Object.assign(layer.params, { travel: 0, relativeRotation: 0, lift: 0 });
  closeTree(oilMotion(layer, 0), oilMotion(layer, 2.7));
  assert.equal(oilMotion(layer, 0).strain, 0);
});

test('Oil movement stays finite at extreme seed, speed, size and modulation settings', () => {
  for (const seed of [0, 1729, 0xffffffff]) for (const cycles of [1, 8]) {
    const layer = createLayer('oil'); Object.assign(layer.params, { seed, cycles, travel: .8, relativeRotation: 1.2, drag: 1, lensSize: .06, lensAspect: .6, lift: 1 });
    for (const phase of [0, .001, 1.2, TAU - .001]) {
      const state = oilMotion(layer, phase);
      const values = Object.values(state).flat(2);
      assert.ok(values.every(Number.isFinite));
      assert.ok(state.presence >= 0 && state.presence <= 1);
      assert.ok(state.strain >= 0 && state.strain <= 1);
    }
  }
});

test('Oil variation respects locks, quality and cutout choice, with bounded modulation', () => {
  const layer = createLayer('oil');layer.params.substrate=0;layer.params.quality=2;
  const varied = varyLayer(layer, .35, { palette: true, structure: true, motion: true, material: false });
  assert.deepEqual(varied.palette, layer.palette);
  assert.equal(varied.params.quality, 2);assert.equal(varied.params.substrate, 0);
  for (const d of parameterDefinitions('oil').filter(d => d.section === 'Motion' || d.section === 'Shape')) assert.equal(varied.params[d.key], layer.params[d.key]);
  for (const d of parameterDefinitions('oil').filter(d => d.step !== 1)) {
    layer.modulations[d.key] = {kind:'sine', cycles:1, phase:0, amount:1, points:[]};
  }
  const animated=evaluateLayer(layer, Math.PI/2);
  for(const d of parameterDefinitions('oil')) assert.ok(animated.params[d.key]>=d.min&&animated.params[d.key]<=d.max);
});


test('v0.7 Oil projects gain only absent refinement controls and retain explicit authored values', () => {
  const project=projectWith();const keys=['deformation','lensDepth','cellComplexity','dispersion'];
  for(const key of keys)delete project.layers[0].params[key];
  const original=structuredClone(project), restored=validateProject(project);
  assert.deepEqual(project,original,'Migration must not mutate the saved input');
  for(const key of keys)assert.equal(restored.layers[0].params[key],parameterDefinitions('oil').find(d=>d.key===key)!.default);
  const zeroes=projectWith();for(const key of keys)zeroes.layers[0].params[key]=0;
  assert.deepEqual(validateProject(zeroes),zeroes);
  for(const key of keys){const invalid=structuredClone(zeroes);invalid.layers[0].params[key]=2;assert.throws(()=>validateProject(invalid));}
});
