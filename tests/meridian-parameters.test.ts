import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENT_KINDS } from '../src/core/instruments';
import { createLayer, createProject, parameterDefinitions, validateProject } from '../src/core/project';
import { canLinkParameter, targetRange } from '../src/map/targets';
import { compose, scoreQuality } from '../src/meridian/composer';
import { applyMacros } from '../src/meridian/macros';
import { MACRO_KEYS, MERIDIAN_DEFAULTS, MERIDIAN_GROUPS, MERIDIAN_MOVES, MERIDIAN_PARAMETERS } from '../src/meridian/parameters';
import type { Layer, Project } from '../src/shared/types';

const byKey = new Map(MERIDIAN_PARAMETERS.map((d) => [d.key, d]));
const withLayer = (layer: Layer): Project => ({ ...createProject(), layers: [layer] });
const repaired = (mutate: (layer: Layer) => void): Layer => {
  const layer = createLayer('meridian');
  mutate(layer);
  return validateProject(withLayer(layer)).layers[0];
};
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('every group has parameters and all have descriptions', () => {
  for (const group of MERIDIAN_GROUPS) assert.ok(MERIDIAN_PARAMETERS.some((d) => d.group === group), `${group} is empty`);
  for (const d of MERIDIAN_PARAMETERS) {
    assert.ok(d.description && d.description.length >= 20, `${d.key} needs a plain-language description`);
    assert.ok(d.group === 'Performance' || MERIDIAN_GROUPS.includes(d.group as string), `${d.key} has an unknown group`);
  }
});

test('there are more than 100 parameters', () => assert.ok(MERIDIAN_PARAMETERS.length > 100));

test('keys are unique and defaults are in range', () => {
  const all = parameterDefinitions('meridian');
  assert.equal(new Set(all.map((d) => d.key)).size, all.length);
  for (const d of all) {
    assert.ok(d.min < d.max, d.key);
    assert.ok(d.default >= d.min && d.default <= d.max, `${d.key} default`);
    if (d.step === 1) assert.ok(Number.isInteger(d.default), `${d.key} integer default`);
  }
});

test('the keys the composer and evaluator read exist with behaviour-preserving defaults', () => {
  const expected: Record<string, number> = {
    symmetry: 0, zones: 4, ringCount: 7, spokeCount: 12, nodeDensity: 0.5, latticeType: 0.35, scoreBars: 8,
    ringWeight: 1, spokeWeight: 1, nodeSize: 1, heroWeight: 1, heroGlow: 1, glitchAmount: 1,
    scoreDraw: 1, scoreBuild: 1, scoreCharge: 1, scorePeak: 1, scoreCollapse: 1, scoreRest: 1,
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(byKey.get(key)?.default, value, key);
  assert.equal(byKey.get('symmetry')?.max, 24);
  assert.equal(byKey.get('scoreBars')?.min, 1);
  assert.equal(byKey.get('scoreBars')?.max, 32);
  assert.equal(byKey.get('scoreRepeat')?.max, 16);
  assert.equal(byKey.get('scoreRepeat')?.step, 1);
});

test('structural parameters are marked, and drawing parameters are not', () => {
  for (const key of ['symmetry', 'zones', 'ringCount', 'spokeCount', 'nodeDensity', 'latticeType', 'scoreBars', 'scoreRepeat', 'scoreDraw', 'scoreBuild', 'scoreCharge', 'scorePeak', 'scoreCollapse', 'scoreRest']) {
    assert.equal(byKey.get(key)?.structural, true, key);
  }
  for (const key of ['ringWeight', 'glitchAmount', 'lightBloomAmount', 'macroDensity']) assert.ok(!byKey.get(key)?.structural, key);
});

test('moves are momentary, default to 0 and span 0 to 1; recall picks a slot', () => {
  for (const key of MERIDIAN_MOVES) {
    const d = byKey.get(key)!;
    assert.deepEqual([d.momentary, d.default, d.min, d.max], [true, 0, 0, 1], key);
  }
  const recall = byKey.get('moveRecall')!;
  assert.deepEqual([recall.momentary, recall.default, recall.min, recall.max, recall.step], [true, 0, 0, 8, 1]);
  for (let slot = 0; slot < 8; slot++) {
    const d = byKey.get(`seedSlot${slot}`)!;
    assert.deepEqual([d.min, d.max, d.step], [0, 999999, 1]);
  }
});

test('the composer reads the defaults without failing a limit', () => {
  for (let seed = 0; seed < 30; seed++) assert.deepEqual(scoreQuality(compose(seed, MERIDIAN_DEFAULTS)).hardFailures, []);
});

test('a new layer validates', () => {
  const layer = createLayer('meridian');
  assert.equal(layer.kind, 'meridian');
  assert.equal(validateProject(withLayer(layer)).layers[0].kind, 'meridian');
  assert.equal(layer.palette.length, 6);
});

test('a project with missing or absurd Meridian values is repaired', () => {
  const missing = createLayer('meridian');
  delete missing.params.ringCount; delete missing.params.glitchAmount; delete missing.params.macroHeat;
  const fixed = validateProject(withLayer(missing)).layers[0];
  assert.equal(fixed.params.ringCount, 7);
  assert.equal(fixed.params.glitchAmount, 1);
  assert.equal(fixed.params.macroHeat, 0.5);

  const absurd = repaired((l) => {
    l.params.ringCount = 1e9; l.params.symmetry = -5; l.params.glitchAmount = NaN;
    l.params.zones = 3.6; l.params.lightExposure = Infinity; l.params.scoreBars = 1e300;
  });
  assert.equal(absurd.params.ringCount, 32);
  assert.equal(absurd.params.symmetry, 0);
  assert.equal(absurd.params.glitchAmount, 1);
  assert.equal(absurd.params.zones, 4);
  assert.equal(absurd.params.lightExposure, 1);
  assert.equal(absurd.params.scoreBars, 32);
  for (const d of MERIDIAN_PARAMETERS) {
    assert.ok(absurd.params[d.key] >= d.min && absurd.params[d.key] <= d.max, d.key);
    if (d.step === 1) assert.ok(Number.isInteger(absurd.params[d.key]), d.key);
  }
});

test('unknown parameters are still refused', () => {
  const layer = createLayer('meridian');
  layer.params.notAParameter = 1;
  assert.throws(() => validateProject(withLayer(layer)), /notAParameter/);
});

test('malformed layer.meridian state is removed, valid state kept', () => {
  const plain = repaired(() => undefined);
  assert.ok(!('meridian' in plain));

  const good = { locks: ['Rings', 'Glitch'], morphA: { ringCount: 5, glitchAmount: 2 }, morphB: { lightExposure: 1.5 }, mark: { dataUrl: PIXEL, width: 1, height: 1 } };
  assert.deepEqual(repaired((l) => { l.meridian = structuredClone(good); }).meridian, good);

  for (const bad of [null, 7, 'x', [], { locks: 'Rings' }, { locks: [1] }, { locks: ['Nonsense'] }, { locks: [], morphA: { ringCount: 'a' } }, { locks: [], morphA: { notAParameter: 1 } }, { locks: [], morphB: { ringCount: NaN } }, { locks: [], mark: { dataUrl: 'javascript:1', width: 1, height: 1 } }, { locks: [], mark: { dataUrl: PIXEL, width: 9, height: 9 } }]) {
    const out = repaired((l) => { l.meridian = bad as never; });
    assert.ok(!('meridian' in out) || (Array.isArray(out.meridian?.locks) && !out.meridian?.morphA?.notAParameter && !out.meridian?.mark?.dataUrl.startsWith('javascript')), JSON.stringify(bad));
  }
  assert.ok(!('meridian' in repaired((l) => { l.meridian = null as never; })));
  assert.ok(!('meridian' in repaired((l) => { l.meridian = { locks: 'Rings' } as never; })));
  assert.equal(repaired((l) => { l.meridian = { locks: ['Rings', 'Nonsense'], mark: { dataUrl: 'javascript:1', width: 1, height: 1 } } as never; }).meridian?.mark, undefined);
  assert.deepEqual(repaired((l) => { l.meridian = { locks: ['Rings', 'Nonsense'] } as never; }).meridian?.locks, ['Rings']);
});

test('Meridian state is removed from other kinds', () => {
  const image = createLayer('image');
  image.meridian = { locks: [] };
  assert.ok(!('meridian' in validateProject(withLayer(image)).layers[0]));
});

test('older projects are unchanged', () => {
  for (const kind of ['surface', 'sculpture', 'fractal', 'oil', 'liquid', 'scope', 'super8', 'graphic', 'image', ...INSTRUMENT_KINDS] as const) {
    const project = withLayer(createLayer(kind));
    assert.deepEqual(validateProject(project), project, kind);
  }
  const project = withLayer(createLayer('meridian'));
  assert.deepEqual(validateProject(project), project);
});

test('macros at neutral leave parameters unchanged', () => {
  const params: Record<string, number> = { ...MERIDIAN_DEFAULTS, ringArcShare: 0.2, glitchAmount: 2.5 };
  const out: Record<string, number> = {};
  applyMacros(params, out);
  assert.ok(Object.keys(out).length > 20);
  for (const [key, value] of Object.entries(out)) assert.equal(value, params[key], key);
});

test('each macro moves its own parameters, and an unknown macro value is neutral', () => {
  for (const macro of MACRO_KEYS) {
    const lifted: Record<string, number> = {};
    applyMacros({ ...MERIDIAN_DEFAULTS, [macro]: 1 }, lifted);
    const moved = Object.keys(lifted).filter((key) => lifted[key] !== MERIDIAN_DEFAULTS[key]);
    assert.ok(moved.length >= 3, `${macro} should move several parameters`);
    const lowered: Record<string, number> = {};
    applyMacros({ ...MERIDIAN_DEFAULTS, [macro]: 0 }, lowered);
    assert.ok(moved.some((key) => lowered[key] !== lifted[key]), macro);
    for (const bad of [NaN, Infinity, undefined as never]) {
      const out: Record<string, number> = {};
      applyMacros({ ...MERIDIAN_DEFAULTS, [macro]: bad }, out);
      for (const [key, value] of Object.entries(out)) assert.equal(value, MERIDIAN_DEFAULTS[key], `${macro} ${key}`);
    }
  }
});

test('macros stay inside each range at both extremes', () => {
  for (const edge of [0, 1, -3, 4]) for (const base of ['default', 'min', 'max'] as const) {
    const params: Record<string, number> = {};
    for (const d of MERIDIAN_PARAMETERS) params[d.key] = base === 'default' ? d.default : d[base];
    for (const macro of MACRO_KEYS) params[macro] = edge;
    const out: Record<string, number> = {};
    applyMacros(params, out);
    for (const [key, value] of Object.entries(out)) {
      assert.ok(Number.isFinite(value), key);
      assert.ok(value >= byKey.get(key)!.min && value <= byKey.get(key)!.max, `${key}=${value}`);
    }
  }
});

test('every continuous parameter and move can be linked; the seeds cannot', () => {
  const layer = createLayer('meridian');
  const show = { shapes: [], sources: [{ id: 'a', project: withLayer(layer) }] } as never;
  for (const d of MERIDIAN_PARAMETERS) {
    const seed = d.key === 'seed' || d.key.startsWith('seedSlot');
    assert.equal(canLinkParameter(layer, d.key), !seed, d.key);
    if (d.step !== 1 || MERIDIAN_MOVES.includes(d.key as never)) assert.ok(targetRange(show, `source.a.param.0.${d.key}`), d.key);
    if (seed) assert.equal(targetRange(show, `source.a.param.0.${d.key}`), null, d.key);
  }
  for (const key of MERIDIAN_MOVES) assert.ok(canLinkParameter(layer, key), key);
  const project = withLayer(layer);
  const free = MERIDIAN_PARAMETERS.filter((d) => d.step !== 1).map((d) => d.key);
  project.layers[0].modulations = Object.fromEntries(free.map((key) => [key, { kind: 'sine', cycles: 1, phase: 0, amount: 0.5, points: [] }])) as never;
  assert.equal(Object.keys(validateProject(project).layers[0].modulations).length, free.length);
});
