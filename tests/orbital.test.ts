import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ORBIT_CHOICES, ORBIT_ADDED_KEYS, ORBIT_LOOKS, ORBIT_TAU, advanceOrbitalClock, orbitFade, recallOrbitalLook } from '../src/core/orbital';
import { applyPreset, createLayer, createProject, finishSupported, validateProject } from '../src/core/project';
import { needsPrepare } from '../src/map/playout';
import { canLinkParameter } from '../src/map/targets';
import { OrbitAppearance } from '../src/rendering/orbit-appearance';
import { blendOrbitView, orbitDetailGain, orbitProjectionDistance } from '../src/rendering/orbit-projection';
import { advanceOrbitPhase, makeOrbitPose, orbitLoopPhase, orbitMorphProgress, sampleOrbit } from '../src/rendering/orbit-motion';

test('the default look and every Orbital preset survive project validation', () => {
  const layer = createLayer('orbital');
  assert.equal(layer.params.orbitPlayback, 0);
  for (const look of ORBIT_LOOKS) {
    const project = { ...createProject(), layers: [applyPreset(layer, look.id)] };
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project, look.name);
  }
});

test('every arrangement closes in loop mode and keeps the same piece identity', () => {
  const { params } = createLayer('orbital');
  const first = makeOrbitPose(), last = makeOrbitPose();
  params.orbitColourCycles = 2;
  params.orbitPhrasing = .8;
  for (let layout = 0; layout < ORBIT_CHOICES.orbitLayout.length; layout++) {
    params.orbitLayout = layout;
    for (let movement = 0; movement < ORBIT_CHOICES.orbitMotion.length; movement++) {
      params.orbitMotion = movement;
      for (let i = 0; i < params.orbitCount; i++) {
        sampleOrbit(first, i, params, orbitLoopPhase(params, 0));
        sampleOrbit(last, i, params, orbitLoopPhase(params, ORBIT_TAU));
        for (const key of ['x', 'y', 'z', 'size', 'tilt', 'roll', 'band'] as const) assert.ok(Math.abs(first[key] - last[key]) < 1e-9, key);
        assert.ok(Math.abs(Math.sin(first.angle) - Math.sin(last.angle)) < 1e-9);
      }
    }
  }
});

test('endless settings integrate time continuously when speed changes or stops', () => {
  const { params } = createLayer('orbital');
  params.orbitBackgroundRate = -.38;
  const start = orbitLoopPhase(params, 0), midway = advanceOrbitPhase(start, params, 3);
  const sum = advanceOrbitPhase(midway, params, 2);
  const together = advanceOrbitPhase(start, params, 5);
  assert.ok(Math.abs(Math.cos(sum.wave) - Math.cos(together.wave)) < 1e-9);
  const next = advanceOrbitPhase(midway, { ...params, orbitRate: 0 }, 2);
  assert.equal(next.spin, midway.spin);
  assert.equal(next.wave, midway.wave);
  assert.equal(next.phrase, midway.phrase);
  assert.notEqual(next.background, midway.background);
});

test('stagger closes every piece and fade cues are independent of the wrapped phase', () => {
  assert.ok(orbitMorphProgress(.4, 0, .5) > orbitMorphProgress(.4, 1, .5));
  assert.equal(orbitMorphProgress(1, 1, .9), 1);
  const layer = createLayer('orbital');
  assert.equal(orbitFade(layer, ORBIT_TAU, 8, 100), 1);
  layer.params.orbitPlayback = 2;
  assert.equal(orbitFade(layer, 0, 8, 8), 0);
  assert.equal(orbitFade(layer, ORBIT_TAU, 8), 0);
  layer.params.orbitFade = .2;
  assert.equal(orbitFade(layer, 0, 8, 1), .8);
  assert.equal(finishSupported(layer, 'finish-tunnel'), false);
  assert.equal(finishSupported(layer, 'finish-soft-glow'), true);
  layer.params.orbitPlayback = 1;
  assert.equal(finishSupported(layer, 'finish-tunnel'), true);
  assert.equal(canLinkParameter(layer, 'orbitOpening'), true);
  assert.equal(canLinkParameter(layer, 'orbitLayout'), false);
});


test('earlier Orbital projects reopen with neutral installation defaults', () => {
  const layer = createLayer('orbital');
  const expected = { ...createProject(), layers: [layer] };
  const previous = JSON.parse(JSON.stringify(expected));
  for (const key of ORBIT_ADDED_KEYS) delete previous.layers[0].params[key];
  assert.deepEqual(validateProject(previous), expected);
  assert.equal(expected.layers[0].params.orbitSafeMargin, 0);
  assert.equal(expected.layers[0].params.orbitShadowModel, 0);
  assert.equal(expected.layers[0].params.orbitPhrasing, 0);
  previous.layers[0].params.orbitSafeMargin = 2;
  assert.throws(() => validateProject(previous), /orbitSafeMargin/);
});

test('palette and finish recalls retarget from the displayed blend', () => {
  const palette = (hex: string) => Array<string>(6).fill(hex);
  const appearance = new OrbitAppearance(palette('#000000'), 0, 0);
  appearance.update(palette('#ffffff'), 3, 1, 2);
  assert.equal(appearance.palette[0].r, 0);
  appearance.update(palette('#ffffff'), 3, 2, 2);
  assert.equal(appearance.palette[0].r, .5);
  assert.deepEqual(appearance.weights, [.5, 0, 0, .5]);
  appearance.update(palette('#ff0000'), 1, 2, 2);
  assert.equal(appearance.palette[0].g, .5);
  assert.deepEqual(appearance.weights, [.5, 0, 0, .5]);
  appearance.update(palette('#ff0000'), 1, 4, 2);
  assert.equal(appearance.palette[0].g, 0);
  assert.deepEqual(appearance.weights, [0, 1, 0, 0]);
});

test('the projection envelope keeps more room on thin surfaces and degrades accents gradually', () => {
  const { params } = createLayer('orbital');
  assert.equal(orbitProjectionDistance(params, 1.7), 2.2);
  params.orbitSafeMargin = .18;
  params.orbitRadius = .59;
  params.orbitLayout = 4;
  const wide = orbitProjectionDistance(params, 1.7);
  const narrow = orbitProjectionDistance(params, .25);
  assert.ok(wide > 2.2 && narrow > wide);
  assert.equal(orbitDetailGain(.5, 0), 1);
  assert.equal(orbitDetailGain(.5, 1), 0);
  assert.equal(orbitDetailGain(3.2, 1), 1);
  assert.ok(orbitDetailGain(1.8, 1) > orbitDetailGain(1.3, 1));
});


test('preset framing blends from the displayed view and refits when the output aspect changes', () => {
  const first = { distance: 2, tilt: 0, density: 20, rotation: Math.PI - .2, contrast: .7, focus: .3 };
  const second = { ...first, distance: 4, density: 10, rotation: -Math.PI + .2 };
  assert.deepEqual(blendOrbitView(first, second, 0, true), first);
  const middle = blendOrbitView(first, second, .5, true);
  assert.equal(middle.distance, 8 / 3);
  assert.equal(middle.density, 15);
  assert.ok(Math.abs(middle.rotation - Math.PI) < 1e-9);
  assert.equal(blendOrbitView(first, second, .5, false).distance, 4);
});


test('the independent clocks stay bounded over a multi-hour installation', () => {
  const { params } = createLayer('orbital');
  params.orbitPhrasing = .8;
  let phase = orbitLoopPhase(params, 0);
  for (let step = 0; step < 288_000; step++) phase = advanceOrbitPhase(phase, params, .1);
  for (const value of Object.values(phase)) assert.ok(Math.abs(value) < ORBIT_TAU);
  const beforeReverse = phase;
  const next = advanceOrbitPhase(phase, { ...params, orbitRate: -params.orbitRate }, .1);
  assert.notEqual(next.phrase, beforeReverse.phrase);
  assert.notEqual(next.background, beforeReverse.background);
  const direct = advanceOrbitPhase(orbitLoopPhase(params, 0), params, 28_800);
  assert.ok(Math.abs(Math.cos(phase.phrase) - Math.cos(direct.phrase)) < 1e-6);
});


test('Map recalls edit the playing Orbital layer, with optional locks and its routes intact', () => {
  const layer = applyPreset(createLayer('orbital'), 'orbital-wall-blueprint');
  layer.transform.x = .2;
  layer.params.orbitMorph = 3;
  layer.params.orbitFade = .12;
  layer.params.orbitPlayback = 2;
  layer.params.echo = .6;
  layer.modulations.orbitOpening = { kind: 'sine', cycles: 1, phase: 0, amount: .1, points: [] };
  const before = { ...createProject(), layers: [layer] };
  const unlocked = recallOrbitalLook(layer, 'orbital-glacier', { layout: false, motion: false, colour: false });
  const after = { ...before, layers: [unlocked] };
  assert.deepEqual(validateProject(after), after);
  assert.equal(needsPrepare(before, after), false);
  for (const key of ['id', 'name', 'transform', 'modulations'] as const) assert.deepEqual(unlocked[key], layer[key]);
  for (const key of ['orbitMorph', 'orbitFade', 'orbitPlayback', 'echo']) assert.equal(unlocked.params[key], layer.params[key]);
  assert.notEqual(unlocked.params.orbitLayout, layer.params.orbitLayout);
  assert.notEqual(unlocked.params.orbitRate, layer.params.orbitRate);
  assert.notDeepEqual(unlocked.palette, layer.palette);

  const locks = { layout: true, motion: true, colour: true };
  const locked = recallOrbitalLook(layer, 'orbital-glacier', locks);
  assert.deepEqual(locked.palette, layer.palette);
  for (const key of ['orbitLayout', 'orbitPiece', 'orbitFraming', 'orbitRate', 'orbitColourMode']) assert.equal(locked.params[key], layer.params[key]);
  assert.equal(locked.params.orbitRecall, 1);
  assert.equal(recallOrbitalLook(locked, 'orbital-glacier', locks).params.orbitRecall, 2);
  assert.equal(canLinkParameter(locked, 'orbitRecall'), false);
  assert.equal(needsPrepare(before, { ...after, layers: [{ ...unlocked, transform: { ...unlocked.transform, x: 0 } }] }), true);
});

test('Perform speed holds motion with the recall clock still running in real seconds', () => {
  const clock = { motion: 0, transition: 0 };
  advanceOrbitalClock(clock, .05, 2);
  assert.deepEqual(clock, { motion: .1, transition: .05 });
  advanceOrbitalClock(clock, 2, 0);
  assert.equal(clock.motion, .1);
  assert.ok(Math.abs(clock.transition - 2.05) < 1e-9);
  advanceOrbitalClock(clock, .05, .5);
  assert.equal(clock.motion, .125);
  assert.ok(Math.abs(clock.transition - 2.1) < 1e-9);
});
