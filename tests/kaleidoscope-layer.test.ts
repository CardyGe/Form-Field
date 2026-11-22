import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, validateProject, parameterDefinitions, KALEIDOSCOPE_INPUT, PRESETS } from '../src/core/project';
import { tileBlockers } from '../src/core/tile-edges';
import { KIND_LABELS } from '../src/core/library';
import { canvasAxes } from '../src/core/canvas-interaction';
import { kaleidoscopeGLSL, kaleidoscopeUniforms } from '../src/rendering/kaleidoscope-glsl';
import * as kaleidoscopeMath from '../src/core/kaleidoscope-math';
import { kaleidoscopeImageFit, kaleidoscopeInputMode } from '../src/rendering/KaleidoscopeRenderer';

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
  const lattice = createLayer('kaleidoscope');
  lattice.params.group = 3;
  const axes = canvasAxes(lattice, { structure: false, material: false } as never);
  assert.deepEqual(axes.slice(0, 2).map(a => a.key), ['cell', 'sourceTurn']);
});

const kLayer = (params: Record<string, number> = {}) => { const l = createLayer('kaleidoscope'); Object.assign(l.params, params); return l; };

test('uniforms round integer controls at the render boundary', () => {
  const u = kaleidoscopeUniforms(kLayer({ input: 0.6, group: 2.6, sectors: 7.4, spiral: 0.7, spiralA: 2.4, spiralB: -3.6, zoomCycles: 1.6, motif: 1.5, cycles: 2.5 }), 0);
  assert.deepEqual([u.uKInput, u.uKGroup, u.uKSectors, u.uKSpiral, u.uKSpiralA, u.uKSpiralB, u.uKMotif], [1, 3, 7, 1, 2, -4, 2]);
  assert.equal(u.uKZoomCycles, 2);
  assert.equal(u.uKCycles, 3);
});

test('uniforms clamp to the definition range and replace non-finite values with the default', () => {
  const u = kaleidoscopeUniforms(kLayer({ group: 99, sectors: 1, cell: 100, warpIn: -2, spiralScale: 1, sourceScale: NaN, lineWidth: Infinity, motifScale: -Infinity }), 0.25);
  assert.equal(u.uKGroup, 4); assert.equal(u.uKSectors, 3); assert.equal(u.uKCell, 4); assert.equal(u.uKWarpIn, 0);
  assert.equal(u.uKSpiralScale, 2); assert.equal(u.uKSourceScale, 1); assert.equal(u.uKLineWidth, 2); assert.equal(u.uKMotifScale, 2);
  const missing = createLayer('kaleidoscope'); delete missing.params.sectors;
  assert.equal(kaleidoscopeUniforms(missing, 0).uKSectors, 6);
  const bad = createLayer('kaleidoscope');
  for (const key of Object.keys(bad.params)) bad.params[key] = NaN;
  for (const [key, value] of Object.entries(kaleidoscopeUniforms(bad, NaN))) {
    for (const n of [value].flat() as number[]) assert.ok(Number.isFinite(n), key);
  }
});

test('spiral (0,0) is sanitised, also after rounding', () => {
  const u = kaleidoscopeUniforms(kLayer({ spiralA: 0.2, spiralB: -0.3 }), 0);
  assert.deepEqual([u.uKSpiralA, u.uKSpiralB], [0, 1]);
  assert.ok(Object.is(u.uKSpiralA, 0));
});

test('spiral mode uses a whole motif repeat of at least one; fold mode keeps the fractional scale', () => {
  assert.equal(kaleidoscopeUniforms(kLayer({ spiral: 1, motifScale: 2.6 }), 0).uKMotifScale, 3);
  assert.equal(kaleidoscopeUniforms(kLayer({ spiral: 1, motifScale: 0.25 }), 0).uKMotifScale, 1);
  assert.equal(kaleidoscopeUniforms(kLayer({ spiral: 0, motifScale: 2.6 }), 0).uKMotifScale, 2.6);
});

test('uniforms are identical at loop fractions 0 and 1, and zoom advances by whole cycles', () => {
  const l = kLayer({ zoomCycles: 3, cycles: 4, spiral: 1 });
  assert.deepEqual(kaleidoscopeUniforms(l, 1), kaleidoscopeUniforms(l, 0));
  assert.deepEqual(kaleidoscopeUniforms(l, 2), kaleidoscopeUniforms(l, 0));
  assert.ok(Math.abs((kaleidoscopeUniforms(l, 0.5).uKZoom as number) - 1.5) < 1e-12);
  assert.ok(Math.abs((kaleidoscopeUniforms(l, 0.125).uKPhase as number) - Math.PI) < 1e-12);
});

test('kaleidoscopeUniforms does not change the layer', () => {
  const l = kLayer({ group: 2.6 }); const before = structuredClone(l);
  kaleidoscopeUniforms(l, 0.3);
  assert.deepEqual(l, before);
});

test('the shader differentiates only the continuous pre-fold coordinate', () => {
  assert.match(kaleidoscopeGLSL, /vec2 foldDomain\(vec2 p, inout vec2 dx, inout vec2 dy\)/);
  assert.match(kaleidoscopeGLSL, /vec2 spiralDomain\(vec2 z, inout vec2 dx, inout vec2 dy\)/);
  assert.match(kaleidoscopeGLSL, /textureGrad\(/);
  assert.doesNotMatch(kaleidoscopeGLSL, /dFdx|dFdy|fwidth/);
});

/** Brute-force parity over one tile: the mask's area and its ink weight (.5 + .5 cos 2 pi (x + y)). */
function integrateParity(centres: number[], radii: number[], n = 1400) {
  let coverage = 0, ink = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + .5) / n, y = (j + .5) / n;
    let parity = 0;
    for (let d = 0; d < 3; d++) {
      const ex = x - centres[d * 2], ey = y - centres[d * 2 + 1];
      const wx = ex - Math.floor(ex + .5), wy = ey - Math.floor(ey + .5);
      if (wx * wx + wy * wy < radii[d] * radii[d]) parity ^= 1;
    }
    if (parity) { coverage++; ink += .5 + .5 * Math.cos(2 * Math.PI * (x + y)); }
  }
  return { coverage: coverage / (n * n), ink: ink / (n * n) };
}

test('the parity fade target matches numeric integration as the discs move', () => {
  const { parityAverage, parityCentres, PARITY_RADII } = kaleidoscopeMath as any;
  const known: [number, number][] = [[0, .4656], [1.88, .4656], [1.20, .4656], [3.50, .4656]];
  for (const [phase, coverage] of known) {
    const measured = integrateParity(parityCentres(phase), PARITY_RADII);
    const average = parityAverage(phase);
    assert.ok(Math.abs(measured.coverage - coverage) < 1e-3, `reference ${phase}: ${measured.coverage}`);
    assert.ok(Math.abs(average.coverage - measured.coverage) < 1e-3, `coverage ${phase}: ${average.coverage} vs ${measured.coverage}`);
    assert.ok(Math.abs(average.ink - measured.ink) < 1e-3, `ink ${phase}: ${average.ink} vs ${measured.ink}`);
  }
});

test('parity uniforms carry the current centres and average, and close over the loop', () => {
  const { parityAverage, parityCentres } = kaleidoscopeMath as any;
  const l = kLayer({ motif: 2, cycles: 1 });
  const u = kaleidoscopeUniforms(l, .3);
  const phase = u.uKPhase as number, average = parityAverage(phase);
  assert.deepEqual(u.uKParityCentres, parityCentres(phase));
  assert.deepEqual(u.uKParityAverage, [average.coverage, average.ink]);
  assert.notDeepEqual(kaleidoscopeUniforms(l, .1).uKParityAverage, u.uKParityAverage);
  assert.deepEqual(kaleidoscopeUniforms(l, 1).uKParityAverage, kaleidoscopeUniforms(l, 0).uKParityAverage);
});

test('the input mode falls back calmly and never needs a ready input', () => {
  const on = (input: number, echo = 0) => kLayer({ input, echo });
  const { motif, image, below, feedback } = KALEIDOSCOPE_INPUT;
  const all = { image: true, hasBelow: true }, none = { image: false, hasBelow: false };
  assert.equal(kaleidoscopeInputMode(on(motif), all), 'motif');
  assert.equal(kaleidoscopeInputMode(on(image), all), 'image');
  assert.equal(kaleidoscopeInputMode(on(image), none), 'motif', 'a missing or loading image shows the motif');
  assert.equal(kaleidoscopeInputMode(on(below), all), 'below');
  assert.equal(kaleidoscopeInputMode(on(below), none), 'empty', 'the bottom layer has nothing to fold');
  assert.equal(kaleidoscopeInputMode(on(feedback, .5), none), 'feedback');
  assert.equal(kaleidoscopeInputMode(on(feedback, 0), all), 'motif', 'no echo means no history');
});

test('the input mode rounds and clamps a modulated input like the uniforms do', () => {
  const ready = { image: true, hasBelow: true };
  assert.equal(kaleidoscopeInputMode(kLayer({ input: .6 }), ready), 'image');
  assert.equal(kaleidoscopeInputMode(kLayer({ input: 1.6 }), ready), 'below');
  assert.equal(kaleidoscopeInputMode(kLayer({ input: 99, echo: .5 }), ready), 'feedback');
  assert.equal(kaleidoscopeInputMode(kLayer({ input: NaN }), ready), 'motif');
});

test('image fit keeps the picture aspect for cover and contain', () => {
  assert.deepEqual(kaleidoscopeImageFit(1, 'cover'), { x: 1, y: 1 });
  assert.deepEqual(kaleidoscopeImageFit(2, 'cover'), { x: .5, y: 1 }, 'wide: crop the sides');
  assert.deepEqual(kaleidoscopeImageFit(.5, 'cover'), { x: 1, y: .5 }, 'tall: crop top and bottom');
  assert.deepEqual(kaleidoscopeImageFit(2, 'contain'), { x: 1, y: 2 }, 'wide: bars above and below');
  assert.deepEqual(kaleidoscopeImageFit(.5, 'contain'), { x: 2, y: 1 }, 'tall: bars at the sides');
  assert.deepEqual(kaleidoscopeImageFit(NaN, 'cover'), { x: 1, y: 1 });
  assert.deepEqual(kaleidoscopeImageFit(0, 'contain'), { x: 1, y: 1 });
});

test('a visible Kaleidoscope blocks tile edges on every input', () => {
  for (const input of Object.values(KALEIDOSCOPE_INPUT)) {
    const p = withLayer('kaleidoscope'); p.layers[0].params.input = input;
    assert.equal(tileBlockers(p).length, 1, `input ${input}`);
  }
});
