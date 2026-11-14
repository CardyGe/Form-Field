import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_FIGURES, SCOPE_PLAIN, scopeCurve, scopeDash, scopeFigurePoint, scopeLine, scopeMorphWeight, scopePerspective, scopeRotation } from '../src/rendering/scope-curve';
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

test('a morphing, wiggling line stays closed, within the sphere and loops exactly', () => {
  const shape = { figure: 0, figureB: 3, morph: 1, hold: .4, wiggle: .7, wiggleFrequency: 47.4, wiggleBursts: .6 };
  const count = 4096;
  for (const phase of [0, 1.3, Math.PI, 4.9]) {
    const points = scopeLine(shape, motion, phase, count);
    for (let k = 0; k < 3; k++) assert.equal(points[k], points[count * 3 + k]);
    for (let i = 0; i <= count; i += 37) { const r = Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]); assert.ok(r < 1 + 1e-5 && r > .2, `radius ${r}`); }
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
