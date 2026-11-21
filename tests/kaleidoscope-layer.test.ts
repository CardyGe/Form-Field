import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, validateProject, parameterDefinitions, KALEIDOSCOPE_INPUT, PRESETS } from '../src/core/project';
import { tileBlockers } from '../src/core/tile-edges';
import { KIND_LABELS } from '../src/core/library';
import { canvasAxes } from '../src/core/canvas-interaction';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const withLayer = (kind: 'kaleidoscope' | 'surface') => { const p = createProject(); p.layers = [createLayer(kind)]; return p; };

test('Kaleidoscope layer validates and round-trips through JSON', () => {
  const p = withLayer('kaleidoscope');
  const back = validateProject(JSON.parse(JSON.stringify(validateProject(p))));
  assert.equal(back.layers[0].kind, 'kaleidoscope');
  assert.deepEqual(back.layers[0].params, p.layers[0].params);
  assert.equal(back.schemaVersion, p.schemaVersion);
});

test('defaults and input constants match the specification', () => {
  const l = createLayer('kaleidoscope');
  assert.equal(l.name, 'Kaleidoscope');
  assert.equal(KIND_LABELS.kaleidoscope, 'Kaleidoscope');
  assert.deepEqual(KALEIDOSCOPE_INPUT, { motif: 0, image: 1, below: 2, feedback: 3 });
  const want: Record<string, number> = { input: 0, group: 0, sectors: 6, cell: 1, spiral: 0, spiralA: 1, spiralB: 2, spiralScale: 4, zoomCycles: 1, sourceX: 0, sourceY: 0, sourceScale: 1, sourceTurn: 0, sourceDrift: .15, warpIn: 0, warpOut: 0, motif: 0, motifScale: 2, lineWidth: 2, cycles: 1, echo: 0, saturation: 1, hue: 0, exposure: 1 };
  for (const [k, v] of Object.entries(want)) assert.equal(l.params[k], v, k);
  assert.ok(parameterDefinitions('kaleidoscope').some(d => d.key === 'echo'));
});

test('only image and Kaleidoscope layers may hold an image', () => {
  const image = { name: 'a.png', dataUrl: PNG, width: 1, height: 1, fit: 'cover' as const };
  const k = withLayer('kaleidoscope'); k.layers[0].image = image;
  assert.equal(validateProject(structuredClone(k)).layers[0].image?.name, 'a.png');
  const s = withLayer('surface'); s.layers[0].image = image;
  assert.throws(() => validateProject(s), /image/);
});

test('out-of-range, non-finite and missing controls are refused like other kinds', () => {
  for (const [key, value] of [['sectors', 25], ['cell', 0], ['group', 5], ['input', 1.5], ['spiralScale', 1], ['sourceX', NaN], ['sourceScale', Infinity]] as const) {
    const p = withLayer('kaleidoscope'); p.layers[0].params[key] = value;
    assert.throws(() => validateProject(p), /./, key);
  }
  const missing = withLayer('kaleidoscope'); delete missing.layers[0].params.sectors;
  assert.throws(() => validateProject(missing), /sectors/);
});

test('projects without the kind open unchanged, and there are no Kaleidoscope presets', () => {
  const p = createProject();
  assert.equal(validateProject(structuredClone(p)).layers[0].kind, 'surface');
  assert.equal(PRESETS.filter(x => (x.kind as string) === 'kaleidoscope').length, 0);
});

test('tile edges name a visible Kaleidoscope layer and ignore a hidden one', () => {
  const p = withLayer('kaleidoscope');
  assert.equal(tileBlockers(p).length, 1);
  assert.match(tileBlockers(p)[0], /Kaleidoscope/);
  p.layers[0].visible = false;
  assert.equal(tileBlockers(p).length, 0);
});

test('canvas drag axes come from the kind\'s own keys', () => {
  const axes = canvasAxes(createLayer('kaleidoscope'), { structure: false, material: false } as never);
  assert.deepEqual(axes.slice(0, 2).map(a => a.key), ['cell', 'sourceTurn']);
});
