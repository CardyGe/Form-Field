import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Conductor, type ConductorFrame } from '../src/meridian/conductor';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { TempoClock } from '../src/react/tempo';

const DT = 1 / 60, params = { ...MERIDIAN_DEFAULTS };
const wrap = (v: number) => v - Math.round(v);

/** The real TempoClock, driven by onsets, with a band signal so the Conductor sees live audio. */
class Rig {
  readonly clock = new TempoClock(); readonly conductor = new Conductor(); t = 0; lastOnset = -9;
  constructor(bpm: number) { this.clock.setSource('beat'); this.clock.setBpm(bpm); }
  step(onset: boolean, bpm: number | null, audio = true): ConductorFrame {
    this.t += DT;
    if (onset) { this.clock.detected(this.t, bpm); this.lastOnset = this.t; }
    const c = this.clock.advance(this.t);
    const signals: Record<string, number> = audio ? { 'tempo.beat': c.beat, 'tempo.phase': c.phase, 'tempo.bpm': c.bpm, 'beat.pulse': Math.exp(-(this.t - this.lastOnset) / 0.15), 'audio.bass': 0.6, 'audio.mids': 0.4, 'audio.highs': 0.3, 'audio.level': 0.5 } : {};
    return this.conductor.update({ dt: DT, signals, params });
  }
  /** Runs a steady beat; onsets land on the frame nearest each true beat. */
  run(seconds: number, bpm: number, from: number, each?: (f: ConductorFrame, truth: number) => void): number {
    const end = this.t + seconds; let next = Math.ceil((this.t - from) * bpm / 60 + 1e-9);
    while (this.t < end - 1e-9) {
      const at = from + next * 60 / bpm, onset = this.t + DT >= at - DT / 2;
      if (onset) next++;
      const f = this.step(onset, bpm);
      each?.(f, (this.t - from) * bpm / 60);
    }
    return from;
  }
}

test('follows a steady 128 BPM within 10 ms over 5 minutes', () => {
  const rig = new Rig(128); let worst = 0;
  rig.run(8, 128, 0);
  rig.run(300, 128, 0, (f, truth) => { worst = Math.max(worst, Math.abs(wrap(f.beats - truth))); assert.equal(f.status, 'locked'); });
  assert.ok(worst * 60 / 128 <= 0.01 + DT, `worst ${(worst * 60 / 128 * 1000).toFixed(2)} ms`);
  let settled = 0; rig.run(10, 128, 0, (f, truth) => { settled = Math.max(settled, Math.abs(wrap(f.beats - truth))); });
  assert.ok(settled * 60 / 128 <= 0.01, `settled ${(settled * 60 / 128 * 1000).toFixed(2)} ms`);
});

test('one false onset does not move the beat', () => {
  const rig = new Rig(128); rig.run(10, 128, 0);
  const before = rig.conductor.update({ dt: 0, signals: {}, params }).beats;
  rig.step(true, 128);
  let worst = 0; rig.run(4, 128, 0, (f, truth) => { worst = Math.max(worst, Math.abs(wrap(f.beats - truth))); });
  assert.ok(Number.isFinite(before));
  assert.ok(worst * 60 / 128 <= 0.02, `moved ${(worst * 60 / 128 * 1000).toFixed(1)} ms`);
});

test('tempo halving and doubling fold back and do not change speed', () => {
  for (const reported of [55, 220]) { // The clock tops out at 240 BPM, so the doubled case starts from 110.
    const c = new Conductor(), clock = new TempoClock(); clock.setBpm(110); clock.setSource('fixed');
    let t = 0;
    const go = (s: number) => { let f!: ConductorFrame; for (let i = 0; i < s * 60; i++) { t += DT; const k = clock.advance(t); f = c.update({ dt: DT, signals: { 'tempo.beat': k.beat, 'tempo.phase': k.phase, 'tempo.bpm': k.bpm, 'beat.pulse': (t * 110 / 60) % 1 < .1 ? 1 : 0, 'audio.level': .5 }, params }); } return f; };
    go(8); clock.setBpm(reported);
    const start = go(0.02).beats, after = go(10);
    assert.ok(Math.abs(after.bpm - 110) < 0.5, `${reported}: bpm ${after.bpm}`);
    assert.ok(Math.abs((after.beats - start) / (10 * 110 / 60) - 1) < 0.09, `${reported}: speed`);
  }
});

test('a real tempo change is accepted only after two beats', () => {
  const rig = new Rig(128); rig.run(10, 128, 0);
  const from = rig.t; let early = 128;
  rig.run(60 / 140 * 1.5, 140, from, f => { early = f.bpm; });
  assert.ok(Math.abs(early - 128) < 1, `moved early to ${early}`);
  let last!: ConductorFrame; rig.run(8, 140, from, f => { last = f; });
  assert.ok(Math.abs(last.bpm - 140) < 0.5, `bpm ${last.bpm}`);
});

test('signals vanish then return without a jump, and reaction eases to zero', () => {
  const rig = new Rig(128); rig.run(10, 128, 0);
  let last = rig.step(false, null), biggest = 0;
  const peak = last.bass;
  for (let i = 0; i < 60 * 6; i++) { const f = rig.step(false, null, false); biggest = Math.max(biggest, f.beats - last.beats); assert.ok(f.bass <= last.bass + 1e-9); last = f; }
  assert.equal(last.status, 'holding'); assert.ok(peak > .2 && last.bass < .01 && last.pulse < .01); assert.ok(Math.abs(last.bpm - 128) < .5);
  rig.run(8, 128, 0, f => { biggest = Math.max(biggest, f.beats - last.beats); last = f; });
  assert.ok(biggest <= 128 / 60 * DT * 1.09, `largest step ${biggest}`);
  assert.equal(last.status, 'locked');
});

test('no audio runs free from the score tempo; bad dt is ignored', () => {
  const c = new Conductor(), p = { ...params, scoreBpm: 100 };
  let f!: ConductorFrame; for (let i = 0; i < 600; i++) f = c.update({ dt: DT, signals: {}, params: p });
  assert.equal(f.status, 'free'); assert.equal(f.bpm, 100); assert.ok(Math.abs(f.beats - 10 / 60 * 100) < 1e-6);
  assert.deepEqual([f.bass, f.mids, f.highs, f.level, f.energy, f.pulse], [0, 0, 0, 0, 0, 0]);
  const held = f.beats;
  for (const dt of [NaN, -1, Infinity]) assert.equal(c.update({ dt, signals: {}, params: p }).beats, held);
  c.reset(4); assert.equal(c.update({ dt: 0, signals: {}, params: p }).beats, 4);
});

test('the Conductor is pure and returns one reused frame', () => {
  const source = readFileSync('src/meridian/conductor.ts', 'utf8');
  assert.ok(!/from '(three|react)|document\.|window\./.test(source));
  const c = new Conductor(); assert.equal(c.update({ dt: DT, signals: {}, params }), c.update({ dt: DT, signals: {}, params }));
});
