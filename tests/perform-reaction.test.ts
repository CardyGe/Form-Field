import test from 'node:test';
import assert from 'node:assert/strict';
import { bandSignal, LARGE_SWING, reactionSpeed, stepReaction, zoneBrightness } from '../src/perform/reaction';
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
