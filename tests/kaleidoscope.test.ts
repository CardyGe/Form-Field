import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, validateProject, visibleParameterDefinitions, PRESETS } from '../src/core/project';
import { kaleidoscopeSettings } from '../src/rendering/kaleidoscope';

const TAU = Math.PI * 2;
// A 1×1 PNG, the smallest valid embedded image.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a new Kaleidoscope layer validates and round-trips through JSON', () => {
  const project = { ...createProject(), layers: [createLayer('kaleidoscope')] };
  const opened = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(opened.layers[0].kind, 'kaleidoscope');
  assert.equal(opened.layers[0].params.input, 0);
  assert.equal(opened.layers[0].params.group, 0);
});

test('a Kaleidoscope may carry an image to fold, and other instruments still may not', () => {
  const layer = createLayer('kaleidoscope');
  layer.image = { name: 'dot.png', dataUrl: PNG, width: 1, height: 1, fit: 'contain' };
  layer.params.input = 1;
  assert.doesNotThrow(() => validateProject(JSON.parse(JSON.stringify({ ...createProject(), layers: [layer] }))));
  const surface = { ...createLayer('surface'), image: layer.image };
  assert.throws(() => validateProject(JSON.parse(JSON.stringify({ ...createProject(), layers: [surface] }))), /image/);
});

test('out-of-range symmetry and input values are refused', () => {
  for (const [key, value] of [['group', 5], ['input', 3], ['segments', 1], ['segments', 25]] as const) {
    const layer = createLayer('kaleidoscope'); layer.params[key] = value;
    assert.throws(() => validateProject(JSON.parse(JSON.stringify({ ...createProject(), layers: [layer] }))), new RegExp(key));
  }
});

test('the inspector shows only the controls the chosen symmetry and input use', () => {
  const keys = (params: Record<string, number>) => { const layer = createLayer('kaleidoscope'); Object.assign(layer.params, params); return new Set(visibleParameterDefinitions(layer).map(d => d.key)); };
  const rosette = keys({ group: 0, input: 0 });
  assert.ok(rosette.has('segments') && !rosette.has('cell') && !rosette.has('cellAspect') && rosette.has('density'));
  const rectangles = keys({ group: 1, input: 2 });
  assert.ok(!rectangles.has('segments') && rectangles.has('cell') && rectangles.has('cellAspect') && !rectangles.has('density'));
  const hexagons = keys({ group: 4, input: 1 });
  assert.ok(hexagons.has('cell') && !hexagons.has('cellAspect'));
});

test('every Kaleidoscope motion closes the loop exactly', () => {
  const layer = createLayer('kaleidoscope');
  Object.assign(layer.params, { spin: 2, insideTurns: -1, drift: .8, cycles: 3 });
  const a = kaleidoscopeSettings(layer, 0, 1.6), b = kaleidoscopeSettings(layer, TAU, 1.6);
  const angle = (x: number) => ((x % TAU) + TAU) % TAU;
  assert.ok(Math.abs(angle(a.angle) - angle(b.angle)) < 1e-9);
  // The line pattern moves whole line periods per cycle.
  assert.ok(Math.abs((b.motifPhase - a.motifPhase) - Math.round(b.motifPhase - a.motifPhase)) < 1e-9);
  a.inside.elements.forEach((v, i) => assert.ok(Math.abs(v - b.inside.elements[i]) < 1e-9, `inside[${i}]`));
});

test('the inside transform keeps the input picture undistorted', () => {
  const layer = createLayer('kaleidoscope');
  Object.assign(layer.params, { insideAngle: .7, insideScale: 1.3, drift: 0 });
  const m = kaleidoscopeSettings(layer, 0, 2).inside.elements; // column-major
  // Undo the input aspect on x: the linear part is then a scaled rotation.
  const a = m[0] * 2, b = m[3] * 2, c = m[1], d = m[4];
  assert.ok(Math.abs(a * a + c * c - b * b - d * d) < 1e-12 && Math.abs(a * b + c * d) < 1e-12);
});

test('the Kaleidoscope adds no presets, so the curated library is unchanged', () => {
  assert.equal(PRESETS.filter(p => p.kind === 'kaleidoscope').length, 0);
});
