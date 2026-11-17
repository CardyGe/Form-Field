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

import { SMOKE_STARTS, SMOKE_CONTROLS } from '../src/live/settings';
import { paletteRamp } from '../src/live/colour';
import { ignoreStillWeight, personWeight } from '../src/live/maths';
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
test('the three starting points set every smoke control, and differ', () => {
  assert.deepEqual(SMOKE_STARTS.map(s => s.label), ['Wispy', 'Smouldering', 'Solid']);
  assert.deepEqual(SMOKE_STARTS.map(s => [s.values.density, s.values.smoulder, s.values.rise, s.values.swirl, s.values.lifeSeconds, s.values.response]),
    [[.25, .9, .8, .45, 4, 1.5], [.6, .5, .4, .35, 6, 1], [1, .1, .15, .2, 10, .7]]);
});
test('Smouldering is where Smoke starts', () => {
  const d = defaultLiveSettings().smoke, start = SMOKE_STARTS[1].values;
  for (const key of Object.keys(start) as (keyof typeof start)[]) assert.equal(d[key], start[key], key);
});
test('a settings file with Burn away loads with Density instead', () => {
  const s = validateLiveSettings({ look: 'smoke', smoke: { burnAway: .9, density: .3 } });
  assert.equal('burnAway' in s.smoke, false); assert.equal(s.smoke.density, .3);
});
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
test('empty room only applies once captured', () => {
  assert.equal(personWeight(1, 1, 1, { use: true, captured: false, differs: 0 }), 1);
  assert.equal(personWeight(1, 1, 1, { use: true, captured: true, differs: 0 }), 0);
  assert.equal(personWeight(1, 0, 1, { use: false, captured: false, differs: 1 }), 0);
});

import { MaskGate, READY_MS, RestartPolicy } from '../src/live/MaskProvider';
test('one frame at a time goes to the model; the rest are dropped', () => {
  let now = 0; const gate = new MaskGate(() => now);
  assert.equal(gate.offer(), true); assert.equal(gate.offer(), false);
  gate.received(); assert.equal(gate.offer(), true);
});
test('people are ready only while masks keep arriving', () => {
  let now = 0; const gate = new MaskGate(() => now);
  assert.equal(gate.ready, false);
  gate.offer(); now = 30; gate.received(); assert.equal(gate.ready, true);
  now = 30 + READY_MS + 1; assert.equal(gate.ready, false);
});
test('a frame the model is slow with makes it behind, and no second frame is sent', () => {
  let now = 0; const gate = new MaskGate(() => now);
  gate.offer(); assert.equal(gate.behind, false);
  now = READY_MS + 1; assert.equal(gate.behind, true); assert.equal(gate.offer(), false);
});
test('a frame that could not be sent frees the gate without counting as a mask', () => {
  let now = 0; const gate = new MaskGate(() => now);
  gate.offer(); gate.cancelled(); assert.equal(gate.ready, false); assert.equal(gate.offer(), true);
  gate.received(); now = 1500; gate.offer(); gate.cancelled(); now = READY_MS + 100; assert.equal(gate.ready, false);
});
test('person finding restarts twice, the second time on the CPU, then gives up', () => {
  const policy = new RestartPolicy();
  assert.equal(policy.failed(), 'restart'); assert.equal(policy.failed(), 'restart-cpu'); assert.equal(policy.failed(), 'give-up');
});
test('a mask after a restart resets the count of restarts', () => {
  const policy = new RestartPolicy();
  policy.failed(); policy.succeeded(); assert.equal(policy.failed(), 'restart');
});
test('near-black palette entries are left out of the ramp, so people never go black', () => {
  for (const palette of [POUR, HOT_SIGNAL]) assert.ok(paletteRamp(palette).every(([r, g, b]) => .2126 * r + .7152 * g + .0722 * b > .01), palette.join());
});
test('Smoke life goes up to 12 seconds, and longer saved values are brought down to it', () => {
  assert.equal(SMOKE_CONTROLS.find(c => c.key === 'lifeSeconds')!.max, 12);
  assert.equal(validateLiveSettings({ smoke: { lifeSeconds: 20 } }).smoke.lifeSeconds, 12);
});
test('Emit runs 0 to 1, defaults to 0.6, and the starting points leave it alone', () => {
  const emit = SMOKE_CONTROLS.find(c => c.key === 'emit')!;
  assert.deepEqual([emit.label, emit.min, emit.max, emit.default], ['Emit', 0, 1, .6]);
  for (const start of SMOKE_STARTS) assert.equal('emit' in start.values, false, start.label);
});
test('Forever is off unless saved as true', () => {
  assert.equal(defaultLiveSettings().smoke.forever, false);
  assert.equal(validateLiveSettings({ smoke: { forever: true } }).smoke.forever, true);
  assert.equal(validateLiveSettings({ smoke: { forever: 'yes' } }).smoke.forever, false);
});

test('Swirl is now Calm ↔ Wild, calmer by default', () => {
  const wild = SMOKE_CONTROLS.find(c => c.key === 'swirl')!;
  assert.deepEqual([wild.label, wild.min, wild.max, wild.default], ['Calm ↔ Wild', 0, 1, .35]);
});
test('Vividness runs 0 to 1, defaults high, and the starting points leave it alone', () => {
  const vivid = SMOKE_CONTROLS.find(c => c.key === 'vividness')!;
  assert.deepEqual([vivid.label, vivid.min, vivid.max, vivid.default], ['Vividness', 0, 1, .8]);
  for (const start of SMOKE_STARTS) assert.equal('vividness' in start.values, false, start.label);
});

test('Relief loads old settings and validates each control independently', () => {
  const d = defaultLiveSettings();
  assert.deepEqual(validateLiveSettings({ look: 'smoke' }).relief, d.relief);
  const saved = validateLiveSettings({ look: 'relief', relief: { depth: 99, reach: -.1, settle: 2 } });
  assert.equal(saved.look, 'relief');
  assert.deepEqual(saved.relief, { depth: 1.25, reach: 0, settle: 2 });
  assert.equal(validateLiveSettings({ relief: { settle: null } }).relief.settle, d.relief.settle);
});
