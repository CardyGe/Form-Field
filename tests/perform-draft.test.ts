// Editing a clip during a show is a private draft: nothing reaches the wall until Apply, and Discard leaves the show alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Project } from '../src/shared/types';
import { applyEdit, presetComposition } from '../src/map/editor';
import { acceptMapMessage } from '../src/map/messages';
import { createShow, LIVE_SOURCE_ID, type ShowDocument } from '../src/map/show';
import { initialMapState, mapReducer, type MapState } from '../src/map/state';
import { freezeLeaving } from '../src/map/playout';
import { applyMapMessage, initialWall } from '../src/map/wall';
import { addRow, historyBlock, placeClip, setCell, zonesSharingSource } from '../src/perform/grid-edit';
import type { Clip } from '../src/perform/types';

type Sent = { type: string; [key: string]: unknown };
const sent: Sent[] = [];
let outputChanged: (open: boolean) => void = () => {};
let wallReport: (state: unknown) => void = () => {};
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = { studio: { onBeforeClose: () => () => {}, map: {
  send: (m: Sent) => { sent.push(m); },
  onOutputChanged: (fn: (open: boolean) => void) => { outputChanged = fn; return () => {}; },
  onState: (fn: (state: unknown) => void) => { wallReport = fn; return () => {}; },
  saveAutosave: async () => {},
  loadAutosave: async () => null,
} } };
const frames: ((t: number) => void)[] = [];
globals.requestAnimationFrame = (fn: (t: number) => void) => { frames.push(fn); return frames.length; };
const nextFrame = () => { for (const fn of frames.splice(0)) fn(0); };

const { applyClipDraft, beginClipCopyDraft, beginClipEdit, clipDraftOpen, discardClipDraft, mapSessionForTest, onClipDraftFailed, reopenFailedDraft, studioEdit } = await import('../src/ui/useMap');

const clip = (id: string, sourceId: string): Clip => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'level' });
function showWithClips(): ShowDocument {
  let show = createShow();
  for (const [row, zone, id, sourceId] of [[0, 0, 'a', 'src-a'], [0, 1, 'b', 'src-b']] as const) {
    const base = show.performance.scenes.length ? show.performance : addRow(show.performance, 'row');
    const made = applyEdit(show, { type: 'addClipSource', sourceId, project: presetComposition('salt-mandala', 7)!, performance: placeClip(base, row, zone, clip(id, sourceId)) });
    assert.ok(made.ok);
    show = made.show;
  }
  return show;
}
const changed = (p: Project, opacity = .5): Project => ({ ...p, layers: p.layers.map(l => ({ ...l, opacity })) });
/** A fresh session holding the show, with the wall open, and nothing sent yet. */
function open(show = showWithClips()): MapState {
  discardClipDraft();
  const state = mapReducer(initialMapState(createShow()), { type: 'load', show });
  mapSessionForTest.load(state);
  outputChanged(true);
  mapSessionForTest.markAllSent();
  sent.length = 0;
  return mapSessionForTest.state();
}

/** Opens a draft. Map's crosshair and flash leave the wall as it opens, and from then on nothing is sent. */
function openDraft(sourceId: string) {
  const begun = beginClipEdit(sourceId, true)!;
  assert.deepEqual(sent.map(m => m.type), ['crosshair', 'identify']);
  sent.length = 0;
  return begun;
}

test('a draft clears Map\'s crosshair and flash from the wall as it opens', () => {
  open();
  assert.ok(beginClipEdit('src-a', true));
  assert.deepEqual(sent, [{ type: 'crosshair', point: null, shapeId: null }, { type: 'identify', shapeId: null }]);
});

test('a look that cannot start on the wall: the show goes back with no undo step, and the draft is kept', () => {
  const state = open(), copy = structuredClone(state.show);
  let told = 0;
  onClipDraftFailed(() => { told++; });
  const begun = openDraft('src-a'), bad = changed(begun.project, .3);
  studioEdit(bad);
  applyClipDraft();
  const revision = mapSessionForTest.state().show.sources.find(s => s.id === 'src-a')!.revision;
  sent.length = 0;
  wallReport({ fps: 60, level: 0, failing: [], swapFailed: [{ id: 'src-a', revision }] });
  const after = mapSessionForTest.state();
  assert.deepEqual(after.show, copy);
  assert.equal(after.past.length, state.past.length);
  assert.equal(told, 1);
  // The wall is given the old composition back, so it and the show agree.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'source');
  assert.equal(sent[0].revision, revision - 1);
  assert.equal(sent[0].crossfade, undefined);
  const reopened = reopenFailedDraft();
  assert.ok(reopened);
  assert.equal(reopened.sourceId, 'src-a');
  assert.equal(reopened.project.layers[0].opacity, .3);
  assert.equal(clipDraftOpen(), true);
  assert.equal(reopenFailedDraft(), null);
  // Applied again, the same draft is a fresh attempt.
  assert.equal(applyClipDraft(), null);
  assert.equal(mapSessionForTest.state().show.sources.find(s => s.id === 'src-a')!.project.layers[0].opacity, .3);
  onClipDraftFailed(null);
});

test('a failure report for another revision changes nothing', () => {
  open();
  const begun = openDraft('src-a');
  studioEdit(changed(begun.project, .3));
  applyClipDraft();
  const applied = mapSessionForTest.state(), revision = applied.show.sources.find(s => s.id === 'src-a')!.revision;
  sent.length = 0;
  wallReport({ fps: 60, level: 0, failing: [], swapFailed: [{ id: 'src-a', revision: revision + 5 }] });
  assert.equal(mapSessionForTest.state(), applied);
  assert.deepEqual(sent, []);
});

test('an edit made after Apply survives the look failing', () => {
  open();
  const begun = openDraft('src-a');
  studioEdit(changed(begun.project, .3));
  applyClipDraft();
  const applied = mapSessionForTest.state(), revision = applied.show.sources.find(s => s.id === 'src-a')!.revision;
  const moved = mapReducer(applied, { type: 'edit', action: { type: 'setPerformance', performance: { ...applied.show.performance, launchQuantize: '4bar' } } });
  mapSessionForTest.replace(moved);
  wallReport({ fps: 60, level: 0, failing: [], swapFailed: [{ id: 'src-a', revision }] });
  const after = mapSessionForTest.state();
  assert.equal(after.show.performance.launchQuantize, '4bar');
  assert.notEqual(after.show.sources.find(s => s.id === 'src-a')!.project.layers[0].opacity, .3);
  assert.ok(after.past.every(p => p.sources.find(s => s.id === 'src-a')!.revision !== revision));
  assert.equal(after.past.length, moved.past.length - 1);
  discardClipDraft();
  reopenFailedDraft();
  discardClipDraft();
});

const copyOf = () => ({ fromSourceId: 'src-a', sourceId: 'src-copy', clip: clip('a-copy', 'src-copy'), row: 0, zone: 0 });

test('Duplicate and edit during a show adds nothing until Apply: Discard leaves the show deep-equal', () => {
  const state = open(), before = structuredClone(state.show);
  assert.ok(beginClipCopyDraft(copyOf()));
  sent.length = 0;
  studioEdit(changed(state.show.sources[0].project, .2));
  discardClipDraft();
  assert.equal(mapSessionForTest.state().show, state.show);
  assert.deepEqual(mapSessionForTest.state().show, before);
  assert.equal(mapSessionForTest.state().past.length, state.past.length);
  assert.deepEqual(sent, []);
});

test('Apply on a duplicate creates the copy as one undo step, and leaves the original alone', () => {
  // The original is also linked in another cell, so it stays in the set when the copy takes this one.
  const linked = showWithClips(), state = open({ ...linked, performance: setCell(linked.performance, 0, 3, 'a') });
  beginClipCopyDraft(copyOf());
  sent.length = 0;
  studioEdit(changed(state.show.sources[0].project, .2));
  assert.equal(applyClipDraft(), null);
  const after = mapSessionForTest.state();
  assert.equal(after.past.length, state.past.length + 1);
  assert.equal(after.past.at(-1), state.show);
  assert.equal(after.show.performance.scenes[0].cells[0], 'a-copy');
  assert.equal(after.show.sources.find(s => s.id === 'src-copy')!.project.layers[0].opacity, .2);
  assert.deepEqual(after.show.sources.find(s => s.id === 'src-a'), state.show.sources.find(s => s.id === 'src-a'));
  assert.equal(sent.filter(m => m.type === 'source').length, 1);
  assert.equal(clipDraftOpen(), false);
});

test('a duplicate whose cell has changed is refused plainly and stays open', () => {
  const state = open();
  beginClipCopyDraft(copyOf());
  mapSessionForTest.replace({ ...state, show: { ...state.show, performance: setCell(state.show.performance, 0, 0, 'b') } });
  assert.match(applyClipDraft() ?? '', /cell has changed/);
  assert.equal(clipDraftOpen(), true);
  discardClipDraft();
});

test('a blend leaving the edited look is frozen on its current picture, and others are left alone', () => {
  type Picture = { name: string };
  const old: Picture = { name: 'old' }, now: Picture = { name: 'now' }, kept: Picture = { name: 'kept' };
  const leaving: { from: Picture | string; fromSource: string | null } = { from: old, fromSource: 'src-a' };
  const colour: { from: Picture | string; fromSource: string | null } = { from: '#000000', fromSource: 'src-a' };
  const other: { from: Picture | string; fromSource: string | null } = { from: kept, fromSource: 'src-b' };
  const freed: Picture[] = [];
  freezeLeaving<Picture>([leaving, colour, other], 'src-a', () => now, t => freed.push(t));
  assert.deepEqual(leaving, { from: now, fromSource: null });
  assert.deepEqual(colour, { from: now, fromSource: null });
  assert.equal(other.from, kept);
  assert.equal(other.fromSource, 'src-b');
  assert.deepEqual(freed, [old]);
});

test('the main process accepts a wall report of a look that failed, and refuses a malformed one', () => {
  const main = createRequire(import.meta.url)('../electron/map.cjs') as { acceptState: (value: unknown) => boolean };
  const base = { fps: 60, level: 0, failing: [] };
  assert.equal(main.acceptState({ ...base, swapFailed: [{ id: 's', revision: 2 }] }), true);
  assert.equal(main.acceptState({ ...base, swapFailed: [{ id: 's', revision: -1 }] }), false);
  assert.equal(main.acceptState({ ...base, swapFailed: 's' }), false);
});

test('a clip whose source plays on no Map shape can be opened', () => {
  const state = open();
  const begun = beginClipEdit('src-a', true);
  assert.ok(begun);
  assert.equal(begun.shapeName, 'a');
  assert.deepEqual(begun.project, state.show.sources.find(s => s.id === 'src-a')!.project);
  assert.equal(clipDraftOpen(), true);
});

test('Live, a video and an unknown source have no composition to open', () => {
  open();
  assert.equal(beginClipEdit(LIVE_SOURCE_ID, true), null);
  assert.equal(beginClipEdit('video-1', true), null);
  assert.equal(beginClipEdit('nope', true), null);
  assert.equal(clipDraftOpen(), false);
});

test('a draft sends nothing to the wall and leaves the show alone while it is edited', () => {
  const state = open();
  const begun = openDraft('src-a');
  for (const o of [.9, .6, .3]) assert.equal(studioEdit(changed(begun.project, o)), null);
  assert.deepEqual(sent, []);
  assert.equal(mapSessionForTest.state().show, state.show);
  assert.equal(mapSessionForTest.state().past.length, state.past.length);
});

test('Apply is one undo step and one crossfading wall source update', () => {
  const state = open();
  const begun = openDraft('src-a');
  for (const o of [.9, .6, .3]) studioEdit(changed(begun.project, o));
  assert.equal(applyClipDraft(), null);
  const after = mapSessionForTest.state();
  assert.equal(after.past.length, state.past.length + 1);
  assert.equal(after.past.at(-1), state.show);
  const source = after.show.sources.find(s => s.id === 'src-a')!, before = state.show.sources.find(s => s.id === 'src-a')!;
  assert.equal(source.project.layers[0].opacity, .3);
  assert.equal(source.revision, before.revision + 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'source');
  assert.equal(sent[0].id, 'src-a');
  assert.equal(sent[0].revision, source.revision);
  assert.equal(sent[0].crossfade, true);
  assert.equal(clipDraftOpen(), false);
});

test('Apply with nothing changed makes no undo step and sends nothing', () => {
  const state = open();
  const begun = openDraft('src-a');
  studioEdit(changed(begun.project, .4));
  studioEdit(structuredClone(begun.project));
  assert.equal(applyClipDraft(), null);
  assert.equal(mapSessionForTest.state().show, state.show);
  assert.deepEqual(sent, []);
});

test('Discard leaves the show identical', () => {
  const state = open(), copy = structuredClone(state.show);
  const begun = openDraft('src-a');
  studioEdit(changed(begun.project, .2));
  discardClipDraft();
  assert.equal(mapSessionForTest.state().show, state.show);
  assert.deepEqual(mapSessionForTest.state().show, copy);
  assert.equal(mapSessionForTest.state().past.length, state.past.length);
  assert.deepEqual(sent, []);
  assert.equal(clipDraftOpen(), false);
});

test('with no show, a clip edit streams to the wall live and is one undo step', () => {
  const state = open();
  const begun = beginClipEdit('src-a', false)!;
  for (const o of [.9, .6]) { assert.equal(studioEdit(changed(begun.project, o)), null); nextFrame(); }
  const after = mapSessionForTest.state();
  assert.equal(after.show.sources.find(s => s.id === 'src-a')!.project.layers[0].opacity, .6);
  assert.equal(after.past.length, state.past.length + 1);
  const sources = sent.filter(m => m.type === 'source');
  assert.equal(sources.length, 2);
  assert.ok(sources.every(m => m.crossfade === undefined));
  discardClipDraft();
  assert.equal(mapSessionForTest.state().show, after.show, 'there is no draft to discard: the edit was live');
});

test('during a show, undoing an Apply is refused, and other picture changes still are', () => {
  open();
  const begun = openDraft('src-a');
  studioEdit(changed(begun.project, .3));
  applyClipDraft();
  const after = mapSessionForTest.state();
  assert.equal(historyBlock(after.show, after.past.at(-1)!, ['a']), 'picture');
  assert.equal(historyBlock(after.show, after.past.at(-1)!, []), 'picture');
});

test('a draft whose clip has left the set is refused plainly and stays open', () => {
  const state = open();
  const begun = openDraft('src-a');
  studioEdit(changed(begun.project, .3));
  mapSessionForTest.replace({ ...state, show: { ...state.show, sources: state.show.sources.filter(s => s.id !== 'src-a') } });
  sent.length = 0;
  assert.match(applyClipDraft() ?? '', /no longer in the set/);
  assert.equal(clipDraftOpen(), true);
  assert.deepEqual(sent, []);
  discardClipDraft();
  assert.equal(clipDraftOpen(), false);
});

test('the zones a draft reaches are every zone playing that source', () => {
  const { show } = open();
  assert.deepEqual(zonesSharingSource(show.performance, 'src-a'), [0]);
  const linked = setCell(show.performance, 0, 3, 'a');
  assert.deepEqual(zonesSharingSource(linked, 'src-a'), [0, 3]);
  assert.deepEqual(zonesSharingSource(linked, 'src-b'), [1]);
});

test('the wall takes a crossfading source update, and refuses a malformed flag', () => {
  const project = presetComposition('salt-mandala', 7)!;
  const good = { type: 'source', id: 's', revision: 1, project, crossfade: true };
  assert.equal(acceptMapMessage(good), true);
  assert.equal(acceptMapMessage({ ...good, crossfade: false }), false);
  assert.equal(acceptMapMessage({ ...good, crossfade: 'yes' }), false);
  assert.equal(applyMapMessage(initialWall(), good).projects.get('s')?.revision, 1);
  // The main process keeps its own copy of the check.
  const main = createRequire(import.meta.url)('../electron/map.cjs') as { acceptMapMessage: (value: unknown) => boolean };
  assert.equal(main.acceptMapMessage(good), true);
  assert.equal(main.acceptMapMessage({ ...good, crossfade: false }), false);
  assert.equal(main.acceptMapMessage({ ...good, crossfade: 'yes' }), false);
});
