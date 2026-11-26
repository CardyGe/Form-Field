import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyPreset, createLayer, createProject, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { CRT_KEYS, DATABEND_KEYS, DROP_KEYS, JPEG_KEYS, VHS_KEYS } from '../src/core/finishing';
import { layerTileBlocker } from '../src/core/tile-edges';
import { crtCurve, loopFrame, signalActive, signalControlVisible, signalStages, streamIndex, streamPixel } from '../src/rendering/signal';

const allKeys = [...VHS_KEYS, ...DROP_KEYS, ...CRT_KEYS, ...JPEG_KEYS, ...DATABEND_KEYS];
const amounts = ['vhsAmount', 'dropAmount', 'crtAmount', 'jpegAmount', 'databendAmount'];
test('signal effects are off by default and older projects migrate without them', () => {
  const project = createProject();
  for (const layer of project.layers) { assert.equal(signalActive(layer), false); for (const key of allKeys) delete layer.params[key]; }
  const migrated = validateProject(JSON.parse(JSON.stringify(project))).layers[0].params;
  for (const key of amounts) assert.equal(migrated[key], 0);
});
test('any amount or an animated amount runs the signal pass, never on graphic layers', () => {
  const layer = createLayer('surface');
  for (const key of amounts) {
    assert.equal(signalActive({ ...layer, params: { ...layer.params, [key]: .3 } }), true, key);
    assert.equal(signalActive({ ...layer, modulations: { [key]: {} as never } }), true, key);
  }
  const graphic = createLayer('graphic');
  assert.equal(signalActive({ ...graphic, params: { ...graphic.params, crtAmount: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => allKeys.includes(d.key)), false);
});
test('stages run in signal order and only when on', () => {
  const layer = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...layer, params: { ...layer.params, ...params } });
  assert.deepEqual(signalStages(layer), []);
  assert.deepEqual(signalStages(on({ crtAmount: 1, vhsAmount: 1, databendAmount: 1, jpegAmount: 1, dropAmount: 1 })), ['databend', 'jpeg', 'vhs', 'drop', 'crt']);
  assert.deepEqual(signalStages(on({ crtAmount: .5 })), ['crt']);
});
test('a signal layer cannot use Tile Edges, naming the effect', () => {
  const layer = createLayer('surface'); layer.params.vhsAmount = .5;
  assert.match(layerTileBlocker(layer) ?? '', /VHS can't use Tile Edges/);
});
test('loop frames round to the nearest frame and wrap at the seam', () => {
  assert.equal(loopFrame(0, 120), 0);
  assert.equal(loopFrame(Math.PI * 2 - 1e-4, 120), 0);
  assert.equal(loopFrame(Math.PI, 120), 60);
  assert.equal(loopFrame(Math.PI * 2 * (59.6 / 120), 120), 60);
});
test('the CRT curve leaves the centre alone and pushes the corners out', () => {
  assert.deepEqual(crtCurve([.5, .5], .3), [.5, .5]);
  const [x, y] = crtCurve([1, 1], .3);
  assert.ok(x > 1 && y > 1);
  assert.deepEqual(crtCurve([.9, .2], 0), [.9, .2]);
});
test('the CRT curve pushes each point out by the curve times its squared distance in frame heights', () => {
  // d = (uv - .5) with x in frame heights; source = .5 + d * (1 + curve * |d|²), x back in frame widths.
  const close = (a: [number, number], b: [number, number]) => assert.ok(Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12, `${a} vs ${b}`);
  const aspect = 16 / 9, dx = .25 * aspect;
  close(crtCurve([.75, .5], .3, aspect), [.5 + .25 * (1 + .3 * dx * dx), .5]);
  close(crtCurve([.5, .1], .5, aspect), [.5, .5 - .4 * (1 + .5 * .16)]);
  // A radial barrel: a point's push depends on its distance alone, so a corner moves along its diagonal.
  const [x, y] = crtCurve([.9, .9], .2, 1);
  close([x, y], [.5 + .4 * (1 + .2 * .32), .5 + .4 * (1 + .2 * .32)]);
  // Square frames by default.
  close(crtCurve([.75, .5], .3), [.5 + .25 * (1 + .3 * .0625), .5]);
});
test('variations never switch signal effects on or change their choices', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    for (let entropy = 0; entropy < 4; entropy++) {
      const varied = varyLayer(layer, 1, { palette: false, structure: false, motion: false, material: false }, entropy);
      for (const key of allKeys) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
    }
  }
});
test('signal controls appear only for the choice that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, ...params } });
  assert.equal(signalControlVisible(base, 'crtAmount'), true);
  assert.equal(signalControlVisible(base, 'crtCurve'), false);
  assert.equal(signalControlVisible(on({ crtAmount: .5, crtMask: 0 }), 'crtMaskSize'), false);
  assert.equal(signalControlVisible(on({ jpegAmount: .5, jpegGlitch: 0 }), 'jpegGlitchSwaps'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 2 }), 'databendRepeats'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 0 }), 'databendRepeats'), true);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 0 }), 'unknownKey'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 0 }), 'databendDepth'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 4 }), 'databendDepth'), true);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 2 }), 'databendDistance'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 2 }), 'databendAxis'), false);
  assert.equal(signalControlVisible(on({ databendAmount: .5, databendMode: 3 }), 'databendDistance'), true);
});
test('the stream runs across, down or wrapping row to row', () => {
  assert.equal(streamIndex(3, 2, 10, 5, 0), 23);
  assert.equal(streamIndex(3, 2, 10, 5, 1), 17);
  assert.deepEqual(streamPixel(23, 10, 5, 2), [3, 2]);
  assert.deepEqual(streamPixel(streamIndex(9, 0, 10, 5, 2) + 1, 10, 5, 2), [0, 1]);
});
