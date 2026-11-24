import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';
import { FlashGuard } from '../src/meridian/flash-guard';
import { heldMoves } from '../src/meridian/held-moves';
import { PRIMITIVE } from '../src/meridian/types';
import type { DisplayList } from '../src/meridian/display-list';
import { MeridianRenderer, type MeridianRuntime } from '../src/rendering/MeridianRenderer';
import type { Layer, Project } from '../src/shared/types';

/**
 * Every judgement here is made by an independent picture: the test's own rectangles on its own 160x90 grid, lit by the
 * evaluated opacity and the gain the renderer chose. Nothing below reads the guard's measurement.
 */
const TAU = Math.PI * 2, W = 640, H = 360, ASPECT = W / H, COLS = 160, ROWS = 90, FRAMES = 120, STEP = 0.1, AREA = 0.25;
type Mode = 'live' | 'export';
interface Spec { rect: [number, number, number, number]; low?: number; high?: number; cycles?: number; half?: boolean; level?: number }
type Hooked = { prepareEvolve(l: Layer, p: number, w: number, h: number, r: MeridianRuntime | undefined, e: { list: DisplayList }): void; evolveView: Record<string, number> };

const FLAT = { structureZoom: 1, outputSafeMargin: 0, structureRotation: 0, structureEllipse: 0, structureTilt: 0, structureCentreX: 0, structureCentreY: 0, lightExposure: 1 };

function layerOf(spec: Spec, index: number, guard: number): Layer {
  const layer = createLayer('meridian'); layer.id = `g${index}`;
  Object.assign(layer.params, { scoreStyle: 2, safetyFlashGuard: guard }, FLAT);
  layer.blend = 'add'; layer.opacity = spec.level ?? 1;
  if (spec.cycles) layer.modulations.opacity = { kind: 'pulse', cycles: spec.cycles, phase: spec.half ? 0.5 : 0, amount: 1, points: [], range: { min: spec.low ?? 0, max: spec.high ?? 1 } } as never;
  return layer;
}

/** A renderer whose Evolve layers each draw one solid rectangle, so light and area are known exactly. */
function rig(specs: Spec[]): MeridianRenderer {
  const r = new MeridianRenderer(), hooked = r as unknown as Hooked, real = hooked.prepareEvolve.bind(r);
  hooked.prepareEvolve = (layer, phase, w, h, runtime, entry) => {
    real(layer, phase, w, h, runtime, entry);
    Object.assign(hooked.evolveView, FLAT);
    const spec = specs[Number(layer.id.slice(1))], [x, y, width, height] = spec.rect;
    entry.list.clear();
    entry.list.push(PRIMITIVE.segment, x - width / 2, y, x + width / 2, y, 1, -height, 0, 0, 1, 0, 0);
  };
  return r;
}

function picture(specs: Spec[], opacities: readonly number[], gain: number, out: Float32Array): void {
  out.fill(0);
  specs.forEach((spec, s) => {
    const [x, y, width, height] = spec.rect;
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const px = ((col + 0.5) / COLS - 0.5) * ASPECT, py = (row + 0.5) / ROWS - 0.5;
      if (Math.abs(px - x) <= width / 2 && Math.abs(py - y) <= height / 2) out[row * COLS + col] += opacities[s] * gain;
    }
  });
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i]);
}

/** Flashes in the worst second: pairs of opposing frames in which a quarter of the picture moved by a large amount. */
function judge(series: readonly Float32Array[]) {
  const anchor = Float32Array.from(series[0]), way = new Int8Array(COLS * ROWS), events: number[] = [], ups: number[] = [0], downs: number[] = [0];
  let step = 0, last = 0;
  series.forEach((v, f) => {
    if (!f) return;
    let up = 0, down = 0;
    for (let i = 0; i < v.length; i++) {
      step = Math.max(step, Math.abs(v[i] - series[f - 1][i]));
      if (way[i] === 1 && v[i] > anchor[i]) anchor[i] = v[i];
      if (way[i] === -1 && v[i] < anchor[i]) anchor[i] = v[i];
      if (way[i] >= 0 && v[i] <= anchor[i] - STEP && v[i] < 0.8) { way[i] = -1; anchor[i] = v[i]; down++; }
      else if (way[i] <= 0 && v[i] >= anchor[i] + STEP) { way[i] = 1; anchor[i] = v[i]; up++; }
    }
    ups.push(up); downs.push(down);
    // A transition may take a few frames to cross the picture. Two in the same direction with no opposite one between are not a pair.
    const near = (list: number[]) => list[f] + (list[f - 1] ?? 0) + (list[f - 2] ?? 0);
    const rose = near(ups) / v.length > AREA, fell = near(downs) / v.length > AREA;
    if (rose && fell) { if (!events.length || f - events[events.length - 1] >= 3) events.push(f); last = 0; }
    else if (rose && last !== 1) { events.push(f); last = 1; }
    else if (fell && last !== -1) { events.push(f); last = -1; }
  });
  let worst = 0;
  for (let i = 0; i < events.length; i++) { let n = 0; for (let k = i; k < events.length && events[k] < events[i] + 60; k++) n++; worst = Math.max(worst, n); }
  return { flashes: Math.ceil(worst / 2), changes: worst, step };
}

function play(mode: Mode, specs: Spec[], guard = 1, laps = 3) {
  const layers = specs.map((s, i) => layerOf(s, i, guard));
  const project: Project = { ...createProject(), layers, duration: 2, fps: { num: 60, den: 1 }, background: '#000000' };
  const r = rig(specs), runtime: MeridianRuntime = {}, series: Float32Array[] = [], gains: number[] = [], clock = performance.now;
  let now = 1000; performance.now = () => now;
  try {
    for (let f = 0; f < FRAMES * laps; f++) {
      now += 1000 / 60;
      const phase = (f % FRAMES) / FRAMES * TAU;
      r.beginComposition(project, phase, W, H, 2, mode === 'export', runtime);
      const gain = r.layerGain(layers[0]), frame = new Float32Array(COLS * ROWS);
      picture(specs, layers.map(l => evaluateLayer(l, phase).opacity), gain, frame);
      series.push(frame); gains.push(gain);
    }
  } finally { performance.now = clock; }
  return { ...judge(series), gains, low: Math.min(...gains) };
}

const left = (w: number): Spec['rect'] => [-ASPECT / 2 + w / 2, 0, w, 1];
const right = (w: number): Spec['rect'] => [ASPECT / 2 - w / 2, 0, w, 1];
const share = (s: number) => s * ASPECT; // A full-height strip covering this share of the frame.
const strips = (n: number, each: number): Spec[] => Array.from({ length: n }, (_, i) => ({ rect: [-ASPECT / 2 + share(each) / 2 + i * ASPECT / n, 0, share(each), 1], cycles: 10 }));

for (const mode of ['live', 'export'] as const) {
  test(`${mode}: anti-phase 40% layers in different places are limited`, () => {
    const specs: Spec[] = [{ rect: left(share(0.4)), cycles: 10 }, { rect: right(share(0.4)), cycles: 10, half: true }];
    assert.ok(play(mode, specs, 0).flashes >= 4, 'the unguarded picture must strobe');
    const on = play(mode, specs);
    assert.ok(on.flashes <= 3, `${on.flashes} flashes in a second`);
  });
  test(`${mode}: three 9% and four 7% layers in phase add up`, () => {
    for (const specs of [strips(3, 0.09), strips(4, 0.07)]) {
      assert.ok(play(mode, specs, 0).flashes >= 4, 'the unguarded picture must strobe');
      const on = play(mode, specs);
      assert.ok(on.flashes <= 3, `${specs.length} layers: ${on.flashes} flashes in a second`);
    }
  });
  test(`${mode}: the same layers stacked under 25% of the frame are not over the area`, () => {
    const specs: Spec[] = [0, 1, 2].map(() => ({ rect: [0, 0, share(0.09), 1], cycles: 10, low: 0, high: 0.33 }));
    const on = play(mode, specs);
    assert.ok(on.gains.every(g => g === 1), `lowest gain ${on.low}`);
  });
  test(`${mode}: a 33% layer swinging 0.4 to 0.7 over a steady full-frame layer is limited`, () => {
    const specs: Spec[] = [{ rect: [0, 0, ASPECT, 1], level: 0.2 }, { rect: left(share(0.33)), cycles: 10, low: 0.4, high: 0.7 }];
    assert.ok(play(mode, specs, 0).flashes >= 4, 'the unguarded picture must strobe');
    const on = play(mode, specs);
    assert.ok(on.flashes <= 3, `${on.flashes} flashes in a second`);
  });
  test(`${mode}: the guard adds no light change and no harder step`, () => {
    for (const specs of [[{ rect: [0, 0, ASPECT, 1], cycles: 10 }], strips(3, 0.09), [{ rect: left(share(0.4)), cycles: 6, low: 0.2, high: 0.9 }, { rect: right(share(0.4)), cycles: 14, low: 0.1, high: 0.6 }]] as Spec[][]) {
      const off = play(mode, specs, 0), on = play(mode, specs);
      assert.ok(on.changes <= off.changes, `changes ${off.changes} became ${on.changes}`);
      assert.ok(on.step <= off.step + 1e-3, `step ${off.step.toFixed(3)} became ${on.step.toFixed(3)}`);
    }
  });
  test(`${mode}: 0 to 3 invisible layers change nothing`, () => {
    const strobe: Spec = { rect: left(share(0.33)), cycles: 10 }, base = play(mode, [strobe]);
    assert.ok(base.flashes <= 3);
    for (let n = 1; n <= 3; n++) {
      const dark: Spec[] = Array.from({ length: n }, () => ({ rect: [0, 0, ASPECT, 1], level: 0 }));
      assert.deepEqual(play(mode, [strobe, ...dark]).gains, base.gains, `${n} invisible layers`);
    }
  });
  test(`${mode}: a change over a large area that is too small to see is left alone`, () => {
    const on = play(mode, [{ rect: [0, 0, ASPECT, 1], cycles: 10, low: 0.5, high: 0.57 }]);
    assert.ok(on.gains.every(g => g === 1), `lowest gain ${on.low}`);
  });
  test(`${mode}: a small strobe over a large steady layer does not dim it`, () => {
    const on = play(mode, [{ rect: [0, 0, ASPECT, 1], level: 0.5 }, { rect: [0, 0, share(0.08), 0.5], cycles: 10 }]);
    assert.ok(on.gains.every(g => g === 1), `lowest gain ${on.low}`);
  });
}

function realLayer(id: string, patch: Record<string, number>): Layer {
  const layer = createLayer('meridian'); layer.id = id;
  Object.assign(layer.params, { scoreStyle: 2 }, patch);
  return layer;
}

test('a calm two-layer composition at Density, Heat and Weight 1 keeps a gain of exactly 1 for 2,400 export frames', () => {
  const patch = { macroDensity: 1, macroHeat: 1, macroWeight: 1 };
  const a = realLayer('a', { ...patch, seed: 11 }), b = realLayer('b', { ...patch, seed: 29 }); b.blend = 'add';
  const project: Project = { ...createProject(), layers: [a, b], duration: 40, fps: { num: 60, den: 1 }, background: '#000000' };
  const r = new MeridianRenderer();
  let low = 1, dimmed = 0;
  for (let f = 0; f < 2400; f++) { r.beginComposition(project, f / 2400 * TAU, W, H, 40, true, {}); const g = Math.min(r.layerGain(a), r.layerGain(b)); low = Math.min(low, g); if (g !== 1) dimmed++; }
  assert.equal(dimmed, 0, `dimmed on ${dimmed} frames, lowest ${low}`);
});

test('max reaction: the guard adds no change of light and no harder step on a real Evolve layer', () => {
  const lit = (guard: number) => {
    const layer = realLayer('m', { macroDensity: 1, macroHeat: 1, macroWeight: 1, reactionBeat: 2, reactionBass: 2, reactionMids: 2, reactionHighs: 2, reactionAttack: 0, reactionRelease: 0, reactionTempoMultiplier: 4, rhythmAccent: 1, lightBloomAmount: 2, lightLineGlow: 2, lightExposure: 2, safetyFlashGuard: guard });
    const project: Project = { ...createProject(), layers: [layer], duration: 10, fps: { num: 60, den: 1 }, background: '#000000' };
    const r = new MeridianRenderer(), clock = performance.now, out: number[] = [], entries = (r as unknown as { evolveEntries: Map<string, { list: DisplayList }> }).evolveEntries;
    let now = 1000; performance.now = () => now;
    try {
      for (let f = 0; f < 1200; f++) {
        now += 1000 / 60;
        const t = f / 60, beat = (t * 2) % 1, kick = beat < 0.12 ? 1 : 0;
        const signals = { 'tempo.beat': Math.floor(t * 2), 'tempo.phase': beat, 'tempo.bpm': 120, 'beat.pulse': kick, 'audio.level': 0.4 + 0.6 * kick, 'audio.bass': kick, 'audio.mids': 0.6 * (1 - beat), 'audio.highs': (t * 8) % 1 < 0.2 ? 1 : 0 };
        heldMoves.set('m', 'moveBurst', f % 14 < 7 ? 1 : 0); heldMoves.set('m', 'moveDrop', f % 56 < 20 ? 1 : 0);
        r.beginComposition(project, (f % 600) / 600 * TAU, W, H, 10, false, { signals });
        const list = entries.get('m')!.list; let sum = 0;
        for (let i = 0; i < list.count; i++) sum += list.data[i * 12 + 9];
        out.push(sum / Math.max(1, list.count) * r.layerGain(layer));
      }
    } finally { performance.now = clock; heldMoves.clear('m'); }
    return out;
  };
  const measure = (v: number[]) => {
    let anchor = v[0], way = 0, step = 0; const turns: number[] = [];
    v.forEach((x, i) => { if (i) step = Math.max(step, Math.abs(x - v[i - 1])); if (way === 1 && x > anchor) anchor = x; if (way === -1 && x < anchor) anchor = x; if (way >= 0 && x <= anchor - STEP) { way = -1; anchor = x; turns.push(i); } else if (way <= 0 && x >= anchor + STEP) { way = 1; anchor = x; turns.push(i); } });
    let worst = 0; for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 60; k++) n++; worst = Math.max(worst, n); }
    return { worst, step };
  };
  const off = measure(lit(0)), on = measure(lit(1));
  assert.ok(on.worst <= off.worst, `changes ${off.worst} became ${on.worst}`);
  assert.ok(on.step <= off.step + 1e-3, `step ${off.step.toFixed(3)} became ${on.step.toFixed(3)}`);
});

test('every strobe rate from 3.3 to 15 Hz is limited at 30, 60 and 144 fps, and a slower pulse keeps a gain of exactly 1', () => {
  const on = { safetyFlashGuard: 1, safetyMaxFlashes: 3, safetyRedLimit: 0.5, safetyFullField: 0.5 };
  const run = (hz: number, fps: number) => {
    const guard = new FlashGuard(), out: number[] = [], times: number[] = [];
    let low = 1;
    for (let f = 1; f <= fps * 8; f++) { const t = f / fps, light = Math.sin(TAU * hz * t) >= 0 ? 0.9 : 0.1, gain = guard.update(1 / fps, light, 1, 0, on); low = Math.min(low, gain); out.push(light * gain); times.push(t); }
    let anchor = out[0], way = 0, worst = 0; const turns: number[] = [];
    out.forEach((v, i) => { if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v; if (way >= 0 && v <= anchor - STEP) { way = -1; anchor = v; turns.push(times[i]); } else if (way <= 0 && v >= anchor + STEP) { way = 1; anchor = v; turns.push(times[i]); } });
    for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 1; k++) n++; worst = Math.max(worst, n); }
    return { worst, low };
  };
  for (const fps of [30, 60, 144]) {
    for (const hz of [3.3, 4, 5, 6, 8, 10, 12, 15]) if (hz <= fps / 2.5) assert.ok(run(hz, fps).worst <= 6, `${hz} Hz at ${fps} fps: ${run(hz, fps).worst} changes`);
    for (const hz of [0.5, 1, 2, 2.5, 2.75]) assert.equal(run(hz, fps).low, 1, `${hz} Hz at ${fps} fps`);
  }
});
