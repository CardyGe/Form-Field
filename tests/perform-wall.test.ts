import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPerformMessage, initialWallPerform, MAX_WALL_LAUNCHES, stepWallPerform, type WallChange, type WallLaunch, type WallPerform } from '../src/perform/wall-perform';
import { applyMapMessage, initialWall } from '../src/map/wall';
import type { ZonePicture } from '../src/perform/resolve';

const black = (): ZonePicture[] => Array.from({ length: 8 }, (_, i) => ({ shapeIds: [`s${i}`], sourceId: null, launched: false }));
const change = (zone: number, sourceId: string | null, extra: Partial<WallChange> = {}): WallChange => ({
  zone, sourceId, shapeIds: [`s${zone}`], blend: { kind: 'fade', durationMs: 500 }, phaseOffsetBeats: 0, ...extra,
});
const launch = (id: string, atMs: number, changes: WallChange[]): WallLaunch => ({ id, atMs, barMs: 2000, changes });
const started = (...launches: WallLaunch[]): WallPerform => {
  let p = applyPerformMessage(initialWallPerform(), { type: 'performStart', zones: black() });
  for (const l of launches) p = applyPerformMessage(p, { type: 'performLaunch', launch: l });
  return p;
};
const allReady = () => true;

test('a launch waits for its time', () => {
  const p = started(launch('a', 1000, [change(0, 'x')]));
  const out = stepWallPerform(p, 999, allReady);
  assert.equal(out.changed, false);
  assert.equal(out.perform, p);
  assert.deepEqual(out.landed, []);
  assert.equal(out.blends.size, 0);
  assert.equal(out.perform.zones[0].launched, false);
});

test('a ready source lands at its time, with its blend', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(2, 'x', { phaseOffsetBeats: 3 })])), 1000, allReady);
  assert.equal(out.changed, true);
  assert.deepEqual(out.perform.zones[2], { shapeIds: ['s2'], sourceId: 'x', launched: true });
  assert.deepEqual(out.landed, [{ launchId: 'a', zones: [2] }]);
  assert.deepEqual(out.blends.get('s2'), { kind: 'fade', durationMs: 500 });
  assert.deepEqual(out.perform.launches, []);
  assert.deepEqual(out.perform.phaseOffsets, { x: 3 });
});

test('a stop lands without needing a ready source', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(1, null)])), 1000, () => false);
  assert.deepEqual(out.perform.zones[1], { shapeIds: ['s1'], sourceId: null, launched: true });
  assert.deepEqual(out.landed, [{ launchId: 'a', zones: [1] }]);
});

test('a source that is not ready defers only that zone by one bar', () => {
  const p = started(launch('a', 1000, [change(0, 'slow'), change(1, 'quick')]));
  const first = stepWallPerform(p, 1000, id => id === 'quick');
  assert.equal(first.changed, true);
  assert.deepEqual(first.landed, [{ launchId: 'a', zones: [1] }]);
  assert.equal(first.perform.zones[0].launched, false);
  assert.equal(first.perform.zones[1].sourceId, 'quick');
  assert.equal(first.perform.launches.length, 1);
  assert.equal(first.perform.launches[0].atMs, 3000);
  assert.deepEqual(first.perform.launches[0].changes.map(c => c.zone), [0]);
  assert.equal(stepWallPerform(first.perform, 2999, allReady).changed, false);
  const second = stepWallPerform(first.perform, 3000, allReady);
  assert.deepEqual(second.landed, [{ launchId: 'a', zones: [0] }]);
  assert.deepEqual(second.perform.launches, []);
});

test('a launch with nothing ready reports nothing and redraws nothing', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(0, 'slow')])), 1000, () => false);
  assert.equal(out.changed, false);
  assert.deepEqual(out.landed, []);
  assert.equal(out.perform.launches[0].atMs, 3000);
});

test('a deferred zone moves to the next bar after a long stall, on the same grid', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(0, 'slow')])), 8500, () => false);
  assert.equal(out.perform.launches[0].atMs, 9000);
});

test('a newer launch on a zone is not overwritten by an older deferred one', () => {
  const deferred = stepWallPerform(started(launch('old', 1000, [change(0, 'slow')])), 1000, () => false).perform;
  const withNew = applyPerformMessage(deferred, { type: 'performLaunch', launch: launch('new', 1500, [change(0, 'fresh')]) });
  const landed = stepWallPerform(withNew, 1500, allReady);
  assert.equal(landed.perform.zones[0].sourceId, 'fresh');
  const later = stepWallPerform(landed.perform, 3000, allReady);
  assert.equal(later.perform.zones[0].sourceId, 'fresh');
  assert.deepEqual(later.landed, [{ launchId: 'old', zones: [] }]);
  assert.deepEqual(later.perform.launches, []);
});

test('an empty launch lands harmlessly and is reported', () => {
  const p = started(launch('a', 1000, []));
  const out = stepWallPerform(p, 1000, allReady);
  assert.equal(out.changed, false);
  assert.deepEqual(out.landed, [{ launchId: 'a', zones: [] }]);
  assert.deepEqual(out.perform.launches, []);
  assert.deepEqual(out.perform.zones, p.zones);
});

test('a launch with the same id replaces the queued one, including a derived ceiling id', () => {
  const p = started(launch('a:ceiling', 1000, [change(7, 'x')]), launch('a:ceiling', 2000, [change(7, 'y')]));
  assert.equal(p.launches.length, 1);
  assert.equal(p.launches[0].atMs, 2000);
  assert.equal(p.launches[0].changes[0].sourceId, 'y');
});

test('a cancelled launch never lands', () => {
  const p = applyPerformMessage(started(launch('a', 1000, [change(0, 'x')])), { type: 'performCancel', launchId: 'a' });
  const out = stepWallPerform(p, 5000, allReady);
  assert.equal(out.changed, false);
  assert.deepEqual(out.landed, []);
  assert.equal(out.perform.zones[0].launched, false);
});

test('cancelling an unknown id changes nothing', () => {
  const p = started(launch('a', 1000, [change(0, 'x')]));
  assert.equal(applyPerformMessage(p, { type: 'performCancel', launchId: 'nope' }), p);
});

test('an overdue launch lands now', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(0, 'x')])), 60000, allReady);
  assert.deepEqual(out.landed, [{ launchId: 'a', zones: [0] }]);
  assert.equal(out.perform.zones[0].sourceId, 'x');
});

test('overdue launches land in time order', () => {
  const out = stepWallPerform(started(launch('late', 2000, [change(0, 'b')]), launch('early', 1000, [change(1, 'a')])), 5000, allReady);
  assert.deepEqual(out.landed.map(l => l.launchId), ['early', 'late']);
});

test('when two overdue launches share a zone, the newest press wins and both are reported', () => {
  const inOrder = stepWallPerform(started(launch('first', 1000, [change(0, 'a')]), launch('second', 2000, [change(0, 'b')])), 5000, allReady);
  assert.equal(inOrder.perform.zones[0].sourceId, 'b');
  assert.deepEqual(inOrder.perform.phaseOffsets, { b: 0 });
  const newerIsEarlier = stepWallPerform(started(launch('older', 2000, [change(0, 'a')]), launch('newer', 1000, [change(0, 'b')])), 5000, allReady);
  assert.equal(newerIsEarlier.perform.zones[0].sourceId, 'b');
  assert.deepEqual(newerIsEarlier.landed, [{ launchId: 'newer', zones: [0] }, { launchId: 'older', zones: [] }]);
  assert.deepEqual(newerIsEarlier.perform.launches, []);
});

test('launching a playing source into a second zone keeps its running phase', () => {
  const first = stepWallPerform(started(launch('a', 1000, [change(0, 'x', { phaseOffsetBeats: 1 })])), 1000, allReady).perform;
  const next = applyPerformMessage(first, { type: 'performLaunch', launch: launch('b', 2000, [change(1, 'x', { phaseOffsetBeats: 3 })]) });
  const second = stepWallPerform(next, 2000, allReady);
  assert.equal(second.perform.zones[1].sourceId, 'x');
  assert.deepEqual(second.perform.phaseOffsets, { x: 1 });
});

test('one launch putting a new source on two zones takes its offset once', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(0, 'x', { phaseOffsetBeats: 2 }), change(1, 'x', { phaseOffsetBeats: 5 })])), 1000, allReady);
  assert.deepEqual(out.perform.phaseOffsets, { x: 2 });
});

test('a source that left the wall takes a new offset when it comes back', () => {
  let p = stepWallPerform(started(launch('a', 1000, [change(0, 'x', { phaseOffsetBeats: 1 })])), 1000, allReady).perform;
  p = stepWallPerform(applyPerformMessage(p, { type: 'performLaunch', launch: launch('b', 2000, [change(0, null)]) }), 2000, allReady).perform;
  assert.deepEqual(p.phaseOffsets, {});
  p = stepWallPerform(applyPerformMessage(p, { type: 'performLaunch', launch: launch('c', 3000, [change(0, 'x', { phaseOffsetBeats: 3 })]) }), 3000, allReady).perform;
  assert.deepEqual(p.phaseOffsets, { x: 3 });
});

test('a source id of __proto__ stays an ordinary phase offset', () => {
  const out = stepWallPerform(started(launch('a', 1000, [change(0, '__proto__', { phaseOffsetBeats: 4 })])), 1000, allReady);
  const offsets = out.perform.phaseOffsets;
  assert.ok(Object.hasOwn(offsets, '__proto__'));
  assert.equal(Object.getOwnPropertyDescriptor(offsets, '__proto__')?.value, 4);
  assert.equal(Object.getPrototypeOf(offsets), Object.prototype);
});

test('the wall queue holds the landed limit, and a full queue can still replace a launch', () => {
  let p = started();
  for (let i = 0; i < MAX_WALL_LAUNCHES; i++) p = applyPerformMessage(p, { type: 'performLaunch', launch: launch(`l${i}`, 1000, []) });
  assert.equal(p.launches.length, 32);
  assert.equal(applyPerformMessage(p, { type: 'performLaunch', launch: launch('one-more', 1000, []) }), p);
  const replaced = applyPerformMessage(p, { type: 'performLaunch', launch: launch('l5', 4000, []) });
  assert.equal(replaced.launches.length, 32);
  assert.equal(replaced.launches.find(l => l.id === 'l5')?.atMs, 4000);
});

test('at most the landed limit lands in one step; the rest land on the next', () => {
  const launches = Array.from({ length: MAX_WALL_LAUNCHES + 1 }, (_, i) => launch(`l${i}`, 1000 + i, []));
  const first = stepWallPerform({ ...started(), launches }, 5000, allReady);
  assert.equal(first.landed.length, 32);
  assert.deepEqual(first.perform.launches.map(l => l.id), ['l32']);
  const second = stepWallPerform(first.perform, 5016, allReady);
  assert.deepEqual(second.landed, [{ launchId: 'l32', zones: [] }]);
  assert.deepEqual(second.perform.launches, []);
});

test('performStart restores phase offsets, and a __proto__ key stays ordinary', () => {
  const phaseOffsets = JSON.parse('{"x":1.5,"__proto__":2}') as Record<string, number>;
  const p = applyPerformMessage(initialWallPerform(), { type: 'performStart', zones: black(), phaseOffsets });
  assert.equal(p.phaseOffsets.x, 1.5);
  assert.equal(Object.getOwnPropertyDescriptor(p.phaseOffsets, '__proto__')?.value, 2);
  assert.equal(Object.getPrototypeOf(p.phaseOffsets), Object.prototype);
  assert.notEqual(p.phaseOffsets, phaseOffsets);
  assert.deepEqual(applyPerformMessage(initialWallPerform(), { type: 'performStart', zones: black() }).phaseOffsets, {});
});

test('stepping does not change the state it was given', () => {
  const p = started(launch('a', 1000, [change(0, 'slow'), change(1, 'quick')]));
  const before = structuredClone(p);
  stepWallPerform(p, 1000, id => id === 'quick');
  assert.deepEqual(p, before);
});

test('performEnd clears the overlay', () => {
  let p = stepWallPerform(started(launch('a', 1000, [change(0, 'x')]), launch('b', 9000, [change(1, 'y')])), 1000, allReady).perform;
  p = applyPerformMessage(p, { type: 'performArm', sourceIds: ['z'] });
  p = applyPerformMessage(p, { type: 'performValues', values: { master: 1, zones: [] } });
  assert.deepEqual(applyPerformMessage(p, { type: 'performEnd' }), initialWallPerform());
});

test('nothing but performStart acts on a wall that is not performing', () => {
  const idle = initialWallPerform();
  assert.equal(applyPerformMessage(idle, { type: 'performLaunch', launch: launch('a', 0, [change(0, 'x')]) }), idle);
  assert.equal(applyPerformMessage(idle, { type: 'performArm', sourceIds: ['x'] }), idle);
  assert.equal(applyPerformMessage(idle, { type: 'performValues', values: { master: 1, zones: [] } }), idle);
  assert.equal(stepWallPerform(idle, 1000, allReady).changed, false);
});

test('other Map messages leave Perform alone', () => {
  const p = started();
  assert.equal(applyPerformMessage(p, { type: 'freeze', on: true }), p);
});

test('the wall state carries Perform and refuses a bad message', () => {
  let wall = applyMapMessage(initialWall(), { type: 'performStart', zones: black() });
  assert.equal(wall.perform.active, true);
  wall = applyMapMessage(wall, { type: 'performArm', sourceIds: ['x'] });
  assert.deepEqual(wall.perform.armed, ['x']);
  assert.equal(applyMapMessage(wall, { type: 'performArm', sourceIds: [3] }), wall);
  assert.equal(applyMapMessage(wall, { type: 'performEnd' }).perform.active, false);
});
