import test from 'node:test';
import assert from 'node:assert/strict';
import { FlashLimiter } from '../src/map/flash-limiter';
import { MidimixMode } from '../src/morphogen/midimix-mode';
import type { MidimixMap } from '../src/morphogen/midimix-map';
import { neutralMacros } from '../src/morphogen/macros';
import { MorphPerformer } from '../src/morphogen/performer';
import { MORPH_LOOKS } from '../src/morphogen/looks';
import { defaultMorphParams } from '../src/morphogen/params';
import { FormFader, StopFader } from '../src/morphogen/transitions';
import type { Signals } from '../src/react/signals';

const W = 64, H = 36, FPS = 60;
function picture(lit: (x: number, y: number) => boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, v = lit(x, y) ? 255 : 0; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return data;
}
function lowestGain(make: (n: number) => Uint8ClampedArray, frames = 240): number {
  const limiter = new FlashLimiter(); let lowest = 1;
  for (let n = 0; n < frames; n++) lowest = Math.min(lowest, limiter.push(make(n), W, H, n / FPS).gain);
  return lowest;
}
const phase = (n: number, hz: number) => Math.floor(n / FPS * hz * 2) % 2 === 0;

test('two equal panels alternating at 10 Hz are limited', () => {
  assert.ok(lowestGain(n => picture(x => (x < W / 2) === phase(n, 10))) < .2);
});

test('four panels chasing at 10 Hz are limited', () => {
  assert.ok(lowestGain(n => { const on = Math.floor(n / 3) % 4; return picture(x => Math.floor(x / 16) === on); }) < .2);
});

test('a 10 Hz checker is limited', () => {
  assert.ok(lowestGain(n => picture((x, y) => (Math.floor(x / 8) + Math.floor(y / 6)) % 2 === (phase(n, 10) ? 0 : 1))) < .2);
});

for (const bpm of [120, 124, 128, 135, 140, 150, 174]) test(`a kick at ${bpm} BPM passes untouched`, () => {
  const period = 60 / bpm * FPS;
  assert.equal(lowestGain(n => { const on = (n % period) < period / 2; return picture(() => on); }, 600), 1);
});

test('exactly 3 Hz passes untouched', () => {
  assert.equal(lowestGain(n => { const on = phase(n, 3); return picture(() => on); }, 600), 1);
});

test('a 30 Hz strobe is caught within two flashes of the limit', () => {
  const limiter = new FlashLimiter(); let engagedAt = -1;
  for (let n = 0; n < 60 && engagedAt < 0; n++) if (limiter.push(picture(() => n % 2 === 0), W, H, n / FPS).gain < 1) engagedAt = n;
  assert.ok(engagedAt >= 0 && engagedAt <= 6, `engaged at frame ${engagedAt}`);
});

const map: MidimixMap = {
  confirmed: true, knobs: [0, 1, 2].map(row => Array.from({ length: 8 }, (_, s) => `midi.cc.1.${10 * (row + 1) + s}`)),
  faders: Array.from({ length: 8 }, (_, s) => `midi.cc.1.${50 + s}`), master: 'midi.cc.1.60',
  amber: Array.from({ length: 8 }, (_, s) => `midi.note.1.${s}`), red: Array.from({ length: 8 }, (_, s) => `midi.note.1.${10 + s}`), solo: 'midi.note.1.20', sendAll: 'midi.note.1.21',
};

test('re-entering the mode does not jump a macro to a knob moved while away', () => {
  const mode = new MidimixMode(map, new MorphPerformer()), signals: Signals = {}, current = neutralMacros();
  const tick = () => mode.update(signals, 1 / 60, current);
  const toggle = () => { signals[map.solo] = 1; signals[map.sendAll] = 1; tick(); signals[map.sendAll] = 0; signals[map.solo] = 0; return tick(); };
  toggle();
  signals[map.knobs[0][0]] = .5; tick(); signals[map.knobs[0][0]] = .2; assert.equal(tick().macros.growth, .2);
  toggle();
  signals[map.knobs[0][0]] = .9; tick();
  toggle();
  assert.equal(tick().macros.growth, .2);
  signals[map.knobs[0][0]] = .85;
  assert.equal(tick().macros.growth, .2);
});

test('sound on a control moves around the look instead of cancelling it', () => {
  const p = new MorphPerformer(), base = defaultMorphParams(), macros = neutralMacros(), look = MORPH_LOOKS[4].params;
  p.frame(1 / 60, base, macros);
  p.morphTo(4, .05);
  for (let i = 0; i < 10; i++) p.frame(1 / 60, base, macros);
  const played = p.frame(1 / 60, base, macros, { ...base, drive: base.drive + .1 }).params.drive;
  assert.ok(Math.abs(played - (look.drive! + .1)) < 1e-9, `drive ${played}`);
  assert.equal(p.frame(1 / 60, base, macros, base).params.drive, look.drive);
});

test('a palette change crossfades', () => {
  const f = new StopFader([[0, 0, 0]]);
  f.set([[1, 1, 1]]);
  const first = f.advance(.1)[0][0], middle = f.advance(.5)[0][0];
  assert.ok(first > 0 && first < .25, `first ${first}`);
  assert.ok(middle > first && middle < 1);
  assert.equal(f.advance(2)[0][0], 1);
});

test('a new palette during a crossfade continues from the colour on screen', () => {
  const f = new StopFader([[0, 0, 0]]);
  f.set([[1, 1, 1]]);
  const before = f.advance(.6)[0][0];
  f.set([[0, 1, 0]]);
  assert.ok(Math.abs(f.advance(1 / 60)[0][0] - before) < .05);
});

test('a form change fades out, swaps, and fades in', () => {
  const f = new FormFader(1);
  f.set(2);
  const down = f.advance(.1);
  assert.equal(down.type, 1);
  assert.ok(down.strength < 1 && down.strength > 0);
  const swapped = f.advance(.5);
  assert.equal(swapped.type, 2);
  assert.ok(swapped.strength < 1);
  assert.deepEqual(f.advance(1), { type: 2, strength: 1 });
});

test('a form appearing from none grows from nothing', () => {
  const f = new FormFader(0);
  f.set(1);
  const first = f.advance(1 / 60);
  assert.equal(first.type, 1);
  assert.ok(first.strength < .1);
});
