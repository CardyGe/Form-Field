import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapMessage } from '../src/map/messages';
import { createShow, type ShowDocument } from '../src/map/show';
import { clockSnapshot, PerformService, type ClockLink, type WallLink } from '../src/perform/service';
import type { ClockSnapshot } from '../src/perform/timing';
import { applyPerformMessage, initialWallPerform, stepWallPerform } from '../src/perform/wall-perform';
import type { Clip, Scene } from '../src/perform/types';
import { TempoClock } from '../src/react/tempo';
import type { AudioStatus, MidiStatus } from '../src/react/engine';
import type { Signals } from '../src/react/signals';

const BAR_MS = 2000; // 120 BPM

const clip = (id: string, sourceId: string, hueOffset = 0): Clip => ({ id, name: id, sourceId, hueOffset, blend: null, audioBand: 'bass' });
const scene = (id: string, cells: Record<number, string>, follow: Scene['follow'] = null): Scene => ({ id, name: id, cells: Array.from({ length: 8 }, (_, i) => cells[i] ?? null), includeProtected: false, follow });

function makeShow(): ShowDocument {
  const show = createShow();
  show.shapes = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, groupId: null })) as unknown as ShowDocument['shapes'];
  show.sources = ['a', 'b', 'free'].map(id => ({ id, speed: 1, tempoSync: id === 'free' ? null : 4, project: { layers: [] } })) as unknown as ShowDocument['sources'];
  show.performance.zones = show.performance.zones.map((z, i) => ({ ...z, target: { kind: 'shape', id: `s${i}` } }));
  show.performance.clips = [clip('ca', 'a', 30), clip('cb', 'b'), clip('cf', 'free'), clip('cf2', 'free', 90)];
  show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cb' }), scene('two', { 0: 'cb' })];
  return show;
}

function rig(show = makeShow(), open = true) {
  const sent: MapMessage[] = [];
  const log: string[] = [];
  let now = 1000, barOffset = 0, next = 0, frame: ((s: Signals) => void) | null = null;
  const state = { audio: { state: 'on', label: 'x' } as AudioStatus, midi: { state: 'off' } as MidiStatus, open };
  const wall: WallLink = {
    send: m => { sent.push(m); log.push(m.type); },
    isOpen: () => state.open,
    sendWholeShow: () => { log.push('wholeShow'); },
  };
  const clock: ClockLink & { audio(): AudioStatus; midi(): MidiStatus } = {
    snapshot: (): ClockSnapshot => ({ anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'locked', barOffset }),
    begin: () => { log.push('clock.begin'); },
    end: () => { log.push('clock.end'); },
    tap: () => { log.push('clock.tap'); },
    follow: () => { log.push('clock.follow'); },
    setBarStart: () => { barOffset = 1; log.push('clock.bar'); },
    subscribe: fn => { frame = fn; return () => { frame = null; log.push('clock.off'); }; },
    audio: () => state.audio,
    midi: () => state.midi,
  };
  const service = new PerformService({ wall, clock, show: () => show, now: () => now, id: () => `L${++next}`, random: () => 0 });
  const ofType = <T extends MapMessage['type']>(type: T) => sent.filter((m): m is Extract<MapMessage, { type: T }> => m.type === type);
  const ready = () => { service.control({ kind: 'sendAllStart' }); service.control({ kind: 'sendAllEnd' }); };
  return { service, sent, log, show, state, ofType, ready, now: () => now, at: (ms: number) => { now = ms; }, frame: (s: Signals = {}) => frame?.(s), hasFrame: () => frame !== null };
}
type Rig = ReturnType<typeof rig>;
const lastLaunch = (r: Rig) => r.ofType('performLaunch').at(-1)!.launch;
const lastValues = (r: Rig) => r.ofType('performValues').at(-1)!.values;

test('startShow sends a black start; no launch until Bank ▶', () => {
  const r = rig();
  r.service.startShow();
  assert.equal(r.service.view().running, true);
  assert.equal(r.log[0], 'clock.begin');
  const start = r.ofType('performStart')[0];
  assert.equal(start.zones.length, 8);
  assert.ok(start.zones.every(z => !z.launched && z.sourceId === null));
  assert.equal(lastValues(r).master, 0);
  r.frame();
  assert.equal(r.ofType('performLaunch').length, 0);
  // Reading the controls does not start anything either.
  r.ready();
  r.frame();
  assert.equal(r.ofType('performLaunch').length, 0);
});

test('a press sends one exact-time launch to the wall', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.at(1000);
  r.service.control({ kind: 'bankNext', down: true });
  const launches = r.ofType('performLaunch');
  assert.equal(launches.length, 1);
  assert.equal(launches[0].launch.atMs, BAR_MS);
  assert.equal(launches[0].launch.barMs, BAR_MS);
  assert.deepEqual(launches[0].launch.changes.map(c => [c.zone, c.sourceId, c.shapeIds]), [[0, 'a', ['s0']], [1, 'b', ['s1']]]);
  r.frame();
  assert.equal(r.ofType('performLaunch').length, 1, 'an unchanged launch is not sent again');
});

test('correcting the 1 cancels and resends queued launches at the new bar', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.at(1000);
  r.service.action({ type: 'bankNext' });
  const id = lastLaunch(r).id;
  r.service.action({ type: 'downbeat' });
  assert.ok(r.log.includes('clock.bar'));
  assert.ok(r.ofType('performCancel').some(m => m.launchId === id));
  const moved = lastLaunch(r);
  assert.equal(moved.id, id);
  // The bar now starts on beat 1, which is 500 ms in: the next one is at 2500.
  assert.equal(moved.atMs, 2500);
  assert.ok(moved.changes.every(c => c.phaseOffsetBeats === 1));
});

test('on a one-beat grid, correcting the 1 keeps the time but resends the new bar offset', () => {
  const r = rig();
  r.show.performance.launchQuantize = '1/4';
  r.service.startShow(); r.ready();
  r.at(1200); // past the late-press grace of the beat at 1000
  r.service.action({ type: 'bankNext' });
  assert.equal(lastLaunch(r).atMs, 1500);
  assert.equal(lastLaunch(r).changes[0].phaseOffsetBeats, 0);
  r.service.action({ type: 'downbeat' });
  assert.equal(lastLaunch(r).atMs, 1500);
  assert.equal(lastLaunch(r).changes[0].phaseOffsetBeats, 1);
});

test('a press just after the bar stays on it when the 1 is corrected', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.at(2050);
  r.service.action({ type: 'bankNext' });
  assert.equal(lastLaunch(r).atMs, 2050);
  const count = r.ofType('performLaunch').length;
  r.at(2060);
  r.service.action({ type: 'downbeat' });
  assert.equal(r.ofType('performLaunch').length, count, 'a launch already firing is not pushed a boundary');
});

test('re-pressing the playing clip cancels what was queued on the wall', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const id = lastLaunch(r).id;
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: id, zones: [0, 1] }] });
  r.at(2200); // past the late-press grace, so these wait for the next bar rather than firing at once
  r.service.action({ type: 'next', zone: 2 }); // zone 2 has no clips: nothing queued
  r.service.action({ type: 'next', zone: 1 }); // column of zone 1 is only cb, already playing
  assert.equal(r.service.view().launcher.queue.length, 0);
  r.service.action({ type: 'next', zone: 0 }); // ca -> cb
  const queued = lastLaunch(r).id;
  r.service.action({ type: 'next', zone: 0 }); // cb -> ca, which is playing: only clears the queue
  assert.equal(r.service.view().launcher.queue.length, 0);
  assert.ok(r.ofType('performCancel').some(m => m.launchId === queued));
});

test('landed reports update what is playing', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const id = lastLaunch(r).id;
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: id, zones: [0, 1] }], armed: ['b'] });
  const view = r.service.view();
  assert.deepEqual(view.launcher.playing.slice(0, 2), ['ca', 'cb']);
  assert.equal(view.launcher.sceneIndex, 0);
  assert.deepEqual(view.armed, ['b']);
  // A report for a launch no longer queued changes nothing.
  r.service.wallState({ landed: [{ launchId: 'gone', zones: [3] }] });
  assert.equal(r.service.view().launcher.playing[3], null);
});

test('a partial landing resends the rest past the missed bar, not at its old time', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const id = lastLaunch(r).id;
  r.at(2000); // exactly on the bar the rest missed
  r.service.wallState({ landed: [{ launchId: id, zones: [0] }] });
  const rest = lastLaunch(r);
  assert.equal(rest.id, id);
  assert.equal(rest.atMs, 4000);
  assert.deepEqual(rest.changes.map(c => c.zone), [1]);
});

test('a scene with nothing to change still lands, so the row moves on', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', {}), scene('two', { 0: 'ca' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  assert.equal(r.ofType('performLaunch').length, 0, 'nothing to send');
  r.at(2000);
  r.frame();
  assert.equal(r.service.view().launcher.sceneIndex, 0);
  assert.equal(r.service.view().launcher.queue.length, 0);
});

test('a follow rule launches by itself', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca' }, { afterBars: 4, to: 'next' }), scene('two', { 0: 'cb' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0] }] });
  const before = r.ofType('performLaunch').length;
  r.at(9000);
  r.frame();
  assert.equal(r.ofType('performLaunch').length, before, 'not due yet');
  // Queued ahead of the bar at 10000, for that exact bar.
  r.at(9900);
  r.frame();
  assert.equal(r.ofType('performLaunch').length, before + 1);
  assert.equal(lastLaunch(r).atMs, 10000);
  assert.equal(lastLaunch(r).changes[0].sourceId, 'b');
});

test('values reach the wall at most 30 times a second', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  const before = r.ofType('performValues').length;
  for (let ms = 0; ms < 1000; ms++) {
    r.at(5000 + ms);
    r.service.control({ kind: 'master', value: (ms % 100) / 100 });
    r.frame();
  }
  const sent = r.ofType('performValues').length - before;
  assert.ok(sent >= 25 && sent <= 30, `${sent} value messages in a second`);
});

test('shared clips average their speed knobs, but keep separate brightness and colour', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'cf', 1: 'cf2' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0, 1] }] });
  r.service.control({ kind: 'knob', strip: 0, knob: 2, value: 0 });
  r.service.control({ kind: 'knob', strip: 1, knob: 2, value: 0 });
  r.service.control({ kind: 'knob', strip: 0, knob: 0, value: 1 });
  r.service.control({ kind: 'knob', strip: 1, knob: 0, value: .5 });
  r.service.control({ kind: 'fader', strip: 0, value: .25 });
  r.service.control({ kind: 'fader', strip: 1, value: .75 });
  r.service.control({ kind: 'master', value: 1 });
  r.at(3000);
  r.frame();
  const v = lastValues(r);
  assert.equal(v.zones[0].speed, v.zones[1].speed);
  assert.ok(Math.abs(v.zones[0].speed - 2) < 1e-9, `the average of full and centre is 4^0.5, got ${v.zones[0].speed}`);
  assert.equal(v.zones[0].brightness, .25);
  assert.equal(v.zones[1].brightness, .75);
  assert.equal(v.zones[0].hueDeg, 0);
  assert.equal(v.zones[1].hueDeg, 90);
});

test('a locked clip sends only half, one or two', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0, 1] }] });
  for (const [knob, want] of [[0, .5], [.5, 1], [1, 2]] as const) {
    r.service.control({ kind: 'knob', strip: 0, knob: 0, value: knob });
    r.at(3000 + knob * 1000);
    r.frame();
    assert.equal(lastValues(r).zones[0].speed, want);
  }
});

test('wallReopened resends the show, zones, armed sources and values', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const id = lastLaunch(r).id;
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: id, zones: [0] }] }); // zone 1 is still queued
  r.at(2500);
  r.sent.length = 0; r.log.length = 0;
  r.service.wallReopened();
  // Values before the show, so a fresh wall never draws a frame at full master.
  assert.deepEqual(r.log.slice(0, 3), ['performStart', 'performValues', 'wholeShow']);
  const start = r.ofType('performStart')[0];
  assert.equal(start.zones[0].sourceId, 'a');
  assert.equal(start.zones[0].launched, true);
  assert.deepEqual(start.phaseOffsets, { a: 0 });
  assert.equal(r.ofType('performArm').length, 1);
  assert.equal(r.ofType('performValues').length, 1);
  const again = lastLaunch(r);
  assert.equal(again.id, id);
  assert.equal(again.atMs, 4000, 'a deferred launch is retimed, not resent at its old time');
  assert.ok(r.log.indexOf('performLaunch') > r.log.indexOf('wholeShow'));
});

test('a scene pressed again while the last one is landing queues for the next bar', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const first = lastLaunch(r);
  r.at(2010); // the wall landed it at 2000; its report has not arrived
  r.service.action({ type: 'bankNext' });
  assert.equal(r.ofType('performCancel').some(m => m.launchId === first.id), false, 'a landing launch is not cancelled');
  const second = lastLaunch(r);
  assert.notEqual(second.id, first.id);
  assert.equal(second.atMs, 4000, 'no grace on a bar that has already fired');
  r.at(2020);
  r.service.wallState({ landed: [{ launchId: first.id, zones: [0, 1] }] });
  assert.deepEqual(r.service.view().launcher.playing.slice(0, 2), ['ca', 'cb']);
  assert.equal(r.service.view().launcher.sceneIndex, 0);
  assert.ok(r.service.view().launcher.queue.some(l => l.id === second.id));
  r.at(4000);
  r.service.wallState({ landed: [{ launchId: second.id, zones: [0] }] });
  assert.deepEqual(r.service.view().launcher.playing.slice(0, 2), ['cb', 'cb']);
  assert.equal(r.service.view().launcher.sceneIndex, 1);
});

test('a zone pressed again while its launch is landing steps on from the landing clip', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const first = lastLaunch(r);
  r.at(2010);
  r.service.action({ type: 'next', zone: 0 });
  assert.equal(r.ofType('performCancel').some(m => m.launchId === first.id), false);
  const second = lastLaunch(r);
  assert.equal(second.atMs, 4000);
  assert.deepEqual(second.changes.map(c => [c.zone, c.sourceId]), [[0, 'b']]);
  r.at(2020);
  r.service.wallState({ landed: [{ launchId: first.id, zones: [0, 1] }] });
  assert.deepEqual(r.service.view().launcher.playing.slice(0, 2), ['ca', 'cb']);
  assert.ok(r.service.view().launcher.queue.some(l => l.id === second.id));
});

test('two zones pressed just after the bar both keep the late-press grace', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cb', 2: 'cf' })];
  r.service.startShow(); r.ready();
  r.at(2030);
  r.service.action({ type: 'next', zone: 0 });
  assert.equal(lastLaunch(r).atMs, 2030);
  r.at(2060);
  r.service.action({ type: 'next', zone: 2 });
  assert.equal(lastLaunch(r).atMs, 2060, 'a two-handed press stays on one bar');
  assert.deepEqual(lastLaunch(r).changes.map(c => c.zone), [2]);
});

test('a zone the landing scene does not touch keeps the late-press grace', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cb' }), scene('x', { 3: 'cf' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const first = lastLaunch(r);
  r.at(2050);
  r.service.action({ type: 'next', zone: 3 });
  assert.equal(lastLaunch(r).atMs, 2050);
  assert.equal(r.ofType('performCancel').some(m => m.launchId === first.id), false, 'the landing scene is left alone');
});

test('a Stop on a zone the landing launch does not touch keeps the late-press grace', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0, 1] }] });
  r.at(3000);
  r.service.action({ type: 'bankNext' }); // scene two changes zone 0 only
  r.at(4050);
  r.service.action({ type: 'stop', zone: 1 });
  assert.equal(lastLaunch(r).atMs, 4050);
  assert.deepEqual(lastLaunch(r).changes.map(c => [c.zone, c.sourceId]), [[1, null]]);
});

test('after a partial landing, a newer press on the waiting zone wins on the wall and in the studio', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cb' }), scene('two', { 1: 'ca' })];
  let wall = initialWallPerform(), seen = 0;
  const step = (ready: (id: string) => boolean) => {
    for (; seen < r.sent.length; seen++) wall = applyPerformMessage(wall, r.sent[seen]);
    const result = stepWallPerform(wall, r.now(), ready);
    wall = result.perform;
    return result.landed;
  };
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const first = lastLaunch(r);
  r.at(2000);
  const partial = step(id => id === 'a'); // zone 0 lands, zone 1's source is not ready
  assert.deepEqual(partial, [{ launchId: first.id, zones: [0] }]);
  r.at(2010);
  r.service.action({ type: 'next', zone: 1 }); // the operator moves zone 1 on, before the report
  const newer = lastLaunch(r);
  assert.equal(newer.atMs, 4000);
  r.at(2020);
  r.service.wallState({ landed: partial });
  assert.equal(r.service.view().launcher.queue.some(l => l.id === first.id), false, 'the stale remainder is gone');
  r.at(4000);
  const next = step(() => true);
  assert.deepEqual(next, [{ launchId: newer.id, zones: [1] }]);
  r.at(4010);
  r.service.wallState({ landed: next });
  assert.equal(wall.zones[1].sourceId, 'a');
  assert.equal(r.service.view().launcher.playing[1], 'ca');
});

/** The real wall rules, fed with everything the service has sent. */
function wallOf(r: Rig) {
  let wall = initialWallPerform(), seen = 0;
  const feed = () => { for (; seen < r.sent.length; seen++) wall = applyPerformMessage(wall, r.sent[seen]); };
  return {
    step: (ready: (id: string) => boolean) => { feed(); const out = stepWallPerform(wall, r.now(), ready); wall = out.perform; return out.landed; },
    zone: (i: number) => { feed(); return wall.zones[i].sourceId; },
    launches: () => { feed(); return wall.launches.map(l => l.id); },
    /** The compositor's rule: a source nothing plays and nothing arms is released, so it is not ready. */
    kept: (id: string) => { feed(); return wall.armed.includes(id) || wall.zones.some(z => z.launched && z.sourceId === id); },
    /** Puts a zone where a crossed report says the wall already is. */
    put: (i: number, sourceId: string) => { feed(); wall = { ...wall, zones: wall.zones.map((z, n) => n === i ? { ...z, sourceId, launched: true } : z) }; },
  };
}
/** The later press landed `cb` on zone 1, then the older launch's report crossed it: the wall shows `free` there and has let `b` go. */
function crossedLanding() {
  const { r, wall, older, newer } = olderWaitingThenScene();
  const first = wall.step(id => id === 'a' || id === 'b');
  assert.deepEqual(first, [{ launchId: newer.id, zones: [0, 1] }]);
  r.at(2030);
  r.service.wallState({ landed: first });
  r.at(2040);
  r.service.wallState({ landed: [{ launchId: older.id, zones: [1] }] });
  wall.put(1, 'free');
  assert.deepEqual([wall.zone(0), wall.zone(1)], ['a', 'free'], 'nothing on the wall plays the later press\'s source any more');
  return { r, wall, fix: lastLaunch(r) };
}
/** Zone 1 is queued to `cf` for 2000 and its source never readies; then a scene pressed later plays `cb` there and fires at once. */
function olderWaitingThenScene() {
  const r = rig();
  r.show.performance.scenes = [scene('x', { 1: 'cf' }), scene('one', { 0: 'ca', 1: 'cb' })];
  const wall = wallOf(r);
  r.service.startShow(); r.ready();
  r.service.action({ type: 'next', zone: 1 });
  const older = lastLaunch(r);
  r.at(2000);
  assert.deepEqual(wall.step(id => id === 'a'), [], 'the older launch is waiting on its source');
  r.at(2010);
  r.service.action({ type: 'bankNext' }); // row 0
  r.service.action({ type: 'bankNext' }); // row 1
  const newer = lastLaunch(r);
  assert.deepEqual(newer.changes.map(c => c.zone), [0, 1]);
  r.at(2020);
  r.service.action({ type: 'launchNow' });
  return { r, wall, older, newer: lastLaunch(r) };
}

test('a partial landing keeps the zone for the later press, even when the older launch is still queued', () => {
  const { r, wall, older, newer } = olderWaitingThenScene();
  const report = wall.step(id => id === 'a');
  assert.deepEqual(report, [{ launchId: newer.id, zones: [0] }]);
  r.at(2030);
  r.service.wallState({ landed: report });
  assert.equal(r.service.view().launcher.queue.some(l => l.id === older.id), false, 'the older press gave up the zone');
  assert.deepEqual(r.service.view().launcher.queue.find(l => l.id === newer.id)?.changes.map(c => c.zone), [1]);
  r.at(4000);
  const next = wall.step(() => true);
  assert.deepEqual(next, [{ launchId: newer.id, zones: [1] }]);
  r.at(4010);
  r.service.wallState({ landed: next });
  assert.equal(wall.zone(1), 'b');
  assert.equal(r.service.view().launcher.playing[1], 'cb');
});

test('once a later press has landed on a zone, an older launch cannot come back to it', () => {
  const { r, wall, older, newer } = olderWaitingThenScene();
  const report = wall.step(id => id === 'a' || id === 'b');
  assert.deepEqual(report, [{ launchId: newer.id, zones: [0, 1] }]);
  r.at(2030);
  r.service.wallState({ landed: report });
  assert.equal(r.service.view().launcher.queue.some(l => l.id === older.id), false);
  assert.equal(wall.launches().includes(older.id), false, 'the wall no longer holds it');
  r.at(2400); r.frame();
  r.at(4000);
  assert.deepEqual(wall.step(() => true), []);
  assert.equal(wall.zone(1), 'b');
  assert.equal(r.service.view().launcher.playing[1], 'cb');
});

test('an older partial remainder yields to a later press, whatever the queue order', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cb' }), scene('two', { 1: 'ca' })];
  const wall = wallOf(r);
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const older = lastLaunch(r);
  r.at(2000);
  const report = wall.step(id => id === 'a');
  r.at(2010);
  r.service.action({ type: 'next', zone: 1 });
  const later = lastLaunch(r);
  r.at(2015);
  r.service.action({ type: 'downbeat' }); // retiming puts the firing launch first and the later press after it
  r.at(2020);
  r.service.wallState({ landed: report });
  assert.equal(r.service.view().launcher.queue.some(l => l.id === older.id), false);
  const moved = r.service.view().launcher.queue.find(l => l.id === later.id)!;
  r.at(moved.atMs);
  const next = wall.step(() => true);
  assert.deepEqual(next, [{ launchId: later.id, zones: [1] }]);
  r.service.wallState({ landed: next });
  assert.equal(wall.zone(1), 'a');
  assert.equal(r.service.view().launcher.playing[1], 'ca');
});

test('an older launch that lands after a later press is put right on the next boundary', () => {
  const { r, wall, older, newer } = olderWaitingThenScene();
  const first = wall.step(id => id === 'a' || id === 'b');
  r.at(2030);
  r.service.wallState({ landed: first });
  assert.deepEqual(first, [{ launchId: newer.id, zones: [0, 1] }]);
  // The cancel crossed the older launch landing on the wall.
  r.at(2040);
  r.service.wallState({ landed: [{ launchId: older.id, zones: [1] }] });
  assert.equal(r.service.view().launcher.playing[1], 'cb', 'the studio keeps the later press');
  const fix = lastLaunch(r);
  assert.equal(fix.atMs, 4000);
  assert.deepEqual(fix.changes.map(c => [c.zone, c.sourceId]), [[1, 'b']]);
});

test('the repair after a crossed landing arms its released source, lands, and leaves wall and studio agreeing', () => {
  const { r, wall, fix } = crossedLanding();
  assert.deepEqual(fix.changes.map(c => [c.zone, c.sourceId]), [[1, 'b']]);
  assert.equal(r.ofType('performArm').at(-1)!.sourceIds[0], 'b', 'the queued source is armed first, though the studio lists its clip as playing');
  assert.equal(wall.kept('b'), true, 'armed, so the wall makes it ready');
  r.at(4000);
  const report = wall.step(wall.kept);
  assert.deepEqual(report, [{ launchId: fix.id, zones: [1] }]);
  r.at(4010);
  r.service.wallState({ landed: report, armed: [] });
  assert.equal(wall.zone(1), 'b');
  assert.equal(r.service.view().launcher.playing[1], 'cb');
  assert.equal(r.service.view().launcher.queue.length, 0);
  assert.equal(wall.launches().length, 0);
  assert.deepEqual(r.service.view().stuck, []);
});

test('a repair whose source cannot get ready shows as stuck', () => {
  const { r, wall, fix } = crossedLanding();
  r.service.wallState({ armed: [] });
  assert.deepEqual(r.service.view().waiting, ['b']);
  r.at(4000);
  assert.deepEqual(wall.step(id => id !== 'b' && wall.kept(id)), []);
  r.at(4300);
  r.frame();
  assert.deepEqual(r.service.view().stuck, ['b'], 'the operator sees the red dot');
  assert.equal(lastLaunch(r).id, fix.id);
  assert.equal(lastLaunch(r).atMs, 6000, 'and it tries again on the next bar');
});

test('a queued source another zone already plays is armed first, and at most eight are armed', () => {
  const r = rig();
  const ids = Array.from({ length: 10 }, (_, i) => `x${i}`);
  r.show.sources = ['a', 'b', ...ids].map(id => ({ id, speed: 1, tempoSync: 4, project: { layers: [] } })) as unknown as ShowDocument['sources'];
  r.show.performance.clips = [clip('ca', 'a'), clip('cb', 'b'), clip('cb2', 'b'), ...ids.map(id => clip(`c${id}`, id))];
  r.show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cb' }), scene('two', { 0: 'cb2', 1: 'cx0', 2: 'cx1', 3: 'cx2', 4: 'cx3', 5: 'cx4', 6: 'cx5' }), scene('three', { 0: 'cx7', 1: 'cx8', 2: 'cx9' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0, 1] }] });
  r.at(2500);
  r.service.action({ type: 'bankNext' });
  // Seven queued, then the next row's clips for the one place left.
  assert.deepEqual(r.ofType('performArm').at(-1)!.sourceIds, ['b', 'x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x7']);
});

test('a launch replaced just as it landed still updates what is playing when its report arrives', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca' }), scene('two', { 0: 'cb' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0] }] });
  r.at(2500);
  r.service.action({ type: 'next', zone: 0 });
  const late = lastLaunch(r);
  r.at(3999);
  r.service.action({ type: 'next', zone: 0 }); // back to the playing clip: the queue clears, but the cancel crosses the landing
  assert.ok(r.ofType('performCancel').some(m => m.launchId === late.id));
  r.at(4010);
  r.service.wallState({ landed: [{ launchId: late.id, zones: [0] }] });
  const view = r.service.view();
  assert.equal(view.launcher.playing[0], 'cb');
  assert.equal(view.launcher.previous[0], 'ca');
  r.sent.length = 0;
  r.service.wallReopened();
  assert.deepEqual(r.ofType('performStart')[0].phaseOffsets, { b: 0 });
});

test('a launch still waiting past the in-flight window moves to the current grid', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  const id = lastLaunch(r).id;
  r.at(2100);
  r.frame();
  assert.equal(lastLaunch(r).atMs, 2000, 'still on its way');
  r.at(2300);
  r.frame();
  assert.equal(lastLaunch(r).id, id);
  assert.equal(lastLaunch(r).atMs, 4000);
});

test('a reopened wall shows no false red dot', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.at(1000 + BAR_MS * 2);
  r.frame();
  assert.ok(r.service.view().stuck.length > 0);
  r.service.wallReopened();
  assert.deepEqual(r.service.view().stuck, []);
  assert.ok(r.service.view().waiting.length > 0);
});

test('queued sources are armed first, as source ids, and a source that never readies is shown as stuck', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  assert.deepEqual(r.ofType('performArm').at(-1)!.sourceIds, ['a', 'b']);
  r.service.wallState({ armed: ['a'] });
  assert.deepEqual(r.service.view().waiting, ['b']);
  assert.deepEqual(r.service.view().stuck, []);
  r.at(1000 + BAR_MS);
  r.frame();
  assert.deepEqual(r.service.view().stuck, ['b']);
  r.service.wallState({ armed: ['a', 'b'] });
  assert.deepEqual(r.service.view().stuck, []);
});

test('a deleted zone target does not throw during tick', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.show.shapes = [];
  r.show.performance.zones[0].target = null;
  r.show.performance.clips = r.show.performance.clips.filter(c => c.id !== 'cb');
  r.at(2000);
  assert.doesNotThrow(() => r.frame());
  assert.doesNotThrow(() => r.service.wallReopened());
  assert.ok(lastLaunch(r).changes.every(c => c.sourceId !== 'b'), 'a deleted clip is not launched');
});

test('endShow restores the clock source and the Map show', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.endShow();
  assert.equal(r.service.view().running, false);
  assert.ok(r.log.includes('performEnd'));
  assert.ok(r.log.includes('clock.end'));
  assert.equal(r.hasFrame(), false);
  const count = r.sent.length;
  r.service.tick();
  r.service.action({ type: 'bankNext' });
  assert.equal(r.sent.length, count, 'nothing reaches the wall after the show');
});

test('losing audio keeps the show running and reports it', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.service.control({ kind: 'master', value: 1 });
  r.service.control({ kind: 'fader', strip: 0, value: .5 });
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0, 1] }] });
  r.at(2100); r.frame({ 'audio.bass': 1 });
  r.at(2200); r.frame({ 'audio.bass': 1 });
  assert.ok(lastValues(r).zones[0].brightness > .5, 'audio lifts the zone');
  r.state.audio = { state: 'lost' };
  for (let t = 2300; t <= 3300; t += 50) { r.at(t); r.frame({}); }
  const view = r.service.view();
  assert.equal(view.running, true);
  assert.equal(view.audio.state, 'lost');
  assert.ok(view.notices.some(n => /audio/i.test(n)));
  assert.ok(Math.abs(lastValues(r).zones[0].brightness - .5) < .01, 'the reaction eases to nothing');
});

test('a lost controller clears shift and bursts and holds every value', () => {
  const r = rig();
  r.service.startShow(); r.ready();
  r.state.midi = { state: 'on', devices: ['MIDImix'] };
  r.frame();
  assert.equal(r.service.view().midi, 'connected');
  r.service.control({ kind: 'fader', strip: 0, value: .6 });
  r.service.control({ kind: 'solo', down: true });
  r.state.midi = { state: 'on', devices: [] };
  r.frame();
  const view = r.service.view();
  assert.equal(view.midi, 'lost');
  assert.equal(view.shift, false);
  assert.equal(view.running, true);
  assert.equal(view.controls.faders[0], .6);
  assert.ok(view.controls.held.every(Boolean));
});

test('the signals sent during a show carry the tempo and only what the show uses', () => {
  const r = rig();
  r.service.startShow();
  r.frame({ 'tempo.beat': 3, 'tempo.phase': .5, 'tempo.bpm': 128, 'audio.bass': .4 });
  assert.deepEqual(r.ofType('signals').at(-1)!.signals, { 'tempo.beat': 3, 'tempo.phase': .5, 'tempo.bpm': 128 });
});

test('the clock adapter reads the tempo clock in the shared time base', () => {
  const tempo = new TempoClock();
  tempo.setBpm(120);
  tempo.advance(10);
  const origin = 1_000_000;
  const a = clockSnapshot(tempo, origin + 10_000, origin);
  const b = clockSnapshot(tempo, origin + 11_000, origin);
  assert.equal(a.bpm, 120);
  assert.equal(a.anchorMs, origin + 10_000);
  assert.ok(Math.abs(b.anchorBeat - a.anchorBeat - 2) < 1e-9, 'a second is two beats at 120');
});

test('audio reaction and bursts never move a locked clip speed, but lift a free one', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca', 1: 'cf' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0, 1] }] });
  for (const strip of [0, 1]) { r.service.control({ kind: 'knob', strip, knob: 2, value: 1 }); r.service.control({ kind: 'fader', strip, value: 1 }); }
  r.service.control({ kind: 'master', value: 1 });
  r.service.action({ type: 'burst', zone: 0, on: true });
  r.service.action({ type: 'burst', zone: 1, on: true });
  for (let t = 2100; t <= 2600; t += 50) { r.at(t); r.frame({ 'audio.bass': 1, 'beat.pulse': 1 }); }
  const v = lastValues(r);
  assert.equal(v.zones[0].speed, 1, 'a locked clip keeps its loop speed');
  assert.ok(v.zones[0].brightness > 1, 'but still brightens');
  assert.ok(v.zones[1].speed > 1, 'a free clip speeds up');
  assert.ok(v.zones.every(z => z.brightness <= 1.6));
});

test('values reach the wall at most 30 times a second, and fader 0 stays black in a burst', () => {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 0: 'ca' })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [0] }] });
  r.service.control({ kind: 'knob', strip: 0, knob: 2, value: 1 });
  r.service.control({ kind: 'fader', strip: 0, value: 1 });
  r.service.control({ kind: 'master', value: 1 });
  r.service.action({ type: 'burst', zone: 0, on: true });
  r.at(2990); r.frame({ 'audio.bass': 1, 'beat.pulse': 1 });
  const before = r.ofType('performValues').length;
  for (let i = 0; i < 100; i++) { r.at(3000 + i * 5); r.frame({ 'audio.bass': i % 4 < 2 ? 1 : 0, 'beat.pulse': i % 4 < 2 ? 1 : 0 }); }
  const sentCount = r.ofType('performValues').length - before;
  assert.ok(sentCount > 0 && sentCount <= 16, `half a second sends at most about 15, sent ${sentCount}`);
  assert.ok(lastValues(r).zones[0].brightness > 0, 'the burst is visible with the fader up');
  r.service.control({ kind: 'fader', strip: 0, value: 0 });
  r.at(3600); r.frame({ 'audio.bass': 1, 'beat.pulse': 1 });
  assert.equal(lastValues(r).zones[0].brightness, 0, 'fader 0 is black mid-burst');
});

// ---- Task 12: the ceiling's own knobs and bloom ----
/** The ceiling playing `clipId` with its fader and master up and the given knobs, landed at 2000 ms. */
function ceilingRig(clipId: string, knobs: { drift?: number; breath?: number } = {}) {
  const r = rig();
  r.show.performance.scenes = [scene('one', { 7: clipId })];
  r.service.startShow(); r.ready();
  r.service.action({ type: 'launchCell', row: 0, zone: 7 });
  r.at(2000);
  r.service.wallState({ landed: [{ launchId: lastLaunch(r).id, zones: [7] }] });
  r.service.control({ kind: 'knob', strip: 7, knob: 0, value: knobs.drift ?? .5 });
  r.service.control({ kind: 'knob', strip: 7, knob: 2, value: knobs.breath ?? 0 });
  r.service.control({ kind: 'fader', strip: 7, value: 1 });
  r.service.control({ kind: 'master', value: 1 });
  return r;
}
const ceilingOf = (r: Rig) => lastValues(r).zones[7];

test('Knob 3 on strip 8 is breath, not audio response: the ceiling ignores loud sound', () => {
  const quiet = ceilingRig('cf', { breath: 0 });
  for (let t = 2050; t <= 12000; t += 50) { quiet.at(t); quiet.frame({ 'audio.bass': 1, 'audio.level': 1, 'beat.pulse': t % 500 < 100 ? 1 : 0 }); assert.equal(ceilingOf(quiet).brightness, 1, `at ${t}`); }
  const breathing = ceilingRig('cf', { breath: 1 });
  const out: number[] = [];
  for (let t = 2050; t <= 26000; t += 50) { breathing.at(t); breathing.frame({ 'audio.bass': 1, 'audio.level': 1, 'beat.pulse': t % 500 < 100 ? 1 : 0 }); out.push(ceilingOf(breathing).brightness); }
  assert.ok(Math.max(...out) > 1.1, 'the ceiling swells and falls with its breath');
  assert.ok(Math.min(...out.slice(20)) < Math.max(...out) - .1, 'and it settles again');
  // The first frames take the knob's position in; after that it only ever moves slowly.
  for (let i = 5; i < out.length; i++) assert.ok(Math.abs(out[i] - out[i - 1]) < .01, `breath jumps ${out[i] - out[i - 1]} in 50 ms at ${i}`);
});

test('Knob 1 on strip 8 is drift, and a locked ceiling clip only ever sends 0.5, 1 or 2', () => {
  for (const [knob, want] of [[0, .5], [.5, 1], [1, 2]] as const) {
    const r = ceilingRig('ca', { drift: knob, breath: 1 });
    r.service.action({ type: 'burst', zone: 7, on: true });
    for (let t = 2050; t <= 9000; t += 50) {
      r.at(t); r.frame({ 'audio.bass': 1, 'beat.pulse': 1 });
      assert.equal(ceilingOf(r).speed, want, `drift ${knob} at ${t}`);
    }
  }
  const free = ceilingRig('cf', { drift: 1 });
  free.at(2100); free.frame();
  assert.equal(ceilingOf(free).speed, 4, 'a free ceiling clip drifts from a quarter to four times');
});

test('Red 8 blooms the ceiling slowly and it settles after release', () => {
  const r = ceilingRig('cf');
  r.service.action({ type: 'burst', zone: 7, on: true });
  const at = (t: number) => { r.at(t); r.frame({ 'audio.bass': 1, 'beat.pulse': 1 }); return ceilingOf(r).brightness; };
  let t = 2000, peak = 1, previous = 1, biggest = 0;
  const seen = new Map<number, number>();
  for (; t <= 16000; t += 50) { const b = at(t); biggest = Math.max(biggest, Math.abs(b - previous)); previous = b; peak = Math.max(peak, b); seen.set(t, b); }
  assert.ok(peak > 1.25, `it blooms to ${peak}`);
  assert.ok(seen.get(3000)! - 1 < (peak - 1) * .5, 'a second in it is under half way');
  assert.ok(biggest < .02, `no step jumps more than ${biggest}`);
  r.service.action({ type: 'burst', zone: 7, on: false });
  assert.ok(at(16050) > peak - .05, 'it does not cut on release');
  for (t = 16100; t <= 40000; t += 50) at(t);
  assert.ok(Math.abs(ceilingOf(r).brightness - 1) < .01, 'it has settled');
});

test('fader 0 and master 0 keep the ceiling black through bloom and breath', () => {
  const r = ceilingRig('cf', { breath: 1 });
  r.service.action({ type: 'burst', zone: 7, on: true });
  for (let t = 2050; t <= 12000; t += 50) { r.at(t); r.frame({ 'audio.bass': 1 }); }
  assert.ok(ceilingOf(r).brightness > 1);
  r.service.control({ kind: 'fader', strip: 7, value: 0 });
  r.at(12050); r.frame();
  assert.equal(ceilingOf(r).brightness, 0);
  r.service.control({ kind: 'fader', strip: 7, value: 1 });
  r.service.control({ kind: 'master', value: 0 });
  r.at(12100); r.frame();
  assert.equal(ceilingOf(r).brightness, 0);
});

test('the service times each source from arm request to ready, and keeps it in memory', () => {
  const r = rig();
  r.service.startShow();
  r.at(1000);
  r.ready();
  const asked = r.ofType('performArm').at(-1)?.sourceIds ?? [];
  assert.ok(asked.length > 0, 'something is armed at the start');
  const id = asked[0], asked_at = r.now();
  assert.deepEqual(r.service.view().prepareMs, {});
  r.at(asked_at + 700);
  r.service.wallState({ armed: [id] });
  assert.equal(r.service.view().prepareMs[id], 700);
  r.at(asked_at + 5000);
  r.service.wallState({ armed: [id] });
  assert.equal(r.service.view().prepareMs[id], 700, 'the first measurement stands');
});
