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

import { SMOKE_STARTS } from '../src/live/settings';
import { paletteRamp } from '../src/live/colour';
import { ignoreStillWeight, burnFade, personWeight } from '../src/live/maths';
import { HOT_SIGNAL, POUR, CANDY } from '../src/core/palettes';
test('a 0.15.0 settings file loads unchanged as Paint', () => {
  const old = { ...defaultLiveSettings() } as Record<string, unknown>; delete old.look; delete old.smoke; delete old.people;
  const s = validateLiveSettings(old);
  assert.equal(s.look, 'paint'); assert.deepEqual(s.paint, defaultLiveSettings().paint); assert.deepEqual(s.palette, defaultLiveSettings().palette);
  assert.deepEqual(s.smoke, defaultLiveSettings().smoke); assert.deepEqual(s.people, { ignoreStillSeconds: 30, useEmptyRoom: false });
});
test('smoke settings repair field by field and keep their own palette', () => {
  const s = validateLiveSettings({ look: 'smoke', smoke: { smoulder: 7, rise: .2, palette: ['#000000'] }, people: { ignoreStillSeconds: 5, useEmptyRoom: 'yes' } });
  assert.equal(s.look, 'smoke'); assert.equal(s.smoke.smoulder, 1); assert.equal(s.smoke.rise, .2);
  assert.deepEqual(s.smoke.palette, HOT_SIGNAL); assert.equal(s.people.ignoreStillSeconds, 10); assert.equal(s.people.useEmptyRoom, false);
  assert.equal(validateLiveSettings({ people: { ignoreStillSeconds: null } }).people.ignoreStillSeconds, null);
  assert.equal(validateLiveSettings({ look: 'dust' }).look, 'paint');
});
test('the three starting points', () => assert.deepEqual(SMOKE_STARTS.map(s => [s.smoulder, s.burnAway]), [[0, 0], [.5, 0], [.9, .9]]));
test('the ramp leaves out the ground colour and runs dark to light', () => {
  for (const palette of [HOT_SIGNAL, POUR, CANDY]) {
    const ramp = paletteRamp(palette), lum = ramp.map(([r, g, b]) => .2126 * r + .7152 * g + .0722 * b);
    assert.equal(ramp.length, 5); assert.deepEqual([...lum].sort((a, b) => a - b), lum);
  }
  assert.ok(!paletteRamp(HOT_SIGNAL).some(c => c.every(v => v < .02)), 'Hot Signal ground colour leaked in');
});
test('sway keeps a still person counted; nothing moved for longer than the time drops out', () => {
  assert.equal(ignoreStillWeight(29, 30), 1); assert.equal(ignoreStillWeight(33, 30), 0); assert.equal(ignoreStillWeight(1e6, null), 1);
});
test('burn away starts after a second still and is complete at three', () => {
  assert.equal(burnFade(.9, .8), 0); assert.ok(Math.abs(burnFade(3, .8) - .8) < 1e-9); assert.equal(burnFade(10, 0), 0);
});
test('empty room only applies once captured', () => {
  assert.equal(personWeight(1, 1, 1, { use: true, captured: false, differs: 0 }), 1);
  assert.equal(personWeight(1, 1, 1, { use: true, captured: true, differs: 0 }), 0);
  assert.equal(personWeight(1, 0, 1, { use: false, captured: false, differs: 1 }), 0);
});
