import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armList, bankBack, bankNext, ceilingBlend, initialLauncher, landed, launchNow, queueScene, queueZone, retime, returnZone, stopZone,
  type LauncherState,
} from '../src/perform/launcher';
import { applyEdit, presetComposition } from '../src/map/editor';
import { createShow } from '../src/map/show';
import { addRow, placeClip, zonesSharingSource } from '../src/perform/grid-edit';
import { dueFollow, followBeat } from '../src/perform/sequence';
import { createPerformanceSet } from '../src/perform/set';
import type { ClockSnapshot } from '../src/perform/timing';
import type { Blend, Clip, PerformanceSet, Scene } from '../src/perform/types';

/** 120 BPM: a beat is 500 ms and a bar is 2000 ms. */
const clock: ClockSnapshot = { anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'manual', barOffset: 0 };
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.values(v)) deepFreeze(k); }
  return v;
}
const clip = (id: string, blend: Blend | null = null): Clip => ({ id, name: id, sourceId: `src-${id}`, hueOffset: 0, blend, audioBand: 'level' });

/** Four scenes over eight zones. Clip `c<zone><row>`; zone 2 has no clip on row 1; zone 4 is empty on rows 1 to 3. Only row 3 includes the ceiling. */
function fixtureSet(): PerformanceSet {
  const set = createPerformanceSet();
  const cell = (z: number, r: number) => (z === 2 && r === 1) || (z === 4 && r > 0) ? null : `c${z}${r}`;
  const follows: Scene['follow'][] = [null, { afterBars: 4, to: 'next' }, { afterBars: 8, to: 'first' }, null];
  set.scenes = [0, 1, 2, 3].map(r => ({ id: `s${r}`, name: `Scene ${r}`, cells: ALL.map(z => cell(z, r)), includeProtected: r === 3, follow: follows[r] }));
  set.clips = ALL.flatMap(z => [0, 1, 2, 3].map(r => cell(z, r)).filter((id): id is string => id !== null).map(id => clip(id)));
  return set;
}
const SET = deepFreeze(fixtureSet());
const editedSet = (edit: (s: PerformanceSet) => void) => { const s = structuredClone(fixtureSet()); edit(s); return deepFreeze(s); };

/** A frozen state with scene `row` landed on beat 4 (2000 ms), so any mutation by a launcher function throws. */
function running(row: number, set: PerformanceSet = SET, random: () => number = () => 0): LauncherState {
  return deepFreeze(landed(queueScene(deepFreeze(initialLauncher()), set, row, clock, 200, 'boot'), 'boot', ALL, 2000, random));
}
const changeFor = (s: LauncherState, zone: number) => s.queue.flatMap(l => l.changes).filter(c => c.zone === zone);

test('Bank ▶ queues the first scene from a black room, on the next bar', () => {
  const s = bankNext(deepFreeze(initialLauncher()), SET, clock, 200, 'a');
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].id, 'a');
  assert.equal(s.queue[0].sceneIndex, 0);
  assert.equal(s.queue[0].beat, 4);
  assert.equal(s.queue[0].atMs, 2000);
  assert.deepEqual(s.playing, Array(8).fill(null));
});

test('Bank ▶ twice moves the queued scene on one row, with one launch queued', () => {
  const once = deepFreeze(bankNext(running(0), SET, clock, 2200, 'a'));
  const twice = bankNext(once, SET, clock, 2300, 'b');
  assert.equal(once.queue[0].sceneIndex, 1);
  assert.equal(twice.queue.length, 1);
  assert.equal(twice.queue[0].sceneIndex, 2);
  assert.equal(twice.queue[0].beat, 8);
  assert.equal(new Set(twice.queue.flatMap(l => l.changes.map(c => c.zone))).size, twice.queue.flatMap(l => l.changes).length);
});

test('Bank ◀ cancels a queued scene and changes nothing playing', () => {
  const before = running(0);
  const queued = deepFreeze(bankNext(before, SET, clock, 2200, 'a'));
  const s = bankBack(queued, SET, clock, 2300, 'b');
  assert.deepEqual(s.queue, []);
  assert.deepEqual(s.playing, before.playing);
  assert.equal(s.sceneIndex, 0);
});

test('Bank ◀ with nothing queued queues the previous scene', () => {
  const s = bankBack(running(2), SET, clock, 2200, 'a');
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].sceneIndex, 1);
  const first = running(0);
  assert.deepEqual(bankBack(first, SET, clock, 2200, 'b').queue, []);
});

test('Bank ▶ on the last scene does not wrap', () => {
  const last = running(3);
  assert.deepEqual(bankNext(last, SET, clock, 2200, 'a').queue, []);
  const queuedLast = deepFreeze(bankNext(running(2), SET, clock, 2200, 'a'));
  const s = bankNext(queuedLast, SET, clock, 2300, 'b');
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].id, 'a');
  assert.equal(s.queue[0].sceneIndex, 3);
});

test('an empty scene cell keeps the zone playing', () => {
  const queued = deepFreeze(queueScene(running(0), SET, 1, clock, 2200, 'a'));
  assert.deepEqual(changeFor(queued, 2), []);
  const s = landed(queued, 'a', ALL, 4000);
  assert.equal(s.playing[2], 'c20');
  assert.equal(s.playing[4], 'c40');
  assert.equal(s.playing[3], 'c31');
});

test('the ceiling ignores scenes unless includeProtected is set', () => {
  const room = queueScene(deepFreeze(initialLauncher()), SET, 1, clock, 200, 'a');
  assert.deepEqual(changeFor(room, 7), []);
  const finale = queueScene(deepFreeze(initialLauncher()), SET, 3, clock, 200, 'b');
  assert.equal(changeFor(finale, 7)[0].clipId, 'c73');
});

test('room scene cuts, Amber fades 1 bar, ceiling dissolves 16 bars at 120 BPM', () => {
  const scene = queueScene(deepFreeze(initialLauncher()), SET, 3, clock, 200, 'a');
  assert.deepEqual(changeFor(scene, 0)[0].blend, { kind: 'cut', durationMs: 0 });
  assert.deepEqual(changeFor(scene, 7)[0].blend, { kind: 'dissolve', durationMs: 32000 });
  const amber = queueZone(running(0), SET, 3, 1, clock, 2200, 'b');
  assert.deepEqual(changeFor(amber, 3)[0].blend, { kind: 'fade', durationMs: 2000 });
});

test('a clip with its own blend overrides every default', () => {
  const set = editedSet(s => {
    s.clips.find(c => c.id === 'c01')!.blend = { kind: 'fade', bars: 2 };
    s.clips.find(c => c.id === 'c11')!.blend = { kind: 'cut', bars: 0 };
    s.clips.find(c => c.id === 'c73')!.blend = { kind: 'dissolve', bars: 8 };
    s.clips.find(c => c.id === 'c30')!.blend = { kind: 'fade', bars: 3 };
    s.clips.find(c => c.id === 'c32')!.blend = { kind: 'dissolve', bars: 20 };
    s.clips.find(c => c.id === 'c33')!.blend = { kind: 'fade', bars: 100 };
  });
  const scene = queueScene(running(0, set), set, 1, clock, 2200, 'a');
  assert.deepEqual(changeFor(scene, 0)[0].blend, { kind: 'fade', durationMs: 4000 });
  const amber = queueZone(running(0, set), set, 1, 1, clock, 2200, 'b');
  assert.deepEqual(changeFor(amber, 1)[0].blend, { kind: 'cut', durationMs: 0 });
  const ceiling = queueScene(deepFreeze(initialLauncher()), set, 3, clock, 200, 'c');
  assert.deepEqual(changeFor(ceiling, 7)[0].blend, { kind: 'dissolve', durationMs: 16000 });
  // Hand-edited bars snap to the allowed values for the kind.
  const snapped = queueScene(deepFreeze(initialLauncher()), set, 0, clock, 200, 'd');
  assert.deepEqual(changeFor(snapped, 3)[0].blend, { kind: 'fade', durationMs: 4000 });
  const dissolve = queueScene(deepFreeze(initialLauncher()), set, 2, clock, 200, 'e');
  assert.deepEqual(changeFor(dissolve, 3)[0].blend, { kind: 'dissolve', durationMs: 32000 });
  const big = queueScene(deepFreeze(initialLauncher()), set, 3, clock, 200, 'f');
  assert.deepEqual(changeFor(big, 3)[0].blend, { kind: 'fade', durationMs: 16000 });
});

test('Amber skips empty cells and wraps within the column', () => {
  const s = running(0);
  assert.equal(changeFor(queueZone(s, SET, 2, 1, clock, 2200, 'a'), 2)[0].clipId, 'c22');
  assert.equal(changeFor(queueZone(s, SET, 2, -1, clock, 2200, 'b'), 2)[0].clipId, 'c23');
  const last = running(3);
  assert.equal(changeFor(queueZone(last, SET, 2, 1, clock, 2200, 'c'), 2)[0].clipId, 'c20');
  // A clip used on two rows is one stop in the column, so Amber can never stick on it.
  const shared = editedSet(x => { x.scenes[1].cells[3] = 'c30'; });
  const a = deepFreeze(queueZone(running(0, shared), shared, 3, 1, clock, 2200, 'd'));
  assert.equal(changeFor(a, 3)[0].clipId, 'c32');
});

test('Amber twice before the bar moves the queued clip on one step, with one change for that zone', () => {
  const once = deepFreeze(queueZone(running(0), SET, 3, 1, clock, 2200, 'a'));
  const twice = queueZone(once, SET, 3, 1, clock, 2300, 'b');
  assert.equal(twice.queue.length, 1);
  assert.equal(changeFor(twice, 3).length, 1);
  assert.equal(changeFor(twice, 3)[0].clipId, 'c32');
  assert.equal(twice.queue[0].beat, 8);
  // Stepping back on to what is already playing leaves nothing queued.
  const back = queueZone(once, SET, 3, -1, clock, 2300, 'c');
  assert.deepEqual(back.queue, []);
});

test('Solo + Amber returns to the previous clip', () => {
  const moved = deepFreeze(landed(queueZone(running(0), SET, 3, 1, clock, 2200, 'a'), 'a', [3], 4000));
  assert.equal(moved.playing[3], 'c31');
  assert.equal(moved.previous[3], 'c30');
  const s = returnZone(moved, SET, 3, clock, 4200, 'b');
  assert.equal(changeFor(s, 3).length, 1);
  assert.equal(changeFor(s, 3)[0].clipId, 'c30');
  assert.deepEqual(changeFor(s, 3)[0].blend, { kind: 'fade', durationMs: 2000 });
  // Nothing to return to: leave the zone alone rather than black it out.
  assert.deepEqual(returnZone(running(0), SET, 3, clock, 2200, 'c').queue, []);
});

test('a ceiling launch during a dissolve waits for it to end; pressing again changes what waits', () => {
  const s = running(3);
  assert.equal(s.ceilingBusyUntilMs, 34000);
  const waiting = deepFreeze(queueZone(s, SET, 7, 1, clock, 3000, 'a'));
  assert.equal(waiting.queue.length, 1);
  assert.equal(waiting.queue[0].atMs, 34000);
  assert.equal(waiting.queue[0].beat, 68);
  assert.equal(changeFor(waiting, 7)[0].clipId, 'c70');
  const again = queueZone(waiting, SET, 7, 1, clock, 3100, 'b');
  assert.equal(again.queue.length, 1);
  assert.equal(again.queue[0].atMs, 34000);
  assert.equal(changeFor(again, 7)[0].clipId, 'c71');
  // A scene that includes the ceiling lands the room on the bar; only the ceiling waits, and Bank ◀ cancels both.
  const from = running(3);
  const scene = deepFreeze(queueScene(from, editedSet(x => { x.scenes[0].includeProtected = true; }), 0, clock, 3000, 'c'));
  assert.equal(scene.queue.length, 2);
  assert.equal(scene.queue[0].atMs, 4000);
  assert.deepEqual(changeFor({ ...scene, queue: [scene.queue[0]] }, 7), []);
  assert.equal(scene.queue[1].atMs, 34000);
  assert.equal(scene.queue[1].changes[0].zone, 7);
  assert.deepEqual(bankBack(scene, SET, clock, 3100, 'd').queue, []);
  // Landing the room starts the scene once; the waiting ceiling no longer counts as a queued scene.
  const roomIn = landed(scene, 'c', ALL, 4000);
  assert.equal(roomIn.sceneIndex, 0);
  assert.equal(roomIn.queue.length, 1);
  assert.equal(roomIn.queue[0].sceneIndex, null);
});

test('landed updates only the zones that landed; a deferred zone stays queued', () => {
  const queued = deepFreeze(queueScene(running(0), SET, 1, clock, 2200, 'a'));
  const s = deepFreeze(landed(queued, 'a', [0, 1], 4000));
  assert.equal(s.playing[0], 'c01');
  assert.equal(s.playing[1], 'c11');
  assert.equal(s.playing[3], 'c30');
  assert.equal(s.sceneIndex, 1);
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].sceneIndex, null);
  assert.ok(!s.queue[0].changes.some(c => c.zone < 2));
  assert.equal(changeFor(s, 3)[0].clipId, 'c31');
  // The deferred zone moves to the next bar when re-timed, then lands without restarting the follow timer.
  const later = deepFreeze(retime(s, clock, SET, 4200));
  assert.equal(later.queue[0].atMs, 6000);
  const done = landed(later, 'a', [3, 5, 6], 6000);
  assert.equal(done.playing[3], 'c31');
  assert.equal(done.followAtBeat, s.followAtBeat);
  assert.equal(landed(s, 'nope', [3], 4000), s);
});

test('retime moves queued launches to the corrected bar and recalculates fade milliseconds', () => {
  const queued = deepFreeze(queueZone(running(0), SET, 3, 1, clock, 2200, 'a'));
  assert.equal(queued.queue[0].beat, 8);
  // "This is the 1": the bar now starts one beat later.
  const shifted = retime(queued, { ...clock, barOffset: 1 }, SET, 2200);
  assert.equal(shifted.queue.length, 1);
  assert.equal(shifted.queue[0].beat, 5);
  assert.equal(shifted.queue[0].atMs, 2500);
  // A tempo correction changes both the bar time and the fade.
  const slower = retime(queued, { ...clock, bpm: 100 }, SET, 2200);
  assert.equal(slower.queue[0].beat, 4);
  assert.equal(slower.queue[0].atMs, 2400);
  assert.deepEqual(slower.queue[0].changes[0].blend, { kind: 'fade', durationMs: 2400 });
  // Re-timing twice changes nothing further.
  assert.deepEqual(retime(deepFreeze(shifted), { ...clock, barOffset: 1 }, SET, 2200), shifted);
  // The follow rule moves to the corrected bar too, without drifting.
  const following = running(1);
  assert.equal(following.followAtBeat, 20);
  const moved = deepFreeze(retime(following, { ...clock, barOffset: 1 }, SET, 2200));
  assert.equal(moved.followAtBeat, 21);
  assert.equal(retime(moved, { ...clock, barOffset: 1 }, SET, 2200).followAtBeat, 21);
  // A ceiling launch keeps waiting for the dissolve through a correction.
  const ceiling = deepFreeze(queueZone(running(3), SET, 7, 1, clock, 3000, 'b'));
  const kept = retime(ceiling, { ...clock, barOffset: 1 }, SET, 3000);
  assert.equal(kept.queue[0].beat, 69);
  assert.equal(kept.queue[0].atMs, 34500);
  // A queued scene's follow timer is worked out from its corrected bar.
  const scene = deepFreeze(queueScene(running(0), SET, 1, clock, 2200, 'c'));
  const landedScene = landed(retime(scene, { ...clock, barOffset: 1 }, SET, 2200), 'c', ALL, 2500);
  assert.equal(landedScene.followAtBeat, 21);
});

test('armList holds the next scene without queueing, and never more than 8', () => {
  const s = running(0);
  const list = armList(s, SET);
  assert.deepEqual(list, ['c01', 'c11', 'c31', 'c51', 'c61']);
  assert.deepEqual(s.queue, []);
  // Queued clips come first; the ceiling is only armed for a scene that includes it.
  const queued = deepFreeze(queueZone(s, SET, 7, 1, clock, 2200, 'a'));
  assert.equal(armList(queued, SET)[0], 'c70');
  const noFollow = editedSet(x => { x.scenes[2].follow = null; });
  assert.ok(armList(running(2, noFollow), noFollow).includes('c73'));
  assert.ok(!armList(running(0), SET).includes('c71'));
  // Scene 2 queued (6 clips) plus scene 3 next (7 clips): the queued clips all survive the cap of 8.
  const crowded = armList(deepFreeze(queueScene(running(1), SET, 2, clock, 2200, 'c')), SET);
  assert.equal(crowded.length, 8);
  assert.equal(new Set(crowded).size, 8);
  assert.deepEqual(crowded.slice(0, 6), ['c02', 'c12', 'c22', 'c32', 'c52', 'c62']);
});

test('a follow rule fires after its bars; a manual launch restarts the timer', () => {
  assert.equal(followBeat(SET.scenes[1], 4), 20);
  assert.equal(followBeat(SET.scenes[0], 4), null);
  const s = running(1);
  assert.equal(s.followAtBeat, 20);
  assert.equal(dueFollow(s, SET, 19.9, () => 0), null);
  assert.equal(dueFollow(s, SET, 20, () => 0), 2);
  // While a scene is queued the follow rule stands aside.
  const queued = deepFreeze(queueScene(s, SET, 2, clock, 2200, 'a'));
  assert.equal(dueFollow(queued, SET, 20, () => 0), null);
  assert.equal(queued.followAtBeat, 20);
  // Landing a manual scene starts its own timer from the bar it landed on.
  const manual = deepFreeze(landed(queued, 'a', ALL, 4000));
  assert.equal(manual.followAtBeat, 8 + 8 * 4);
  assert.equal(dueFollow(manual, SET, 20, () => 0), null);
  assert.equal(dueFollow(manual, SET, 40, () => 0), 0);
  // A scene with no rule clears the timer.
  assert.equal(landed(queueScene(manual, SET, 0, clock, 4200, 'b'), 'b', ALL, 6000).followAtBeat, null);
  // Keywords win over a scene with the same id; a real id resolves to its row.
  const named = editedSet(x => { x.scenes[0].id = 'next'; x.scenes[1].follow = { afterBars: 4, to: 'next' }; x.scenes[2].follow = { afterBars: 4, to: 's3' }; });
  assert.equal(dueFollow(running(1, named), named, 20, () => 0), 2);
  assert.equal(dueFollow(running(2, named), named, 20, () => 0), 3);
  // Next off the end and previous off the start go nowhere.
  const ends = editedSet(x => { x.scenes[3].follow = { afterBars: 4, to: 'next' }; x.scenes[0].follow = { afterBars: 4, to: 'previous' }; });
  assert.equal(dueFollow(running(3, ends), ends, 20, () => 0), null);
  assert.equal(dueFollow(running(0, ends), ends, 20, () => 0), null);
});

test('follow random never picks the current scene', () => {
  const set = editedSet(x => { x.scenes[1].follow = { afterBars: 4, to: 'random' }; });
  const seen = new Set<number | null>();
  for (const r of [0, 0.2, 0.34, 0.4, 0.5, 0.67, 0.8, 0.999999]) seen.add(dueFollow(running(1, set, () => r), set, 20, () => 0));
  assert.ok(!seen.has(1));
  assert.deepEqual([...seen].sort(), [0, 2, 3]);
  const alone = editedSet(x => { x.scenes = [x.scenes[1]]; x.scenes[0].follow = { afterBars: 4, to: 'random' }; });
  assert.equal(dueFollow(running(0, alone), alone, 20, () => 0.5), null);
});

test('a stop fades the zone to black on the next beat and cancels what was queued for it', () => {
  const queued = deepFreeze(queueZone(running(0), SET, 3, 1, clock, 2200, 'a'));
  const s = deepFreeze(stopZone(queued, 3, clock, 2200, 'b'));
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].beat, 5);
  assert.deepEqual(s.queue[0].changes, [{ zone: 3, clipId: null, blend: { kind: 'fade', durationMs: 2000 } }]);
  const black = landed(s, 'b', [3], 2500);
  assert.equal(black.playing[3], null);
  assert.equal(black.previous[3], 'c30');
  assert.equal(black.launched[3], true);
  // A stop keeps its one-beat grid through a correction.
  assert.equal(retime(s, { ...clock, barOffset: 1 }, SET, 2200).queue[0].beat, 5);
});

test('launching now fires the queued scene at once, but the ceiling still waits for its dissolve', () => {
  const queued = deepFreeze(queueScene(running(0), SET, 1, clock, 2200, 'a'));
  assert.equal(launchNow(queued, 2300).queue[0].atMs, 2300);
  const amber = deepFreeze(queueZone(running(0), SET, 3, 1, clock, 2200, 'b'));
  assert.equal(launchNow(amber, 2300).queue[0].atMs, 4000);
  const set = editedSet(x => { x.scenes[0].includeProtected = true; });
  const split = deepFreeze(queueScene(running(3), set, 0, clock, 3000, 'c'));
  const fired = launchNow(split, 3100);
  assert.equal(fired.queue[0].atMs, 3100);
  assert.equal(fired.queue[1].atMs, 34000);
});

const withCeilingScene = () => editedSet(x => { x.scenes[0].includeProtected = true; });

test('Launch Now fires the room of a combined scene while its ceiling keeps waiting', () => {
  const set = withCeilingScene();
  const queued = deepFreeze(queueScene(running(3, set), set, 0, clock, 33200, 'a'));
  assert.equal(queued.queue.length, 1);
  assert.equal(queued.queue[0].atMs, 34000);
  const fired = deepFreeze(launchNow(queued, 33300));
  assert.equal(fired.queue.length, 2);
  assert.equal(fired.queue[0].id, 'a');
  assert.equal(fired.queue[0].atMs, 33300);
  assert.ok(!fired.queue[0].changes.some(c => c.zone === 7));
  assert.equal(fired.queue[1].id, 'a:ceiling');
  assert.equal(fired.queue[1].atMs, 34000);
  assert.deepEqual(fired.queue[1].changes.map(c => c.zone), [7]);
  const roomIn = landed(fired, 'a', ALL, 33300);
  assert.equal(roomIn.sceneIndex, 0);
  assert.equal(roomIn.playing[7], 'c73');
  assert.equal(roomIn.queue.length, 1);
  assert.equal(roomIn.queue[0].sceneIndex, null);
});

test('retime keeps the room on its corrected bar while the ceiling waits', () => {
  const set = withCeilingScene();
  const queued = deepFreeze(queueScene(running(3, set), set, 0, clock, 33200, 'a'));
  const moved = deepFreeze(retime(queued, { ...clock, barOffset: 3 }, set, 33200));
  assert.equal(moved.queue.length, 2);
  assert.equal(moved.queue[0].id, 'a');
  assert.equal(moved.queue[0].atMs, 33500);
  assert.ok(!moved.queue[0].changes.some(c => c.zone === 7));
  assert.equal(moved.queue[1].id, 'a:ceiling');
  assert.equal(moved.queue[1].atMs, 35500);
  assert.deepEqual(retime(moved, { ...clock, barOffset: 3 }, set, 33200), moved);
});

test('a ceiling Stop lands on the next beat through a dissolve and only its fade holds the ceiling', () => {
  // 3000 ms is exactly beat 6, so a press there lands on that beat rather than at 34000.
  assert.equal(stopZone(running(3), 7, clock, 3000, 'on').queue[0].atMs, 3000);
  const stop = deepFreeze(stopZone(running(3), 7, clock, 3200, 'a'));
  assert.equal(stop.queue[0].beat, 7);
  assert.equal(stop.queue[0].atMs, 3500);
  assert.deepEqual(stop.queue[0].changes[0].blend, { kind: 'fade', durationMs: 2000 });
  assert.equal(retime(stop, clock, SET, 3200).queue[0].atMs, 3500);
  const black = deepFreeze(landed(stop, 'a', [7], 3500));
  assert.equal(black.playing[7], null);
  assert.equal(black.ceilingBusyUntilMs, 5500);
  assert.equal(queueZone(black, SET, 7, 1, clock, 3600, 'b').queue[0].atMs, 6000);
});

test('the follow target is armed ahead of the next row', () => {
  const list = armList(running(2), SET);
  assert.deepEqual(list.slice(0, 7), ['c00', 'c10', 'c20', 'c30', 'c40', 'c50', 'c60']);
  assert.equal(list.length, 8);
});

test('a random follow is chosen on landing, armed, and is the one that fires', () => {
  const set = editedSet(x => { x.scenes[1].follow = { afterBars: 4, to: 'random' }; });
  const s = running(1, set, () => 0.5);
  assert.equal(s.followTarget, 2);
  assert.equal(armList(s, set)[0], 'c02');
  for (const r of [0, 0.5, 0.999]) assert.equal(dueFollow(s, set, 20, () => r), 2);
  assert.ok(armList(s, set).length <= 8);
});

test('a press inside the late grace counts as the bar just gone', () => {
  const s = queueZone(running(0), SET, 3, 1, clock, 4050, 'a');
  assert.equal(s.queue[0].beat, 8);
  assert.equal(s.queue[0].atMs, 4050);
});

// ---- Task 12: the protected ceiling ----
test('the ceiling blend is a 16-bar dissolve, and the launcher uses it', () => {
  assert.deepEqual(ceilingBlend(), { kind: 'dissolve', bars: 16 });
  const amber = queueZone(running(0), SET, 7, 1, clock, 2200, 'a');
  assert.deepEqual(changeFor(amber, 7)[0].blend, { kind: 'dissolve', durationMs: ceilingBlend().bars * 4 * 500 });
});

test('a room scene leaves a running ceiling dissolve untouched, and includeProtected changes it', () => {
  const dissolving = running(3);
  assert.equal(dissolving.playing[7], 'c73');
  assert.equal(dissolving.ceilingBusyUntilMs, 34000);
  const room = deepFreeze(queueScene(dissolving, SET, 2, clock, 3000, 'room'));
  assert.deepEqual(changeFor(room, 7), []);
  const done = landed(room, 'room', ALL, 4000);
  assert.equal(done.playing[7], 'c73');
  assert.equal(done.ceilingBusyUntilMs, 34000);
  assert.deepEqual(done.queue.filter(l => l.changes.some(c => c.zone === 7)), []);
  const withCeiling = editedSet(s => { s.scenes[2].includeProtected = true; });
  const finale = queueScene(running(3, withCeiling), withCeiling, 2, clock, 3000, 'finale');
  assert.equal(changeFor(finale, 7)[0].clipId, 'c72');
  // It does not cut in over the running dissolve: it waits for it.
  assert.ok(finale.queue.find(l => l.changes.some(c => c.zone === 7))!.atMs >= 34000);
});

test('a new ceiling clip leaves its source Free, and a source already used elsewhere keeps its timing', () => {
  let show = createShow();
  const row = addRow(show.performance, 'row');
  const added = applyEdit(show, { type: 'addClipSource', sourceId: 'src-new', project: presetComposition('salt-mandala', 7)!, performance: placeClip(row, 0, 7, { ...clip('ceil'), sourceId: 'src-new' }) });
  assert.ok(added.ok);
  show = added.show;
  assert.equal(show.performance.scenes[0].cells[7], 'ceil');
  assert.equal(show.sources.find(s => s.id === 'src-new')!.tempoSync, null, 'a new ceiling source plays Free');
  // A source a room zone already plays in time is linked to the ceiling without touching its timing.
  const room = applyEdit(show, { type: 'addClipSource', sourceId: 'src-room', project: presetComposition('salt-mandala', 8)!, tempoSync: 4, performance: placeClip(show.performance, 0, 0, { ...clip('room'), sourceId: 'src-room' }) });
  assert.ok(room.ok);
  const shared = applyEdit(room.show, { type: 'setPerformance', performance: placeClip(room.show.performance, 0, 7, { ...clip('ceil2'), sourceId: 'src-room' }) });
  assert.ok(shared.ok);
  assert.equal(shared.show.sources.find(s => s.id === 'src-room')!.tempoSync, 4, 'sharing a source never changes its timing');
  assert.deepEqual(zonesSharingSource(shared.show.performance, 'src-room').sort(), [0, 7]);
});

test('a tempo change does not alter a running dissolve', () => {
  const dissolving = running(3);
  const queued = deepFreeze(queueZone(dissolving, SET, 7, 1, clock, 3000, 'next'));
  const slower: ClockSnapshot = { ...clock, bpm: 60 };
  const moved = retime(queued, slower, SET, 4000);
  assert.equal(moved.ceilingBusyUntilMs, 34000, 'the running dissolve still ends when it was going to');
  assert.equal(moved.playing[7], 'c73');
  assert.ok(moved.queue[0].atMs >= 34000, 'the waiting loop still waits for it');
  assert.equal(moved.queue[0].changes[0].blend.durationMs, 64000, 'only the not-yet-started dissolve takes the new tempo');
});
