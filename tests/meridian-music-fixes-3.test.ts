import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';
import { FLASH_STEP } from '../src/meridian/flash-guard';
import { LightGrid } from '../src/meridian/light-measure';
import { DisplayList } from '../src/meridian/display-list';
import { PRIMITIVE } from '../src/meridian/types';
import { MeridianRenderer, type MeridianRuntime } from '../src/rendering/MeridianRenderer';
import type { Layer, Project } from '../src/shared/types';

const TAU = Math.PI * 2, W = 160, H = 90; // Line widths are in pixels, so a small frame lets one real layer reach a third of the picture.
type Probe = { loadLive(l: Layer, s: Record<string, number>): void; prepareEvolve(l: Layer, p: number, w: number, h: number, r: MeridianRuntime, e: unknown): void; measureEntry(l: Layer, e: unknown, w: number, h: number, guarded: boolean): void; sampleEntry: { area: number }; lightGrid: LightGrid };

const projectOf = (layers: Layer[]): Project => ({ ...createProject(), layers, duration: 2, fps: { num: 60, den: 1 }, background: '#000000' });

function solid(id: string, weight: number): Layer {
  const layer = createLayer('meridian'); layer.id = id;
  Object.assign(layer.params, { scoreStyle: 2, macroDensity: 1, macroHeat: 1, ringWeight: weight, spokeWeight: weight, lightExposure: 4 }); // Bright enough that the live picture's lines light over a quarter of the frame.
  return layer;
}
type Mode = 'export' | 'live';
/** One layer's area and light on the path under test, at full opacity. */
function measure(layer: Layer, mode: Mode): { area: number } {
  const r = new MeridianRenderer() as unknown as Probe & { beginComposition: MeridianRenderer['beginComposition']; evolveEntries: Map<string, { area: number }> };
  if (mode === 'live') {
    const project = projectOf([layer]), real = performance.now; let now = 1000; performance.now = () => now;
    try { for (let f = 0; f < 3; f++) { now += 1000 / 60; r.beginComposition(project, f / 120 * TAU, W, H, 2, false, {}); } } finally { performance.now = real; }
    const entry = r.evolveEntries.get(layer.id)!;
    return { area: entry.area };
  }
  r.lightGrid.reset(W / H); r.loadLive(layer, layer.params); r.prepareEvolve(layer, 1, W, H, { live: false, structure: layer.params, duration: 2 }, r.sampleEntry); r.measureEntry(layer, r.sampleEntry, W, H, true);
  return { area: r.sampleEntry.area };
}
/** The line weight at which one layer covers a third of the frame on this path. */
function thirdWeight(mode: Mode): number {
  let low = 0.2, high = 16;
  for (let i = 0; i < 18; i++) { const mid = (low + high) / 2; if (measure(solid('m', mid), mode).area > 0.33) high = mid; else low = mid; }
  return (low + high) / 2;
}
const WEIGHTS: Record<Mode, number> = { export: thirdWeight('export'), live: thirdWeight('live') };
function strobing(mode: Mode): Layer {
  const layer = solid('strobe', WEIGHTS[mode]); layer.opacity = 0.5;
  layer.modulations.opacity = { kind: 'pulse', cycles: 10, phase: 0, amount: 1, points: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }] };
  return layer;
}
function hidden(n: number, mode: Mode): Layer[] { return Array.from({ length: n }, (_, i) => { const l = solid(`dark${i}`, WEIGHTS[mode]); l.opacity = 0; return l; }); }

function worstChanges(out: readonly number[], step: number): number {
  const turns: number[] = []; let anchor = out[0], way = 0;
  out.forEach((v, i) => {
    if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - step) { way = -1; anchor = v; turns.push(i); }
    else if (way <= 0 && v >= anchor + step) { way = 1; anchor = v; turns.push(i); }
  });
  let worst = 0;
  for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 60; k++) n++; worst = Math.max(worst, n); }
  return worst;
}
function opacityStep(mode: Mode): number {
  const r = new MeridianRenderer() as unknown as Probe, layer = solid('m', WEIGHTS[mode]);
  r.lightGrid.reset(W / H); r.loadLive(layer, layer.params); r.prepareEvolve(layer, 1, W, H, { live: false, structure: layer.params, duration: 2 }, r.sampleEntry); r.measureEntry(layer, r.sampleEntry, W, H, true); r.lightGrid.finish();
  const cells = Array.from(r.lightGrid.guarded.subarray(0, r.lightGrid.count)).sort((x, y) => y - x);
  return FLASH_STEP / cells[Math.floor(cells.length * 0.25)]; // The opacity change that moves a quarter of the frame by a flash step.
}

function exported(layers: Layer[]): number[] {
  const project = projectOf(layers), r = new MeridianRenderer(), runtime: MeridianRuntime = {}, out: number[] = [];
  for (let f = 0; f < 120; f++) { const phase = f / 120 * TAU; r.beginComposition(project, phase, W, H, 2, true, runtime); out.push(evaluateLayer(layers[0], phase).opacity * r.layerGain(layers[0])); }
  return [...out, ...out, ...out];
}
function live(layers: Layer[]): number[] {
  const project = projectOf(layers), r = new MeridianRenderer(), runtime: MeridianRuntime = {}, out: number[] = [], real = performance.now;
  let now = 1000; performance.now = () => now;
  try {
    for (let f = 0; f < 360; f++) { now += 1000 / 60; const phase = (f % 120) / 120 * TAU; r.beginComposition(project, phase, W, H, 2, false, runtime); out.push(evaluateLayer(layers[0], phase).opacity * r.layerGain(layers[0])); }
  } finally { performance.now = real; }
  return out;
}

for (const [name, play] of [['export', exported], ['live', live]] as const) {
  // A real live layer at these settings lights under a quarter of the grid, so its strobe is not a flash; tests/meridian-flash-grid.test.ts holds the live limit with exact rectangles.
  if (name === 'export') test(`N4 ${name}: 0 to 3 invisible layers never weaken the limit on a 33% strobe`, () => {
    const step = opacityStep(name);
    for (let n = 0; n <= 3; n++) {
      const changes = worstChanges(play([strobing(name), ...hidden(n, name)]), step);
      assert.ok(changes <= 6, `${n} invisible layers: ${changes} changes in the worst second`);
    }
  });
  test(`N4 ${name}: invisible layers in any position give the same limit`, () => {
    const a = strobing(name), dark = hidden(2, name), first = play([a, ...dark]), reordered = projectOf([dark[0], a, dark[1]]);
    const r = new MeridianRenderer(), runtime: MeridianRuntime = {}, second: number[] = [], real = performance.now; let now = 1000;
    performance.now = () => now;
    try {
      for (let f = 0; f < 360; f++) { now += 1000 / 60; const phase = (f % 120) / 120 * TAU; r.beginComposition(reordered, phase, W, H, 2, name === 'export', runtime); second.push(evaluateLayer(a, phase).opacity * r.layerGain(a)); }
    } finally { performance.now = real; }
    assert.deepEqual(second, first);
  });
}

const band = (x: number, width: number): DisplayList => { const list = new DisplayList(2); list.push(PRIMITIVE.segment, x - width / 2, 0, x + width / 2, 0, 1, -1, 0, 0, 1, 0, 0); return list; };
const placed = (level: number) => ({ aspect: 16 / 9, a: 1, b: 0, c: 0, d: 1, x: 0, y: 0, level, pixel: 1 / 360, minWidth: 1.5 });

test('N4: a dark layer adds nothing to the light grid', () => {
  const one = new LightGrid(), two = new LightGrid();
  one.reset(16 / 9); one.addLayer(band(-0.3, 0.6), placed(0.8), 0.2, true); one.finish();
  two.reset(16 / 9); two.addLayer(band(0.3, 1.6), placed(0), 1, true); two.addLayer(band(-0.3, 0.6), placed(0.8), 0.2, true); two.addLayer(band(0, 1.7), placed(0), 1, true); two.finish();
  assert.deepEqual(Array.from(two.guarded.subarray(0, two.count)), Array.from(one.guarded.subarray(0, one.count)));
  assert.deepEqual(Array.from(two.red.subarray(0, two.count)), Array.from(one.red.subarray(0, one.count)));
});

test('N4: layers add in the grid in any order, to the last bit', () => {
  const lists = [band(-0.4, 0.5), band(0.1, 0.7), band(0.3, 0.9)], levels = [0.31, 0.47, 0.73];
  const build = (order: number[]) => { const grid = new LightGrid(); grid.reset(16 / 9); for (const i of order) grid.addLayer(lists[i], placed(levels[i]), i / 3, true); grid.finish(); return [Array.from(grid.guarded.subarray(0, grid.count)), Array.from(grid.red.subarray(0, grid.count))]; };
  assert.deepEqual(build([2, 0, 1]), build([0, 1, 2]));
});
