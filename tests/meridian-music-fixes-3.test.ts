import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';
import { FLASH_STEP } from '../src/meridian/flash-guard';
import { composeLight } from '../src/meridian/light-measure';
import { MeridianRenderer, type MeridianRuntime } from '../src/rendering/MeridianRenderer';
import type { Layer, Project } from '../src/shared/types';

const TAU = Math.PI * 2, W = 640, H = 360;
type Probe = { loadLive(l: Layer, s: Record<string, number>): void; prepareEvolve(l: Layer, p: number, w: number, h: number, r: MeridianRuntime, e: unknown): void; measureEntry(l: Layer, e: unknown, w: number, h: number): void; sampleEntry: { area: number; light: number } };

const projectOf = (layers: Layer[]): Project => ({ ...createProject(), layers, duration: 2, fps: { num: 60, den: 1 }, background: '#000000' });

function solid(id: string, weight: number): Layer {
  const layer = createLayer('meridian'); layer.id = id;
  Object.assign(layer.params, { scoreStyle: 2, macroDensity: 1, macroHeat: 1, ringWeight: weight, spokeWeight: weight });
  return layer;
}
type Mode = 'export' | 'live';
/** One layer's area and light on the path under test, at full opacity. */
function measure(layer: Layer, mode: Mode): { area: number; light: number } {
  const r = new MeridianRenderer() as unknown as Probe & { beginComposition: MeridianRenderer['beginComposition']; evolveEntries: Map<string, { area: number; light: number }> };
  if (mode === 'live') {
    const project = projectOf([layer]), real = performance.now; let now = 1000; performance.now = () => now;
    try { for (let f = 0; f < 3; f++) { now += 1000 / 60; r.beginComposition(project, f / 120 * TAU, W, H, 2, false, {}); } } finally { performance.now = real; }
    const entry = r.evolveEntries.get(layer.id)!;
    return { area: entry.area, light: entry.light };
  }
  r.loadLive(layer, layer.params); r.prepareEvolve(layer, 1, W, H, { live: false, structure: layer.params, duration: 2 }, r.sampleEntry); r.measureEntry(layer, r.sampleEntry, W, H);
  return { area: r.sampleEntry.area, light: r.sampleEntry.light };
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
/** A change of light over the flash area, expressed in this layer's opacity. */
function opacityStep(mode: Mode): number {
  const m = measure(solid('m', WEIGHTS[mode]), mode), out = { light: 0, area: 0, red: 0 };
  composeLight([m.area], [m.light], [0], 1, out);
  return FLASH_STEP / out.light;
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
  test(`N4 ${name}: 0 to 3 invisible layers never weaken the limit on a 33% strobe`, () => {
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

test('N4: a dark layer adds nothing to the composed light, area or red', () => {
  const one = { light: 0, area: 0, red: 0 }, two = { light: 0, area: 0, red: 0 };
  composeLight([0.33], [0.8], [0.2], 1, one);
  composeLight([0.33, 0.9, 0.9], [0.8, 0, 0], [0.2, 1, 1], 3, two);
  assert.deepEqual(two, one);
});

test('N4: a change over less than the flash area is not a flash, and layers that add up to one are', () => {
  const light = (areas: number[], level: number) => { const out = { light: 0, area: 0, red: 0 }; composeLight(areas, areas.map(() => level), areas.map(() => 0), areas.length, out); return out.light; };
  assert.ok(light([0.05], 0.9) - light([0.05], 0) < FLASH_STEP, 'a 5% layer');
  assert.ok(light([0.2, 0.2], 0.9) - light([0.2, 0.2], 0) >= FLASH_STEP, 'two 20% layers');
  assert.ok(light([1], 1) - light([1], 0.5) >= FLASH_STEP, 'a full frame halving is still a change');
});
