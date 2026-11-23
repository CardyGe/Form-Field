import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Conductor, type ConductorFrame } from '../src/meridian/conductor';
import { DisplayList } from '../src/meridian/display-list';
import { FlashGuard, FLASH_STEP } from '../src/meridian/flash-guard';
import { HeldMoves } from '../src/meridian/held-moves';
import { MoveRouter } from '../src/meridian/moves';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { PRIMITIVE } from '../src/meridian/types';
import { createLayer } from '../src/core/project';
import { TempoClock } from '../src/react/tempo';

const DT = 1 / 60, on = { ...MERIDIAN_DEFAULTS }, idle = { next: false, hold: false, drop: false, collapse: false, burst: false };
const held = new HeldMoves();
const strobe = (f: number, hz = 5) => Math.floor(f * DT * hz * 2 + 1e-6) % 2 === 1;

function turnsPerSecond(out: readonly number[], wrap = false): number {
  const series = wrap ? [...out, ...out, ...out] : out, turns: number[] = []; let anchor = series[0], way = 0;
  series.forEach((v, i) => {
    if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - FLASH_STEP) { way = -1; anchor = v; turns.push(i); }
    else if (way <= 0 && v >= anchor + FLASH_STEP) { way = 1; anchor = v; turns.push(i); }
  });
  let worst = 0;
  for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 60; k++) n++; worst = Math.max(worst, n); }
  return worst;
}

test('C1: a strobe whose lit area rises with it, read one frame late, is still limited', () => {
  const guard = new FlashGuard(), out: number[] = [];
  let lastArea = 0.1;
  for (let f = 0; f < 600; f++) { const lit = strobe(f), light = lit ? 0.8 : 0.2; out.push(light * guard.update(DT, light, lastArea, 0, on)); lastArea = lit ? 0.4 : 0.1; }
  assert.ok(turnsPerSecond(out) <= 6, `${turnsPerSecond(out)} changes in a second`);
});

test('C2: layers are judged together, whatever their order', async () => {
  const { composeLight } = await import('../src/meridian/light-measure');
  const play = (order: number[]) => {
    const guard = new FlashGuard(), out: number[] = [], result = { light: 0, area: 0, red: 0 };
    for (let f = 0; f < 600; f++) {
      const level = strobe(f) ? 0.9 : 0.2, areas = order.map(() => 0.2), lights = order.map(() => level), reds = order.map(i => i * 0.5);
      composeLight(areas, lights, reds, order.length, result);
      out.push(result.light * guard.update(DT, result.light, result.area, result.red, on));
    }
    return out;
  };
  assert.ok(turnsPerSecond(play([0, 1])) <= 6);
  assert.deepEqual(play([0, 1]), play([1, 0]));
});

test('C2: lit area follows the layer placement and is clipped by the frame', async () => {
  const { measureList } = await import('../src/meridian/light-measure');
  const list = new DisplayList(8); list.push(PRIMITIVE.segment, -0.4, 0, 0.4, 0, 0, -0.05, 0, 0, 1, 0, 0);
  const place = (scale: number, x: number) => ({ aspect: 16 / 9, a: scale, b: 0, c: 0, d: scale, x, y: 0, level: 1 }), out = { area: 0, light: 0 };
  measureList(list, place(1, 0), out); const whole = out.area;
  measureList(list, place(0.5, 0), out); const half = out.area;
  measureList(list, place(1, 4), out); const gone = out.area;
  assert.ok(whole > 0 && Math.abs(half / whole - 0.25) < 0.05, `${whole} ${half}`); assert.equal(gone, 0);
});

test('I2: a linked Mutate lets go when its slider is moved, and clears on load', async () => {
  const { LinkedOverrides } = await import('../src/meridian/moves');
  const o = new LinkedOverrides(), base = { lightCore: 1, ringWeight: 2 }, live = { ...base };
  o.mutated(base, { lightCore: 1.4, ringWeight: 2 }); o.seed = 55;
  o.apply(base, live); assert.equal(live.lightCore, 1.4);
  const moved = { ...base, lightCore: 0.7 }, after = { ...moved }; o.apply(moved, after); assert.equal(after.lightCore, 0.7);
  const again = { ...base }; o.apply(base, again); assert.equal(again.lightCore, 1, 'the key stays released');
  o.mutated(base, { lightCore: 1.2, ringWeight: 2 }); o.clear(); const cleared = { ...base }; o.apply(base, cleared);
  assert.deepEqual([cleared.lightCore, o.seed], [1, null]);
  assert.ok(/resetMeridianPerformance/.test(readFileSync('src/ui/App.tsx', 'utf8')), 'loading a project clears performance state');
});

test('I3: one linked control fires one Recall or Mutate', () => {
  const router = new MoveRouter(), out = { ...idle }; let recalls = 0, mutates = 0;
  const up = Array.from({ length: 9 }, (_, i) => i), sweep = [...up, ...up.slice(0, -1).reverse()];
  for (const v of sweep) for (let i = 0; i < 4; i++) if (router.read(held, 'a', { moveRecall: v }, out).kind === 'recall') recalls++;
  assert.equal(recalls, 1);
  for (const v of [0, 0.52, 0.48, 0.53, 0.47, 0.55, 0.49, 0.51, 0.9, 0.48, 0.52]) if (router.read(held, 'a', { moveMutate: v }, out).kind === 'mutate') mutates++;
  assert.equal(mutates, 1);
  // A pad through link smoothing lands on its real slot, not on a value it passed.
  const pad = new MoveRouter(), fired: number[] = [];
  for (const v of [0, 0.7, 1.6, 2.4, 3, 3, 3, 3, 3]) { const e = pad.read(held, 'a', { moveRecall: v }, out); if (e.kind === 'recall') fired.push(e.slot); }
  assert.deepEqual(fired, [2]);
});

function clocked(real: number, reported: number, signalsExtra: Record<string, number> = {}, external = false): ConductorFrame {
  const c = new Conductor(), clock = new TempoClock(); clock.setSource('fixed'); clock.setBpm(real);
  let t = 0, f!: ConductorFrame;
  const go = (seconds: number) => { for (let i = 0; i < seconds * 60; i++) { t += DT; const k = clock.advance(t); f = c.update({ dt: DT, externalTempo: external, signals: { 'tempo.beat': k.beat, 'tempo.phase': k.phase, 'tempo.bpm': k.bpm, 'beat.pulse': (t * real / 60) % 1 < 0.1 ? 1 : 0, 'audio.level': 0.5, ...signalsExtra }, params: on } as never); } };
  go(10); clock.setBpm(reported); go(12);
  return f;
}

test('I4: a doubled tempo clamped to 240 still folds back', () => {
  for (const real of [128, 140]) assert.ok(Math.abs(clocked(real, 240).bpm - real) < 1, `${real}: ${clocked(real, 240).bpm}`);
});

test('I5: an external tempo is followed through sound with no onsets', () => {
  const c = new Conductor(), clock = new TempoClock(); clock.setSource('fixed'); clock.setBpm(132);
  let t = 0, f!: ConductorFrame;
  for (let i = 0; i < 900; i++) { t += DT; const k = clock.advance(t); f = c.update({ dt: DT, externalTempo: true, signals: { 'tempo.beat': k.beat, 'tempo.phase': k.phase, 'tempo.bpm': k.bpm, 'audio.level': 0.3, 'audio.bass': 0.2 }, params: on } as never); }
  assert.equal(f.status, 'locked'); assert.ok(Math.abs(f.bpm - 132) < 1, `${f.bpm}`);
});

test('I6: only an Evolve layer listens for music', async () => {
  const { listensToMusic } = await import('../src/meridian/panel') as unknown as { listensToMusic: (l: unknown) => boolean };
  const layer = createLayer('meridian');
  assert.equal(listensToMusic(layer), true);
  assert.equal(listensToMusic({ ...layer, params: { ...layer.params, scoreStyle: 0 } }), false);
  assert.equal(listensToMusic({ ...layer, visible: false }), false);
  assert.equal(listensToMusic(createLayer('surface')), false);
  assert.ok(/listensToMusic/.test(readFileSync('src/ui/App.tsx', 'utf8')));
});

test('I7: the live music path allocates no closures or input objects per frame', () => {
  const conductor = readFileSync('src/meridian/conductor.ts', 'utf8'), renderer = readFileSync('src/rendering/MeridianRenderer.ts', 'utf8');
  assert.ok(!/const envelope = \(/.test(conductor));
  assert.ok(!/conductor\.update\(\{/.test(renderer));
  assert.ok(!/router\.read\(key =>/.test(renderer));
  assert.ok(!/Object\.assign\(live, performer\.mutated\)/.test(renderer));
});

test('I8: the export table limits a strobe across the loop point, in any read order', async () => {
  const { guardLoopTable } = await import('../src/meridian/flash-guard') as unknown as { guardLoopTable: (sample: (f: number, out: { light: number; area: number; red: number }) => void, frames: number, fps: number, p: Record<string, number>) => Float32Array };
  const light = (f: number) => (strobe(f) ? 0.9 : 0.15), sample = (f: number, out: { light: number; area: number; red: number }) => { out.light = light(f); out.area = 0.6; out.red = 0; };
  for (const frames of [120, 130, 97]) {
    const table = guardLoopTable(sample, frames, 60, on), out = Array.from(table, (g, f) => g * light(f));
    assert.ok(turnsPerSecond(out, true) <= 6, `${frames} frames: ${turnsPerSecond(out, true)}`);
    assert.deepEqual(Array.from(guardLoopTable(sample, frames, 60, on)), Array.from(table));
    assert.ok(Math.max(...out) > 0.5, `${frames} frames: the guarded loop must keep some of its light, not flatten to the floor`);
  }
  const calm = guardLoopTable((f, out) => { out.light = 0.3 + 0.01 * Math.sin(f / 9); out.area = 0.9; out.red = 0; }, 120, 60, on);
  assert.ok(calm.every(g => g === 1));
  const slow = guardLoopTable((f, out) => { out.light = strobe(f, 2) ? 0.9 : 0.2; out.area = 0.9; out.red = 0; }, 120, 60, on);
  assert.ok(slow.every(g => g === 1), 'a 2 Hz pulse is unchanged');
  const off = guardLoopTable(sample, 120, 60, { ...on, safetyFlashGuard: 0 });
  assert.ok(off.every(g => g === 1));
});

test('I8: the renderer guards exports and Motion-driven light from a composition budget', () => {
  const renderer = readFileSync('src/rendering/MeridianRenderer.ts', 'utf8'), studio = readFileSync('src/rendering/StudioRenderer.ts', 'utf8');
  assert.ok(/guardLoopTable\(/.test(renderer)); assert.ok(/beginComposition\(/.test(studio)); assert.ok(/layerGain\(/.test(studio));
  assert.equal((renderer.match(/new FlashGuard\(/g) ?? []).length, 1, 'one budget for the composition');
});
