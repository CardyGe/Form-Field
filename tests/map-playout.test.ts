import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePhase, drawsThisFrame, fadeAlpha, governorStep, initialGovernor, GOVERNOR_SCALES, shouldFade, sourceSize } from '../src/map/playout';
import { applyPreset, createLayer, createProject } from '../src/core/project';

const TAU = Math.PI * 2;
const square = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

test('sourceSize: the shape\'s bounding box in projector pixels, times the scale, within 64 px and the stage', () => {
  assert.deepEqual(sourceSize(square(0.25, 0.25, 0.75, 0.75), 1), { width: 960, height: 540 });
  assert.deepEqual(sourceSize(square(0.25, 0.25, 0.75, 0.75), 0.5), { width: 480, height: 270 });
  assert.deepEqual(sourceSize(square(0, 0, 1, 1), 1), { width: 1920, height: 1080 });
  // Small shapes are drawn at no less than 64 px, so a thin sliver still has a picture.
  assert.deepEqual(sourceSize(square(0.5, 0.5, 0.501, 0.9), 1), { width: 64, height: 432 });
  // Whole pixels, rounded up.
  const odd = sourceSize(square(0, 0, 0.3333, 0.3333), 1);
  assert.ok(Number.isInteger(odd.width) && Number.isInteger(odd.height));
  assert.ok(odd.width >= 0.3333 * 1920);
});

test('advancePhase: one loop of the composition per its duration, times the speed; long pauses are capped', () => {
  const project = createProject();
  project.layers = [applyPreset(createLayer('relief'), 'porcelain-shutters')];
  project.duration = 10;
  // Speed 4: a quarter of the 10 s loop takes 0.625 s, here as 25 frames of 25 ms.
  let quarter = 0;
  for (let i = 0; i < 25; i++) quarter = advancePhase(quarter, 0.025, project, 4);
  assert.ok(Math.abs(quarter - TAU / 4) < 0.02, `${quarter}`);
  assert.ok(Math.abs(advancePhase(0, 0.05, project, 1) - 0.05 / 10 * TAU) < 0.002);
  // A stalled frame (the window was hidden) moves the clock at most 0.1 s.
  assert.ok(Math.abs(advancePhase(0, 5, project, 1) - 0.1 / 10 * TAU) < 0.002);
  assert.equal(advancePhase(1, -3, project, 1), 1);
  // Loops wrap.
  assert.ok(advancePhase(TAU - 0.001, 0.1, project, 1) < 0.1);
});

test('governor: 30 late frames step down, 120 easy frames step back up, and in-between frames hold', () => {
  let g = initialGovernor();
  for (let i = 0; i < 29; i++) g = governorStep(g, 20);
  assert.equal(g.level, 0);
  g = governorStep(g, 12); // one frame inside budget resets the count: no step on a short spike
  for (let i = 0; i < 29; i++) g = governorStep(g, 20);
  assert.equal(g.level, 0);
  g = governorStep(g, 20);
  assert.equal(g.level, 1);
  for (let i = 0; i < 90; i++) g = governorStep(g, 20);
  assert.equal(g.level, 3);
  g = governorStep(g, 20);
  assert.equal(g.level, 3, 'never below the last level');
  for (let i = 0; i < 119; i++) g = governorStep(g, 5);
  assert.equal(g.level, 3);
  g = governorStep(g, 5);
  assert.equal(g.level, 2);
  assert.deepEqual(GOVERNOR_SCALES, [1, 0.75, 0.5, 0.5]);
});

test('drawsThisFrame: at the last level instruments draw every other frame', () => {
  assert.ok([0, 1, 2, 3, 4].every(n => drawsThisFrame(0, n)));
  assert.deepEqual([0, 1, 2, 3].map(n => drawsThisFrame(3, n)), [true, false, true, false]);
});

test('fadeAlpha and shouldFade', () => {
  assert.equal(fadeAlpha(1000, 1000), 0);
  assert.equal(fadeAlpha(1000, 1200), 0.5);
  assert.equal(fadeAlpha(1000, 1400), 1);
  assert.equal(fadeAlpha(1000, 9000), 1);
  assert.equal(fadeAlpha(1000, 500), 0);
  // A new source, or a different instrument in the same source, fades; a Vary or palette change does not.
  assert.equal(shouldFade(undefined, { sourceId: 'a', kinds: 'relief' }), false);
  assert.equal(shouldFade({ sourceId: 'a', kinds: 'relief' }, { sourceId: 'b', kinds: 'relief' }), true);
  assert.equal(shouldFade({ sourceId: 'a', kinds: 'relief' }, { sourceId: 'a', kinds: 'resonance' }), true);
  assert.equal(shouldFade({ sourceId: 'a', kinds: 'relief' }, { sourceId: 'a', kinds: 'relief' }), false);
  assert.equal(shouldFade({ sourceId: null, kinds: '' }, { sourceId: 'a', kinds: 'relief' }), true);
});
