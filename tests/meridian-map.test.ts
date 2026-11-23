import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';
import { needsPrepare } from '../src/map/playout';
import { wallInputs } from '../src/map/messages';
import { createShow, type ShowDocument } from '../src/map/show';
import { reactable, targetOptions, targetRange } from '../src/map/targets';
import { EVOLVE_NO_MOTION, motionIgnored, MERIDIAN_PARAMETERS } from '../src/meridian/parameters';
import { StructureHold } from '../src/meridian/structure-hold';
import { WALL_CELLS, WallFlashGuard, wallGuardPolicy } from '../src/meridian/wall-guard';
import { showReacts } from '../src/ui/show-reacts';
import type { Project } from '../src/shared/types';

const TAU = Math.PI * 2;
const meridian = (style = 2, extra: Record<string, number> = {}): Project => {
  const project = createProject(), layer = createLayer('meridian');
  Object.assign(layer.params, { scoreStyle: style, ...extra });
  project.layers = [layer];
  return project;
};
const showWith = (project: Project): ShowDocument => ({ ...createShow(), sources: [{ id: 'm', kind: 'instrument', speed: 1, revision: 1, tempoSync: null, followOutline: null, project } as ShowDocument['sources'][number]] });
const policy = (...projects: Project[]) => wallGuardPolicy(projects);
const POLICY_ON = () => policy(meridian());

/** A 48 x 27 wall, stored as the square root of linear light, as the graphics card hands it over. */
const wall = (r: number, g = r, b = r, area = 1) => {
  const out = new Uint8Array(WALL_CELLS * 4), lit = Math.round(area * WALL_CELLS);
  for (let i = 0; i < WALL_CELLS; i++) { const on = i < lit; out[i * 4] = Math.round(Math.sqrt(on ? r : 0) * 255); out[i * 4 + 1] = Math.round(Math.sqrt(on ? g : 0) * 255); out[i * 4 + 2] = Math.round(Math.sqrt(on ? b : 0) * 255); out[i * 4 + 3] = 255; }
  return out;
};
/** Counts opposing changes of over 10% light on the shown wall in the worst second. */
function worstChanges(shown: number[], fps: number): number {
  const events: number[] = []; let anchor = shown[0], way = 0;
  for (let f = 1; f < shown.length; f++) {
    const v = shown[f];
    if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - .1 && v < .8) { way = -1; anchor = v; events.push(f); }
    else if (way <= 0 && v >= anchor + .1 && anchor < .8) { way = 1; anchor = v; events.push(f); }
  }
  let worst = 0;
  for (let i = 0; i < events.length; i++) { let n = 0; for (let k = i; k < events.length && events[k] < events[i] + fps; k++) n++; worst = Math.max(worst, n); }
  return worst;
}

test('moves are link targets; the seed and its slots are not', () => {
  const show = showWith(meridian());
  for (const key of ['moveNext', 'moveHold', 'moveDrop', 'moveCollapse', 'moveBurst', 'moveMutate', 'moveReseed', 'moveRecall']) {
    assert.ok(targetRange(show, `source.m.param.0.${key}`), `${key} can be linked`);
    assert.ok(targetOptions(show).some(t => t.target === `source.m.param.0.${key}`), `${key} is offered`);
  }
  for (const key of ['seed', 'seedSlot0', 'seedSlot7']) assert.equal(targetRange(show, `source.m.param.0.${key}`), null, `${key} is refused`);
});

test('Recall can follow a pad on the Effect tab, though it counts in whole slots', () => {
  const recall = MERIDIAN_PARAMETERS.find(d => d.key === 'moveRecall')!;
  assert.equal(reactable(recall).ok, true);
});

test('a continuous link never asks a playing Evolve to prepare again', () => {
  const a = meridian(), b = structuredClone(a);
  b.layers[0].params.ringWeight += .5; b.layers[0].params.moveDrop = 1; b.layers[0].params.lightExposure += .1;
  assert.equal(needsPrepare(a, b), false);
});

test('Motion cannot animate bloom, line glow or core on Evolve, and the saved route stays in the file', () => {
  for (const key of EVOLVE_NO_MOTION) {
    const layer = meridian().layers[0], saved = layer.params[key];
    layer.modulations[key] = { kind: 'pulse', cycles: 10, phase: 0, amount: 1, points: [], range: { min: 0, max: 2 } };
    assert.equal(motionIgnored(layer, key), true);
    for (const phase of [0, .4, 1.3, 2.9, 5]) assert.equal(evaluateLayer(layer, phase).params[key], saved, `${key} at ${phase}`);
    assert.ok(layer.modulations[key], 'route kept');
    assert.ok(evaluateLayer(layer, 1).modulations[key], 'route kept after evaluating');
  }
});

test('the same routes still play on Dense and Pulse, and other Evolve routes still play', () => {
  for (const style of [0, 1]) {
    const layer = meridian(style).layers[0];
    layer.modulations.lightCore = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: 0, max: 2 } };
    assert.equal(motionIgnored(layer, 'lightCore'), false);
    assert.notEqual(evaluateLayer(layer, TAU / 4).params.lightCore, evaluateLayer(layer, TAU * 3 / 4).params.lightCore);
  }
  const evolve = meridian().layers[0];
  evolve.modulations.lightExposure = { kind: 'sine', cycles: 1, phase: 0, amount: 1, points: [], range: { min: .5, max: 2 } };
  assert.notEqual(evaluateLayer(evolve, TAU / 4).params.lightExposure, evaluateLayer(evolve, TAU * 3 / 4).params.lightExposure);
});

test('the wall hears the music only when the show holds Meridian', () => {
  const plain = createProject(); plain.layers = [createLayer('fractal')];
  const without = wallInputs(showWith(plain), null), withIt = wallInputs(showWith(meridian()), null);
  for (const input of ['audio.bass', 'audio.mids', 'audio.highs', 'audio.level', 'beat.pulse', 'tempo.bpm', 'tempo.external']) {
    assert.ok(withIt.has(input), input); assert.equal(without.has(input), false, input);
  }
  assert.equal(showReacts(showWith(meridian())), true);
  assert.equal(showReacts(showWith(plain)), false);
});

test('the wall guard follows the show: none without Meridian, the strictest setting of the guarded layers', () => {
  const plain = createProject(); plain.layers = [createLayer('fractal')];
  assert.deepEqual({ present: policy(plain).present, on: policy(plain).on, warn: policy(plain).warn }, { present: false, on: false, warn: false });
  const strict = meridian(2, { safetyMaxFlashes: 2, safetyRedLimit: .3, safetyFullField: .4 }), loose = meridian(1, { safetyMaxFlashes: 3 });
  const both = policy(strict, loose);
  assert.equal(both.on, true); assert.equal(both.warn, false);
  assert.equal(both.settings.safetyMaxFlashes, 2); assert.equal(both.settings.safetyRedLimit, .3); assert.equal(both.settings.safetyFullField, .4);
  const off = policy(meridian(2, { safetyFlashGuard: 0 }));
  assert.equal(off.on, false); assert.equal(off.warn, true);
  const mixed = policy(meridian(2, { safetyFlashGuard: 0 }), meridian());
  assert.equal(mixed.on, true, 'one guarded layer guards the wall'); assert.equal(mixed.warn, true, 'and the unguarded one is still warned about');
  const hidden = meridian(2, { safetyFlashGuard: 0 }); hidden.layers[0].visible = false;
  assert.equal(policy(hidden).present, false, 'a hidden layer is not on the wall');
});

test('a calm wall has a gain of exactly 1, and no saturation limit', () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON();
  for (let f = 0; f < 600; f++) {
    guard.step(1 / 60, wall(.2 + .04 * Math.sin(f / 60 * TAU * .25)), settings);
    assert.equal(guard.gain, 1, `frame ${f}`); assert.equal(guard.saturation, Infinity);
  }
  assert.equal(guard.limiting, false);
});

test('a slow full-wall swell inside the limit is left alone', () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON();
  for (let f = 0; f < 600; f++) { guard.step(1 / 60, wall(.1 + .4 * (.5 + .5 * Math.sin(f / 60 * TAU))), settings); assert.equal(guard.gain, 1, `frame ${f}`); }
});

for (const hz of [5, 8, 12]) test(`a ${hz} Hz full-wall strobe is brought within three flashes a second, even read a frame late`, () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON(), bright = wall(.8), dark = wall(.02), shown: number[] = [], raw: number[] = [];
  const at = (f: number) => (f / 60 * hz) % 1 < .5;
  for (let f = 0; f < 480; f++) {
    guard.step(1 / 60, at(Math.max(0, f - 1)) ? bright : dark, settings); // The reading is a frame old.
    raw.push(at(f) ? .8 : .02); shown.push((at(f) ? .8 : .02) * guard.gain);
  }
  assert.ok(worstChanges(raw, 60) > 6, 'the check strobes without the guard');
  assert.ok(worstChanges(shown.slice(60), 60) <= 6, `shown ${worstChanges(shown.slice(60), 60)} changes in a second`);
  assert.equal(guard.limiting, true);
});

test('the dim never steps harder than its slew, in either direction', () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON(), bright = wall(.8), dark = wall(.02);
  let last = 1, biggest = 0;
  for (let f = 0; f < 600; f++) { guard.step(1 / 60, f < 400 && (f / 60 * 8) % 1 < .5 ? bright : dark, settings); biggest = Math.max(biggest, Math.abs(guard.gain - last)); last = guard.gain; }
  assert.ok(biggest <= .25, `largest step ${biggest}`);
  assert.equal(guard.gain, 1, 'and it comes all the way back');
});

test('saturated red flashing at constant luminance is met with a saturation limit', () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON(), red = wall(.5, .01, .01), grey = wall(.13, .13, .13);
  let lowest = Infinity;
  for (let f = 0; f < 240; f++) { guard.step(1 / 60, (f / 60 * 5) % 1 < .5 ? red : grey, settings); lowest = Math.min(lowest, guard.saturation); }
  assert.ok(lowest <= .5, `saturation came down only to ${lowest}`);
});

test('a guard that is off, or reset, is exactly 1', () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON();
  for (let f = 0; f < 120; f++) guard.step(1 / 60, f % 6 < 3 ? wall(.8) : wall(.02), settings);
  assert.ok(guard.gain < 1);
  guard.reset();
  assert.equal(guard.gain, 1); assert.equal(guard.saturation, Infinity); assert.equal(guard.limiting, false);
});

test('a dropped or strange frame time cannot move the dim', () => {
  const guard = new WallFlashGuard(), { settings } = POLICY_ON();
  guard.step(1 / 60, wall(.2), settings);
  for (const dt of [Number.NaN, -1, Infinity]) { guard.step(dt, wall(.9), settings); assert.equal(guard.gain, 1); }
});

test('a structural link on Dense is held until the loop comes round; a saved edit is not', () => {
  const hold = new StructureHold(), project = meridian(1, { ringCount: 6 });
  const link = (value: number) => [{ layer: 0, key: 'ringCount', value }, { layer: 0, key: 'lightExposure', value: 1.5 }];
  assert.equal(hold.apply('m', project, link(7), 1)![0].value, 7, 'the first frame reads the link');
  for (const value of [8, 9, 10]) {
    const out = hold.apply('m', project, link(value), 2)!;
    assert.equal(out.find(o => o.key === 'ringCount')!.value, 7, 'held inside the loop');
    assert.equal(out.find(o => o.key === 'lightExposure')!.value, 1.5, 'a light setting is never held');
  }
  assert.equal(hold.apply('m', project, link(10), .1)!.find(o => o.key === 'ringCount')!.value, 10, 'taken as the loop comes round');
});

test('structural links on Evolve and Pulse pass straight through, and no links stay no links', () => {
  const hold = new StructureHold();
  for (const style of [0, 2]) {
    const project = meridian(style), link = [{ layer: 0, key: 'ringCount', value: 3 }];
    assert.equal(hold.apply(`s${style}`, project, link, 1), link);
  }
  assert.equal(hold.apply('none', meridian(1), undefined, 1), undefined);
});
