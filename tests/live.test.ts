import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLiveSettings, validateLiveSettings, RELIEF_PRESETS, PAINT_CONTROLS } from '../src/live/settings';
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
  assert.deepEqual(saved.relief, { ...d.relief, depth: 1.25, reach: 0, settle: 2 });
  assert.equal(validateLiveSettings({ relief: { settle: null } }).relief.settle, d.relief.settle);
});

test('Relief presets round-trip and invalid materials fall back independently', () => {
  for (const preset of RELIEF_PRESETS) {
    assert.deepEqual(validateLiveSettings({ relief: preset.settings }).relief, preset.settings);
  }
  const style = validateLiveSettings({ relief: { surface: 'weave', motion: 'toString', finish: null, edgeLight: 2 } }).relief;
  assert.deepEqual([style.surface, style.motion, style.finish, style.edgeLight], ['weave', 'sweep', 'silver', 1]);
});

test('saved Broad and Medium Relief sizes migrate to Fine', () => {
  for (const size of ['broad', 'medium']) {
    const saved = validateLiveSettings({ look: 'relief', relief: { surface: 'scales', size, depth: .65 } });
    assert.equal(saved.relief.size, 'fine');
    assert.equal(saved.relief.depth, .65);
  }
  assert.equal(validateLiveSettings({ relief: { size: 'extraFine' } }).relief.size, 'extraFine');
});

test('Relief colour schemes persist and old settings use the finish colours', () => {
  assert.equal(validateLiveSettings({ look: 'relief' }).reliefPalette, 'material');
  assert.equal(validateLiveSettings({ reliefPalette: 'constructor' }).reliefPalette, 'material');
  assert.equal(validateLiveSettings({ reliefPalette: 'cyber' }).reliefPalette, 'cyber');
});

import { SIGNAL_CONTROLS, SIGNAL_STARTS } from '../src/live/settings';
test('Signal settings survive saving, repair bad values, and migrate older files', () => {
  const settings = defaultLiveSettings(); settings.look = 'signal'; settings.signal.hold = true;
  Object.assign(settings.signal, SIGNAL_STARTS[2].values);
  assert.deepEqual(validateLiveSettings(JSON.parse(JSON.stringify(settings))), settings);
  const bad = validateLiveSettings({ look: 'signal', signal: { memorySeconds: Infinity, blockSize: 9000, shift: -1, hold: 'yes' } });
  assert.equal(bad.signal.memorySeconds, 3); assert.equal(bad.signal.blockSize, 96); assert.equal(bad.signal.shift, 0); assert.equal(bad.signal.hold, false);
  const old = { ...settings } as Record<string, unknown>; delete old.signal;
  assert.deepEqual(validateLiveSettings(old).signal, defaultLiveSettings().signal);
  for (const start of SIGNAL_STARTS) for (const c of SIGNAL_CONTROLS) assert.ok(start.values[c.key] >= c.min && start.values[c.key] <= c.max);
});

test('Signal defaults to people only, vivid colour, and its own independent palette', () => {
  const d = defaultLiveSettings();
  assert.equal(d.signal.removeBackground, true); assert.equal(d.signal.vividness, 1);
  const restored = validateLiveSettings({ look: 'signal', signal: { removeBackground: false, palette: CANDY, maskThreshold: 9, maskSoftness: 0 } });
  assert.equal(restored.signal.removeBackground, false); assert.deepEqual(restored.signal.palette, CANDY);
  assert.equal(restored.signal.maskThreshold, .85); assert.equal(restored.signal.maskSoftness, .01);
  assert.deepEqual(restored.smoke.palette, HOT_SIGNAL);
  assert.equal(validateLiveSettings({signal:{removeBackground:'no'}}).signal.removeBackground,true);
  assert.deepEqual(validateLiveSettings({signal:{palette:['bad']}}).signal.palette,d.signal.palette);
});

import { personStillTimeout } from '../src/live/settings';
test('Still poses participate in Signal without changing Smoke still-object settings', () => {
  const s=defaultLiveSettings();s.look='signal';s.people.ignoreStillSeconds=10;
  assert.equal(personStillTimeout(s),null);
  s.signal.keepStill=false;assert.equal(personStillTimeout(s),10);
  s.look='smoke';s.signal.keepStill=true;assert.equal(personStillTimeout(s),10);
  assert.equal(validateLiveSettings({signal:{keepStill:false}}).signal.keepStill,false);
  assert.equal(validateLiveSettings({signal:{keepStill:'yes',chargeSeconds:99,halo:-1}}).signal.keepStill,true);
  assert.equal(validateLiveSettings({signal:{chargeSeconds:99}}).signal.chargeSeconds,8);
  assert.equal(validateLiveSettings({signal:{halo:-1}}).signal.halo,0);
});

import * as THREE from 'three';
import { KALEIDOSCOPE_LIVE, usesPeople } from '../src/live/settings';
import { Kaleidoscope, advancePhase, liveKaleidoscopeUniforms } from '../src/live/Kaleidoscope';
import type { Passes } from '../src/live/passes';
import type { TrackingFeed } from '../src/live/look';

test('old settings keep their look and gain the kaleidoscope defaults', () => {
  const { kaleidoscope: _dropped, ...old } = { ...defaultLiveSettings(), look: 'smoke' as const };
  const s = validateLiveSettings(old);
  assert.equal(s.look, 'smoke');
  assert.deepEqual(s.kaleidoscope, { group: 0, sectors: 6, cell: 1, spiral: false, spin: .1, zoom: 1 });
});
test('the kaleidoscope look survives sanitising', () => {
  const s = validateLiveSettings({ ...defaultLiveSettings(), look: 'kaleidoscope', kaleidoscope: { group: 3, sectors: 12, cell: 2.5, spiral: true, spin: -.5, zoom: -2 } });
  assert.equal(s.look, 'kaleidoscope');
  assert.deepEqual(s.kaleidoscope, { group: 3, sectors: 12, cell: 2.5, spiral: true, spin: -.5, zoom: -2 });
});
test('kaleidoscope settings clamp, round and repair', () => {
  const high = validateLiveSettings({ kaleidoscope: { group: 9, sectors: 99, cell: 9, spiral: 'yes', spin: 5, zoom: 50 } }).kaleidoscope;
  assert.deepEqual(high, { group: 4, sectors: 24, cell: 4, spiral: false, spin: 1, zoom: 4 });
  const low = validateLiveSettings({ kaleidoscope: { group: -3, sectors: 1, cell: 0, spin: -5, zoom: -50 } }).kaleidoscope;
  assert.deepEqual(low, { group: 0, sectors: 3, cell: .1, spiral: false, spin: -1, zoom: -4 });
  assert.equal(validateLiveSettings({ kaleidoscope: { group: 2.6, sectors: 7.4 } }).kaleidoscope.group, 3);
  assert.equal(validateLiveSettings({ kaleidoscope: { group: 2.6, sectors: 7.4 } }).kaleidoscope.sectors, 7);
  const broken = validateLiveSettings({ kaleidoscope: { group: NaN, sectors: Infinity, cell: -Infinity, spin: NaN, zoom: '2' } }).kaleidoscope;
  assert.deepEqual(broken, { group: KALEIDOSCOPE_LIVE.group.default, sectors: KALEIDOSCOPE_LIVE.sectors.default, cell: KALEIDOSCOPE_LIVE.cell.default, spiral: false, spin: KALEIDOSCOPE_LIVE.spin.default, zoom: KALEIDOSCOPE_LIVE.zoom.default });
});
test('settings with the kaleidoscope stay under the 16 KB message cap', () => {
  const s = validateLiveSettings({ ...defaultLiveSettings(), look: 'kaleidoscope' });
  assert.ok(Buffer.byteLength(JSON.stringify({ type: 'settings', settings: s })) < 16 * 1024);
});
test('only smoke and background removal ask for people', () => {
  const d = defaultLiveSettings();
  assert.equal(usesPeople({ ...d, look: 'kaleidoscope' }), false);
  assert.equal(usesPeople({ ...d, look: 'paint' }), false);
  assert.equal(usesPeople({ ...d, look: 'smoke' }), true);
  assert.equal(usesPeople({ ...d, look: 'signal' }), true);
  assert.equal(usesPeople({ ...d, look: 'signal', signal: { ...d.signal, removeBackground: false } }), false);
});
test('phase advances by frame time, whatever the frame rate', () => {
  let fast = 0, slow = 0;
  for (let i = 0; i < 240; i++) fast = advancePhase(fast, .1, 1 / 120);
  for (let i = 0; i < 60; i++) slow = advancePhase(slow, .1, 1 / 30);
  assert.ok(Math.abs(fast - .025) < 1e-9); assert.ok(Math.abs(slow - .025) < 1e-9);
});
test('phase stays wrapped over a very long run and ignores bad input', () => {
  let phase = 0;
  for (let i = 0; i < 200000; i++) { phase = advancePhase(phase, -1, .05); assert.ok(phase >= 0 && phase < 1); }
  assert.equal(advancePhase(.25, NaN, 1), .25);
  assert.equal(advancePhase(.25, 1, Infinity), .25);
  assert.ok(advancePhase(0, -1e-30, 1) < 1);
});
test('live uniforms use the shared shader controls with no drift', () => {
  const u = liveKaleidoscopeUniforms({ group: 2, sectors: 9, cell: 1.5, spiral: true, spin: .1, zoom: 1 }, .25, .5);
  assert.equal(u.uKGroup, 2); assert.equal(u.uKSectors, 9); assert.equal(u.uKCell, 1.5); assert.equal(u.uKSpiral, 1);
  assert.equal(u.uKSourceDrift, 0); assert.equal(u.uKZoom, .5);
  assert.ok(Math.abs((u.uKSourceTurn as number) - Math.PI / 2) < 1e-12);
});

/** Passes with no GPU: records what each draw read and wrote. */
function fakeLook() {
  const draws: { output: THREE.WebGLRenderTarget | null; read: unknown[]; empty: unknown }[] = [];
  const passes = {
    target: (w: number, h: number) => new THREE.WebGLRenderTarget(w, h),
    material: (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ fragmentShader, uniforms }),
    draw: (material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget | null) => {
      const read = Object.values(material.uniforms).map(u => u.value).filter(v => (v as THREE.Texture)?.isTexture);
      draws.push({ output, read, empty: material.uniforms.uKEmpty?.value });
    },
  } as unknown as Passes;
  const look = new Kaleidoscope(passes, 1920, 1080);
  const camera = new THREE.WebGLRenderTarget(1280, 720).texture;
  const feed = (newImage: boolean, texture: THREE.Texture = camera, fresh = false, hasImage = newImage) => ({ camera: texture, newImage, fresh, hasImage }) as unknown as TrackingFeed;
  const settings = { ...defaultLiveSettings(), look: 'kaleidoscope' as const };
  return { look, draws, feed, settings, camera };
}
test('the look is dark until a frame arrives, and copies only on fresh frames', () => {
  const { look, draws, feed, settings } = fakeLook();
  look.step(.016, 0, feed(false), settings);
  assert.equal(draws.length, 1); assert.equal(draws[0].empty, 1); assert.equal(draws[0].read.length, 0);
  look.step(.016, 0, feed(true), settings);
  assert.equal(draws.length, 3, 'one copy and one picture'); assert.equal(draws[2].empty, 0);
  look.step(.016, 0, feed(false), settings);
  assert.equal(draws.length, 4, 'a held frame is not copied again'); assert.equal(draws[3].empty, 0);
});
test('the look copies on a new image, whether or not movement could be measured', () => {
  const { look, draws, feed, settings, camera } = fakeLook();
  look.step(.016, 0, feed(true, camera, false), settings);
  assert.equal(draws.length, 2, 'a slow frame is copied'); assert.equal(draws[1].empty, 0);
  look.step(.016, 0, feed(false, camera, true), settings);
  assert.equal(draws.length, 3, 'no new image, no copy');
});
test('no draw samples the target it writes', () => {
  const { look, draws, feed, settings } = fakeLook();
  for (const fresh of [false, true, true, false, true]) look.step(.016, 0, feed(fresh), settings);
  for (const d of draws) assert.ok(!d.read.includes(d.output?.texture), 'feedback loop');
});
test('clear drops the held frame until a new one arrives', () => {
  const { look, draws, feed, settings } = fakeLook();
  look.step(.016, 0, feed(true), settings);
  look.clear();
  look.step(.016, 0, feed(false), settings);
  assert.equal(draws.at(-1)!.empty, 1); assert.equal(draws.at(-1)!.read.length, 0);
  look.step(.016, 0, feed(true), settings);
  assert.equal(draws.at(-1)!.empty, 0);
});
test('a new look on a frozen source shows the frame Tracking still holds', () => {
  const { look, draws, feed, settings, camera } = fakeLook();
  look.step(.016, 0, feed(false, camera, false, true), settings);
  assert.equal(draws.length, 2, 'one seed and one picture');
  assert.ok(draws[0].read.includes(camera)); assert.equal(draws[1].empty, 0);
  look.step(.016, 0, feed(false, camera, false, true), settings);
  assert.equal(draws.length, 3, 'seeded once, not every frame');
});
test('Clear on a frozen source returns to the frame Tracking holds', () => {
  const { look, draws, feed, settings, camera } = fakeLook();
  look.step(.016, 0, feed(true), settings);
  look.clear();
  look.step(.016, 0, feed(false, camera, false, true), settings);
  assert.ok(draws.at(-2)!.read.includes(camera)); assert.equal(draws.at(-1)!.empty, 0);
});
test('Clear with no source stays calmly dark and reads no texture', () => {
  const { look, draws, feed, settings, camera } = fakeLook();
  look.step(.016, 0, feed(true), settings);
  look.clear();
  for (let i = 0; i < 3; i++) look.step(.016, 0, feed(false, camera, false, false), settings);
  assert.equal(draws.at(-1)!.empty, 1); assert.equal(draws.at(-1)!.read.length, 0);
});
test('a closed source keeps the held picture until Clear, then stays dark', () => {
  const { look, draws, feed, settings, camera } = fakeLook();
  look.step(.016, 0, feed(true), settings);
  look.step(.016, 0, feed(false, camera, false, false), settings);
  assert.equal(draws.at(-1)!.empty, 0, 'the last picture holds');
  look.clear();
  look.step(.016, 0, feed(false, camera, false, false), settings);
  assert.equal(draws.at(-1)!.empty, 1);
});
test('a new look with no source never reads the feed', () => {
  const { look, draws, feed, settings, camera } = fakeLook();
  look.step(.016, 0, feed(false, camera, false, false), settings);
  assert.equal(draws.length, 1); assert.equal(draws[0].empty, 1); assert.equal(draws[0].read.length, 0);
});
test('a camera texture of a new size is followed without losing the look', () => {
  const { look, draws, feed, settings } = fakeLook();
  look.step(.016, 0, feed(true), settings);
  const other = new THREE.WebGLRenderTarget(640, 480).texture;
  look.step(.016, 0, feed(true, other), settings);
  assert.ok(draws.at(-2)!.read.includes(other)); assert.equal(draws.at(-1)!.empty, 0);
  look.dispose();
});
