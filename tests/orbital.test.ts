import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ORBIT_CHOICES, ORBIT_LOOKS, ORBIT_TAU, orbitFade } from '../src/core/orbital';
import { applyPreset, createLayer, createProject, finishSupported, validateProject } from '../src/core/project';
import { canLinkParameter } from '../src/map/targets';
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
