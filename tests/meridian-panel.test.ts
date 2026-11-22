import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer } from '../src/core/project';
import { compose } from '../src/meridian/composer';
import { MACRO_KEYS, MERIDIAN_DEFAULTS, MERIDIAN_GROUPS, MERIDIAN_PARAMETERS } from '../src/meridian/parameters';
import { applyLockedVariation, applyMorph, captureMorph, filterParameters, MERIDIAN_CHOICES, morph, PANEL_PARAMETERS, performanceShortcut, recallSeed, releaseMoves, storeSeed, toggleGroupLock } from '../src/meridian/panel';
import type { Layer, ParameterDefinition } from '../src/shared/types';

const meridian = (locks: string[] = []): Layer => ({ ...createLayer('meridian'), meridian: { locks } });
const inGroup = (group: string) => MERIDIAN_PARAMETERS.filter((d) => d.group === group).map((d) => d.key);
const pick = (layer: Layer, keys: readonly string[]) => keys.map((key) => layer.params[key]);
const NEVER_VARIED = ['glitchSeed', ...inGroup('Safety'), ...MACRO_KEYS, ...MERIDIAN_PARAMETERS.filter((d) => d.momentary).map((d) => d.key), ...Array.from({ length: 8 }, (_, i) => `seedSlot${i}`)];
const key = (k: string, target: object = { tagName: 'BODY' }, extra: object = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, target, ...extra });

test('search matches label, group and description, across words and ignoring case', () => {
  assert.ok(filterParameters(PANEL_PARAMETERS, 'TWIN share').get('Spokes')?.some((d) => d.key === 'spokeTwinShare'));
  assert.equal(filterParameters(PANEL_PARAMETERS, 'hero').get('Hero')?.length, inGroup('Hero').length);
  assert.ok(filterParameters(PANEL_PARAMETERS, 'failing screen').get('Glitch')?.some((d) => d.key === 'glitchScanBands'));
  assert.equal(filterParameters(PANEL_PARAMETERS, 'zzzz').size, 0);
});

test('an empty search keeps every group in panel order, without macros, moves or the seed bank', () => {
  const all = filterParameters(PANEL_PARAMETERS, '  ');
  assert.deepEqual([...all.keys()], [...MERIDIAN_GROUPS]);
  const shown = [...all.values()].flat().map((d) => d.key);
  for (const hidden of [...MACRO_KEYS, 'moveNext', 'seedSlot0']) assert.ok(!shown.includes(hidden), hidden);
});

test('every named choice has one label per value', () => {
  for (const [name, labels] of Object.entries(MERIDIAN_CHOICES)) {
    const d = MERIDIAN_PARAMETERS.find((p) => p.key === name)!;
    assert.equal(labels.length, d.max - d.min + 1, name);
  }
});

for (const mode of ['mutate', 'reseed'] as const) {
  test(`locked groups survive ${mode}`, () => {
    for (const group of MERIDIAN_GROUPS) {
      const layer = meridian([group]), next = applyLockedVariation(layer, 99, mode), keys = inGroup(group);
      assert.deepEqual(pick(next, keys), pick(layer, keys), group);
    }
  });
  test(`${mode} never changes safety, macros, moves, the seed bank or the glitch seed, nor its input`, () => {
    const layer = meridian(), before = structuredClone(layer);
    for (const k of MACRO_KEYS) layer.params[k] = before.params[k] = 0.8;
    layer.params.seedSlot3 = before.params.seedSlot3 = 42;
    const next = applyLockedVariation(layer, 7, mode);
    assert.deepEqual(pick(next, NEVER_VARIED), pick(before, NEVER_VARIED));
    assert.deepEqual(layer, before);
  });
}

test('Reseed writes the active seed unless Score is locked', () => {
  assert.equal(applyLockedVariation(meridian(), 1234, 'reseed').params.seed, 1234);
  const locked = meridian(['Score']);
  assert.equal(applyLockedVariation(locked, 1234, 'reseed').params.seed, locked.params.seed);
});

test('Mutate keeps the seed and the structure, moves the design, is repeatable and stays in range', () => {
  const layer = meridian(), a = applyLockedVariation(layer, 5, 'mutate'), b = applyLockedVariation(layer, 5, 'mutate');
  assert.deepEqual(a.params, b.params);
  assert.equal(a.params.seed, layer.params.seed);
  assert.ok(MERIDIAN_PARAMETERS.some((d) => a.params[d.key] !== layer.params[d.key]));
  for (const d of MERIDIAN_PARAMETERS) {
    if (d.structural) assert.equal(a.params[d.key], layer.params[d.key], d.key);
    assert.ok(a.params[d.key] >= d.min && a.params[d.key] <= d.max, d.key);
  }
});

test('Variation sets how far Mutate wanders, and animated values are left alone', () => {
  const distance = (variation: number) => {
    const layer = meridian(); layer.params.scoreVariation = variation;
    const next = applyLockedVariation(layer, 11, 'mutate');
    return MERIDIAN_PARAMETERS.reduce((sum, d) => sum + Math.abs(next.params[d.key] - layer.params[d.key]) / (d.max - d.min), 0);
  };
  assert.equal(distance(0), 0);
  assert.ok(distance(1) > distance(0.2));
  const layer = meridian(); layer.params.scoreVariation = 1;
  layer.modulations.ringOpacity = { kind: 'sine', cycles: 1, phase: 0, amount: 0.2, points: [] };
  layer.params.ringOpacity = 0.5;
  assert.equal(applyLockedVariation(layer, 11, 'mutate').params.ringOpacity, 0.5);
});

test('a stored seed comes back, up to the largest a slot holds', () => {
  const layer = meridian(); layer.params.seed = 999999;
  const stored = storeSeed(layer, 7);
  assert.equal(stored.params.seedSlot7, 999999);
  assert.equal(recallSeed({ ...stored, params: { ...stored.params, seed: 5 } }, 7).params.seed, 999999);
  const tooLarge = { ...layer, params: { ...layer.params, seed: 1000000 } };
  assert.equal(storeSeed(tooLarge, 0), tooLarge);
});

test('an empty slot or an impossible slot does not change the layer', () => {
  const layer = meridian();
  assert.equal(recallSeed(layer, 2), layer);
  assert.equal(recallSeed(layer, 8), layer);
  assert.equal(storeSeed(layer, -1), layer);
  assert.equal(storeSeed({ ...layer, params: { ...layer.params, seed: 0 } }, 1).params.seedSlot1, 0);
});

const DEFS: ParameterDefinition[] = [
  { key: 'c', label: 'c', min: 0, max: 10, step: 0.01, default: 0, section: 'Shape' },
  { key: 's', label: 's', min: 0, max: 3, step: 1, default: 0, section: 'Shape' },
  { key: 't', label: 't', min: 0, max: 1, step: 0.01, default: 0, section: 'Shape', structural: true },
];

test('morph ends equal A and B, and stays in range', () => {
  const a = { c: 2, s: 1, t: 0.2 }, b = { c: 8, s: 3, t: 0.9 };
  assert.deepEqual(morph(a, b, 0, DEFS), a);
  assert.deepEqual(morph(a, b, 1, DEFS), b);
  assert.equal(morph(a, b, 0.5, DEFS).c, 5);
  assert.equal(morph({ c: 50 }, { c: 90 }, 0.5, DEFS).c, 10);
  assert.equal(morph(a, b, -3, DEFS).c, 2);
  assert.equal(morph(a, b, 7, DEFS).c, 8);
});

test('stepped and structural values switch at the midpoint, so a morph drag never recomposes continuously', () => {
  const a = { c: 2, s: 1, t: 0.2 }, b = { c: 8, s: 3, t: 0.9 };
  for (const amount of [0.1, 0.49]) { const m = morph(a, b, amount, DEFS); assert.equal(m.s, 1); assert.equal(m.t, 0.2); }
  for (const amount of [0.5, 0.9]) { const m = morph(a, b, amount, DEFS); assert.equal(m.s, 3); assert.equal(m.t, 0.9); }
});

test('A and B live on the layer, leave show settings out, and locked groups do not morph', () => {
  let layer = meridian(); layer.params.ringOpacity = 0.2; layer.params.heroGlow = 1;
  layer = captureMorph(layer, 'morphA');
  layer = { ...layer, params: { ...layer.params, ringOpacity: 0.8, heroGlow: 3 } };
  layer = captureMorph(layer, 'morphB');
  assert.equal(layer.meridian?.morphA?.ringOpacity, 0.2);
  for (const k of ['safetyFlashGuard', 'outputBlackLevel', 'moveHold', 'seedSlot0']) assert.ok(!(k in layer.meridian!.morphA!), k);
  layer = toggleGroupLock(layer, 'Hero');
  const mid = applyMorph(layer, 0.5);
  assert.ok(Math.abs(mid.params.ringOpacity - 0.5) < 1e-9);
  assert.equal(mid.params.heroGlow, 3);
  assert.equal(applyMorph(meridian(), 0.5).params.ringOpacity, MERIDIAN_DEFAULTS.ringOpacity);
  assert.deepEqual(toggleGroupLock(layer, 'Hero').meridian?.locks, []);
});

test('a restored layer never comes back with a move held', () => {
  const layer = meridian(); layer.params.moveHold = 1; layer.params.moveRecall = 3; layer.params.ringOpacity = 0.4;
  const released = releaseMoves(layer);
  assert.equal(released.params.moveHold, 0);
  assert.equal(released.params.moveRecall, 0);
  assert.equal(released.params.ringOpacity, 0.4);
});

test('keys map to moves and Recall, and leave typing and app shortcuts alone', () => {
  for (const [k, action] of [['n', 'moveNext'], ['H', 'moveHold'], ['d', 'moveDrop'], ['c', 'moveCollapse'], ['m', 'moveMutate'], ['r', 'moveReseed'], ['1', 'recall:0'], ['8', 'recall:7']]) assert.equal(performanceShortcut(key(k)), action);
  assert.equal(performanceShortcut(key('9')), null);
  assert.equal(performanceShortcut(key('f')), null);
  assert.equal(performanceShortcut(key('n', { tagName: 'INPUT', type: 'search' })), null);
  assert.equal(performanceShortcut(key('n', { tagName: 'INPUT', type: 'number' })), null);
  assert.equal(performanceShortcut(key('n', { tagName: 'SELECT' })), null);
  assert.equal(performanceShortcut(key('n', { tagName: 'DIV', isContentEditable: true })), null);
  assert.equal(performanceShortcut(key('r', { tagName: 'BODY' }, { metaKey: true })), null);
  assert.equal(performanceShortcut(key('n', { tagName: 'INPUT', type: 'range' })), 'moveNext');
});

test('Radial ratio above 1 overrides the seeded ratio; 0 to 1 keeps the seeded choice', () => {
  const zoneRings = (params: Record<string, number>) => JSON.stringify(compose(4, { ...MERIDIAN_DEFAULTS, ...params }).elements);
  const seeded = zoneRings({});
  assert.equal(zoneRings({ structureRadialRatio: 0.5 }), seeded);
  assert.equal(zoneRings({ structureRadialRatio: 1 }), seeded);
  assert.notEqual(zoneRings({ structureRadialRatio: 1.9 }), seeded);
  assert.notEqual(zoneRings({ structureRadialRatio: 1.9 }), zoneRings({ structureRadialRatio: 1.1 }));
  for (const element of compose(4, { ...MERIDIAN_DEFAULTS, zones: 8, structureRadialRatio: 2.2 }).elements) assert.ok(Number.isFinite(element.radius));
});
