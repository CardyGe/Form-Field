import test from 'node:test';
import assert from 'node:assert/strict';
import { LIQUID_KEYS, LUMA_WARP_KEYS, MIRROR_KEYS, POLAR_KEYS, WARP_KEYS } from '../src/core/finishing';
import { PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { layerTileBlocker } from '../src/core/tile-edges';
import { foldAngle, loopOffset, lumaDriver, warpActive, warpPoints } from '../src/rendering/warp';
import { FINISH_EFFECTS } from '../src/ui/finish-rack';

const allKeys = [...WARP_KEYS, ...LIQUID_KEYS, ...LUMA_WARP_KEYS, ...POLAR_KEYS, ...MIRROR_KEYS];

test('warps are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) { assert.equal(warpActive(layer), false); for (const key of allKeys) delete layer.params[key]; }
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  for (const key of ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount']) assert.equal(migrated[key], 0);
});
test('any warp amount, or an animated amount, makes the pass run', () => {
  const layer = createLayer('surface');
  for (const key of ['bendAmount', 'liquidAmount', 'lumaWarpAmount', 'polarAmount', 'mirrorAmount']) {
    assert.equal(warpActive({ ...layer, params: { ...layer.params, [key]: .2 } }), true, key);
    assert.equal(warpActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  }
});
test('graphic layers take no warp, and a warped layer cannot tile', () => {
  const graphic = createLayer('graphic');
  assert.equal(warpActive({ ...graphic, params: { ...graphic.params, bendAmount: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => allKeys.includes(d.key)), false);
  const layer = createLayer('surface'); layer.params.liquidAmount = .3;
  assert.match(layerTileBlocker(layer) ?? '', /Warp can't tile/);
});
test('warp points are stable, inside the frame and use both polarities', () => {
  assert.deepEqual(warpPoints(4, 1729), warpPoints(4, 1729));
  assert.notDeepEqual(warpPoints(4, 1729), warpPoints(4, 1730));
  const points = warpPoints(8, 1729);
  assert.equal(points.length, 8);
  assert.ok(points.every(p => p.x >= .1 && p.x <= .9 && p.y >= .1 && p.y <= .9));
  assert.deepEqual([...new Set(points.map(p => p.polarity))].sort(), [-1, 1]);
});
test('kaleidoscope folding is periodic and mirrored', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const wedge = Math.PI * 2 / 6;
  near(foldAngle(.2, 6), .2);
  near(foldAngle(.2 + wedge, 6), .2);
  near(foldAngle(wedge - .2, 6), .2);
  near(foldAngle(-.2, 6), .2);
});
test('loop motion closes after whole cycles', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9);
  for (const cycles of [-3, 1, 4]) { const a = loopOffset(0, cycles), b = loopOffset(Math.PI * 2, cycles); near(a[0], b[0]); near(a[1], b[1]); }
  assert.deepEqual(loopOffset(1.2, 0), [0, 0]);
});
test('variations never switch a warp on or change its choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette: false, structure: false, motion: false, material: false }, entropy);
      for (const key of allKeys) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
test('the luma driver rescales above its threshold', () => {
  assert.equal(lumaDriver(.5, 0), .5);
  assert.equal(lumaDriver(.2, .4), 0);
  assert.equal(lumaDriver(.7, .4), .5);
  assert.equal(lumaDriver(1, 1), 0);
});
test('the luma driver stays in range past full tone', () => {
  assert.equal(lumaDriver(2, 1), 0);
  assert.equal(lumaDriver(2, .5), 1);
});
test('every warp key belongs to one Finish effect in the Warp group', () => {
  const ids = FINISH_EFFECTS.filter(item => item.group === 'Warp').map(item => item.id);
  assert.deepEqual(ids, ['warp', 'liquid', 'lumaWarp', 'polar', 'mirror']);
});
