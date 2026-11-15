import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyFinish, applyPreset, createLayer, createProject, finishSupported, validateProject, varyLayer, visibleParameterDefinitions } from '../src/core/project';
import { PRINT_KEYS, FINISH_KEYS } from '../src/core/finishing';
import { bayerThreshold, classicLevel, printActive, printCoverage, printInkScale, printMarkSize, printUniforms, supportsPrint } from '../src/rendering/print-screen';

test('print screen is off by default and older projects migrate without it', () => {
  const project = createProject();
  for (const layer of project.layers) {
    assert.equal(layer.params.printMix, 0);
    assert.equal(printActive(layer), false);
    for (const key of PRINT_KEYS) delete layer.params[key];
  }
  const migrated = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(PRINT_KEYS.map(k => migrated.layers[0].params[k]),
    [0, 0, 8, 45, 0, 2, 0, 0, 1, .8, 0, 0, 0, 0, 1, 0, 0, 12, .5, .25]);
});

test('print keys are finish keys in the spec order', () => {
  assert.deepEqual(PRINT_KEYS, ['printMix','printType','printSize','printAngle','printDot','printMatrix','printScroll',
    'printFloor','printCeiling','printMax','printGain','printSoft','printInvert','printColour','printInk','printPaper',
    'printArea','printEdgeWidth','printEdgeSense','printEdgeFeather']);
  assert.equal(PRINT_KEYS.every(k => FINISH_KEYS.includes(k)), true);
});

test('print screen runs when the amount is animated from zero', () => {
  const layer = createLayer('surface');
  assert.equal(printActive({ ...layer, modulations: { printMix: {} as never } }), true);
  assert.equal(printActive({ ...layer, params: { ...layer.params, printMix: .4 } }), true);
});

test('graphic patterns take no print screen; the oscilloscope does', () => {
  const graphic = createLayer('graphic');
  assert.equal(supportsPrint(graphic), false);
  assert.equal(printActive({ ...graphic, params: { ...graphic.params, printMix: 1 } }), false);
  assert.equal(visibleParameterDefinitions(graphic).some(d => PRINT_KEYS.includes(d.key)), false);
  assert.equal(PRINT_KEYS.every(k => visibleParameterDefinitions(createLayer('scope')).some(d => d.key === k)), true);
});

test('the screen is sized in 1080-line pixels and travels whole cells per loop', () => {
  const layer = createLayer('surface');
  const u = printUniforms({ params: { ...layer.params, printSize: 8, printAngle: 45, printScroll: 3 } }, Math.PI * 2);
  assert.equal(u.cells, 135);
  assert.equal(u.scroll, 3);
  assert.deepEqual(u.angles.map(a => Math.round(a * 180 / Math.PI)), [60, 120, 45, 90]);
  assert.equal(printUniforms({ params: { ...layer.params, printScroll: 3 } }, 0).scroll, 0);
});

test('tone maps to coverage through floor, ceiling, gain and invert', () => {
  assert.equal(printCoverage(.5, 0, 1, 0, 0), .5);
  assert.equal(printCoverage(.2, .2, .8, 0, 0), 0);
  assert.equal(printCoverage(.8, .2, .8, 0, 0), 1);
  assert.ok(printCoverage(.5, 0, 1, .5, 0) > .5);
  assert.ok(printCoverage(.5, 0, 1, -.5, 0) < .5);
  assert.equal(printCoverage(.25, 0, 1, 0, 1), .75);
  // Floor above ceiling: a hard threshold at the floor, never NaN.
  assert.equal(printCoverage(.5, .6, .4, 0, 0), 0);
  assert.equal(printCoverage(.7, .6, .4, 0, 0), 1);
});

test('the largest mark leaves the background showing in full-bright areas', () => {
  assert.equal(printCoverage(1, 0, 1, 0, 0, .8), .8);
  assert.equal(printCoverage(0, 0, 1, 0, 1, .8), .8);
  assert.equal(printCoverage(.5, 0, 1, 0, 0, .8), .4);
  assert.equal(printCoverage(1, 0, 1, 0, 0, 1), 1);
  assert.equal(printCoverage(0, 0, 1, 0, 0, .8), 0);
});

test('layer-colour brightness scale is finite and capped', () => {
  assert.equal(printInkScale(0), 8);
  assert.equal(printInkScale(.5), 2);
  assert.equal(printInkScale(1), 1);
});

test('mark size grows with coverage, is empty at 0 and fills the cell at 1', () => {
  // Size is the mark's half-extent in cells: radius, half-side, or diamond reach.
  for (const shape of [0, 1, 2, 3]) {
    assert.equal(printMarkSize(shape, 0), 0);
    let last = 0;
    for (let c = .05; c <= 1; c += .05) { const s = printMarkSize(shape, c); assert.ok(s > last, `${shape} ${c}`); last = s; }
  }
  assert.ok(Math.abs(printMarkSize(0, .2) - Math.sqrt(.2 / Math.PI)) < 1e-9);  // round: area = c
  assert.ok(printMarkSize(0, 1) >= Math.SQRT1_2);                               // round covers the cell corners
  assert.ok(Math.abs(printMarkSize(2, .5) - .5) < 1e-9);                        // diamonds meet at half tone
  assert.equal(printMarkSize(2, 1), 1);
  assert.equal(printMarkSize(3, 1), .5);                                         // square: half-side
});

test('the classic dot covers the share of the cell its tone asks for', () => {
  assert.ok(Math.abs(classicLevel(.5)) < 1e-6);
  const n = 200;
  for (const c of [.1, .3, .5, .7, .9]) {
    const level = classicLevel(c);
    let inside = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const field = (Math.cos(2 * Math.PI * (x + .5) / n) + Math.cos(2 * Math.PI * (y + .5) / n)) / 2;
      if (field > level) inside++;
    }
    assert.ok(Math.abs(inside / (n * n) - c) < .02, `${c}: ${inside / (n * n)}`);
  }
});

test('bayer matrices are complete and balanced', () => {
  for (const [matrix, n] of [[0, 2], [1, 4], [2, 8]] as const) {
    const seen = new Set<number>();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) seen.add(bayerThreshold(matrix, x, y));
    assert.equal(seen.size, n * n);
    assert.ok(Math.min(...seen) > 0 && Math.max(...seen) < 1);
    assert.equal(bayerThreshold(matrix, n, n), bayerThreshold(matrix, 0, 0)); // tiles
  }
});

test('print looks apply, replace other finishes and clear', () => {
  const layer = createLayer('surface');
  const halftone = applyFinish(layer, 'finish-halftone');
  assert.deepEqual([halftone.params.printMix, halftone.params.printType, halftone.params.printSize, halftone.params.printAngle], [1, 0, 8, 45]);
  const comic = applyFinish(applyFinish(layer, 'finish-soft-glow'), 'finish-comic-process');
  assert.deepEqual([comic.params.glowMix, comic.params.printColour, comic.params.printSize], [0, 3, 7]);
  const edges = applyFinish(layer, 'finish-halftone-edges');
  assert.deepEqual([edges.params.printArea, edges.params.printEdgeWidth], [1, 16]);
  const dither = applyFinish(layer, 'finish-bitmap-dither');
  assert.deepEqual([dither.params.printType, dither.params.printSize, dither.params.printMatrix, dither.params.printAngle], [2, 3, 2, 0]);
  assert.deepEqual([applyFinish(layer, 'finish-fine-halftone').params.printDot, applyFinish(layer, 'finish-engraving').params.printType, applyFinish(layer, 'finish-rgb-raster').params.printColour], [1, 1, 2]);
  assert.equal(applyFinish(halftone, 'finish-none').params.printMix, 0);
  assert.equal(applyFinish(halftone, 'finish-tunnel').params.printMix, 0);
});

test('print looks are unavailable on graphic patterns', () => {
  const graphic = createLayer('graphic');
  assert.equal(finishSupported(graphic, 'finish-halftone'), false);
});

test('vary never switches the screen or its stepped choices, and keeps it near where it was set', () => {
  const unlocked = { palette: false, structure: false, motion: false, material: false };
  const stepped = ['printMix','printType','printDot','printMatrix','printScroll','printInvert','printColour','printInk','printPaper','printArea'];
  for (const preset of PRESETS) {
    const layer = applyPreset(createLayer(preset.kind), preset.id);
    const varied = varyLayer(layer, 1, unlocked, 4000);
    for (const key of PRINT_KEYS) assert.equal(varied.params[key], layer.params[key], `${preset.id} ${key}`);
  }
  const on = applyFinish(createLayer('liquid'), 'finish-halftone');
  for (let i = 0; i < 30; i++) {
    const varied = varyLayer(on, 1, unlocked, 5000 + i);
    for (const key of stepped) assert.equal(varied.params[key], on.params[key], key);
    assert.ok(Math.abs(varied.params.printSize - 8) <= 63 * .1201, `size ${varied.params.printSize}`);
  }
});
