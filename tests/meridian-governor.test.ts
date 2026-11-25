import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOVERNOR, MeridianGovernor, FULL_QUALITY } from '../src/meridian/governor';

/** Feeds frames of `ms` for `seconds` and returns every output, copied. */
function run(governor: MeridianGovernor, ms: number, seconds: number) {
  const out: { bloom: number; tear: number; instanceScale: number; reduced: boolean }[] = [];
  for (let t = 0; t < seconds * 1000; t += ms) { const q = governor.update(ms); out.push({ bloom: q.bloom, tear: q.tear, instanceScale: q.instanceScale, reduced: q.reduced }); }
  return out;
}
const last = <T>(list: readonly T[]) => list[list.length - 1];
/** A governor that has seen two seconds of a healthy 60 Hz display, so it knows the refresh. */
const warmed = () => { const g = new MeridianGovernor(); run(g, 16.7, 2); return g; };
/** Seeded jitter, so every run is the same. */
const jitter = (seed: number) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - .5) * 2; };

test('a calm show stays at full quality', () => {
  const g = new MeridianGovernor();
  for (const q of run(g, 16.7, 60)) assert.deepEqual(q, { bloom: 1, tear: 1, instanceScale: 1, reduced: false });
});

test('one slow frame changes nothing, nor does a short hitch', () => {
  const g = new MeridianGovernor();
  run(g, 16.7, 2);
  const stall = g.update(400);
  assert.equal(stall.reduced, false);
  run(g, 16.7, 1);
  for (let i = 0; i < 6; i++) g.update(45); // a quarter of a second of hitching
  const after = last(run(g, 16.7, 10));
  assert.deepEqual(after, { bloom: 1, tear: 1, instanceScale: 1, reduced: false });
});

test('sustained slow frames reduce bloom first, then the tear, then instances', () => {
  const g = warmed();
  const frames = run(g, 30, 30);
  const firstBloom = frames.findIndex(q => q.bloom < 1), firstTear = frames.findIndex(q => q.tear < 1), firstInstances = frames.findIndex(q => q.instanceScale < 1);
  assert.ok(firstBloom > 0, 'bloom reduces');
  assert.ok(firstTear > firstBloom, `tear (${firstTear}) after bloom (${firstBloom})`);
  assert.ok(firstInstances > firstTear, `instances (${firstInstances}) after tear (${firstTear})`);
  // Bloom has fully reached its floor before the tear starts, and the tear before instances.
  assert.equal(frames[firstTear].bloom, 0);
  assert.equal(frames[firstInstances].tear, 0);
  assert.ok(firstBloom * 30 >= GOVERNOR.sustainSeconds * 1000 - 30, `reduced after ${firstBloom * 30} ms`);
  const end = last(frames);
  assert.deepEqual(end, { bloom: 0, tear: 0, instanceScale: GOVERNOR.minInstanceScale, reduced: true });
});

test('changes glide: no frame moves any output by more than a small step', () => {
  const g = warmed();
  const frames = [...run(g, 33, 25), ...run(g, 16.7, 60)];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    assert.ok(Math.abs(a.bloom - b.bloom) <= GOVERNOR.glidePerSecond * .034 + 1e-9, `bloom jump at ${i}: ${a.bloom} → ${b.bloom}`);
    assert.ok(Math.abs(a.tear - b.tear) <= GOVERNOR.glidePerSecond * .034 + 1e-9, `tear jump at ${i}`);
    assert.ok(Math.abs(a.instanceScale - b.instanceScale) <= (1 - GOVERNOR.minInstanceScale) * GOVERNOR.glidePerSecond * .034 + 1e-9, `instance jump at ${i}`);
  }
});

test('recovery needs about five calm seconds', () => {
  const g = warmed();
  run(g, 30, 2.5);
  const reduced = g.update(30);
  assert.equal(reduced.reduced, true);
  const level = reduced.bloom;
  // Four calm seconds: nothing comes back yet.
  const early = run(g, 16.7, 4);
  assert.ok(early.every(q => q.bloom <= level + 1e-9), 'no recovery inside 4 s');
  // A little after five seconds, it starts to come back, and by twelve it is full again.
  const later = run(g, 16.7, 8);
  assert.ok(later.some(q => q.bloom > level + 1e-6), 'recovery begins after about 5 s');
  assert.deepEqual(last(later), { bloom: 1, tear: 1, instanceScale: 1, reduced: false });
});

test('a slow frame during recovery restarts the calm count', () => {
  const g = warmed();
  run(g, 30, 2.5);
  const level = g.update(30).bloom;
  run(g, 16.7, 3);
  for (let i = 0; i < 4; i++) g.update(40);
  const resumed = run(g, 16.7, 3.5);
  assert.ok(resumed.every(q => q.bloom <= level + 1e-9), 'calm count started again');
});

test('a step back down soon after recovering waits longer before the next recovery', () => {
  const g = warmed();
  run(g, 30, 2.5);
  run(g, 16.7, 8);           // recovers one step
  const back = run(g, 30, 2.5); // slow again straight away
  assert.equal(last(back).reduced, true);
  const level = last(back).bloom;
  const wait = run(g, 16.7, 6);
  assert.ok(wait.every(q => q.bloom <= level + 1e-9), 'the second recovery needs more than 6 s');
});

test('impossible frame times are ignored', () => {
  const g = new MeridianGovernor();
  for (const ms of [Number.NaN, -5, 0, Infinity, 1e9]) assert.equal(g.update(ms).reduced, false);
  run(g, 16.7, 1);
  assert.equal(g.update(Number.NaN).bloom, 1);
});

test('reset returns to full quality at once', () => {
  const g = warmed();
  run(g, 40, 20);
  g.reset();
  assert.deepEqual(last(run(g, 16.7, .1)), { bloom: 1, tear: 1, instanceScale: 1, reduced: false });
});

test('line sharpness and the flash limiter are never in the output', () => {
  const g = new MeridianGovernor(), q = g.update(16.7);
  assert.deepEqual(Object.keys(q).sort(), ['bloom', 'instanceScale', 'level', 'reduced', 'tear']);
  assert.deepEqual(Object.keys(FULL_QUALITY).sort(), ['bloom', 'instanceScale', 'level', 'reduced', 'tear']);
  const source = readFileSync(new URL('../src/meridian/governor.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /minLineWidth|lineWidth|AntiAlias|flashGuard|limiter/i);
  assert.doesNotMatch(source, /from ['"](three|react)/);
});

test('update allocates nothing: it returns the same object every frame', () => {
  const g = new MeridianGovernor();
  assert.equal(g.update(16.7), g.update(40));
});

for (const hz of [24, 30, 48, 50, 60, 120, 144]) {
  test(`a healthy ${hz} Hz display is never reduced in ten minutes, with jitter and the odd missed refresh`, () => {
    const g = new MeridianGovernor(), noise = jitter(hz), period = 1000 / hz;
    let reduced = 0, frames = 0;
    for (let t = 0; t < 600000; frames++) {
      // Vsync-locked with ±0.3 ms of jitter, and one missed refresh about every 10 seconds.
      const ms = (frames % Math.round(10 * hz) === 7 ? 2 * period : period) + noise() * .3;
      t += ms;
      if (g.update(ms).reduced) reduced++;
    }
    assert.equal(reduced, 0, `${reduced} of ${frames} frames reduced`);
  });
  test(`real slowness on a ${hz} Hz display is still found`, () => {
    const g = new MeridianGovernor(), noise = jitter(hz + 1), period = 1000 / hz;
    for (let i = 0; i < hz * 3; i++) g.update(period + noise() * .3);
    // Every frame now misses a refresh.
    let reduced = false;
    for (let i = 0; i < hz * 4 && !reduced; i++) reduced = g.update(2 * period + noise() * .3).reduced;
    assert.ok(reduced, 'no reduction after four seconds of every frame missing a refresh');
  });
}

test('a display that changes to a slower refresh is learnt, and quality comes back', () => {
  const g = warmed();
  // Moved to a 30 Hz projector: at first this looks slow and is reduced, then the refresh is learnt and it recovers.
  const frames = run(g, 33.4, 360);
  assert.equal(last(frames).reduced, false, `still reduced at level ${g.quality.level}`);
});
