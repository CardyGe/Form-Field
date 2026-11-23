import test from 'node:test';
import assert from 'node:assert/strict';
import { MidimixMode } from '../src/morphogen/midimix-mode';
import { MIDIMIX_MAP, midimixInputs, type MidimixMap } from '../src/morphogen/midimix-map';
import { acceptSignals } from '../src/react/signals';
import { MACROS, neutralMacros } from '../src/morphogen/macros';
import { MorphPerformer } from '../src/morphogen/performer';
import { defaultMorphParams } from '../src/morphogen/params';
import type { Signals } from '../src/react/signals';

const map: MidimixMap = {
  confirmed: true,
  knobs: [0, 1, 2].map(row => Array.from({ length: 8 }, (_, strip) => `midi.cc.1.${10 * (row + 1) + strip}`)),
  faders: Array.from({ length: 8 }, (_, strip) => `midi.cc.1.${50 + strip}`), master: 'midi.cc.1.60',
  amber: Array.from({ length: 8 }, (_, strip) => `midi.note.1.${strip}`), red: Array.from({ length: 8 }, (_, strip) => `midi.note.1.${10 + strip}`),
  solo: 'midi.note.1.20', sendAll: 'midi.note.1.21',
};
const STEP = 1 / 60;

class Spy extends MorphPerformer {
  calls: string[] = [];
  override morphTo(index: number, seconds: number) { this.calls.push(`morph:${index}:${seconds}`); super.morphTo(index, seconds); }
  override hold(on: boolean) { this.calls.push(`hold:${on}`); super.hold(on); }
  override mutate(seed: number) { this.calls.push('mutate'); super.mutate(seed); }
  override scramble() { this.calls.push('scramble'); super.scramble(); }
  override undo() { this.calls.push('undo'); super.undo(); }
}
function rig() {
  const performer = new Spy(), mode = new MidimixMode(map, performer), signals: Signals = {}, current = neutralMacros();
  const tick = () => mode.update(signals, STEP, current);
  const press = (name: string) => { signals[name] = 1; const on = tick(); signals[name] = 0; tick(); return on; };
  const enter = () => { signals[map.solo] = 1; press(map.sendAll); signals[map.solo] = 0; return tick(); };
  return { performer, mode, signals, current, tick, press, enter };
}

test('Solo + Send All toggles the mode once per press', () => {
  const r = rig();
  assert.equal(r.tick().active, false);
  r.signals[map.solo] = 1;
  r.signals[map.sendAll] = 1;
  for (let i = 0; i < 20; i++) assert.equal(r.tick().active, true);
  r.signals[map.sendAll] = 0; r.tick();
  r.signals[map.sendAll] = 1;
  assert.equal(r.tick().active, false);
});

test('Send All alone does not enter the mode', () => {
  const r = rig();
  r.press(map.sendAll);
  assert.equal(r.tick().active, false);
});

test('controls do nothing outside the mode', () => {
  const r = rig();
  r.signals[map.knobs[0][0]] = 1; r.tick();
  r.press(map.amber[2]); r.press(map.red[1]);
  assert.deepEqual(r.performer.calls.filter(c => c !== 'hold:false'), []);
  assert.equal(r.tick().macros.growth, .5);
});

test('a knob takes over only when it passes through the current value', () => {
  const r = rig();
  r.signals[map.knobs[0][0]] = .9;
  r.enter();
  assert.equal(r.tick().macros.growth, .5);
  r.signals[map.knobs[0][0]] = .7;
  assert.equal(r.tick().macros.growth, .5);
  r.signals[map.knobs[0][0]] = .4;
  assert.equal(r.tick().macros.growth, .4);
  r.signals[map.knobs[0][0]] = .8;
  assert.equal(r.tick().macros.growth, .8);
});

test('each of the eight knobs drives its own macro', () => {
  const r = rig();
  r.enter();
  MACROS.forEach((key, strip) => { r.signals[map.knobs[0][strip]] = .5; r.tick(); r.signals[map.knobs[0][strip]] = .1 + strip * .05; assert.equal(r.tick().macros[key], .1 + strip * .05, key); });
});

test('ambers morph to looks and ignore strips with no look', () => {
  const r = rig();
  r.enter();
  r.press(map.amber[2]);
  assert.ok(r.performer.calls.some(c => c.startsWith('morph:2:')));
  r.performer.calls.length = 0;
  r.press(map.amber[6]); r.press(map.amber[7]);
  assert.ok(!r.performer.calls.some(c => c.startsWith('morph:')));
});

test('with a running beat a morph waits for the next beat', () => {
  const r = rig();
  r.signals['tempo.bpm'] = 120; r.signals['tempo.beat'] = 10;
  r.enter();
  r.press(map.amber[3]);
  assert.ok(!r.performer.calls.some(c => c.startsWith('morph:')));
  assert.equal(r.tick().lights.queued, 3);
  r.signals['tempo.beat'] = 11;
  const after = r.tick();
  assert.ok(r.performer.calls.some(c => c.startsWith('morph:3:')));
  assert.equal(after.lights.queued, null);
  assert.equal(after.lights.amber[3], true);
});

test('a stopped clock cannot hold a queued morph for ever', () => {
  const r = rig();
  r.signals['tempo.bpm'] = 120; r.signals['tempo.beat'] = 10;
  r.enter();
  r.press(map.amber[1]);
  for (let i = 0; i < 90; i++) r.tick();
  assert.ok(r.performer.calls.some(c => c.startsWith('morph:1:')));
});

test('reds fire Hold, Mutate, Scramble and Undo', () => {
  const r = rig();
  r.enter(); r.performer.calls.length = 0;
  r.press(map.red[0]); r.press(map.red[1]); r.press(map.red[2]); r.press(map.red[3]);
  assert.deepEqual(r.performer.calls.filter(c => c !== 'hold:false' || r.performer.calls.indexOf(c) < 0), ['hold:true', 'mutate', 'scramble', 'undo']);
  assert.equal(r.tick().lights.red[0], true);
});

test('faders are never consumed by the mode', () => {
  const r = rig();
  r.enter();
  const before = JSON.stringify(r.tick().macros);
  for (const name of [...map.faders, map.master]) r.signals[name] = .13;
  assert.equal(JSON.stringify(r.tick().macros), before);
  assert.equal(r.signals[map.master], .13);
});

test('a controller that stops sending holds every value', () => {
  const r = rig();
  r.enter();
  r.signals[map.knobs[0][4]] = .5; r.tick();
  r.signals[map.knobs[0][4]] = .22; r.tick();
  for (let i = 0; i < 600; i++) assert.equal(r.tick().macros.heat, .22);
});

test('leaving the mode mid-morph causes no jump', () => {
  const r = rig();
  r.enter();
  r.signals[map.knobs[0][1]] = .5; r.tick();
  r.signals[map.knobs[0][1]] = .83; r.tick();
  r.press(map.amber[1]);
  r.signals[map.solo] = 1; r.signals[map.sendAll] = 1;
  const left = r.tick();
  assert.equal(left.active, false);
  assert.equal(left.macros.chaos, .83);
});

test('moving the on-screen slider takes the macro back', () => {
  const r = rig();
  r.enter();
  r.signals[map.knobs[0][0]] = .5; r.tick();
  r.signals[map.knobs[0][0]] = .9; r.tick();
  r.current.growth = .2;
  assert.equal(r.tick().macros.growth, .2);
});

test('the shipped control map says plainly that it is not confirmed', () => {
  assert.equal(MIDIMIX_MAP.confirmed, false);
  assert.equal(MIDIMIX_MAP.knobs.length, 3);
  assert.equal(MIDIMIX_MAP.amber.length, 8);
  assert.equal(new Set([...MIDIMIX_MAP.knobs.flat(), ...MIDIMIX_MAP.faders, MIDIMIX_MAP.master, ...MIDIMIX_MAP.amber, ...MIDIMIX_MAP.red, MIDIMIX_MAP.solo, MIDIMIX_MAP.sendAll]).size, 24 + 8 + 1 + 16 + 2);
});

test('the signals Morphogen listens to include its controls and the beat, and never a fader', () => {
  const inputs = midimixInputs(map);
  for (const name of [...map.knobs[0], map.knobs[1][0], ...map.amber, ...map.red, map.solo, map.sendAll, 'tempo.bpm', 'tempo.beat']) assert.ok(inputs.includes(name), name);
  for (const name of [...map.faders, map.master]) assert.ok(!inputs.includes(name), name);
  for (const name of inputs) assert.ok(acceptSignals({ [name]: 1 }), name);
});

test('macros reach the performer unchanged', () => {
  const r = rig();
  r.enter();
  r.signals[map.knobs[0][7]] = .5; r.tick();
  r.signals[map.knobs[0][7]] = 1;
  const { macros } = r.tick();
  const out = r.performer.frame(STEP, defaultMorphParams(), macros).params;
  assert.ok(out.depth > defaultMorphParams().depth);
});
