import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { canvasAxes, shapeFromDrag } from '../src/core/canvas-interaction';
import { createLayer, SURFACE_FOLD, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { layerTileBlocker } from '../src/core/tile-edges';
import { frameCount, phaseAtFrame } from '../src/core/timeline';
import { presetComposition } from '../src/map/editor';
import { activeParameterLink } from '../src/map/targets';
import { sourceViewMatrix } from '../src/rendering/source-view';

const reference = validateProject(JSON.parse(readFileSync(new URL('./fixtures/Offset_Fold_Reference.formfield', import.meta.url), 'utf8')));
const locks = { palette: false, structure: false, motion: false, material: false };

test('reference opens with exact loop timing and the same look as the Map preset', () => {
  const layer = reference.layers[0];
  const map = presetComposition('offset-fold', layer.params.seed)!;
  assert.equal(layer.params.style, SURFACE_FOLD);
  assert.deepEqual(layer.params, map.layers[0].params);
  assert.deepEqual(layer.palette, map.layers[0].palette);
  assert.equal(frameCount(reference), 175);
  assert.equal(layer.params.cycles, 4);
  assert.equal(phaseAtFrame(175, 175), phaseAtFrame(0, 175));
  assert.match(layerTileBlocker(layer) ?? '', /Liquid Fold/);
  assert.throws(() => validateProject({
    ...reference, layers: [{ ...layer, params: { ...layer.params, variant: 1 } }],
  }), /does not belong to Liquid Fold/);
});

test('drag moves the opening at the pointer rate on rotated, scaled and wide layers', () => {
  const base = reference.layers[0];
  const layer = { ...base, transform: { x: .15, y: -.1, scale: .75, rotation: .9 } };
  const dx = .24, dy = -.18;
  for (const aspect of [9/16, 16/10, 16/9]) {
    const view = sourceViewMatrix(layer.transform, aspect);
    const start = new Vector3(layer.params.foldX, layer.params.foldY, 1).applyMatrix3(view.clone().invert());
    const dragged = shapeFromDrag(layer, canvasAxes(layer, locks), dx, dy, aspect);
    const actual = new Vector3(dragged.params.foldX, dragged.params.foldY, 1).applyMatrix3(view.invert());
    assert.ok(actual.distanceTo(start.add(new Vector3(dx, -dy, 0))) < 1e-12);
  }
  const outside = shapeFromDrag(base, canvasAxes(base, locks), .65, .75, 16/9);
  assert.ok(outside.params.foldX > 1 && outside.params.foldY < 0);
  assert.deepEqual(outside.transform, base.transform);
  const varied = varyLayer(outside, .9, locks);
  assert.equal(varied.params.foldX, outside.params.foldX);
  assert.equal(varied.params.foldY, outside.params.foldY);
});

test('older Surface layers load with hidden Fold controls and inactive Fold MIDI links', () => {
  const legacy = createLayer('surface');
  for (const key of Object.keys(legacy.params)) if (key.startsWith('fold')) delete legacy.params[key];
  const opened = validateProject({ ...reference, layers: [legacy] }).layers[0];
  assert.equal(opened.params.style, legacy.params.style);
  assert.ok(Number.isFinite(opened.params.foldX));
  assert.ok(!visibleParameterDefinitions(opened).some(d => d.key === 'foldX'));
  assert.equal(activeParameterLink(opened, 'foldX'), false);
  assert.equal(activeParameterLink(reference.layers[0], 'foldX'), true);
  assert.equal(activeParameterLink(reference.layers[0], 'foldDirection'), false);
});
