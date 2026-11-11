import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAT_LOOK_IDS, PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer } from '../src/core/project';
import { TOON_KEYS } from '../src/core/finishing';
const unlocked = { palette: false, structure: false, motion: false, material: false };

test('flat colour is neutral by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.toonMix, 0);
    for (const key of TOON_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.layers[0].params.toonMix, 0, 'Absent controls take neutral defaults.');
  assert.equal(migrated.layers[0].params.toonCycles, 0);
  assert.equal('highlights' in migrated, false, 'Older projects keep the original soft highlight handling.');
});

test('highlight handling accepts only soft or exact', () => {
  const project = createProject();
  assert.equal(validateProject({ ...project, highlights: 'exact' }).highlights, 'exact');
  assert.equal(validateProject({ ...project, highlights: 'soft' }).highlights, 'soft');
  assert.throws(() => validateProject({ ...project, highlights: 'filmic' }));
});

test('flat looks exist, use flat colour and save as ordinary layers', () => {
  assert.equal(FLAT_LOOK_IDS.length, 5);
  for (const id of FLAT_LOOK_IDS) {
    const preset = PRESETS.find(p => p.id === id);
    assert.ok(preset, id);
    assert.ok(preset.params.toonMix > 0, `${id} uses flat colour`);
    assert.equal(preset.params.toonCycles, 0, `${id} does not strobe by default`);
    const project = { ...createProject(), highlights: 'exact' as const, layers: [applyPreset(createLayer(preset.kind), id)] };
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  }
});

test('variations never switch flat colour on, change palette cycling or vary hidden flat controls', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let i = 0; i < 6; i++) {
      const varied = varyLayer(layer, 1, unlocked, 1000 + i);
      assert.equal(varied.params.toonMix, layer.params.toonMix, `${preset.id} toonMix`);
      assert.equal(varied.params.toonCycles, layer.params.toonCycles, `${preset.id} toonCycles`);
      if (!(layer.params.toonMix > 0)) for (const key of TOON_KEYS) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
