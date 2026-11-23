// The Perform screen's pure parts: the computer keyboard as a controller, and grid edits as Map edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardControl, keysBelongElsewhere } from '../src/ui/usePerform';
import { addRow, placeClip, setCell, zonesFromGroups } from '../src/perform/grid-edit';
import { createPerformanceSet } from '../src/perform/set';
import { applyEdit, presetComposition, type EditAction } from '../src/map/editor';
import { createShow, MAX_SOURCES, validateShow, type ShowDocument } from '../src/map/show';
import { initialMapState, mapReducer } from '../src/map/state';
import type { Clip } from '../src/perform/types';

const key = (code: string, type = 'keydown', over: Record<string, unknown> = {}) => ({ code, type, repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null, ...over }) as unknown as KeyboardEvent;
const clip = (id: string, sourceId: string): Clip => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'level' });
const ok = (show: ShowDocument, action: EditAction) => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const project = () => presetComposition('salt-mandala', 1)!;

test('the keyboard follows the brief, by physical key so Shift + 1 is still Amber 1', () => {
  assert.deepEqual(keyboardControl(key('Digit1', 'keydown', { shiftKey: true })), { kind: 'amber', strip: 0, down: true });
  assert.deepEqual(keyboardControl(key('Digit8')), { kind: 'amber', strip: 7, down: true });
  assert.equal(keyboardControl(key('Digit9')), null);
  assert.deepEqual(keyboardControl(key('KeyI', 'keyup')), { kind: 'red', strip: 7, down: false });
  assert.deepEqual(keyboardControl(key('BracketLeft')), { kind: 'bankBack', down: true });
  assert.deepEqual(keyboardControl(key('BracketRight')), { kind: 'bankNext', down: true });
  assert.deepEqual(keyboardControl(key('ShiftRight')), { kind: 'solo', down: true });
  assert.deepEqual(keyboardControl(key('Backslash')), { kind: 'sendAllStart' });
  assert.deepEqual(keyboardControl(key('Backslash', 'keyup')), { kind: 'sendAllEnd' });
});

test('Space and F are actions, so they are not controller events', () => {
  assert.equal(keyboardControl(key('Space')), null);
  assert.equal(keyboardControl(key('KeyF')), null);
});

test('held-key repeats and command shortcuts do nothing', () => {
  assert.equal(keyboardControl(key('Digit1', 'keydown', { repeat: true })), null);
  assert.equal(keyboardControl(key('KeyQ', 'keydown', { metaKey: true })), null);
});

test('typing in a text field is not playing, but a fader or a button keeps the keys', () => {
  const el = (tagName: string, type?: string) => ({ tagName, type, isContentEditable: false, closest: () => null }) as unknown as HTMLElement;
  assert.equal(keysBelongElsewhere(el('INPUT', 'text')), true);
  assert.equal(keysBelongElsewhere(el('INPUT', 'search')), true);
  assert.equal(keysBelongElsewhere(el('TEXTAREA')), true);
  assert.equal(keysBelongElsewhere(el('INPUT', 'range')), false);
  assert.equal(keysBelongElsewhere(el('BUTTON')), false);
  assert.equal(keyboardControl(key('Digit1', 'keydown', { target: el('INPUT', 'text') })), null);
  // A release always gets through, so nothing stays held after focus moves into a field.
  assert.deepEqual(keyboardControl(key('Digit1', 'keyup', { target: el('INPUT', 'text') })), { kind: 'amber', strip: 0, down: false });
});

test('a clip source arrives with its set in one undo step, survives a reload, and undo removes both', () => {
  const start = initialMapState(createShow());
  const performance = placeClip(addRow(start.show.performance, 'row'), 0, 0, clip('c1', 'src1'));
  const after = mapReducer(start, { type: 'edit', action: { type: 'addClipSource', sourceId: 'src1', project: project(), performance } });
  assert.equal(after.refusal, null);
  assert.equal(after.past.length, 1);
  assert.deepEqual(after.show.sources.map(s => s.id), ['src1']);
  const reloaded = validateShow(JSON.parse(JSON.stringify(after.show))).show;
  assert.equal(reloaded.performance.scenes[0].cells[0], 'c1');
  assert.equal(reloaded.sources.length, 1);
  const undone = mapReducer(after, { type: 'undo' });
  assert.equal(undone.show.sources.length, 0);
  assert.equal(undone.show.performance.clips.length, 0);
});

test('a full source budget is refused and changes nothing', () => {
  let show = createShow(), set = addRow(show.performance, 'row');
  for (let i = 0; i < MAX_SOURCES; i++) {
    set = { ...set, clips: [...set.clips, clip(`c${i}`, `s${i}`)] };
    show = ok(show, { type: 'addClipSource', sourceId: `s${i}`, project: project(), performance: set });
  }
  const r = applyEdit(show, { type: 'addClipSource', sourceId: 'one-more', project: project(), performance: { ...set, clips: [...set.clips, clip('extra', 'one-more')] } });
  assert.deepEqual(r, { ok: false, reason: 'too-many-sources' });
});

test('clearing a cell keeps a clip the show is playing, and lets it go once nothing needs it', () => {
  const set = placeClip(addRow(createPerformanceSet(), 'row'), 0, 0, clip('c1', 'src1'));
  assert.equal(setCell(set, 0, 0, null, ['c1']).clips.length, 1);
  assert.equal(setCell(set, 0, 0, null).clips.length, 0);
});

test('setPerformance changing nothing is not an undo step', () => {
  const start = initialMapState(createShow());
  const same = mapReducer(start, { type: 'edit', action: { type: 'setPerformance', performance: structuredClone(start.show.performance) } });
  assert.equal(same.past.length, 0);
});

test('zones come from Map groups in order, with Ceiling on the last strip', () => {
  const zones = zonesFromGroups(createPerformanceSet(), [{ id: 'g1', name: 'Speakers' }, { id: 'g2', name: 'Ceiling' }, { id: 'g3', name: 'Sofa' }]).zones;
  assert.deepEqual(zones[0].target, { kind: 'group', id: 'g1' });
  assert.deepEqual(zones[1].target, { kind: 'group', id: 'g3' });
  assert.deepEqual(zones[7].target, { kind: 'group', id: 'g2' });
  assert.equal(zones[2].target, null);
});
