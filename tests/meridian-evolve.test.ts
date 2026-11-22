import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLayer, createProject, PRESETS, validateProject } from '../src/core/project';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, createEvolveClock, createEvolveTransport, evaluateEvolve, EVOLVE_ELEMENTS, exactEvolveClock, GLITCH_SHARDS, SCORE_STYLE_EVOLVE, type EvolveMoves, type EvolveTransport } from '../src/meridian/evolve';
import { applyLockedVariation } from '../src/meridian/panel';
import { MACRO_KEYS, MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { SCORE_STYLE_DENSE, SCORE_STYLE_PULSE } from '../src/meridian/pulse';
import { PRIMITIVE } from '../src/meridian/types';

const SEEDS = [1729, 2, 77, 4096, 31337, 900001, 12345, 555];
const FPS = 60, DT = 1 / FPS, LOOP = 60;
const MAX_MOVE = 0.012, MAX_ALPHA = 0.08, MAX_COLOUR = 0.08, MAX_GLOW = 0.25, MAX_WIDTH_PX = 1;
/** A deliberate Density or Scale move is a smooth zoom of the whole structure, so it may travel further per frame, on screen. */
const MAX_USER_MOVE = 0.04;
const AFTER_TEN_MINUTES = 600;
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
  private lastCount = 0;
  maxMove = 0; maxAlpha = 0; maxColour = 0; maxGlow = 0; maxWidth = 0; minDrawn = Infinity; maxEnergyStep = 0; private energy = 0;
  private readonly a = new Float64Array(4); private readonly b = new Float64Array(4);
  /** With `visibleOnly`, marks wholly outside the frame do not count towards movement: nobody can see them travel. */
  constructor(private readonly visibleOnly = false) {}
  private inFrame(e: Float64Array): boolean { return (Math.abs(e[0]) < 0.9 && Math.abs(e[1]) < 0.52) || (Math.abs(e[2]) < 0.9 && Math.abs(e[3]) < 0.52); }
  see(list: DisplayList): void {
    const d = list.data;
    let drawn = 0, energy = 0;
    for (let i = 0; i < list.count; i++) {
      const at = i * STRIDE, alpha = d[at + 9];
      if (alpha > 0.04) { drawn++; const k = d[at]; energy += alpha * (k === PRIMITIVE.ring ? Math.PI * 2 * d[at + 3] : k === PRIMITIVE.arc ? d[at + 3] * d[at + 5] : k === PRIMITIVE.segment ? Math.hypot(d[at + 3] - d[at + 1], d[at + 4] - d[at + 2]) : 0.01) * Math.abs(d[at + 6] || 0.001); }
      if (!this.last) continue;
      // A mark appended since the last frame, such as a glitch shard, counts as arriving from nothing.
      if (i >= this.lastCount) { this.maxAlpha = Math.max(this.maxAlpha, alpha); continue; }
      const p = this.last, seen = Math.max(alpha, p[at + 9]);
      this.maxAlpha = Math.max(this.maxAlpha, Math.abs(alpha - p[at + 9]));
      if (seen <= 0.04) continue;
      this.maxColour = Math.max(this.maxColour, Math.abs(d[at + 8] - p[at + 8]));
      this.maxGlow = Math.max(this.maxGlow, Math.abs(d[at + 7] - p[at + 7]));
      this.maxWidth = Math.max(this.maxWidth, Math.abs(d[at + 6] - p[at + 6]) * 1080);
      ends(p, at, this.a); ends(d, at, this.b);
      if (!this.visibleOnly || this.inFrame(this.a) || this.inFrame(this.b)) this.maxMove = Math.max(this.maxMove, Math.hypot(this.a[0] - this.b[0], this.a[1] - this.b[1]), Math.hypot(this.a[2] - this.b[2], this.a[3] - this.b[3]));
    }
    this.minDrawn = Math.min(this.minDrawn, drawn);
    if (this.last) this.maxEnergyStep = Math.max(this.maxEnergyStep, Math.abs(energy - this.energy) / Math.max(this.energy, 1e-6));
    this.energy = energy;
    this.last = d.slice(0, list.count * STRIDE);
    this.lastCount = list.count;
  }
}

interface Step { params?: Record<string, number>; moves?: EvolveMoves; seed?: number }

function run(seed: number, seconds: number, p: Record<string, number>, frame: (f: number) => Step | void, watch: Watch, start = 0): EvolveTransport {
  const transport = createEvolveTransport(), list = new DisplayList(2000), view: Record<string, number> = {};
  let current = p, currentSeed = seed;
  advanceEvolve(transport, 0, LOOP, 0, seed, current, idle);
  // The warm-up is the session so far. Faults that grow with accumulated time only show after it.
  for (let f = 1, warm = Math.round(start * 10); f <= warm; f++) advanceEvolve(transport, phaseAt(f / 10), LOOP, 0.1, seed, current, idle);
  const frames = Math.round(seconds * FPS);
  for (let f = 0; f <= frames; f++) {
    const step = f === 0 ? {} : frame(f) ?? {};
    if (step.params) current = step.params;
    if (step.seed !== undefined) currentSeed = step.seed;
    const clock = advanceEvolve(transport, phaseAt(start + f * DT), LOOP, f === 0 ? 0 : DT, currentSeed, current, step.moves ?? idle);
    Object.assign(view, current, transport.values);
    evaluateEvolve(currentSeed, clock, view, list);
    watch.see(list);
  }
  return transport;
}

const within = (watch: Watch, label: string, move = MAX_MOVE) => {
  assert.ok(watch.maxMove <= move, `${label}: moved ${watch.maxMove}`);
  assert.ok(watch.maxAlpha <= MAX_ALPHA, `${label}: alpha step ${watch.maxAlpha}`);
  assert.ok(watch.maxColour <= MAX_COLOUR, `${label}: colour step ${watch.maxColour}`);
  assert.ok(watch.maxGlow <= MAX_GLOW, `${label}: glow step ${watch.maxGlow}`);
  assert.ok(watch.maxWidth <= MAX_WIDTH_PX, `${label}: width step ${watch.maxWidth}px`);
};

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

test('moving any macro across its range in one second causes no jump, after ten minutes and with Glitch up', () => {
  for (const seed of [1729, 77]) for (const key of MACRO_KEYS) for (const glitch of [0.5, 0.9]) for (const [from, to] of [[0, 1], [1, 0]]) {
    if (key === 'macroGlitch' && glitch !== 0.5) continue;
    const zoom = key === 'macroDensity' || key === 'macroScale', watch = new Watch(zoom), base = params({ macroGlitch: glitch, [key]: from });
    run(seed, 8, base, f => ({ params: { ...base, [key]: from + (to - from) * Math.min(1, f / FPS) } }), watch, AFTER_TEN_MINUTES);
    within(watch, `seed ${seed} ${key} ${from}->${to} glitch ${glitch}`, zoom ? MAX_USER_MOVE : MAX_MOVE);
  }
});

test('Density and Scale answer within about a second, without overshoot', () => {
  for (const key of ['macroDensity', 'macroScale']) for (const [from, to] of [[0.5, 1], [0.5, 0], [0, 1]]) {
    const base = params({ [key]: from }), moved = { ...base, [key]: to }, transport = createEvolveTransport();
    advanceEvolve(transport, 0, LOOP, 0, 1729, base, idle);
    let at = 0, atOneSecond = 0;
    for (let f = 1; f <= 240; f++) {
      advanceEvolve(transport, phaseAt(f * DT), LOOP, DT, 1729, moved, idle);
      const value = transport.values[key], share = (value - from) / (to - from);
      assert.ok(share >= at - 1e-9 && share <= 1 + 1e-9, `${key} overshoots or turns back at frame ${f}`);
      at = share;
      if (f === FPS) atOneSecond = share;
    }
    assert.ok(atOneSecond >= 0.8, `${key} ${from}->${to}: ${atOneSecond} of the way after one second`);
    assert.equal(transport.values[key], to);
  }
});

test('changing ring rotation after a long session does not whirl the rings', () => {
  for (const [key, from, to] of [['ringRotationSpeed', 1, 1.5], ['ringRotationSpeed', 1, -3], ['ringCounterRotation', 0.5, 1], ['ringCounterRotation', 0.5, 0]] as const) for (const start of [AFTER_TEN_MINUTES, 3600]) {
    const watch = new Watch(), base = params({ [key]: from });
    run(1729, 6, base, f => (f > 30 ? { params: { ...base, [key]: to } } : {}), watch, start);
    within(watch, `${key} ${from}->${to} at ${start}s`);
  }
});

test('moving Speed or Density never strobes a glitch', () => {
  for (const seed of [1729, 77, 4096]) for (const key of ['macroSpeed', 'macroDensity']) {
    const watch = new Watch(key === 'macroDensity'), base = params({ macroGlitch: 1 });
    run(seed, 16, base, f => ({ params: { ...base, [key]: 0.5 + 0.5 * Math.sin(f / 37) } }), watch, AFTER_TEN_MINUTES);
    within(watch, `seed ${seed} ${key}`, key === 'macroDensity' ? MAX_USER_MOVE : MAX_MOVE);
  }
});

test('a glitch keeps its ring and shards for the whole event', () => {
  const transport = createEvolveTransport(), base = params({ macroGlitch: 1 });
  advanceEvolve(transport, 0, LOOP, 0, 1729, base, idle);
  let cell = Number.NaN, voice = -1;
  for (let f = 1; f < 3000; f++) {
    const clock = advanceEvolve(transport, phaseAt(f * DT), LOOP, DT, 1729, { ...base, macroDensity: f % 200 < 100 ? 0 : 1 }, idle);
    if (clock.glitchCell === cell) assert.equal(clock.glitchVoice, voice);
    cell = clock.glitchCell; voice = clock.glitchVoice;
  }
});

test('repeated Burst never cuts a ripple that is still lit', () => {
  for (const seed of [1729, 77, 4096]) {
    const watch = new Watch();
    run(seed, 14, params(), f => ({ moves: { ...idle, burst: f % 20 < 4 } }), watch, AFTER_TEN_MINUTES);
    within(watch, `seed ${seed}`);
  }
});

test('repeated Reseed never cuts the colour or the structure', () => {
  for (const gap of [13, 40, 170]) {
    const watch = new Watch();
    run(1729, 30, params({ macroHeat: 1 }), f => (f < 1000 ? { seed: 1729 + Math.floor(f / gap) * 311 } : { seed: 1729 + Math.floor(1000 / gap) * 311 }), watch, AFTER_TEN_MINUTES);
    within(watch, `every ${gap} frames`);
  }
});

test('the group controls and Mutate move the picture without a jump', () => {
  for (const [key, to] of [['ringCount', 20], ['ringWeight', 4], ['ringOpacity', 0.2], ['ringArcShare', 1], ['spokeCount', 40], ['spokeWeight', 4], ['spokeOpacity', 0.1], ['spokeInnerReach', 0.7], ['spokeOuterReach', 0.3], ['spokeOffsetAngle', 120], ['nodeDensity', 1], ['nodeSize', 4], ['nodeGlow', 2], ['nodeOpacity', 0.1], ['heroWeight', 5], ['heroGlow', 5], ['heroPulse', 1], ['heroRadius', 1], ['heroSplit', 1], ['heroHaloStrength', 2]] as const) {
    const watch = new Watch(), base = params();
    run(1729, 14, base, f => (f > 30 ? { params: { ...base, [key]: to } } : {}), watch, AFTER_TEN_MINUTES);
    within(watch, key);
  }
  for (let trial = 0; trial < 12; trial++) {
    const layer = createLayer('meridian'), watch = new Watch(), base = params(layer.params);
    layer.params.scoreVariation = 1;
    const mutated = params(applyLockedVariation(layer, 9000 + trial, 'mutate').params);
    run(1729, 10, base, f => (f > 30 ? { params: mutated } : {}), watch, AFTER_TEN_MINUTES);
    within(watch, `Mutate ${trial}`);
  }
});

test('an export honours the ring rotation controls and keeps the layered rates', () => {
  const arcStarts = (p: Record<string, number>, phase = 1.3) => { const list = new DisplayList(2000); evaluateEvolve(1729, exactEvolveClock(phase, 60, p, createEvolveClock()), p, list); return Array.from(list.data.subarray(0, list.count * STRIDE)); };
  assert.notDeepEqual(arcStarts(params({ ringRotationSpeed: 1 })), arcStarts(params({ ringRotationSpeed: -3 })));
  assert.notDeepEqual(arcStarts(params({ ringCounterRotation: 0 })), arcStarts(params({ ringCounterRotation: 1 })));
  const clock = exactEvolveClock(Math.PI * 2 * 0.25, 60, params(), createEvolveClock());
  assert.ok(clock.ringTurns[0] > 0 && clock.ringTurns[1] < 0 && clock.ringTurns[2] > 0, 'tiers keep their directions');
  assert.ok(Math.abs(clock.ringTurns[0]) > Math.abs(clock.ringTurns[1]) && Math.abs(clock.ringTurns[1]) > Math.abs(clock.ringTurns[2]), 'tiers keep their different rates');
});

test('a held export stays on one live form and closes', () => {
  for (const extra of [{ scoreHoldShape: 1 }, { scoreEvolution: 0 }] as Record<string, number>[]) for (const duration of [10, 60]) {
    const draw = (phase: number, more: Record<string, number> = {}) => { const p = params({ ...extra, ...more }), list = new DisplayList(2000); evaluateEvolve(1729, exactEvolveClock(phase, duration, p, createEvolveClock()), p, list); return list; };
    const bytes = (list: DisplayList) => Array.from(list.data.subarray(0, list.count * STRIDE));
    assert.notDeepEqual(bytes(draw(2, { macroOrder: 0 })), bytes(draw(2, { macroOrder: 1 })), 'Chaos is live');
    let shard = 0;
    for (let f = 0; f < 400; f++) { const list = draw(f / 400 * Math.PI * 2, { macroGlitch: 1 }); for (let i = EVOLVE_ELEMENTS; i < list.count; i++) shard = Math.max(shard, list.data[i * STRIDE + 9]); }
    assert.ok(shard > 0.3, `Glitch is live (${shard})`);
    for (const more of [{}, { macroOrder: 1 }, { macroGlitch: 1 }, { macroSpeed: 1 }, { ringRotationSpeed: -3 }] as Record<string, number>[]) {
      const first = draw(0, more), last = draw(Math.PI * 2 - 1e-7, more), a = new Float64Array(4), b = new Float64Array(4);
      assert.equal(first.count, last.count);
      for (let i = 0; i < first.count; i++) {
        const at = i * STRIDE;
        assert.ok(Math.abs(first.data[at + 9] - last.data[at + 9]) < 1e-3, `alpha at ${i}`);
        if (first.data[at + 9] < 0.01) continue;
        ends(first.data, at, a); ends(last.data, at, b);
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3 && Math.hypot(a[2] - b[2], a[3] - b[3]) < 1e-3, `${duration}s ${JSON.stringify(more)} mark ${i}`);
      }
    }
    const watch = new Watch(), clock = createEvolveClock(), p = params({ ...extra, macroGlitch: 1 }), list = new DisplayList(2000);
    for (let f = 0; f <= duration * FPS; f++) { evaluateEvolve(1729, exactEvolveClock(f / (duration * FPS) * Math.PI * 2, duration, p, clock), p, list); watch.see(list); }
    within(watch, `held ${duration}s`);
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

test('nothing on the per-frame path allocates', () => {
  const source = readFileSync(new URL('../src/meridian/evolve.ts', import.meta.url), 'utf8');
  const body = (name: string): string => {
    const declared = source.search(new RegExp(`(?:function ${name}\\(|const ${name} = \\()`));
    assert.ok(declared >= 0, `${name} is on the path`);
    const arrow = source.slice(declared).startsWith('const') ? source.indexOf('=>', declared) : declared;
    let at = source.indexOf(arrow === declared ? ') ' : '=> ', arrow), depth = 0;
    if (arrow === declared) { let round = 0; for (at = source.indexOf('(', declared); ; at++) { if (source[at] === '(') round++; else if (source[at] === ')' && --round === 0) break; } }
    const open = source.indexOf('{', at), semi = source.indexOf(';', at);
    if (semi >= 0 && semi < open) return source.slice(at, semi);
    for (let i = open; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1); }
    throw new Error(name);
  };
  const path = ['advanceEvolve', 'evaluateEvolve', 'exactEvolveClock', 'project', 'blendPose', 'angleBetween', 'easePose', 'easeField', 'formFor', 'segmentAt', 'boundary', 'morphWindow', 'morphRate', 'travel', 'exactStops', 'closedTurn', 'latchGlitch', 'glitchEnvelope', 'ringVoices', 'spokeVoices', 'tierRate', 'growth', 'pull', 'oscillate', 'lightAt', 'rippleAt', 'tintAt', 'hash', 'hashUnit', 'speedRate', 'evolutionRate'];
  for (const name of path) {
    const code = body(name).replace(/\/\/.*$/gm, '');
    assert.ok(!/\bnew\s+[A-Z]|\.(map|filter|slice|concat|flatMap|reduce|forEach)\(|\.\.\./.test(code), `${name} allocates`);
    assert.ok(!/(^|[=(,:?&|]\s*|\bof\s+|\breturn\s+)\[/m.test(code), `${name} builds an array`);
    assert.ok(!/=>|\bfunction\b/.test(name === 'pull' || name === 'oscillate' || name === 'tierRate' || name === 'growth' || name === 'ringVoices' || name === 'speedRate' || name === 'hashUnit' ? code.replace(/^=> /, '') : code), `${name} builds a closure`);
  }
  assert.ok(!/from 'three'|from 'react'|document\.|window\./.test(source));
});

test('the library leads with Evolve looks', () => {
  const looks = PRESETS.filter(p => p.kind === 'meridian');
  assert.ok(looks.slice(0, 10).every(p => p.params.scoreStyle === SCORE_STYLE_EVOLVE), 'first ten are Evolve');
});
