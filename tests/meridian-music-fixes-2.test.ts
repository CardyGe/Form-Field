import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject } from '../src/core/project';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, createEvolveTransport, evaluateEvolve, type EvolveMoves } from '../src/meridian/evolve';
import { FlashGuard, FLASH_STEP, guardLoopTable } from '../src/meridian/flash-guard';
import { HeldMoves } from '../src/meridian/held-moves';
import { MoveRouter } from '../src/meridian/moves';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { smooth } from '../src/react/links';
import { MeridianRenderer, type MeridianRuntime } from '../src/rendering/MeridianRenderer';
import { PRIMITIVE } from '../src/meridian/types';
import type { Layer, Project } from '../src/shared/types';

const DT = 1 / 60, on = { ...MERIDIAN_DEFAULTS }, idle: EvolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };

function defaultList(seed: number, aspect: number, evolution: number): Float32Array {
  const transport = createEvolveTransport(), list = new DisplayList(2000), p = { ...MERIDIAN_DEFAULTS };
  transport.clock.aspect = aspect;
  const clock = advanceEvolve(transport, 0, 60, 0, seed, p, idle);
  clock.evolution = evolution;
  evaluateEvolve(seed, clock, { ...p, ...transport.values }, list);
  return list.data.slice(0, list.count * STRIDE);
}

test('N1: a preview rounded by a pixel draws exactly the 16:9 picture', () => {
  for (const [w, h] of [[641, 361], [643, 362], [1000, 563], [1279, 720]]) for (const seed of [1729, 2, 77]) for (const t of [0, 40, 130])
    assert.deepEqual(defaultList(seed, w / h, t), defaultList(seed, 16 / 9, t), `${w}x${h} seed ${seed} at ${t}`);
});

test('N1: default Scale is unchanged at other shapes wherever the picture is already visible', () => {
  for (const aspect of [16 / 10, 1, 9 / 16]) for (let seed = 1; seed <= 12; seed++) for (let t = 0; t < 400; t += 37)
    assert.deepEqual(defaultList(seed, aspect, t), defaultList(seed, 16 / 9, t), `${aspect.toFixed(2)} seed ${seed} at ${t}`);
});

test('N1: narrow framing engages inside the autonomous move limit and keeps the picture on screen', () => {
  const seen = (d: Float32Array, at: number, aspect: number) => {
    const kind = d[at], segment = kind === PRIMITIVE.segment, r = Math.abs(d[at + 3]), start = kind === PRIMITIVE.arc ? d[at + 4] : 0, sweep = kind === PRIMITIVE.arc ? d[at + 5] : Math.PI * 2;
    const size = segment ? Math.hypot(d[at + 3] - d[at + 1], d[at + 4] - d[at + 2]) : r * sweep; let inside = 0;
    for (let s = 0; s < 32; s++) { const t = (s + 0.5) / 32, x = segment ? d[at + 1] + (d[at + 3] - d[at + 1]) * t : d[at + 1] + Math.cos(start + sweep * t) * r, y = segment ? d[at + 2] + (d[at + 4] - d[at + 2]) * t : d[at + 2] + Math.sin(start + sweep * t) * r; if (Math.abs(x) <= aspect / 2 && Math.abs(y) <= 0.5) inside++; }
    return size * inside / 32;
  };
  for (const aspect of [1, 9 / 16]) for (const macroDensity of [0, 0.5]) for (const seed of [1, 3, 5, 7]) {
    const p = { ...MERIDIAN_DEFAULTS, macroDensity }, t = createEvolveTransport(), l = new DisplayList(2000); t.clock.aspect = aspect;
    let last: Float32Array | null = null, worst = 0, fewest = Infinity;
    for (let f = 0; f < 60 * 200; f++) {
      const c = advanceEvolve(t, ((f / 60) % 60) / 60 * Math.PI * 2, 60, f ? DT : 0, seed, p, idle); evaluateEvolve(seed, c, { ...p, ...t.values }, l);
      const d = l.data.slice(0, l.count * STRIDE); let marks = 0;
      for (let i = 0; i < l.count; i++) {
        const at = i * STRIDE;
        if (last && Math.max(d[at + 9], last[at + 9]) >= 0.05) worst = Math.max(worst, Math.abs(d[at + 1] - last[at + 1]), Math.abs(d[at + 2] - last[at + 2]));
        if (f % 6 === 0 && d[at] !== PRIMITIVE.dot && d[at + 9] >= 0.05 && seen(d, at, aspect) >= 0.008) marks++;
      }
      if (f % 6 === 0) fewest = Math.min(fewest, marks);
      last = d;
    }
    assert.ok(worst <= 0.012, `${aspect.toFixed(2)} density ${macroDensity} seed ${seed}: moved ${worst.toFixed(4)}`);
    assert.ok(fewest >= 5, `${aspect.toFixed(2)} density ${macroDensity} seed ${seed}: ${fewest} marks`);
  }
});

function heavy(id: string, extra: Record<string, number> = {}): Layer {
  const layer = createLayer('meridian'); layer.id = id;
  Object.assign(layer.params, { scoreStyle: 2, macroDensity: 1, macroHeat: 1, ringWeight: 14, spokeWeight: 14, ...extra });
  return layer;
}
function tiny(id: string): Layer {
  const layer = createLayer('meridian'); layer.id = id; layer.opacity = 0.5; // With the pulse, this layer swings fully between dark and lit.
  Object.assign(layer.params, { scoreStyle: 2, macroDensity: 0, macroScale: 0, seed: 5 });
  layer.modulations.opacity = { kind: 'pulse', cycles: 10, phase: 0, amount: 1, points: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }] };
  return layer;
}
function gains(layers: Layer[], watch: string): number[] {
  const project: Project = { ...createProject(), layers, duration: 2, fps: { num: 60, den: 1 }, background: '#000000' };
  const renderer = new MeridianRenderer(), runtime: MeridianRuntime = {}, out: number[] = [], layer = layers.find(l => l.id === watch)!;
  for (let f = 0; f < 120; f++) { renderer.beginComposition(project, f / 120 * Math.PI * 2, 640, 360, 2, true, runtime); out.push(renderer.layerGain(layer)); }
  return out;
}

test('N2: a tiny pulsing layer does not dim a steady layer, in either order', () => {
  const alone = gains([heavy('steady')], 'steady');
  assert.ok(alone.every(g => g === 1), 'the steady layer alone is never dimmed');
  const first = gains([heavy('steady'), tiny('pulse')], 'steady'), second = gains([tiny('pulse'), heavy('steady')], 'steady');
  assert.equal(first.filter(g => g < 0.98).length, 0, `dimmed to ${Math.min(...first)}`);
  assert.deepEqual(first, second);
});

function stepsThrough(hz: number) {
  const guard = new FlashGuard(), lights: number[] = [], out: number[] = [];
  for (let f = 0; f < 900; f++) { const light = 0.5 + 0.42 * Math.sin(f * DT * hz * Math.PI * 2); lights.push(light); out.push(light * guard.update(DT, light, 0.8, 0, on)); }
  const biggest = (a: number[]) => a.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - a[i])), 0);
  return { input: biggest(lights), output: biggest(out), out };
}
function worstTurns(out: readonly number[]): number {
  const turns: number[] = []; let anchor = out[0], way = 0;
  out.forEach((v, i) => {
    if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - FLASH_STEP) { way = -1; anchor = v; turns.push(i); }
    else if (way <= 0 && v >= anchor + FLASH_STEP) { way = 1; anchor = v; turns.push(i); }
  });
  let worst = 0;
  for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 60; k++) n++; worst = Math.max(worst, n); }
  return worst;
}

test('N3: limiting a smooth swell never makes a harder step or an extra flash', () => {
  for (const hz of [2, 4, 5, 8]) {
    const { input, output, out } = stepsThrough(hz);
    assert.ok(output <= input + 1e-6, `${hz} Hz: step ${input.toFixed(3)} became ${output.toFixed(3)}`);
    assert.ok(worstTurns(out) <= 6, `${hz} Hz: ${worstTurns(out)} changes in a second`);
  }
});

test('N3: the export table is just as smooth, across the loop point', () => {
  for (const frames of [120, 130, 97]) for (const cycles of [8, 10, 16]) {
    const light = (f: number) => 0.5 + 0.42 * Math.sin(f / frames * cycles * Math.PI * 2);
    const table = guardLoopTable((f, o) => { o.light = light(f); o.area = 0.8; o.red = 0; }, frames, 60, on), out = Array.from(table, (g, f) => g * light(f));
    let input = 0, output = 0;
    for (let f = 0; f < frames; f++) { input = Math.max(input, Math.abs(light((f + 1) % frames) - light(f))); output = Math.max(output, Math.abs(out[(f + 1) % frames] - out[f])); }
    assert.ok(output <= input + 1e-3, `${frames}f ${cycles}c: step ${input.toFixed(3)} became ${output.toFixed(3)}`);
    assert.ok(worstTurns([...out, ...out, ...out]) <= 6, `${frames}f ${cycles}c`);
  }
});

test('I3: a pad on Recall N fires N once through any link smoothing', () => {
  const held = new HeldMoves(), out = { ...idle };
  for (const target of [1, 3, 8]) for (const attack of [0, 20, 40, 80, 150, 250, 1000]) for (const fps of [60, 120]) {
    const router = new MoveRouter(), fired: number[] = [];
    let value = 0;
    const play = (to: number, seconds: number, tau: number) => { for (let f = 0; f < seconds * fps; f++) { value = smooth(value, to, 1 / fps, tau, 200); const e = router.read(held, 'a', { moveRecall: value }, out); if (e.kind === 'recall') fired.push(e.slot + 1); } };
    play(target, Math.max(1, attack / 1000 * 12), attack); play(0, 2, attack);
    assert.deepEqual(fired, [target], `slot ${target}, ${attack} ms, ${fps} fps`);
  }
});

test('I3: a sweep or a jittering control does not fire repeatedly', () => {
  const held = new HeldMoves(), out = { ...idle }, router = new MoveRouter(); let fired = 0;
  for (let f = 0; f < 480; f++) { const v = 4 + 4 * Math.sin(f / 480 * Math.PI * 2 - Math.PI / 2); if (router.read(held, 'a', { moveRecall: v }, out).kind === 'recall') fired++; }
  assert.ok(fired <= 1, `sweep fired ${fired}`);
  const jitter = new MoveRouter(); fired = 0;
  for (let f = 0; f < 600; f++) if (jitter.read(held, 'a', { moveRecall: 3 + 0.3 * Math.sin(f * 2.3) }, out).kind === 'recall') fired++;
  assert.ok(fired <= 1, `jitter fired ${fired}`);
});
