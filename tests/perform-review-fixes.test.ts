// Task 9 review: what a running show may undo, what reaches a saved file, a closed wall, and playing from the grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as grid from '../src/perform/grid-edit';
import { applyEdit, presetComposition, type EditAction } from '../src/map/editor';
import { createShow, validateShow, type CurvePoint, type ShowDocument } from '../src/map/show';
import { PerformService } from '../src/perform/service';
import type { Clip } from '../src/perform/types';
import type { MapMessage } from '../src/map/messages';

const edit = grid as unknown as {
  historyBlock(now: ShowDocument, target: ShowDocument, inUse: readonly string[]): string | null;
  savedShow(show: ShowDocument): ShowDocument;
};
const sq: CurvePoint[] = [{ x: .1, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .4 }, { x: .1, y: .4 }];
const ok = (show: ShowDocument, action: EditAction) => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const clip = (id: string, sourceId: string): Clip => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'level' });
const project = () => presetComposition('salt-mandala', 1)!;

function played(): ShowDocument {
  let show = ok(createShow(), { type: 'addShape', id: 'shape', points: sq, colour: '#ff0000' });
  const set = grid.placeClip(grid.addRow(show.performance, 'row'), 0, 0, clip('c1', 's1'));
  show = ok(show, { type: 'addClipSource', sourceId: 's1', project: project(), performance: set });
  return show;
}

test('during a show, undoing a shape edit is refused', () => {
  const before = played(), after = ok(before, { type: 'moveShape', shapeId: 'shape', dx: .05, dy: 0 });
  assert.equal(edit.historyBlock(after, before, ['c1']), 'picture');
});

test('during a show, undoing a group change is refused', () => {
  const before = played(), after = ok(before, { type: 'group', shapeIds: ['shape'], groupId: 'g', name: 'G' });
  assert.equal(edit.historyBlock(after, before, ['c1']), 'picture');
});

test('during a show, undoing a composition edit is refused', () => {
  const before = played(), next = project();
  next.name = 'Edited';
  const after = ok(before, { type: 'setSourceProject', sourceId: 's1', project: next });
  assert.equal(edit.historyBlock(after, before, ['c1']), 'picture');
});

test('during a show, undoing a safe grid edit is allowed', () => {
  const before = played(), after = ok(before, { type: 'setPerformance', performance: grid.changeClip(before.performance, 'c1', { audioBand: 'bass' }) });
  assert.equal(edit.historyBlock(after, before, ['c1']), null);
});

test('during a show, undoing the arrival of a clip that is playing is refused', () => {
  const empty = ok(createShow(), { type: 'addShape', id: 'shape', points: sq, colour: '#ff0000' });
  const set = grid.placeClip(grid.addRow(empty.performance, 'row'), 0, 0, clip('c1', 's1'));
  const after = ok(empty, { type: 'addClipSource', sourceId: 's1', project: project(), performance: set });
  assert.notEqual(edit.historyBlock(after, empty, ['c1']), null);
});

test('a clip kept only for the running show never reaches a saved file', () => {
  const show = played();
  const cleared = ok(show, { type: 'setPerformance', performance: grid.setCell(show.performance, 0, 0, null, ['c1']) });
  assert.equal(cleared.performance.clips.length, 1, 'the running show still holds it');
  const saved = validateShow(JSON.parse(JSON.stringify(edit.savedShow(cleared)))).show;
  assert.equal(saved.performance.clips.length, 0);
  assert.equal(saved.sources.length, 0);
});

test('a show with nothing to prune is saved as it is', () => {
  const show = played();
  assert.equal(edit.savedShow(show), show);
});

function rig(open: boolean) {
  let now = 1000, next = 0;
  const state = { open };
  const show = played();
  show.shapes = show.shapes.map(s => s);
  show.performance.zones = show.performance.zones.map((z, i) => i === 0 ? { ...z, target: { kind: 'shape', id: 'shape' } } : z);
  const sent: MapMessage[] = [];
  const service = new PerformService({
    wall: { send: m => { sent.push(m); }, isOpen: () => state.open, sendWholeShow: () => {} },
    clock: { snapshot: () => ({ anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'locked', barOffset: 0 }), begin() {}, end() {}, tap() {}, follow() {}, setBarStart() {}, subscribe: () => () => {} },
    show: () => show, now: () => now, id: () => `L${++next}`, random: () => 0,
  });
  return { service, state, sent, at: (ms: number) => { now = ms; }, ready: () => { service.control({ kind: 'sendAllStart' }); service.control({ kind: 'sendAllEnd' }); } };
}

test('with the wall closed nothing counts as loading or too heavy, and the wait starts when it opens', () => {
  const r = rig(false);
  r.service.startShow(); r.ready();
  r.service.action({ type: 'bankNext' });
  r.at(20000);
  assert.deepEqual(r.service.view().waiting, []);
  assert.deepEqual(r.service.view().stuck, []);
  r.state.open = true;
  r.service.wallReopened();
  assert.deepEqual(r.service.view().waiting, ['s1']);
  assert.deepEqual(r.service.view().stuck, [], 'the wait starts now, not when the look was first asked for');
  r.at(23000);
  assert.deepEqual(r.service.view().stuck, ['s1']);
});

test('a clicked cell queues on the next bar through the launcher', () => {
  const r = rig(true);
  r.service.startShow(); r.ready();
  r.service.action({ type: 'launchCell', row: 0, zone: 0 });
  const q = r.service.view().launcher.queue;
  assert.equal(q.length, 1);
  assert.deepEqual(q[0].changes.map(c => [c.zone, c.clipId]), [[0, 'c1']]);
  assert.equal(q[0].beat % 4, 0);
});

test('a clicked scene queues that row', () => {
  const r = rig(true);
  r.service.startShow(); r.ready();
  r.service.action({ type: 'launchScene', row: 0 });
  assert.equal(r.service.view().launcher.queue[0].sceneIndex, 0);
});

test('nothing launches from the grid before Send All', () => {
  const r = rig(true);
  r.service.startShow();
  r.service.action({ type: 'launchCell', row: 0, zone: 0 });
  r.service.action({ type: 'launchScene', row: 0 });
  assert.equal(r.service.view().launcher.queue.length, 0);
});
