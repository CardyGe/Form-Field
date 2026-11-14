import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_FIGURES, scopeCurve, scopeFigurePoint, scopePerspective, scopeRotation } from '../src/rendering/scope-curve';
import { PRESETS, applyPreset, createLayer, createProject, parameterDefinitions, validateProject } from '../src/core/project';

const TAU = Math.PI * 2;
const motion = { tilt: .4, tumbleX: 1, tumbleY: 2 };

test('every scope figure is a closed line on the unit sphere', () => {
  for (const figure of SCOPE_FIGURES) {
    const start = scopeFigurePoint(figure, 0), end = scopeFigurePoint(figure, 1);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(start[k] - end[k]) < 1e-9, `${figure.name} does not close`);
    for (let i = 0; i < 200; i++) {
      const p = scopeFigurePoint(figure, i / 200);
      assert.ok(Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) < 1e-9, `${figure.name} leaves the sphere`);
    }
    assert.ok(Number.isInteger(figure.turns) && Number.isInteger(figure.waves) && figure.swing < Math.PI / 2);
  }
  assert.equal(new Set(SCOPE_FIGURES.map(f => `${f.turns}:${f.waves}`)).size, SCOPE_FIGURES.length);
});

test('the scope curve has no jumps and its ends meet exactly', () => {
  for (let figure = 0; figure < SCOPE_FIGURES.length; figure++) {
    const count = 4096, points = scopeCurve(figure, motion, 1.1, count);
    assert.equal(points.length, (count + 1) * 3);
    for (let k = 0; k < 3; k++) assert.equal(points[k], points[count * 3 + k]);
    let longest = 0;
    for (let i = 0; i < count; i++) longest = Math.max(longest, Math.hypot(points[i * 3 + 3] - points[i * 3], points[i * 3 + 4] - points[i * 3 + 1], points[i * 3 + 5] - points[i * 3 + 2]));
    assert.ok(longest < .08, `${SCOPE_FIGURES[figure].name}: a step of ${longest}`);
  }
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
