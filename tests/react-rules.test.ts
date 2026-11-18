import test from 'node:test';
import assert from 'node:assert/strict';
import { bandEnergies, AutoGain } from '../src/react/features';
import { BeatDetector } from '../src/react/beat';
import { TempoClock } from '../src/react/tempo';
import { evaluate, fire, smooth, type Link, type Trigger } from '../src/react/links';
import { acceptSignals } from '../src/react/signals';

test('band energies come from the right frequencies', () => {
  const fft = 2048, rate = 48000, bins = fft / 2;
  const db = new Float32Array(bins).fill(-120);
  const binOf = (hz: number) => Math.round(hz / (rate / fft));
  db[binOf(80)] = 0; // a loud bass tone only
  const e = bandEnergies(db, rate, fft);
  assert.ok(e.bass > 0.05 && e.mids < 1e-4 && e.highs < 1e-4, JSON.stringify(e));
});

test('auto-gain brings a steady sound to full scale, and does not lift silence above its floor', () => {
  const g = new AutoGain();
  let out = 0;
  for (let i = 0; i < 120; i++) out = g.update(0.02, 1 / 60);
  assert.ok(out > 0.95, `steady sound gives ${out}`);
  const quiet = new AutoGain();
  for (let i = 0; i < 120; i++) out = quiet.update(1e-6, 1 / 60);
  assert.ok(out < 0.05, `silence gives ${out}`);
  // A loud hit then quieter sound: the quieter part is well under full scale at first.
  const h = new AutoGain();
  h.update(1, 1 / 60);
  assert.ok(h.update(0.2, 1 / 60) < 0.3);
});

test('a kick drum at 120 BPM is found, beat by beat, and its tempo read', () => {
  const d = new BeatDetector();
  let onsets = 0;
  for (let f = 0; f < 60 * 8; f++) {
    const t = f / 60, sinceBeat = t % 0.5;
    const bass = 0.05 + (sinceBeat < 1 / 30 ? 1 : 0.9 * Math.exp(-sinceBeat * 12));
    if (d.update(bass, t).onset) onsets++;
  }
  const s = d.state(8);
  assert.ok(onsets >= 14 && onsets <= 17, `${onsets} beats in 8 s`);
  assert.ok(Math.abs(s.bpm! - 120) < 2, `tempo ${s.bpm}`);
});

test('steady hum is not a beat', () => {
  const d = new BeatDetector();
  let onsets = 0;
  for (let f = 0; f < 600; f++) if (d.update(0.4 + 0.01 * Math.sin(f), f / 60).onset) onsets++;
  assert.ok(onsets <= 1, `${onsets} beats from a hum`);
});

test('tap tempo: four taps half a second apart give 120 BPM, starting the beat on the tap', () => {
  const c = new TempoClock();
  c.setSource('tap');
  for (const t of [10, 10.5, 11, 11.5]) c.tap(t);
  const s = c.advance(11.75);
  assert.ok(Math.abs(s.bpm - 120) < 0.5, `${s.bpm}`);
  assert.ok(Math.abs(s.phase - 0.5) < 0.02, `phase ${s.phase}`);
});

test('MIDI clock: 24 ticks a beat set the tempo and the phase', () => {
  const c = new TempoClock();
  c.setSource('midi');
  c.midiStart(0);
  const tick = 60 / 128 / 24;
  for (let i = 1; i <= 24 * 4 + 12; i++) c.midiTick(i * tick);
  const s = c.advance((24 * 4 + 12) * tick);
  assert.ok(Math.abs(s.bpm - 128) < 1, `${s.bpm}`);
  assert.ok(Math.abs(s.phase - 0.5) < 0.05 && s.beat === 4, JSON.stringify(s));
});

test('a fixed tempo runs on its own', () => {
  const c = new TempoClock();
  c.setSource('fixed'); c.setBpm(90);
  c.advance(0);
  const s = c.advance(1);
  assert.equal(s.beat, 1);
  assert.ok(Math.abs(s.phase - 0.5) < 1e-6);
});

const link = (over: Partial<Link>): Link => ({ id: 'l', input: 'audio.bass', target: 't', mode: 'modulate', amount: 0.5, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: '', ...over });

test('modulate adds the signal times its amount of the range, to the set value, inside the range', () => {
  const state = new Map<string, number>();
  assert.equal(evaluate(1, { min: 0, max: 2 }, [link({})], { 'audio.bass': 1 }, state, 1 / 60), 2);
  assert.equal(evaluate(1, { min: 0, max: 2 }, [link({ amount: -1 })], { 'audio.bass': 1 }, new Map(), 1 / 60), 0);
  assert.equal(evaluate(1, { min: 0, max: 2 }, [link({})], {}, new Map(), 1 / 60), 1, 'no signal, no change');
  assert.equal(evaluate(1, { min: 0, max: 2 }, [link({ on: false })], { 'audio.bass': 1 }, new Map(), 1 / 60), 1);
});

test('control sets the value between its low and high, taking over from the set value', () => {
  const l = link({ mode: 'control', input: 'midi.cc.1.74', low: 0.25, high: 0.75 });
  assert.equal(evaluate(10, { min: 0, max: 100 }, [l], { 'midi.cc.1.74': 0.5 }, new Map(), 1 / 60), 50);
  assert.equal(evaluate(10, { min: 0, max: 100 }, [l], {}, new Map(), 1 / 60), 10, 'a knob not yet moved leaves the set value');
});

test('smoothing: attack and release follow at their own speeds', () => {
  const up = smooth(0, 1, 0.1, 100, 1000), down = smooth(1, 0, 0.1, 100, 1000);
  assert.ok(up > 0.6 && up < 0.7, `${up}`);
  assert.ok(down > 0.88 && down < 0.92, `${down}`);
  assert.equal(smooth(0.3, 0.8, 0.016, 0, 0), 0.8);
});

test('triggers fire once on a note going on, a control rising past halfway, and every N beats', () => {
  const triggers: Trigger[] = [
    { id: 'a', input: 'midi.note.1.60', when: 'on', every: 1, action: { kind: 'scene', sceneId: 's2' }, on: true },
    { id: 'b', input: 'midi.cc.1.20', when: 'on', every: 1, action: { kind: 'blackout' }, on: true },
    { id: 'c', input: 'tempo.beat', when: 'beats', every: 4, action: { kind: 'next-scene' }, on: true },
  ];
  assert.deepEqual(fire(triggers, { 'midi.note.1.60': 0 }, { 'midi.note.1.60': 1 }).map(a => a.kind), ['scene']);
  assert.deepEqual(fire(triggers, { 'midi.note.1.60': 1 }, { 'midi.note.1.60': 1 }), []);
  assert.deepEqual(fire(triggers, { 'midi.cc.1.20': 0.4 }, { 'midi.cc.1.20': 0.6 }).map(a => a.kind), ['blackout']);
  assert.deepEqual(fire(triggers, { 'tempo.beat': 7 }, { 'tempo.beat': 8 }).map(a => a.kind), ['next-scene']);
  assert.deepEqual(fire(triggers, { 'tempo.beat': 8 }, { 'tempo.beat': 9 }), []);
});

test('signals messages: numbers only, bounded', () => {
  assert.equal(acceptSignals({ 'audio.bass': 0.5, 'midi.cc.1.7': 1 }), true);
  assert.equal(acceptSignals({ 'audio.bass': 'loud' }), false);
  assert.equal(acceptSignals({ 'audio.bass': Number.NaN }), false);
  assert.equal(acceptSignals(Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`midi.cc.1.${i}`, 0]))), false);
  assert.equal(acceptSignals(null), false);
});
