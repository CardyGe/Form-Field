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
import { wallGuardPolicy } from '../src/meridian/wall-guard';
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

test('Map shows the guard state and any limiter error of a Live playing Meridian', async () => {
  const { mapGuardStatus } = await import('../src/meridian/wall-guard');
  const none = policy(createProject());
  const calm = { limiting: false, failed: false };
  // A show with no Meridian anywhere: nothing to say, whatever Live reports for another look.
  assert.deepEqual(mapGuardStatus(none, false, calm, { limiting: true, error: 'x' }), { warning: null, limiting: false });
  // Live plays Meridian: its own limiter's state reaches the footer.
  assert.deepEqual(mapGuardStatus(none, true, calm, { limiting: true, error: null }), { warning: null, limiting: true });
  assert.match(mapGuardStatus(none, true, calm, { limiting: false, error: 'the flash limiter could not start' }).warning ?? '', /Flash limiter unavailable.*Live/);
  assert.deepEqual(mapGuardStatus(none, true, calm, null), { warning: null, limiting: false }, 'Live not drawing yet');
  // The wall's own guard is unchanged.
  const guarded = policy(meridian()), off = policy(meridian(2, { safetyFlashGuard: 0 }));
  assert.deepEqual(mapGuardStatus(guarded, false, { limiting: true, failed: false }, null), { warning: null, limiting: true });
  assert.equal(mapGuardStatus(guarded, false, { limiting: false, failed: true }, null).warning, 'Flash limiter unavailable: the wall is not limited');
  assert.equal(mapGuardStatus(off, false, calm, null).warning, 'Flash guard is off: the wall is not limited');
  const { readFileSync } = await import('node:fs');
  assert.ok(/mapGuardStatus\(/.test(readFileSync(new URL('../src/ui/MapPanel.tsx', import.meta.url), 'utf8')), 'the footer uses the rule');
});

test('a wall told to guard before its compositions arrive starts from the default red limit, not 1', async () => {
  const { guardBeforeCompositions } = await import('../src/meridian/wall-guard');
  const { MERIDIAN_DEFAULTS } = await import('../src/meridian/parameters');
  const early = guardBeforeCompositions(policy());
  assert.equal(early.on, true); assert.equal(early.present, true);
  assert.equal(early.settings.safetyFlashGuard, 1);
  assert.equal(early.settings.safetyRedLimit, MERIDIAN_DEFAULTS.safetyRedLimit);
  assert.equal(early.settings.safetyRedLimit, 0.5);
  assert.equal(early.settings.safetyFullField, MERIDIAN_DEFAULTS.safetyFullField);
  assert.equal(early.settings.safetyMaxFlashes, MERIDIAN_DEFAULTS.safetyMaxFlashes);
  const { readFileSync } = await import('node:fs');
  assert.ok(/guardBeforeCompositions\(/.test(readFileSync(new URL('../src/map/compositor.ts', import.meta.url), 'utf8')));
});
