import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { canvasAxes, panFromDrag, shapeFromDrag, wheelZoomFactor, zoomAt } from '../src/core/canvas-interaction';
import { createLayer, createProject, PRESETS, applyPreset, validateProject } from '../src/core/project';
import { sourceViewMatrix } from '../src/rendering/source-view';
import { INSTRUMENT_KINDS } from '../src/core/instruments';

const locks = { palette: true, structure: false, motion: true, material: false };
const mod = { kind: 'sine' as const, cycles: 1, phase: 0, amount: .2, points: [] };

test('cursor-anchored zoom preserves the actual source point across aspect, rotation and scale', () => {
  for (const aspect of [9/16, 1, 16/9, 3]) for (const rotation of [-2.4, 0, 1.9]) for (const scale of [.1, 1, 5]) {
    const before = { x: .1, y: -.2, scale, rotation };
    for (const [x, y] of [[0, 0], [.2, -.3], [-.4, .4]]) for (const factor of [.5, 1.7]) {
      const after = zoomAt(before, factor, x, y);
      const cursor = new Vector3(x + .5, .5 - y, 1);
      const a = cursor.clone().applyMatrix3(sourceViewMatrix(before, aspect));
      const b = cursor.clone().applyMatrix3(sourceViewMatrix(after, aspect));
      assert.ok(a.distanceTo(b) < 1e-12, `Source drift: ${a.distanceTo(b)}`);
      const back = zoomAt(after, before.scale / after.scale, x, y);
      for (const key of ['x', 'y', 'scale'] as const) assert.ok(Math.abs(back[key] - before[key]) < 1e-12);
    }
  }
});

test('zoom and pan obey persisted bounds, including wheel unit normalization', () => {
  const base = { x: 0, y: 0, scale: 1, rotation: .3 };
  assert.deepEqual(panFromDrag(base, 200, -200), { ...base, x: 2, y: -2 });
  assert.equal(zoomAt(base, 1e9, 0, 0).scale, 8);
  assert.equal(zoomAt(base, 1e-9, 0, 0).scale, .05);
  assert.equal(wheelZoomFactor(1, 1, 400), wheelZoomFactor(16, 0, 400));
  assert.equal(wheelZoomFactor(1, 2, 200), wheelZoomFactor(200, 0, 200));
  assert.ok(wheelZoomFactor(-1e20, 0, 500) < 2);
  assert.ok(wheelZoomFactor(1e20, 0, 500) > .5);
});

test('every procedural instrument exposes two useful axes and excludes locks and animated routes', () => {
  for (const kind of ['surface','sculpture','fractal','oil','super8','graphic', ...INSTRUMENT_KINDS] as const) {
    const layer = createLayer(kind), axes = canvasAxes(layer, locks);
    assert.equal(axes.length, 2, kind);
    assert.ok(axes.every(d => d.step !== 1 && !d.preparation));
    for (const axis of axes) layer.modulations[axis.key] = mod;
    assert.ok(canvasAxes(layer, locks).every(d => !layer.modulations[d.key]));
    assert.deepEqual(canvasAxes(layer, { ...locks, structure: true, material: true }), []);
  }
  const ink = createLayer('livingink');
  assert.deepEqual(canvasAxes(ink, locks).map(d => d.key), ['flow', 'warp']);
  const fractal = createLayer('fractal'); fractal.params.style = 1;
  assert.deepEqual(canvasAxes(fractal, locks).map(d => d.key), ['juliaReal', 'juliaImag']);
});

test('drag edits roundtrip every saved look without touching palette, motion, mask or framing', () => {
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id), original = structuredClone(layer);
    const axes = canvasAxes(layer, locks);
    assert.deepEqual(shapeFromDrag(layer, axes, 0, 0), layer);
    for (const [dx, dy] of [[.12, -.14], [1e6, -1e6], [-1e6, 1e6]]) {
      const next = shapeFromDrag(layer, axes, dx, dy);
      validateProject({ ...createProject(), layers: [next] });
      assert.deepEqual(next.transform, layer.transform);
      assert.deepEqual(next.palette, layer.palette);
      assert.deepEqual(next.mask, layer.mask);
      assert.deepEqual(next.modulations, layer.modulations);
      assert.equal(next.params.seed, layer.params.seed);
      for (const key of Object.keys(layer.params)) if (!axes.some(d => d.key === key)) assert.equal(next.params[key], layer.params[key], key);
    }
    assert.deepEqual(layer, original);
  }
});
