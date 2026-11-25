import test from 'node:test';
import assert from 'node:assert/strict';
import { EMBER_PALETTES, PRESETS, applyPreset, createLayer, createProject, validateProject } from '../src/core/project';
import { EMBER_SMOKE_ORIGINS, EMBER_SMOKE_STYLES, emberBursts, emberFluidSettings, emberFluidSteps, emberLoopBlend } from '../src/rendering/ember-fluid-model';

const defaults = applyPreset(createLayer('scope'), 'ember-pulse').params;

test('each style produces distinct simulation settings', () => {
  const at = (emberSmokeStyle: number) => emberFluidSettings({ ...defaults, emberSmokeStyle });
  const all = EMBER_SMOKE_STYLES.map((_, i) => JSON.stringify(at(i)));
  assert.equal(new Set(all).size, 5);
  assert.equal(EMBER_SMOKE_ORIGINS.length, 4);
});

test('every smoke control moves its setting by at least a factor of two', () => {
  for (const [key, field] of [['emberSmoke', 'emit'], ['emberSmokeSpread', 'force'], ['emberSmokeCurl', 'curl'], ['emberSmokeLife', 'dyeLife'], ['emberSmokeBody', 'density'], ['emberSmokeDetail', 'turbulence'], ['emberSmokeLight', 'lighting']] as const) {
    const low = emberFluidSettings({ ...defaults, [key]: .05 })[field], high = emberFluidSettings({ ...defaults, [key]: 1 })[field];
    assert.ok(high >= low * 2, `${key}: ${low} to ${high}`);
  }
});

test('lift changes the sign of buoyancy', () => {
  assert.ok(emberFluidSettings({ ...defaults, emberSmokeLift: -1 }).buoyancy < 0);
  assert.ok(emberFluidSettings({ ...defaults, emberSmokeLift: 1 }).buoyancy > 0);
});

test('sound adds force and turbulence, and response zero ignores it', () => {
  const quiet = emberFluidSettings(defaults), loud = emberFluidSettings(defaults, { bass: 1, highs: 1 });
  assert.ok(loud.force > quiet.force && loud.turbulence > quiet.turbulence);
  assert.deepEqual(emberFluidSettings({ ...defaults, emberSmokeResponse: 0 }, { bass: 1, highs: 1 }), emberFluidSettings({ ...defaults, emberSmokeResponse: 0 }));
});

test('bursts are deterministic and split cleanly across windows', () => {
  const whole = emberBursts(0, 10, 10, 5, 1729);
  assert.deepEqual([...emberBursts(0, 4, 10, 5, 1729), ...emberBursts(4, 10, 10, 5, 1729)], whole);
  assert.ok(whole.length >= 20);
  assert.notDeepEqual(whole.map(b => b.angle), emberBursts(0, 10, 10, 5, 90210).map(b => b.angle));
});

test('bursts continue past the loop end with the same timing', () => {
  const first = emberBursts(0, 10, 10, 5, 1729), second = emberBursts(10, 20, 10, 5, 1729);
  assert.equal(second.length, first.length);
  second.forEach((burst, i) => assert.ok(Math.abs(burst.time - first[i].time - 10) < 1e-9));
});

test('live stepping is whole sixtieths and capped after a stall', () => {
  assert.equal(emberFluidSteps(1 / 60), 1);
  assert.equal(emberFluidSteps(0), 0);
  assert.equal(emberFluidSteps(5), 2);
});

test('loop blend is bounded on short and long loops', () => {
  assert.equal(emberLoopBlend(0, 10).weight, 0);
  assert.equal(emberLoopBlend(1.5, 10).weight, 1);
  assert.ok(emberLoopBlend(0, .1).blendSeconds <= .025);
  assert.equal(emberLoopBlend(0, 600).blendSeconds, 1.5);
});

test('older Ember layers gain style and origin, and validate', () => {
  const old = applyPreset(createLayer('scope'), 'ember-pulse');
  delete old.params.emberSmokeStyle; delete old.params.emberSmokeOrigin;
  const project = validateProject({ ...createProject(), layers: [old] });
  assert.equal(project.layers[0].params.emberSmokeStyle, 1);
  assert.equal(project.layers[0].params.emberSmokeOrigin, 0);
});

test('there are fifteen distinct Ember schemes with their own presets', () => {
  assert.equal(EMBER_PALETTES.length, 15);
  assert.equal(new Set(EMBER_PALETTES.map(p => p.palette.join())).size, 15);
  for (const look of EMBER_PALETTES) {
    assert.equal(look.palette.length, 6);
    assert.ok(PRESETS.some(p => p.id === look.id), look.id);
  }
});
