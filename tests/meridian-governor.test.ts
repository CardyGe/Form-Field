import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOVERNOR, MeridianGovernor, FULL_QUALITY } from '../src/meridian/governor';

/** Feeds frames of `ms` for `seconds` and returns every output, copied. */
function run(governor: MeridianGovernor, ms: number, seconds: number) {
  const out: { bloomLevels: number; tear: number; instanceScale: number; reduced: boolean }[] = [];
  for (let t = 0; t < seconds * 1000; t += ms) { const q = governor.update(ms); out.push({ bloomLevels: q.bloomLevels, tear: q.tear, instanceScale: q.instanceScale, reduced: q.reduced }); }
  return out;
}
const last = <T>(list: readonly T[]) => list[list.length - 1];

test('a calm show stays at full quality', () => {
  const g = new MeridianGovernor();
  for (const q of run(g, 16.7, 60)) assert.deepEqual(q, { bloomLevels: 5, tear: 1, instanceScale: 1, reduced: false });
});

test('one slow frame changes nothing, nor does a short hitch', () => {
  const g = new MeridianGovernor();
  run(g, 16.7, 2);
  const stall = g.update(400);
  assert.equal(stall.reduced, false);
  run(g, 16.7, 1);
  for (let i = 0; i < 6; i++) g.update(45); // a quarter of a second of hitching
  const after = last(run(g, 16.7, 10));
  assert.deepEqual(after, { bloomLevels: 5, tear: 1, instanceScale: 1, reduced: false });
});

test('sustained slow frames reduce bloom first, then the tear, then instances', () => {
  const g = new MeridianGovernor();
  const frames = run(g, 30, 30);
  const firstBloom = frames.findIndex(q => q.bloomLevels < 5), firstTear = frames.findIndex(q => q.tear < 1), firstInstances = frames.findIndex(q => q.instanceScale < 1);
  assert.ok(firstBloom > 0, 'bloom reduces');
  assert.ok(firstTear > firstBloom, `tear (${firstTear}) after bloom (${firstBloom})`);
  assert.ok(firstInstances > firstTear, `instances (${firstInstances}) after tear (${firstTear})`);
  // Bloom has fully reached its floor before the tear starts, and the tear before instances.
  assert.equal(frames[firstTear].bloomLevels, GOVERNOR.minBloomLevels);
  assert.equal(frames[firstInstances].tear, 0);
  assert.ok(firstBloom * 30 >= GOVERNOR.sustainSeconds * 1000 - 30, `reduced after ${firstBloom * 30} ms`);
  const end = last(frames);
  assert.deepEqual(end, { bloomLevels: GOVERNOR.minBloomLevels, tear: 0, instanceScale: GOVERNOR.minInstanceScale, reduced: true });
});

test('changes glide: no frame moves any output by more than a small step', () => {
  const g = new MeridianGovernor();
  const frames = [...run(g, 33, 25), ...run(g, 16.7, 60)];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    assert.ok(Math.abs(a.bloomLevels - b.bloomLevels) <= 3 * GOVERNOR.glidePerSecond * .034 + 1e-9, `bloom jump at ${i}: ${a.bloomLevels} → ${b.bloomLevels}`);
    assert.ok(Math.abs(a.tear - b.tear) <= GOVERNOR.glidePerSecond * .034 + 1e-9, `tear jump at ${i}`);
    assert.ok(Math.abs(a.instanceScale - b.instanceScale) <= (1 - GOVERNOR.minInstanceScale) * GOVERNOR.glidePerSecond * .034 + 1e-9, `instance jump at ${i}`);
  }
});

test('recovery needs about five calm seconds', () => {
  const g = new MeridianGovernor();
  run(g, 30, 2.5);
  const reduced = g.update(30);
  assert.equal(reduced.reduced, true);
  const level = reduced.bloomLevels;
  // Four calm seconds: nothing comes back yet.
  const early = run(g, 16.7, 4);
  assert.ok(early.every(q => q.bloomLevels <= level + 1e-9), 'no recovery inside 4 s');
  // A little after five seconds, it starts to come back, and by twelve it is full again.
  const later = run(g, 16.7, 8);
  assert.ok(later.some(q => q.bloomLevels > level + 1e-6), 'recovery begins after about 5 s');
  assert.deepEqual(last(later), { bloomLevels: 5, tear: 1, instanceScale: 1, reduced: false });
});

test('a slow frame during recovery restarts the calm count', () => {
  const g = new MeridianGovernor();
  run(g, 30, 2.5);
  const level = g.update(30).bloomLevels;
  run(g, 16.7, 3);
  for (let i = 0; i < 4; i++) g.update(40);
  const resumed = run(g, 16.7, 3.5);
  assert.ok(resumed.every(q => q.bloomLevels <= level + 1e-9), 'calm count started again');
});

test('a step back down soon after recovering waits longer before the next recovery', () => {
  const g = new MeridianGovernor();
  run(g, 30, 2.5);
  run(g, 16.7, 8);           // recovers one step
  const back = run(g, 30, 2.5); // slow again straight away
  assert.equal(last(back).reduced, true);
  const level = last(back).bloomLevels;
  const wait = run(g, 16.7, 6);
  assert.ok(wait.every(q => q.bloomLevels <= level + 1e-9), 'the second recovery needs more than 6 s');
});

test('impossible frame times are ignored', () => {
  const g = new MeridianGovernor();
  for (const ms of [Number.NaN, -5, 0, Infinity, 1e9]) assert.equal(g.update(ms).reduced, false);
  run(g, 16.7, 1);
  assert.equal(g.update(Number.NaN).bloomLevels, 5);
});

test('reset returns to full quality at once', () => {
  const g = new MeridianGovernor();
  run(g, 40, 20);
  g.reset();
  assert.deepEqual(last(run(g, 16.7, .1)), { bloomLevels: 5, tear: 1, instanceScale: 1, reduced: false });
});

test('line sharpness and the flash limiter are never in the output', () => {
  const g = new MeridianGovernor(), q = g.update(16.7);
  assert.deepEqual(Object.keys(q).sort(), ['bloomLevels', 'instanceScale', 'level', 'reduced', 'tear']);
  assert.deepEqual(Object.keys(FULL_QUALITY).sort(), ['bloomLevels', 'instanceScale', 'level', 'reduced', 'tear']);
  const source = readFileSync(new URL('../src/meridian/governor.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /minLineWidth|lineWidth|AntiAlias|flashGuard|limiter/i);
  assert.doesNotMatch(source, /from ['"](three|react)/);
});

test('update allocates nothing: it returns the same object every frame', () => {
  const g = new MeridianGovernor();
  assert.equal(g.update(16.7), g.update(40));
});
