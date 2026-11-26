import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { CHAR_KEYS, LED_KEYS, TILE_KEYS } from '../src/core/finishing';
import { layerTileBlocker } from '../src/core/tile-edges';
import { CHAR_SETS, RETRO_PALETTES, cellGrid, glyphForTone, tileControlVisible, tilesActive } from '../src/rendering/tiles';

const allKeys = [...LED_KEYS, ...CHAR_KEYS, ...TILE_KEYS];
test('tile effects are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) { assert.equal(tilesActive(layer), false); for (const key of [...allKeys, 'printRetro', 'printShimmer']) delete layer.params[key]; }
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  for (const key of ['ledAmount', 'charAmount', 'tileAmount', 'printShimmer']) assert.equal(migrated[key], 0);
});
test('any amount or an animated amount runs the tile pass, never on graphic layers', () => {
  const layer = createLayer('surface');
  for (const key of ['ledAmount', 'charAmount', 'tileAmount']) {
    assert.equal(tilesActive({ ...layer, params: { ...layer.params, [key]: .3 } }), true, key);
    assert.equal(tilesActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  }
  const graphic = createLayer('graphic');
  assert.equal(tilesActive({ ...graphic, params: { ...graphic.params, ledAmount: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => allKeys.includes(d.key)), false);
});
test('a tiled layer cannot use Tile Edges', () => {
  const layer = createLayer('surface'); layer.params.tileAmount = .5;
  assert.match(layerTileBlocker(layer) ?? '', /Tiles can't tile/);
});
test('the cell grid is sized in 1080-line pixels at any render size', () => {
  assert.deepEqual(cellGrid(1920, 1080, 10).cols, 192);
  assert.deepEqual(cellGrid(3840, 2160, 10).cols, 192);
  assert.deepEqual(cellGrid(960, 540, 10).rows, 108);
  const g = cellGrid(1000, 1000, 7);
  assert.equal(g.rows, Math.ceil(1080 / 7));
  assert.ok(Math.abs(g.cellUv[1] * g.rows - 1) < .02);
});
test('glyphs run from empty to full with tone', () => {
  assert.equal(glyphForTone(0, 10), 0);
  assert.equal(glyphForTone(1, 10), 9);
  assert.equal(glyphForTone(.5, 10), 5);
  assert.equal(glyphForTone(-1, 4), 0);
  assert.equal(glyphForTone(8, 4), 3);
});
test('character sets and retro palettes keep their order', () => {
  assert.deepEqual(CHAR_SETS.map(s => s.name), ['Density', 'Blocks', 'Binary', 'Dots']);
  assert.ok(CHAR_SETS.every(s => s.glyphs[0] === ' '));
  assert.deepEqual(RETRO_PALETTES.map(p => p.name), ['Game Boy', 'CGA', 'Teletext', 'Green screen']);
});
test('variations never switch tile effects on or change their choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette: false, structure: false, motion: false, material: false }, entropy);
      for (const key of [...allKeys, 'printRetro', 'printShimmer', 'printType', 'printColour']) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
test('tile controls appear only for the choice that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, ...params } });
  assert.equal(tileControlVisible(base, 'ledAmount'), true);
  assert.equal(tileControlVisible(base, 'ledSize'), false);
  assert.equal(tileControlVisible(on({ charAmount: .5, charColour: 0 }), 'charInk'), false);
  assert.equal(tileControlVisible(on({ charAmount: .5, charColour: 1 }), 'charInk'), true);
  assert.equal(tileControlVisible(on({ charAmount: .5, charSwaps: 0 }), 'charSwapChance'), false);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 0 }), 'tileJitter'), true);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 2 }), 'tileJitter'), false);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 0 }), 'tileGrout'), true);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 1 }), 'tileGrout'), true);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 2 }), 'tileGrout'), false);
  assert.equal(tileControlVisible(on({ tileAmount: .5, tileStyle: 2 }), 'tileGaps'), true);
});
