import test from 'node:test';
import assert from 'node:assert/strict';
import { FINISH_KEYS } from '../src/core/finishing';
import { warpControlVisible, visibleBelow } from '../src/rendering/warp';
import { createLayer, visibleParameterDefinitions } from '../src/core/project';
import { FINISH_EFFECTS, addFinishEffect, pickerEffects, finishEffectOn, finishEffectsFor, finishRackEffects, finishSummary, powerLocked, resetFinishEffect, searchFinishEffects, toggleFinishEffect } from '../src/ui/finish-rack';

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

test('a new layer lists no effects until one is added', () => {
  const layer = createLayer('surface');
  assert.deepEqual(finishRackEffects(layer, defs(layer)), []);
  assert.deepEqual(finishRackEffects(layer, defs(layer), new Set(['tone'])).map(item => item.id), ['tone']);
});

test('the list keeps effects that are on or have changed settings', () => {
  const layer = createLayer('surface'); layer.params.glowMix = .5; layer.params.printSize = 12;
  assert.deepEqual(finishRackEffects(layer, defs(layer)).map(item => item.id), ['glow', 'print']);
});

test('the list never shows an effect the layer cannot take', () => {
  const layer = createLayer('graphic');
  assert.deepEqual(finishRackEffects(layer, defs(layer), new Set(['glow'])), []);
});

test('adding turns a switched effect on, keeps one already on, and restores a stored amount', () => {
  const layer = createLayer('surface');
  assert.equal(addFinishEffect(layer, effect('glow'), defs(layer)).layer.params.glowMix, .8);
  assert.equal(addFinishEffect(layer, effect('glow'), defs(layer), { glowMix: 1.4 }).layer.params.glowMix, 1.4);
  const on = { ...layer, params: { ...layer.params, glowMix: 1.2 } };
  assert.equal(addFinishEffect(on, effect('glow'), defs(layer)).layer, on);
  assert.equal(addFinishEffect(layer, effect('tone'), defs(layer)).layer, layer);
});

test('search matches names, groups and descriptions, with every word required', () => {
  const ids = (query: string) => searchFinishEffects(FINISH_EFFECTS, query).map(item => item.id);
  assert.deepEqual(ids('glow'), ['glow', 'led']); // LED wall's description says "glowing"
  assert.ok(ids('time').includes('feedback'));
  assert.ok(ids('halftone').includes('print'));
  assert.deepEqual(ids('halftone glow'), []);
  assert.equal(ids('  ').length, FINISH_EFFECTS.length);
});

test('the picker filters by group and search together', () => {
  assert.equal(pickerEffects(FINISH_EFFECTS, 'All', '').length, FINISH_EFFECTS.length);
  assert.deepEqual(pickerEffects(FINISH_EFFECTS, 'Warp', '').map(item => item.id), ['warp', 'liquid', 'lumaWarp', 'polar', 'mirror']);
  assert.deepEqual(pickerEffects(FINISH_EFFECTS, 'Warp', 'circle').map(item => item.id), ['polar']);
  assert.deepEqual(pickerEffects(FINISH_EFFECTS, 'Time', 'circle'), []);
});

test('warp controls appear only for the type that uses them', () => {
  const base = createLayer('surface');
  const on = (params: Record<string, number>) => ({ ...base, params: { ...base.params, bendAmount: .2, ...params } });
  assert.equal(warpControlVisible(base, 'bendAmount'), true);
  assert.equal(warpControlVisible(base, 'bendField'), false);
  assert.equal(warpControlVisible(on({ bendField: 1 }), 'bendDetail'), true);
  assert.equal(warpControlVisible(on({ bendField: 0 }), 'bendDetail'), false);
  assert.equal(warpControlVisible(on({ bendField: 3 }), 'bendPoints'), true);
  assert.equal(warpControlVisible(on({ bendField: 2 }), 'bendFalloff'), true);
  assert.equal(warpControlVisible(on({ bendField: 1 }), 'bendFalloff'), false);
  assert.equal(warpControlVisible(on({ bendField: 0 }), 'bendAngle'), true);
  assert.equal(warpControlVisible(on({ bendField: 4 }), 'bendAngle'), false);
});

test('the other warps show their extras only for the choice that uses them', () => {
  const base = createLayer('surface');
  const p = (params: Record<string, number>) => ({ ...base, params: { ...base.params, ...params } });
  assert.equal(warpControlVisible(p({ liquidStyle: 1 }), 'liquidTrail'), false);
  assert.equal(warpControlVisible(p({ liquidAmount: .3, liquidStyle: 1 }), 'liquidTrail'), true);
  assert.equal(warpControlVisible(p({ liquidAmount: .3, liquidStyle: 0 }), 'liquidTrail'), false);
  assert.equal(warpControlVisible(p({ lumaWarpAmount: .3, lumaWarpMode: 0 }), 'lumaWarpAngle'), true);
  assert.equal(warpControlVisible(p({ lumaWarpAmount: .3, lumaWarpMode: 1 }), 'lumaWarpAngle'), false);
  assert.equal(warpControlVisible(p({ mirrorAmount: 1, mirrorMode: 3 }), 'mirrorSegments'), true);
  assert.equal(warpControlVisible(p({ mirrorAmount: 1, mirrorMode: 2 }), 'mirrorSegments'), false);
  assert.equal(warpControlVisible(p({ polarAmount: 1 }), 'polarTwist'), true);
  assert.equal(warpControlVisible(p({}), 'polarTwist'), false);
  assert.equal(warpControlVisible({ ...base, modulations: { mirrorAmount: { kind: 'sine', amount: .2, cycles: 1, phase: 0, points: [] } } }, 'mirrorMode'), true);
});

test('a layer below means a visible layer under this one', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(id => ({ ...createLayer('surface'), id }));
  assert.equal(visibleBelow([a, b, c], 'a'), false);
  assert.equal(visibleBelow([a, b, c], 'c'), true);
  assert.equal(visibleBelow([{ ...a, visible: false }, b], 'b'), false);
  assert.equal(visibleBelow([a, b], 'missing'), false);
});

test('warp labels and descriptions avoid the technical words', () => {
  const banned = /displacement|domain|curl|divergence|gradient|advection/i;
  for (const id of ['warp', 'liquid', 'lumaWarp', 'polar', 'mirror']) {
    const item = effect(id), defs = visibleParameterDefinitions(createLayer('surface')).filter(d => item.keys.includes(d.key));
    for (const text of [item.label, item.description, ...defs.flatMap(d => [d.label, d.description ?? ''])]) assert.doesNotMatch(text, banned, `${id}: ${text}`);
  }
});

test('Print controls follow the screen and colour choices', async () => {
  const { printControlShown, printDisabledOptions } = await import('../src/ui/finish-rack');
  const layer = (params: Record<string, number>) => { const l = createLayer('surface'); Object.assign(l.params, { printMix: 1 }, params); return l; };
  // Shimmer moves dither and blue-noise cells only.
  for (const [type, shown] of [[0, false], [1, false], [2, true], [3, true]] as const) assert.equal(printControlShown(layer({ printType: type }), 'printShimmer'), shown, `type ${type}`);
  // Invert flips the whole-colour screen and the retro palette; RGB light and CMYK ink ignore it.
  for (const [colour, shown] of [[0, true], [1, true], [2, false], [3, false], [4, true]] as const) assert.equal(printControlShown(layer({ printColour: colour }), 'printInvert'), shown, `colour ${colour}`);
  // Retro spans the whole palette with hard edges and no paper, so Largest mark, Mark softness and Paper do nothing.
  for (const key of ['printMax', 'printSoft', 'printPaper']) {
    assert.equal(printControlShown(layer({ printColour: 4 }), key), false, key);
    assert.equal(printControlShown(layer({ printColour: 0 }), key), true, key);
  }
  assert.equal(printControlShown(layer({ printColour: 4 }), 'printRetro'), true);
  // Retro draws the Classic dot as Round, so Classic is offered only without it.
  assert.deepEqual(printDisabledOptions(layer({ printColour: 4 }), 'printDot'), [1]);
  assert.equal(printDisabledOptions(layer({ printColour: 0 }), 'printDot'), undefined);
  assert.equal(printDisabledOptions(layer({ printColour: 4 }), 'printType'), undefined);
  // Everything but the amount hides while Print is off.
  assert.equal(printControlShown(layer({ printMix: 0 }), 'printType'), false);
  assert.equal(printControlShown(layer({ printMix: 0 }), 'printMix'), true);
});
