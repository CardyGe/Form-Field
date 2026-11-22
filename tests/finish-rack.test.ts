import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_KEYS } from '../src/core/finishing';
import { createLayer, visibleParameterDefinitions } from '../src/core/project';
import { FINISH_EFFECTS, finishEffectOn, finishEffectsFor, finishSummary, powerLocked, resetFinishEffect, toggleFinishEffect } from '../src/ui/finish-rack';

const effect = (id: string) => FINISH_EFFECTS.find(item => item.id === id)!;
const defs = (layer = createLayer('surface')) => visibleParameterDefinitions(layer);

test('every finish setting belongs to exactly one effect', () => {
  const owned = FINISH_EFFECTS.flatMap(item => item.keys).filter(key => FINISH_KEYS.includes(key));
  assert.deepEqual([...owned].sort(), [...FINISH_KEYS].sort());
  assert.equal(new Set(owned).size, owned.length);
});

test('a new layer shows every effect switched off', () => {
  const layer = createLayer('surface'), shown = finishEffectsFor(layer, defs(layer));
  assert.equal(shown.length, FINISH_EFFECTS.length);
  for (const item of shown) {
    assert.equal(finishEffectOn(layer, item, defs(layer)), false, item.id);
    assert.equal(finishSummary(layer, item, defs(layer)), '', item.id);
  }
});

test('graphic layers list only the effects they can take', () => {
  const layer = createLayer('graphic'), ids = finishEffectsFor(layer, defs(layer)).map(item => item.id);
  for (const id of ['balance', 'gradient', 'key', 'glow', 'split', 'print', 'time']) assert.equal(ids.includes(id), false, id);
});

test('the switch restores the exact amount and leaves the other settings alone', () => {
  const layer = createLayer('surface');
  layer.params.glowMix = 1.37; layer.params.glowSize = .22;
  const off = toggleFinishEffect(layer, effect('glow'), defs(layer));
  assert.equal(off.layer.params.glowMix, 0);
  assert.equal(off.layer.params.glowSize, .22);
  const on = toggleFinishEffect(off.layer, effect('glow'), defs(layer), off.stored);
  assert.equal(on.layer.params.glowMix, 1.37);
  assert.equal(layer.params.glowMix, 1.37, 'The original layer is not mutated.');
});

test('a first switch-on uses a visible starting amount', () => {
  const layer = createLayer('surface');
  for (const id of ['gradient', 'key', 'glow', 'split', 'print', 'flat', 'time', 'feedback']) {
    const next = toggleFinishEffect(layer, effect(id), defs(layer)).layer;
    assert.equal(finishEffectOn(next, effect(id), defs(layer)), true, id);
  }
});

test('Colour split counts channel order as on, and its switch clears both', () => {
  const layer = createLayer('surface'); layer.params.splitOrder = 2;
  assert.equal(finishSummary(layer, effect('split'), defs(layer)), 'Channels');
  const off = toggleFinishEffect(layer, effect('split'), defs(layer));
  assert.equal(finishEffectOn(off.layer, effect('split'), defs(layer)), false);
  assert.equal(toggleFinishEffect(off.layer, effect('split'), defs(layer), off.stored).layer.params.splitOrder, 2);
});

test('an animated amount stays on and its switch does not fight the animation', () => {
  const layer = createLayer('surface'); layer.modulations.glowMix = { kind: 'sine', cycles: 1, phase: 0, amount: .5, points: [] };
  assert.equal(finishEffectOn(layer, effect('glow'), defs(layer)), true);
  assert.equal(powerLocked(layer, effect('glow')), true);
  assert.equal(toggleFinishEffect(layer, effect('glow'), defs(layer)).layer, layer);
});

test('effects without a switch report how many settings changed', () => {
  const layer = createLayer('surface'); layer.params.toneContrast = 1.2; layer.params.vibrance = .3;
  assert.equal(finishSummary(layer, effect('tone'), defs(layer)), '2 changed');
});

test('reset returns only that effect to defaults and removes its animation', () => {
  const layer = createLayer('surface');
  layer.params.glowMix = 1; layer.params.printMix = 1; layer.modulations.glowSize = { kind: 'sine', cycles: 1, phase: 0, amount: .2, points: [] };
  const next = resetFinishEffect(layer, effect('glow'), defs(layer));
  assert.equal(next.params.glowMix, 0);
  assert.equal(next.modulations.glowSize, undefined);
  assert.equal(next.params.printMix, 1);
});
