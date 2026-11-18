import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_FIGURES, SCOPE_PLAIN, scopeWave, scopeCurve, scopeDash, scopeFigurePoint, scopeLine, scopeMorphWeight, scopePerspective, scopeRotation } from '../src/rendering/scope-curve';
import { PRESETS, applyPreset, createLayer, createProject, parameterDefinitions, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';

import { emberPhrase, SCOPE_POINT_STRIDE, writeEmberPoints } from '../src/rendering/scope-ember';
import { emberSmokeFrame } from '../src/rendering/scope-ember-smoke';

const TAU = Math.PI * 2;
const motion = { tilt: .4, tumbleX: 1, tumbleY: 2 };

test('every scope figure is a closed line inside the unit cube with its own ratio', () => {
  for (const figure of SCOPE_FIGURES) {
    for (const slip of [0, 1.3]) {
      const start = scopeFigurePoint(figure, 0, undefined, slip, .5), end = scopeFigurePoint(figure, 1, undefined, slip, .5);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(start[k] - end[k]) < 1e-9, `${figure.name} does not close`);
      for (let i = 0; i < 200; i++) for (const v of scopeFigurePoint(figure, i / 200, undefined, slip, .5)) assert.ok(Math.abs(v) <= 1 + 1e-9, `${figure.name} leaves the cube`);
    }
    assert.ok(Number.isInteger(figure.x) && Number.isInteger(figure.y) && Number.isInteger(figure.z));
  }
  assert.equal(new Set(SCOPE_FIGURES.map(f => `${f.x}:${f.y}:${f.z}`)).size, SCOPE_FIGURES.length);
});

test('the scope curve has no jumps and its ends meet exactly', () => {
  for (let figure = 0; figure < SCOPE_FIGURES.length; figure++) {
    const count = 4096, points = scopeCurve(figure, motion, 1.1, count);
    assert.equal(points.length, (count + 1) * 3);
    for (let k = 0; k < 3; k++) assert.equal(points[k], points[count * 3 + k]);
    let longest = 0;
    for (let i = 0; i < count; i++) longest = Math.max(longest, Math.hypot(points[i * 3 + 3] - points[i * 3], points[i * 3 + 4] - points[i * 3 + 1], points[i * 3 + 5] - points[i * 3 + 2]));
    assert.ok(longest < .05, `${SCOPE_FIGURES[figure].name}: a step of ${longest}`);
  }
});

test('phase drift changes the figure itself and closes over the loop', () => {
  const still = { tilt: 0, tumbleX: 0, tumbleY: 0 }, shape = { figure: 1, ...SCOPE_PLAIN, drift: 1 };
  const start = scopeLine(shape, still, 0, 512), later = scopeLine(shape, still, 1.2, 512), end = scopeLine(shape, still, TAU, 512);
  for (let i = 0; i < start.length; i += 5) assert.ok(Math.abs(start[i] - end[i]) < 1e-5);
  // Not a turn of a fixed object: the up-and-down part is untouched while across changes.
  let across = 0, up = 0;
  for (let i = 0; i < 512; i++) { across = Math.max(across, Math.abs(start[i * 3] - later[i * 3])); up = Math.max(up, Math.abs(start[i * 3 + 1] - later[i * 3 + 1])); }
  assert.ok(across > .3 && up < 1e-6, `${across} ${up}`);
  // With no drift and no tumble the figure holds still.
  assert.deepEqual(scopeLine({ ...shape, drift: 0 }, still, 0, 64), scopeLine({ ...shape, drift: 0 }, still, 2, 64));
});

test('the tumble returns to its start after one loop and moves in between', () => {
  const start = scopeRotation(motion, 0), end = scopeRotation(motion, TAU), middle = scopeRotation(motion, TAU / 3);
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(start[i] - end[i]) < 1e-9);
  assert.ok(start.some((v, i) => Math.abs(v - middle[i]) > .2));
  // Fractional turn counts are rounded, so a loop can never fail to close.
  const odd = scopeRotation({ tilt: 0, tumbleX: 1.4, tumbleY: 0 }, TAU);
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(odd[i] - scopeRotation({ tilt: 0, tumbleX: 1, tumbleY: 0 }, 0)[i]) < 1e-9);
  // A rotation keeps lengths.
  for (let r = 0; r < 3; r++) assert.ok(Math.abs(Math.hypot(middle[r * 3], middle[r * 3 + 1], middle[r * 3 + 2]) - 1) < 1e-9);
});

test('near points appear larger than far ones', () => {
  assert.ok(scopePerspective(1) > scopePerspective(0) && scopePerspective(0) > scopePerspective(-1));
  assert.equal(scopePerspective(0), 1);
});

test('scope is a registered family with usable defaults and presets', () => {
  const layer = createLayer('scope');
  assert.equal(layer.name, 'Oscilloscope');
  assert.equal(layer.palette.length, 6);
  for (const d of parameterDefinitions('scope')) assert.ok(layer.params[d.key] >= d.min && layer.params[d.key] <= d.max, d.key);
  assert.equal(parameterDefinitions('scope').find(d => d.key === 'figure')!.max, SCOPE_FIGURES.length - 1);
  const presets = PRESETS.filter(p => p.kind === 'scope');
  assert.ok(presets.length >= 2);
  for (const preset of presets) {
    const project = { ...createProject(), layers: [applyPreset(createLayer('scope'), preset.id)] };
    assert.equal(validateProject(JSON.parse(JSON.stringify(project))).layers.length, 1, preset.id);
  }
});

const lengthOf = (points: Float32Array) => { let sum = 0; for (let i = 3; i < points.length; i += 3) sum += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]); return sum; };

test('the morph rests on each figure and returns to the first', () => {
  assert.equal(scopeMorphWeight(0, .5), 0);
  assert.equal(scopeMorphWeight(TAU, .5), 0);
  assert.equal(scopeMorphWeight(Math.PI, .5), 1);
  // Resting: still on the first figure an eighth of the way in, already on the second by three eighths.
  assert.equal(scopeMorphWeight(TAU * .1, .5), 0);
  assert.equal(scopeMorphWeight(TAU * .4, .5), 1);
  const middle = scopeMorphWeight(TAU * .25, .5);
  assert.ok(middle > .4 && middle < .6);
  // Out and back are mirror images.
  assert.ok(Math.abs(scopeMorphWeight(TAU * .2, .3) - scopeMorphWeight(TAU * .8, .3)) < 1e-9);
});

test('a morphing, wiggling line stays closed, bounded and loops exactly', () => {
  const shape = { figure: 0, figureB: 3, morph: 1, hold: .4, drift: 2, overtones: .5, sway: .6, wiggle: .7, wiggleFrequency: 47.4, wiggleBursts: .6 };
  const count = 4096;
  for (const phase of [0, 1.3, Math.PI, 4.9]) {
    const points = scopeLine(shape, motion, phase, count);
    for (let k = 0; k < 3; k++) assert.equal(points[k], points[count * 3 + k]);
    for (let i = 0; i <= count; i += 37) { const r = Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]); assert.ok(r < 1.7, `radius ${r}`); }
  }
  const start = scopeLine(shape, motion, 0, count), end = scopeLine(shape, motion, TAU, count);
  for (let i = 0; i < start.length; i += 11) assert.ok(Math.abs(start[i] - end[i]) < 1e-5, `point ${i}`);
});

test('wiggle lengthens the line, and bursts gather it into part of the loop', () => {
  const base = { figure: 0, ...SCOPE_PLAIN }, still = { tilt: 0, tumbleX: 0, tumbleY: 0 };
  const plain = lengthOf(scopeLine(base, still, 1, 4096));
  const rippled = lengthOf(scopeLine({ ...base, wiggle: .6 }, still, 1, 4096));
  assert.ok(rippled > plain * 1.5, `${rippled} against ${plain}`);
  // With bursts the ripple is absent at the start of the loop and present at its middle.
  const burst = { ...base, wiggle: .6, wiggleBursts: 1 };
  assert.ok(Math.abs(lengthOf(scopeLine(burst, still, 0, 4096)) - plain) < plain * .01);
  assert.ok(lengthOf(scopeLine(burst, still, Math.PI, 4096)) > plain * 1.15);
});

test('no pair of figures tears while morphing', () => {
  for (let a = 0; a < SCOPE_FIGURES.length; a++) for (let b = 0; b < SCOPE_FIGURES.length; b++) {
    // Weight 0.5 is reached at a quarter of the loop with no hold.
    const points = scopeLine({ figure: a, ...SCOPE_PLAIN, figureB: b, morph: 1 }, { tilt: 0, tumbleX: 0, tumbleY: 0 }, TAU * .25, 4096);
    let longest = 0;
    for (let i = 3; i < points.length; i += 3) longest = Math.max(longest, Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]));
    assert.ok(longest < .2, `${SCOPE_FIGURES[a].name} to ${SCOPE_FIGURES[b].name}: a step of ${longest.toFixed(3)}`);
  }
});

test('dashes travel and the pattern closes over the line and the loop', () => {
  assert.equal(scopeDash(.3, 1, 0, 12, .3, 2), 1);
  const at = (s: number, phase: number) => scopeDash(s, phase, 1, 12, .3, 2);
  assert.ok(Math.abs(at(0, .7) - at(1, .7)) < 1e-9);
  assert.ok(Math.abs(at(.123, 0) - at(.123, TAU)) < 1e-9);
  let bright = 0, dim = 0;
  for (let i = 0; i < 1200; i++) { const v = at(i / 1200, .4); if (v > 3) bright++; else if (v < .5) dim++; }
  assert.ok(bright > 150 && bright < 400, `${bright} bright`);
  assert.ok(dim > 600, `${dim} dim`);
  assert.notEqual(at(.01, 0), at(.01, 1));
});

test('the wave closes over the loop, is uneven, and can be supplied from outside', () => {
  const shape = { figure: 1, ...SCOPE_PLAIN, sway: .5, wiggle: .6 };
  const start = scopeWave(shape, 0), end = scopeWave(shape, TAU), later = scopeWave(shape, 1.7);
  for (let i = 0; i < start.length; i += 7) assert.ok(Math.abs(start[i] - end[i]) < 1e-5);
  assert.ok(start.some((v, i) => Math.abs(v - later[i]) > .02));
  // Not a neat zigzag: the peaks are of many different heights.
  const peaks = new Set<number>();
  for (let i = 1; i < start.length - 1; i++) if (start[i] > start[i - 1] && start[i] > start[i + 1]) peaks.add(Math.round(start[i] * 100));
  assert.ok(peaks.size > 8, `${peaks.size} peak heights`);
  assert.ok(scopeWave({ figure: 1, ...SCOPE_PLAIN }, 1).every(v => v === 0));
  // A wave from elsewhere (sound, later) moves the line with no signal of its own.
  const still = { tilt: 0, tumbleX: 0, tumbleY: 0 }, plain = { figure: 1, ...SCOPE_PLAIN };
  const sound = Float32Array.from({ length: 512 }, (_, i) => .08 * Math.sin(TAU * 24 * i / 512));
  const driven = scopeLine(plain, still, 0, 2048, undefined, sound), quiet = scopeLine(plain, still, 0, 2048);
  assert.ok(lengthOf(driven) > lengthOf(quiet) * 1.2);
  for (let k = 0; k < 3; k++) assert.equal(driven[k], driven[2048 * 3 + k]);
});

test('float changes the pace of the tumble but still closes the loop', () => {
  const steady = { tilt: .3, tumbleX: 1, tumbleY: 1 }, floating = { ...steady, float: 1 };
  const start = scopeRotation(floating, 0), end = scopeRotation(floating, TAU);
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(start[i] - end[i]) < 1e-9);
  assert.ok(scopeRotation(floating, 1.9).some((v, i) => Math.abs(v - scopeRotation(steady, 1.9)[i]) > .1));
  // It still rocks when the tumble is off.
  const rest = { tilt: 0, tumbleX: 0, tumbleY: 0, float: 1 };
  assert.ok(scopeRotation(rest, 1).some((v, i) => Math.abs(v - scopeRotation(rest, 2.5)[i]) > .1));
});

const emberLayer = () => applyPreset(createLayer('scope'), 'ember-pulse');

test('older Oscilloscope layers open in Classic and the Ember mode has its own persisted controls', () => {
  const layer = createLayer('scope');
  for (const key of Object.keys(layer.params)) if (key === 'scopeMode' || key.startsWith('ember')) delete layer.params[key];
  const classic = validateProject({ ...createProject(), layers: [layer] }).layers[0];
  assert.equal(classic.params.scopeMode, 0);
  assert.ok(visibleParameterDefinitions(classic).some(d => d.key === 'figure'));
  assert.ok(!visibleParameterDefinitions(classic).some(d => d.key === 'emberOpening'));

  const ember = emberLayer();
  assert.equal(ember.params.scopeMode, 1);
  assert.ok(visibleParameterDefinitions(ember).some(d => d.key === 'emberOpening'));
  assert.ok(!visibleParameterDefinitions(ember).some(d => d.key === 'figure'));
  assert.deepEqual(validateProject({ ...createProject(), layers: [ember] }).layers[0], ember);
  const varied = varyLayer(ember, .6, { palette: false, structure: false, motion: false, material: false }, 90);
  assert.equal(varied.params.scopeMode, 1);
  assert.equal(varied.params.emberPhrases, ember.params.emberPhrases);
  assert.deepEqual(varied.palette, ember.palette);
});

function emberFrame(params: Record<string, number>, phase: number, aspect = 9 / 16) {
  const buffer = new Float32Array(8000 * SCOPE_POINT_STRIDE).fill(NaN);
  const frame = writeEmberPoints(buffer, params, phase, aspect);
  assert.ok(frame.points > 0 && frame.points <= 8000);
  const samples = buffer.slice(0, frame.points * SCOPE_POINT_STRIDE);
  assert.ok(samples.every(Number.isFinite));
  return { ...frame, samples };
}

test('Ember geometry has bounded, closed paths and a deterministic loop including afterglow', () => {
  const params = { ...emberLayer().params, emberDensity: 1, afterglow: 1 };
  const start = emberFrame(params, 0);
  assert.deepEqual(start, emberFrame(params, TAU));
  for (const phase of [0, .1, .65, 1.1, 2.7, 4.4, TAU - .001]) {
    const { samples } = emberFrame(params, phase);
    let start = 0;
    for (let index = 0; index < samples.length; index += SCOPE_POINT_STRIDE) {
      if (samples[index + 3] !== 0) continue;
      assert.deepEqual(samples.slice(index, index + 3), samples.slice(start, start + 3));
      start = index + SCOPE_POINT_STRIDE;
    }
    assert.equal(start, samples.length);
  }
  assert.notDeepEqual(start.samples, emberFrame(params, TAU / 5).samples, 'later phrases evolve in shape');
  assert.deepEqual(start, emberFrame(params, 0), 'seeking gives the same frame');
});

test('Ember phrase separates the hollow and hot accents, and rings leave the moving body intact', () => {
  const params = emberLayer().params, phase = (bar: number) => TAU * bar / params.emberPhrases;
  const open = emberPhrase(phase(.255), params.emberPhrases);
  const crest = emberPhrase(phase(.78), params.emberPhrases);
  assert.ok(open.opening > crest.opening && crest.heat > open.heat);

  const bodyOnly = emberFrame({ ...params, emberRings: 0, emberOuter: 0 }, phase(.8));
  const rings = emberFrame({ ...params, emberOuter: 0 }, phase(.8));
  assert.ok(rings.points > bodyOnly.points);
  assert.deepEqual(rings.samples.slice(0, bodyOnly.samples.length), bodyOnly.samples);
  const outer = emberFrame({ ...params, emberRings: 0 }, phase(.8));
  assert.ok(outer.points > bodyOnly.points);
  const portrait = emberFrame(params, phase(.8));
  const landscape = emberFrame(params, phase(.8), 16 / 9);
  assert.ok(Math.abs(portrait.radius / (9 / 16) - landscape.radius) < 1e-10);
});

test('Older Ember layers pick up smoke defaults, and Classic hides the smoke controls', () => {
  const old = emberLayer();
  delete old.params.emberSmoke;
  delete old.params.emberSmokeSpread;
  const updated = validateProject({ ...createProject(), layers: [old] }).layers[0];
  assert.ok(updated.params.emberSmoke > 0 && updated.params.emberSmokeSpread > 0);
  assert.ok(visibleParameterDefinitions(updated).some(d => d.key === 'emberSmoke'));
  assert.ok(!visibleParameterDefinitions(createLayer('scope')).some(d => d.key === 'emberSmoke'));
  updated.params.emberSmoke = 0;
  assert.equal(validateProject({ ...createProject(), layers: [updated] }).layers[0].params.emberSmoke, 0);
});

test('Ember smoke keeps the same launch direction as puffs age and fades across the loop seam', () => {
  const at = (phase: number) => emberSmokeFrame(phase, 5, 1729);
  assert.deepEqual(at(0), at(TAU));
  const last = at(TAU - 1e-6), first = at(0);
  assert.ok(first.puffs.some(puff => puff.gain > .1), 'smoke survives the seam');
  for (let i = 0; i < first.puffs.length; i++) {
    const a = last.puffs[i], b = first.puffs[i];
    assert.ok(Math.abs(a.gain - b.gain) < 1e-4);
    if (b.gain > .1) {
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-5);
      assert.ok(b.age > a.age, 'puffs continue travelling across the seam');
    }
  }
  assert.notDeepEqual(at(0).puffs, at(TAU / 5).puffs, 'launch directions vary by phrase');
});
