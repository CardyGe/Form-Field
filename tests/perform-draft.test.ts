// Editing a clip during a show is a private draft: nothing reaches the wall until Apply, and Discard leaves the show alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Project } from '../src/shared/types';
import { applyEdit, presetComposition } from '../src/map/editor';
import { acceptMapMessage } from '../src/map/messages';
import { createShow, LIVE_SOURCE_ID, type ShowDocument } from '../src/map/show';
import { initialMapState, mapReducer, type MapState } from '../src/map/state';
import { applyMapMessage, initialWall } from '../src/map/wall';
import { addRow, historyBlock, placeClip, setCell, zonesSharingSource } from '../src/perform/grid-edit';
import type { Clip } from '../src/perform/types';

type Sent = { type: string; [key: string]: unknown };
const sent: Sent[] = [];
let outputChanged: (open: boolean) => void = () => {};
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = { studio: { onBeforeClose: () => () => {}, map: {
  send: (m: Sent) => { sent.push(m); },
  onOutputChanged: (fn: (open: boolean) => void) => { outputChanged = fn; return () => {}; },
  onState: () => () => {},
  saveAutosave: async () => {},
  loadAutosave: async () => null,
} } };
const frames: ((t: number) => void)[] = [];
globals.requestAnimationFrame = (fn: (t: number) => void) => { frames.push(fn); return frames.length; };
const nextFrame = () => { for (const fn of frames.splice(0)) fn(0); };

const { applyClipDraft, beginClipEdit, clipDraftOpen, discardClipDraft, mapSessionForTest, studioEdit } = await import('../src/ui/useMap');

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
  const begun = beginClipEdit('src-a', true)!;
  for (const o of [.9, .6, .3]) assert.equal(studioEdit(changed(begun.project, o)), null);
  assert.deepEqual(sent, []);
  assert.equal(mapSessionForTest.state().show, state.show);
  assert.equal(mapSessionForTest.state().past.length, state.past.length);
});

test('Apply is one undo step and one crossfading wall source update', () => {
  const state = open();
  const begun = beginClipEdit('src-a', true)!;
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
  const begun = beginClipEdit('src-a', true)!;
  studioEdit(changed(begun.project, .4));
  studioEdit(structuredClone(begun.project));
  assert.equal(applyClipDraft(), null);
  assert.equal(mapSessionForTest.state().show, state.show);
  assert.deepEqual(sent, []);
});

test('Discard leaves the show identical', () => {
  const state = open(), copy = structuredClone(state.show);
  const begun = beginClipEdit('src-a', true)!;
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
  const begun = beginClipEdit('src-a', true)!;
  studioEdit(changed(begun.project, .3));
  applyClipDraft();
  const after = mapSessionForTest.state();
  assert.equal(historyBlock(after.show, after.past.at(-1)!, ['a']), 'picture');
  assert.equal(historyBlock(after.show, after.past.at(-1)!, []), 'picture');
});

test('a draft whose clip has left the set is refused plainly and stays open', () => {
  const state = open();
  const begun = beginClipEdit('src-a', true)!;
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
