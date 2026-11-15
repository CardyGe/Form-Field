import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLiveSettings, validateLiveSettings, PAINT_CONTROLS } from '../src/live/settings';
import { MAX_STEP, capStep, fadeFactor, boxWeight, birthChance } from '../src/live/maths';

test('defaults validate to themselves', () => assert.deepEqual(validateLiveSettings(defaultLiveSettings()), defaultLiveSettings()));
test('every paint control has a default inside its range', () => {
  assert.equal(PAINT_CONTROLS.length, 7);
  for (const c of PAINT_CONTROLS) { assert.ok(c.default >= c.min && c.default <= c.max, c.key); assert.equal(defaultLiveSettings().paint[c.key], c.default); }
});
test('damaged settings fall back field by field', () => {
  const s = validateLiveSettings({ version: 9, mirror: 'no', paint: { fadeSeconds: 9999, response: 2 }, box: { left: .8, right: .2 }, palette: ['red'] });
  const d = defaultLiveSettings();
  assert.equal(s.mirror, d.mirror); assert.equal(s.paint.fadeSeconds, 120); assert.equal(s.paint.response, 2);
  assert.deepEqual(s.box, d.box); assert.deepEqual(s.palette, d.palette);
});
test('garbage is defaults', () => { for (const v of [null, 'x', 7, []]) assert.deepEqual(validateLiveSettings(v), defaultLiveSettings()); });
test('a stall is capped', () => { assert.equal(capStep(5), MAX_STEP); assert.equal(capStep(-1), 0); assert.equal(capStep(NaN), 0); assert.equal(capStep(.01), .01); });
test('fade leaves 5% after the fade time', () => assert.ok(Math.abs(fadeFactor(30, 30) - Math.exp(-3)) < 1e-12));
test('box weight', () => { const b = { left: .25, right: .75, bottom: 0, top: 1 }; assert.equal(boxWeight(.5, .5, b), 1); assert.equal(boxWeight(.1, .5, b), 0); });
test('still input births nothing', () => { assert.equal(birthChance(0, 3, MAX_STEP), 0); assert.equal(birthChance(1, 3, MAX_STEP), .5); assert.equal(birthChance(9, 3, MAX_STEP), 1); });

import { stateFromError } from '../src/live/source';
test('camera errors become plain states', () => {
  assert.deepEqual(stateFromError('NotAllowedError'), { status: 'refused' });
  assert.deepEqual(stateFromError('NotFoundError'), { status: 'none' });
  assert.deepEqual(stateFromError('OverconstrainedError'), { status: 'none' });
  assert.equal(stateFromError('Boom').status, 'error');
});

import { chooseDisplay } from '../src/live/settings';
test('a display that has gone is replaced, preferring one that is not this screen', () => {
  const both = [{ id: 1, primary: true }, { id: 7, primary: false }];
  assert.equal(chooseDisplay(both, 1), 1);
  assert.equal(chooseDisplay(both, 7), 7);
  assert.equal(chooseDisplay(both, 99), 7);
  assert.equal(chooseDisplay(both, null), 7);
  assert.equal(chooseDisplay([both[0]], 7), 1);
  assert.equal(chooseDisplay([], 7), null);
});
