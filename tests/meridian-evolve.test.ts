import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLayer, createProject, PRESETS, validateProject } from '../src/core/project';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, createEvolveClock, createEvolveTransport, evaluateEvolve, EVOLVE_ELEMENTS, exactEvolveClock, GLITCH_SHARDS, SCORE_STYLE_EVOLVE, type EvolveMoves, type EvolveTransport } from '../src/meridian/evolve';
import { MACRO_KEYS, MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { SCORE_STYLE_DENSE, SCORE_STYLE_PULSE } from '../src/meridian/pulse';
import { PRIMITIVE } from '../src/meridian/types';

const SEEDS = [1729, 2, 77, 4096, 31337, 900001, 12345, 555];
const FPS = 60, DT = 1 / FPS, LOOP = 60;
const MAX_MOVE = 0.012, MAX_ALPHA = 0.08;
const idle: EvolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };
const params = (extra: Record<string, number> = {}) => ({ ...MERIDIAN_DEFAULTS, ...extra });
const phaseAt = (t: number) => (t / LOOP) * Math.PI * 2;

/** Both ends of an element, in frame heights. Arcs are followed by their ends, so a turning arc is tracked honestly. */
function ends(d: Float32Array, at: number, out: Float64Array): void {
  const kind = d[at];
  if (kind === PRIMITIVE.arc) {
    const r = d[at + 3], a = d[at + 4], b = a + d[at + 5];
    out[0] = d[at + 1] + Math.cos(a) * r; out[1] = d[at + 2] + Math.sin(a) * r; out[2] = d[at + 1] + Math.cos(b) * r; out[3] = d[at + 2] + Math.sin(b) * r;
  } else if (kind === PRIMITIVE.segment) { out[0] = d[at + 1]; out[1] = d[at + 2]; out[2] = d[at + 3]; out[3] = d[at + 4]; }
  else { const r = kind === PRIMITIVE.ring ? d[at + 3] : 0; out[0] = d[at + 1] + r; out[1] = d[at + 2]; out[2] = d[at + 1] - r; out[3] = d[at + 2]; }
}

class Watch {
  private last: Float32Array | null = null;
  maxMove = 0; maxAlpha = 0; minDrawn = Infinity; maxEnergyStep = 0; private energy = 0;
  private readonly a = new Float64Array(4); private readonly b = new Float64Array(4);
  see(list: DisplayList): void {
    const d = list.data;
    let drawn = 0, energy = 0;
    for (let i = 0; i < list.count; i++) {
      const at = i * STRIDE, alpha = d[at + 9];
      if (alpha > 0.04) { drawn++; const k = d[at]; energy += alpha * (k === PRIMITIVE.ring ? Math.PI * 2 * d[at + 3] : k === PRIMITIVE.arc ? d[at + 3] * d[at + 5] : k === PRIMITIVE.segment ? Math.hypot(d[at + 3] - d[at + 1], d[at + 4] - d[at + 2]) : 0.01) * Math.abs(d[at + 6] || 0.001); }
      if (this.last && i * STRIDE < this.last.length) {
        const p = this.last, seen = Math.max(alpha, p[at + 9]);
        this.maxAlpha = Math.max(this.maxAlpha, Math.abs(alpha - p[at + 9]));
        if (seen > 0.04) { ends(p, at, this.a); ends(d, at, this.b); this.maxMove = Math.max(this.maxMove, Math.hypot(this.a[0] - this.b[0], this.a[1] - this.b[1]), Math.hypot(this.a[2] - this.b[2], this.a[3] - this.b[3])); }
      }
    }
    this.minDrawn = Math.min(this.minDrawn, drawn);
    if (this.last) this.maxEnergyStep = Math.max(this.maxEnergyStep, Math.abs(energy - this.energy) / Math.max(this.energy, 1e-6));
    this.energy = energy;
    this.last = d.slice(0, list.count * STRIDE);
  }
}

function run(seed: number, seconds: number, p: Record<string, number>, frame: (f: number) => { params?: Record<string, number>; moves?: EvolveMoves } | void, watch: Watch, start = 0): EvolveTransport {
  const transport = createEvolveTransport(), list = new DisplayList(2000), view: Record<string, number> = {};
  let current = p;
  advanceEvolve(transport, phaseAt(start), LOOP, 0, seed, current, idle);
  const frames = Math.round(seconds * FPS);
  for (let f = 1; f <= frames; f++) {
    const step = frame(f) ?? {};
    if (step.params) current = step.params;
    const clock = advanceEvolve(transport, phaseAt(start + f * DT), LOOP, DT, seed, current, step.moves ?? idle);
    Object.assign(view, current, transport.values);
    evaluateEvolve(seed, clock, view, list);
    watch.see(list);
  }
  return transport;
}

test('Evolve is the default for a new layer, and saved layers keep their style', () => {
  assert.equal(createLayer('meridian').params.scoreStyle, SCORE_STYLE_EVOLVE);
  for (const style of [SCORE_STYLE_PULSE, SCORE_STYLE_DENSE]) {
    const saved = createLayer('meridian'); saved.params.scoreStyle = style;
    assert.equal(validateProject({ ...createProject(), layers: [saved] }).layers[0].params.scoreStyle, style);
  }
  const old = createLayer('meridian'); delete old.params.scoreStyle; delete old.params.scoreEvolution; delete old.params.scoreHoldShape;
  assert.equal(validateProject({ ...createProject(), layers: [old] }).layers[0].params.scoreStyle, SCORE_STYLE_DENSE);
});

test('an exact frame depends only on seed, params and time, in any order', () => {
  const draw = (phase: number, seed = 1729) => { const list = new DisplayList(2000); evaluateEvolve(seed, exactEvolveClock(phase, 60, params(), createEvolveClock()), params(), list); return Array.from(list.data.subarray(0, list.count * STRIDE)); };
  const first = draw(2.2); draw(5.1); draw(0.4, 99); draw(3.3);
  assert.deepEqual(draw(2.2), first);
});

test('ten minutes at 60 fps never empties, cuts, jumps or flashes, on eight seeds', () => {
  for (const seed of SEEDS) {
    const watch = new Watch();
    run(seed, 600, params(), () => undefined, watch);
    assert.ok(watch.minDrawn >= 5, `seed ${seed}: ${watch.minDrawn} drawn`);
    assert.ok(watch.maxMove <= MAX_MOVE, `seed ${seed}: moved ${watch.maxMove}`);
    assert.ok(watch.maxAlpha <= MAX_ALPHA, `seed ${seed}: alpha step ${watch.maxAlpha}`);
    assert.ok(watch.maxEnergyStep < 0.12, `seed ${seed}: light step ${watch.maxEnergyStep}`);
  }
});

test('structures 30, 60 and 120 seconds apart differ', () => {
  for (const seed of SEEDS) {
    const transport = createEvolveTransport(), p = params(), lists = new Map<number, Float32Array>(), list = new DisplayList(2000), view: Record<string, number> = {};
    advanceEvolve(transport, 0, LOOP, 0, seed, p, idle);
    for (let f = 1; f <= 420 * 10; f++) {
      const clock = advanceEvolve(transport, phaseAt(f / 10), LOOP, 0.1, seed, p, idle);
      if (f % 300 === 0) { Object.assign(view, p, transport.values); evaluateEvolve(seed, clock, view, list); lists.set(f / 10, list.data.slice(0, list.count * STRIDE)); }
    }
    for (const gap of [30, 60, 120]) for (const [t, a] of lists) {
      const b = lists.get(t + gap);
      if (!b) continue;
      let change = 0;
      for (let i = 0; i < a.length; i += STRIDE) if (Math.max(a[i + 9], b[i + 9]) > 0.1) change += Math.abs(a[i + 3] - b[i + 3]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      assert.ok(change > 0.05, `seed ${seed}, ${t}s and ${t + gap}s are alike (${change})`);
    }
  }
});

test('moving any macro across its range in one second causes no jump', () => {
  for (const key of MACRO_KEYS) for (const [from, to] of [[0, 1], [1, 0]]) {
    const watch = new Watch(), base = params({ [key]: from });
    run(1729, 8, base, f => ({ params: { ...base, [key]: from + (to - from) * Math.min(1, f / FPS) } }), watch, 30);
    assert.ok(watch.maxMove <= MAX_MOVE, `${key} ${from}->${to}: moved ${watch.maxMove}`);
    assert.ok(watch.maxAlpha <= MAX_ALPHA, `${key} ${from}->${to}: alpha ${watch.maxAlpha}`);
  }
});

test('glitch is exactly absent at or below the centre', () => {
  for (const glitch of [0, 0.25, 0.5]) {
    const clock = exactEvolveClock(2, 60, params(), createEvolveClock()), a = new DisplayList(2000), b = new DisplayList(2000);
    evaluateEvolve(1729, clock, params({ macroGlitch: glitch }), a); evaluateEvolve(1729, clock, params({ macroGlitch: 0.5 }), b);
    assert.equal(a.count, EVOLVE_ELEMENTS);
    assert.deepEqual(Array.from(a.data.subarray(0, a.count * STRIDE)), Array.from(b.data.subarray(0, b.count * STRIDE)));
  }
  const high = new DisplayList(2000);
  evaluateEvolve(1729, exactEvolveClock(2, 60, params(), createEvolveClock()), params({ macroGlitch: 0.8 }), high);
  assert.equal(high.count, EVOLVE_ELEMENTS + GLITCH_SHARDS);
});

test('an export closes: the last frame flows into the first as a picture', () => {
  // The closing turn maps the home form onto itself, so voices may have swapped places. Compare the sets of marks.
  const marks = (phase: number, duration: number, p: Record<string, number>) => {
    const list = new DisplayList(2000); evaluateEvolve(1729, exactEvolveClock(phase, duration, p, createEvolveClock()), p, list);
    const out: string[] = [], d = list.data, e = new Float64Array(4);
    for (let i = 0; i < list.count; i++) {
      const at = i * STRIDE;
      if (d[at + 9] < 0.03 || (d[at] === PRIMITIVE.arc && d[at + 5] < 1e-3)) continue;
      if (d[at] === PRIMITIVE.arc) { out.push(`arc ${d[at + 3].toFixed(3)}`); continue; }
      ends(d, at, e);
      const pair = [`${e[0].toFixed(2)},${e[1].toFixed(2)}`, `${e[2].toFixed(2)},${e[3].toFixed(2)}`].sort().join(' ');
      out.push(`${d[at]} ${pair}`.replaceAll('-0.00', '0.00'));
    }
    return out.sort();
  };
  for (const duration of [10, 20, 60, 137]) for (const extra of [{}, { macroOrder: 1 }, { macroDensity: 1 }, { macroDensity: 0.1 }, { macroSpeed: 1 }] as Record<string, number>[]) {
    const p = params(extra);
    assert.deepEqual(marks(Math.PI * 2 - 1e-7, duration, p), marks(0, duration, p), `${duration}s ${JSON.stringify(extra)}`);
  }
});

test('an export never jumps either, even a short one at full Evolution', () => {
  for (const duration of [10, 20, 60]) for (const scoreEvolution of [0.5, 1]) {
    const p = params({ scoreEvolution }), watch = new Watch(), list = new DisplayList(2000), clock = createEvolveClock(), frames = duration * FPS;
    for (const seed of SEEDS) { const each = new Watch(); for (let f = 0; f < frames; f++) { evaluateEvolve(seed, exactEvolveClock(f / frames * Math.PI * 2, duration, p, clock), p, list); each.see(list); } watch.maxMove = Math.max(watch.maxMove, each.maxMove); watch.maxAlpha = Math.max(watch.maxAlpha, each.maxAlpha); }
    assert.ok(watch.maxMove <= MAX_MOVE, `${duration}s at ${scoreEvolution}: moved ${watch.maxMove}`);
    assert.ok(watch.maxAlpha <= MAX_ALPHA, `${duration}s at ${scoreEvolution}: alpha ${watch.maxAlpha}`);
  }
});

test('full Evolution stays free of jumps over a long run', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    const watch = new Watch();
    run(seed, 180, params({ scoreEvolution: 1 }), () => undefined, watch);
    assert.ok(watch.maxMove <= MAX_MOVE, `seed ${seed}: moved ${watch.maxMove}`);
    assert.ok(watch.maxAlpha <= MAX_ALPHA, `seed ${seed}: alpha ${watch.maxAlpha}`);
  }
});

test('every pad shapes the picture without a cut', () => {
  for (const key of ['next', 'hold', 'drop', 'collapse', 'burst'] as const) {
    const watch = new Watch(), list = run(1729, 24, params(), f => ({ moves: { ...idle, [key]: f > 120 && f < 300 } }), watch, 20);
    assert.ok(list, key);
    assert.ok(watch.minDrawn >= 5, `${key}: ${watch.minDrawn} drawn`);
    assert.ok(watch.maxMove <= MAX_MOVE, `${key}: moved ${watch.maxMove}`);
    assert.ok(watch.maxAlpha <= MAX_ALPHA, `${key}: alpha ${watch.maxAlpha}`);
  }
});

test('a new seed glides into place', () => {
  const transport = createEvolveTransport(), watch = new Watch(), list = new DisplayList(2000), p = params(), view: Record<string, number> = {};
  advanceEvolve(transport, 0, LOOP, 0, 1729, p, idle);
  for (let f = 1; f <= 1200; f++) {
    const seed = f < 300 ? 1729 : 4242;
    const clock = advanceEvolve(transport, phaseAt(f * DT), LOOP, DT, seed, p, idle);
    Object.assign(view, p, transport.values); evaluateEvolve(seed, clock, view, list); watch.see(list);
  }
  assert.ok(watch.maxMove <= MAX_MOVE, `moved ${watch.maxMove}`);
  assert.ok(watch.maxAlpha <= MAX_ALPHA, `alpha ${watch.maxAlpha}`);
});

test('Hold shape keeps the form while it goes on turning', () => {
  const transport = createEvolveTransport(), p = params({ scoreHoldShape: 1 });
  advanceEvolve(transport, 0, LOOP, 0, 1729, p, idle);
  for (let f = 1; f <= 600; f++) advanceEvolve(transport, phaseAt(f * DT), LOOP, DT, 1729, p, idle);
  const settled = transport.clock.evolution, motion = transport.clock.motion;
  for (let f = 601; f <= 1800; f++) advanceEvolve(transport, phaseAt(f * DT), LOOP, DT, 1729, p, idle);
  assert.equal(transport.clock.evolution, settled);
  assert.ok(transport.clock.motion > motion + 10);
});

test('the evaluator has no allocating syntax in its hot path', () => {
  const source = readFileSync(new URL('../src/meridian/evolve.ts', import.meta.url), 'utf8');
  const hot = source.slice(source.indexOf('// HOT PATH'));
  assert.ok(!/new (Float|Uint|Array|Map|Set)|\.map\(|\.filter\(|\.slice\(|\[\.\.\./.test(hot));
  assert.ok(!/from 'three'|from 'react'|document\.|window\./.test(source));
});

test('the library leads with Evolve looks', () => {
  const looks = PRESETS.filter(p => p.kind === 'meridian');
  assert.ok(looks.slice(0, 10).every(p => p.params.scoreStyle === SCORE_STYLE_EVOLVE), 'first ten are Evolve');
});
