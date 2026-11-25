import test from 'node:test';
import assert from 'node:assert/strict';
import { bandSignal, bloomValue, BURST_TIMES, breathValue, LARGE_SWING, reactionSpeed, stepReaction, zoneBrightness } from '../src/perform/reaction';
import type { ReactionState } from '../src/perform/reaction';

const rest: ReactionState = { envelope: 0, burst: 0 };
const run = (s: ReactionState, seconds: number, band: number, amount: number, held: boolean, pulse = 0): ReactionState => {
  let t = 0;
  while (t < seconds - 1e-9) { s = stepReaction(s, band, amount, held, pulse, 1 / 60); t += 1 / 60; }
  return s;
};

test('bandSignal reads the clip band and treats missing or bad values as silence', () => {
  const signals = { 'audio.bass': .8, 'audio.mids': .4, 'audio.highs': .2, 'audio.level': .6, 'beat.pulse': 1 };
  assert.equal(bandSignal(signals, 'bass'), .8);
  assert.equal(bandSignal(signals, 'mid'), .4);
  assert.equal(bandSignal(signals, 'high'), .2);
  assert.equal(bandSignal(signals, 'level'), .6);
  assert.equal(bandSignal({}, 'bass'), 0);
  assert.equal(bandSignal({ 'audio.bass': NaN }, 'bass'), 0);
  assert.equal(bandSignal({ 'audio.bass': 4 }, 'bass'), 1);
});

test('fader 0 and master 0 are black whatever the audio or burst', () => {
  const loud: ReactionState = { envelope: 1, burst: 1 };
  assert.equal(zoneBrightness(0, 1, loud), 0);
  assert.equal(zoneBrightness(1, 0, loud), 0);
  assert.equal(zoneBrightness(0, 0, loud), 0);
});

test('the Audio knob at 0 gives no reaction', () => {
  const s = run(rest, 1, 1, 0, false);
  assert.equal(s.envelope, 0);
  assert.equal(zoneBrightness(.5, 1, s), .5);
  assert.equal(reactionSpeed(1, s), 1);
});

test('reaction attacks faster than it releases', () => {
  const up = run(rest, .05, 1, 1, false).envelope;
  const down = 1 - run({ envelope: 1, burst: 0 }, .05, 0, 1, false).envelope;
  assert.ok(up > down * 2, `attack ${up} should beat release ${down}`);
  assert.ok(up > .5);
});

test('a burst rises while held and decays after release', () => {
  const held = run(rest, .2, 0, 1, true, 1);
  assert.ok(held.burst > .9, 'the kick lifts the burst');
  const soon = run(held, .05, 0, 1, false);
  const later = run(held, 1, 0, 1, false);
  assert.ok(soon.burst < held.burst && soon.burst > later.burst, 'it decays rather than cutting');
  assert.ok(later.burst < .01);
});

test('a held burst without a kick still lifts, and the kick adds to it', () => {
  const quiet = run(rest, .5, 0, 0, true, 0).burst;
  const kick = run(rest, .5, 0, 0, true, 1).burst;
  assert.ok(quiet > .3 && kick > quiet);
});

test('audio loss eases the reaction to zero within one second', () => {
  let s = run(rest, 1, 1, 1, false);
  assert.ok(s.envelope > .9);
  s = run(s, 1, 0, 1, false);
  assert.ok(s.envelope < .01, `still ${s.envelope}`);
});

test('brightness is finite and at most 1.6, even for bad input', () => {
  for (const r of [{ envelope: 1, burst: 1 }, { envelope: 5, burst: 5 }, { envelope: NaN, burst: Infinity }, rest]) {
    for (const fader of [0, .5, 1]) {
      const b = zoneBrightness(fader, 1, r);
      assert.ok(Number.isFinite(b) && b >= 0 && b <= 1.6, `${fader} ${JSON.stringify(r)} gave ${b}`);
    }
  }
  assert.equal(zoneBrightness(1, 1, { envelope: 1, burst: 1 }), 1.6);
  assert.ok(Number.isFinite(stepReaction(rest, NaN, NaN, true, NaN, NaN).envelope));
});

test('reactionSpeed lifts a free clip and stays finite', () => {
  assert.ok(reactionSpeed(1, { envelope: 1, burst: 0 }) > 1);
  assert.equal(reactionSpeed(2, rest), 2);
  assert.ok(Number.isFinite(reactionSpeed(1, { envelope: NaN, burst: 9 })));
});

/** Counts rises-and-falls larger than `big`, by zigzag. */
function countSwings(values: number[], big: number): number {
  let dir = 0, extreme = values[0], turns = 0;
  for (const v of values) {
    if (dir === 0) { if (Math.abs(v - extreme) > big) { dir = v > extreme ? 1 : -1; extreme = v; turns++; } continue; }
    if (dir > 0 ? v > extreme : v < extreme) extreme = v;
    else if (Math.abs(v - extreme) > big) { dir = -dir; extreme = v; turns++; }
  }
  return turns / 2;
}

function simulate(bpm: number, held: boolean, seconds: number, seed: number): number[] {
  let s = rest, rnd = seed, t = 0;
  const out: number[] = [];
  const sixteenth = 60 / bpm / 4;
  while (t < seconds) {
    rnd = (rnd * 1664525 + 1013904223) % 4294967296;
    const dt = 1 / 60 + ((rnd / 4294967296) - .5) * .012;
    const hit = t % sixteenth < .03 ? 1 : 0;
    s = stepReaction(s, hit, 1, held, hit, dt);
    out.push(zoneBrightness(1, 1, s));
    t += dt;
  }
  return out;
}

test('flash guard: no zone swings by more than 10% more than 3 times a second at any tempo', () => {
  assert.equal(LARGE_SWING, .1);
  for (const bpm of [85, 100, 120, 140, 160, 175]) {
    for (const held of [false, true]) {
      for (const seed of [1, 7, 99]) {
        const seconds = 8, swings = countSwings(simulate(bpm, held, seconds, seed).slice(60), LARGE_SWING);
        assert.ok(swings / (seconds - 1) <= 3, `${bpm} bpm held=${held} seed=${seed}: ${swings} swings`);
      }
    }
  }
});

test('flash guard: every band is limited the same way', () => {
  const keys = { bass: 'audio.bass', mid: 'audio.mids', high: 'audio.highs', level: 'audio.level' } as const;
  for (const [band, key] of Object.entries(keys) as [keyof typeof keys, string][]) {
    let s = rest, t = 0;
    const out: number[] = [];
    while (t < 8) {
      const on = t % (60 / 175 / 4) < .03 ? 1 : 0;
      s = stepReaction(s, bandSignal({ [key]: on }, band), 1, false, 0, 1 / 60);
      out.push(zoneBrightness(1, 1, s));
      t += 1 / 60;
    }
    assert.ok(countSwings(out.slice(60), LARGE_SWING) / 7 <= 3, key);
  }
});

test('flash guard: slow music still moves the picture, without a pop', () => {
  let s = rest;
  const out: number[] = [];
  for (let i = 0; i < 120; i++) { s = stepReaction(s, i % 60 < 20 ? 1 : 0, 1, false, 0, 1 / 60); out.push(zoneBrightness(1, 1, s)); }
  assert.ok(Math.max(...out) > 1.5, 'a slow beat reaches nearly full lift');
  for (let i = 1; i < out.length; i++) assert.ok(Math.abs(out[i] - out[i - 1]) < .2, `step ${i} jumps ${out[i] - out[i - 1]}`);
});

test('a stalled frame cannot pop the reaction', () => {
  assert.deepEqual(stepReaction(rest, 1, 1, true, 1, 10), stepReaction(rest, 1, 1, true, 1, .1));
});

// ---- Task 12: the ceiling's bloom and breath ----
/** One frame of the ceiling: no audio, slow burst times, no kick, and the breath as it is at `seconds`. */
const ceilingStep = (s: ReactionState, held: boolean, knob: number, seconds: number, dt = 1 / 60): ReactionState =>
  stepReaction(s, 0, 0, held, 0, dt, BURST_TIMES.ceiling, breathValue(knob, seconds));

test('breath is zero with the knob down, grows with the knob, and stays inside its range', () => {
  for (const t of [0, 1.7, 6, 33]) assert.equal(breathValue(0, t), 0);
  const peak = (knob: number) => Math.max(...Array.from({ length: 1200 }, (_, i) => breathValue(knob, i / 20)));
  assert.ok(peak(.3) > 0 && peak(.3) < peak(1));
  for (const v of [breathValue(1, 0), breathValue(1, 3), breathValue(9, 3), breathValue(NaN, 3), breathValue(1, NaN), breathValue(-1, 3)]) assert.ok(Number.isFinite(v) && v >= 0 && v <= .5, `${v}`);
});

test('breath is provably slower than the flash guard: a full breath takes seconds, and never strobes', () => {
  // The fastest the lift can move, per second, times the lift's weight on brightness.
  let fastest = 0;
  for (let i = 1; i < 6000; i++) fastest = Math.max(fastest, Math.abs(breathValue(1, i / 60) - breathValue(1, (i - 1) / 60)) * 60);
  assert.ok(fastest * .6 <= LARGE_SWING, `breath moves brightness at ${fastest * .6} a second, so a 10% swing takes a second or more`);
  // Through the guard too, with the knob full, over a minute.
  let s = rest;
  const out: number[] = [];
  for (let i = 0; i < 3600; i++) { s = ceilingStep(s, false, 1, i / 60); out.push(zoneBrightness(1, 1, s)); }
  assert.ok(Math.max(...out) > 1.05, 'it does breathe');
  // A minute is five breaths, so five slow swings: far below the guard's 3 a second.
  assert.ok(countSwings(out, LARGE_SWING) <= 6, `${countSwings(out, LARGE_SWING)} swings in a minute`);
});

test('Red 8 blooms slowly: a rise of at least 2 seconds, then it settles after release', () => {
  let s = rest, t = 0;
  const at = new Map<number, number>();
  while (t < 12) { s = ceilingStep(s, true, 0, t); t += 1 / 60; at.set(Math.round(t * 10) / 10, bloomValue(s)); }
  const full = bloomValue(s);
  assert.ok(full > .45, `it swells to ${full}`);
  const reach = (share: number) => { for (const [sec, v] of [...at].sort((a, b) => a[0] - b[0])) if (v >= full * share) return sec; return Infinity; };
  assert.ok(reach(.9) >= 2, `90% after ${reach(.9)}s`);
  assert.ok(at.get(1)! < full * .5, 'a second in it is less than half way');
  // After release it eases away rather than cutting.
  const soon = ceilingStep(s, false, 0, t);
  assert.ok(bloomValue(soon) > full * .95, 'one frame after release it has barely moved');
  let r = s, u = 0;
  while (u < 1) { r = ceilingStep(r, false, 0, t + u); u += 1 / 60; }
  assert.ok(bloomValue(r) > full * .5, `a second after release it is still ${bloomValue(r)}`);
  while (u < 20) { r = ceilingStep(r, false, 0, t + u); u += 1 / 60; }
  assert.ok(bloomValue(r) < .01, 'and it settles');
});

test('the kick does not pulse the ceiling bloom, and a held bloom never flashes', () => {
  let s = rest;
  const out: number[] = [];
  for (let i = 0; i < 60 * 30; i++) { s = stepReaction(s, 0, 0, true, i % 20 < 4 ? 1 : 0, 1 / 60, BURST_TIMES.ceiling, 0); out.push(zoneBrightness(1, 1, s)); }
  assert.ok(countSwings(out, LARGE_SWING) <= 1, 'one slow swell and nothing else');
  assert.ok(Math.max(...out.slice(600)) - Math.min(...out.slice(600)) < .1, 'steady once it has swelled');
});

test('fader 0 and master 0 are black whatever the bloom or breath', () => {
  const full: ReactionState = stepReaction({ envelope: 0, burst: 1, shown: 1 }, 0, 0, true, 0, 1 / 60, BURST_TIMES.ceiling, .5);
  assert.ok(bloomValue(full) > .9);
  assert.equal(zoneBrightness(0, 1, full), 0);
  assert.equal(zoneBrightness(1, 0, full), 0);
  assert.equal(zoneBrightness(0, 0, full), 0);
});

test('bloomValue reads only the burst, and is bad-input safe', () => {
  assert.equal(bloomValue({ envelope: 1, burst: 0 }), 0);
  assert.equal(bloomValue({ envelope: 0, burst: .4 }), .4);
  assert.equal(bloomValue({ envelope: 0, burst: .4, shown: .1 }), .1, 'never more than the guard lets show');
  assert.equal(bloomValue({ envelope: 0, burst: NaN }), 0);
  assert.equal(bloomValue({ envelope: 0, burst: 9 }), 1);
});
