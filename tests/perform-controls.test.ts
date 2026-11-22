import test from 'node:test';
import assert from 'node:assert/strict';
import { applyControl, holdForReconnect, initialControls, knobOffset, speedFactor } from '../src/perform/controls';
import type { ControlEvent, ControlValues } from '../src/perform/controls';

/** A show whose Send All has finished. */
function ready(): ControlValues {
  let v = initialControls();
  v = applyControl(v, { kind: 'sendAllStart' }, false).values;
  v = applyControl(v, { kind: 'sendAllEnd' }, false).values;
  return v;
}
const press = (e: ControlEvent, shift = false) => applyControl(ready(), e, shift).actions;

test('initial values', () => {
  const v = initialControls();
  assert.equal(v.faders.length, 8);
  assert.ok(v.faders.every((f) => f === 0));
  assert.equal(v.knobs.length, 8);
  assert.ok(v.knobs.every((k) => k.length === 3 && k.every((x) => x === 0.5)));
  assert.equal(v.master, 0);
  assert.equal(v.ready, false);
  assert.ok(v.held.every((h) => h === false));
});

test('Amber next, shift + Amber previous', () => {
  assert.deepEqual(press({ kind: 'amber', strip: 2, down: true }), [{ type: 'next', zone: 2 }]);
  assert.deepEqual(press({ kind: 'amber', strip: 2, down: true }, true), [{ type: 'previous', zone: 2 }]);
  assert.deepEqual(press({ kind: 'amber', strip: 2, down: false }), []);
});

test('Red burst down and up, shift + Red stop', () => {
  assert.deepEqual(press({ kind: 'red', strip: 7, down: true }), [{ type: 'burst', zone: 7, on: true }]);
  assert.deepEqual(press({ kind: 'red', strip: 7, down: false }), [{ type: 'burst', zone: 7, on: false }]);
  assert.deepEqual(press({ kind: 'red', strip: 7, down: true }, true), [{ type: 'stop', zone: 7 }]);
  // releasing Red after shift came down must not leave a burst stuck on
  assert.deepEqual(press({ kind: 'red', strip: 7, down: false }, true), [{ type: 'burst', zone: 7, on: false }]);
});

test('Bank buttons and their shifted functions', () => {
  assert.deepEqual(press({ kind: 'bankNext', down: true }), [{ type: 'bankNext' }]);
  assert.deepEqual(press({ kind: 'bankNext', down: true }, true), [{ type: 'launchNow' }]);
  assert.deepEqual(press({ kind: 'bankBack', down: true }), [{ type: 'bankBack' }]);
  assert.deepEqual(press({ kind: 'bankBack', down: true }, true), [{ type: 'downbeat' }]);
  assert.deepEqual(press({ kind: 'bankNext', down: false }), []);
  assert.deepEqual(press({ kind: 'bankBack', down: false }, true), []);
});

test('Solo is shift: it follows the button and makes no action', () => {
  const v = ready();
  const down = applyControl(v, { kind: 'solo', down: true }, false);
  assert.equal(down.shift, true);
  assert.deepEqual(down.actions, []);
  const up = applyControl(v, { kind: 'solo', down: false }, true);
  assert.equal(up.shift, false);
  assert.equal(applyControl(v, { kind: 'amber', strip: 0, down: true }, true).shift, true);
});

test('knobs, faders and master set values, clamped, without mutating the input', () => {
  const v = ready();
  const snapshot = JSON.stringify(v);
  let r = applyControl(v, { kind: 'knob', strip: 3, knob: 1, value: 0.8 }, false);
  assert.equal(r.values.knobs[3][1], 0.8);
  assert.equal(r.values.knobs[3][0], 0.5);
  r = applyControl(r.values, { kind: 'fader', strip: 4, value: 2 }, false);
  assert.equal(r.values.faders[4], 1);
  r = applyControl(r.values, { kind: 'master', value: 0.25 }, false);
  assert.equal(r.values.master, 0.25);
  assert.deepEqual(r.actions, []);
  assert.equal(JSON.stringify(v), snapshot);
});

test('nothing reaches the picture until Send All has finished', () => {
  let v = initialControls();
  v = applyControl(v, { kind: 'fader', strip: 0, value: 0.9 }, false).values;
  assert.equal(v.ready, false);
  // buttons before Send All do nothing
  assert.deepEqual(applyControl(v, { kind: 'bankNext', down: true }, false).actions, []);
  assert.deepEqual(applyControl(v, { kind: 'amber', strip: 0, down: true }, false).actions, []);
  v = applyControl(v, { kind: 'sendAllStart' }, false).values;
  assert.equal(v.ready, false);
  v = applyControl(v, { kind: 'fader', strip: 1, value: 0.4 }, false).values;
  v = applyControl(v, { kind: 'knob', strip: 1, knob: 2, value: 0.1 }, false).values;
  v = applyControl(v, { kind: 'master', value: 0.7 }, false).values;
  assert.equal(v.ready, false);
  v = applyControl(v, { kind: 'sendAllEnd' }, false).values;
  assert.equal(v.ready, true);
  assert.equal(v.faders[1], 0.4);
  assert.equal(v.knobs[1][2], 0.1);
  assert.equal(v.master, 0.7);
  assert.deepEqual(applyControl(v, { kind: 'bankNext', down: true }, false).actions, [{ type: 'bankNext' }]);
});

test('holdForReconnect keeps the values and the show running', () => {
  let v = ready();
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.6 }, false).values;
  const snapshot = JSON.stringify(v);
  const h = holdForReconnect(v);
  assert.equal(JSON.stringify(v), snapshot);
  assert.equal(h.ready, true);
  assert.equal(h.faders[2], 0.6);
  assert.ok(h.held.every((x) => x === true));
});

test('after reconnect a fader takes over only when it crosses its held value', () => {
  let v = ready();
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.6 }, false).values;
  v = holdForReconnect(v);
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.2 }, false).values;
  assert.equal(v.faders[2], 0.6);
  assert.equal(v.held[2], true);
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.7 }, false).values;
  assert.equal(v.faders[2], 0.7);
  assert.equal(v.held[2], false);
  // once taken over it follows freely
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.1 }, false).values;
  assert.equal(v.faders[2], 0.1);
});

test('a held knob and master cross the same way, from above too', () => {
  let v = ready();
  v = applyControl(v, { kind: 'knob', strip: 5, knob: 0, value: 0.3 }, false).values;
  v = applyControl(v, { kind: 'master', value: 0.5 }, false).values;
  v = holdForReconnect(v);
  v = applyControl(v, { kind: 'knob', strip: 5, knob: 0, value: 0.9 }, false).values;
  assert.equal(v.knobs[5][0], 0.3);
  v = applyControl(v, { kind: 'knob', strip: 5, knob: 0, value: 0.2 }, false).values;
  assert.equal(v.knobs[5][0], 0.2);
  v = applyControl(v, { kind: 'master', value: 0.9 }, false).values;
  assert.equal(v.master, 0.5);
  v = applyControl(v, { kind: 'master', value: 0.4 }, false).values;
  assert.equal(v.master, 0.4);
});

test('a held fader that lands exactly on its value takes over', () => {
  let v = ready();
  v = applyControl(v, { kind: 'fader', strip: 0, value: 0.6 }, false).values;
  v = holdForReconnect(v);
  v = applyControl(v, { kind: 'fader', strip: 0, value: 0.6 }, false).values;
  assert.equal(v.held[0], false);
});

test('buttons still work while values are held', () => {
  const v = holdForReconnect(ready());
  assert.deepEqual(applyControl(v, { kind: 'bankNext', down: true }, false).actions, [{ type: 'bankNext' }]);
});

test('Send All after reconnect takes every value at once', () => {
  let v = ready();
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.6 }, false).values;
  v = holdForReconnect(v);
  v = applyControl(v, { kind: 'sendAllStart' }, false).values;
  assert.equal(v.ready, true, 'the picture keeps running during Send All');
  v = applyControl(v, { kind: 'fader', strip: 2, value: 0.2 }, false).values;
  v = applyControl(v, { kind: 'knob', strip: 0, knob: 0, value: 0.9 }, false).values;
  v = applyControl(v, { kind: 'master', value: 0.3 }, false).values;
  v = applyControl(v, { kind: 'sendAllEnd' }, false).values;
  assert.equal(v.faders[2], 0.2);
  assert.equal(v.knobs[0][0], 0.9);
  assert.equal(v.master, 0.3);
  assert.ok(v.held.every((x) => x === false));
  assert.equal(v.ready, true);
});

test('knob dead zone', () => {
  assert.equal(knobOffset(0.5), 0);
  assert.equal(knobOffset(0.53), 0);
  assert.equal(knobOffset(0.47), 0);
  assert.equal(knobOffset(1), 1);
  assert.equal(knobOffset(0), -1);
  assert.ok(knobOffset(0.6) > 0 && knobOffset(0.6) < 0.2);
  assert.ok(knobOffset(0.4) < 0 && knobOffset(0.4) > -0.2);
});

test('free clips scale from a quarter to four times; locked clips snap to half, 1 and 2', () => {
  assert.equal(speedFactor(-1, false), 0.25);
  assert.equal(speedFactor(0, false), 1);
  assert.equal(speedFactor(1, false), 4);
  assert.equal(speedFactor(-0.8, true), 0.5);
  assert.equal(speedFactor(0.1, true), 1);
  assert.equal(speedFactor(0.8, true), 2);
});
