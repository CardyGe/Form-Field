// Stage 5: scenes, links, triggers and tempo sync in the show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, validateShow, type CurvePoint, type ShowDocument } from '../src/map/show';
import { toWire } from '../src/map/messages';
import { isPinnable } from '../src/map/homography';
import { pinCorners } from '../src/map/placement';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const refused = (show: ShowDocument, action: EditAction, reason: string) => assert.deepEqual(applyEdit(show, action), { ok: false, reason });
const shapeOf = (show: ShowDocument, id: string) => show.shapes.find(s => s.id === id)!;
const play = (show: ShowDocument, id: string, sourceId: string, presetId = 'porcelain-shutters') => ok(show, { type: 'setContent', shapeId: id, content: { kind: 'preset', presetId, sourceId, seed: 1, linked: false } });
const base = () => play(ok(ok(createShow(), { type: 'addShape', id: 'a', points: sq(.1, .1, .4, .4), colour: '#ff0000' }), { type: 'addShape', id: 'b', points: sq(.5, .5, .8, .8), colour: '#00ff00' }), 'a', 'sa');

test('a scene takes in what every shape plays and how; switching scenes keeps the live one and brings the other back', () => {
  let show = ok(base(), { type: 'addScene', sceneId: 's1', name: 'Opening' });
  assert.equal(show.sceneId, 's1');
  show = ok(show, { type: 'addScene', sceneId: 's2', name: 'Build' });
  // Edited while live: the change belongs to scene 2.
  show = play(show, 'a', 'sb', 'salt-mandala');
  show = ok(show, { type: 'setLook', shapeId: 'b', brightness: .5 });
  show = ok(show, { type: 'setVisible', shapeId: 'b', visible: false });
  const back = ok(show, { type: 'switchScene', sceneId: 's1' });
  assert.equal(shapeOf(back, 'a').sourceId, 'sa');
  assert.equal(shapeOf(back, 'b').brightness, 1);
  assert.equal(shapeOf(back, 'b').visible, true);
  // Both scenes' instruments stay in the show.
  assert.deepEqual(back.sources.map(s => s.id).sort(), ['sa', 'sb']);
  const again = ok(back, { type: 'switchScene', sceneId: 's2' });
  assert.equal(shapeOf(again, 'a').sourceId, 'sb');
  assert.equal(shapeOf(again, 'b').visible, false);
  // Outlines are never part of a scene.
  assert.deepEqual(shapeOf(again, 'a').points, shapeOf(base(), 'a').points);
});

test('a shape added after a scene was made keeps its state there; deleting a shape removes it everywhere; scenes can be renamed, timed and deleted', () => {
  let show = ok(ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' }), { type: 'addScene', sceneId: 's2', name: 'Two' });
  show = ok(show, { type: 'addShape', id: 'c', points: sq(.85, .1, .95, .2), colour: '#0000ff' });
  show = ok(show, { type: 'switchScene', sceneId: 's1' });
  assert.ok(shapeOf(show, 'c'));
  show = ok(show, { type: 'renameScene', sceneId: 's1', name: 'Intro' });
  show = ok(show, { type: 'setSceneFade', sceneId: 's1', seconds: 4 });
  show = ok(show, { type: 'setSceneFade', sceneId: null, seconds: 1.5 });
  assert.equal(show.scenes[0].name, 'Intro');
  assert.equal(show.scenes[0].fadeSeconds, 4);
  assert.equal(show.sceneFade, 1.5);
  show = ok(show, { type: 'delete', shapeId: 'a' });
  assert.ok(show.scenes.every(sc => !('a' in sc.shapes)));
  assert.deepEqual(show.sources, [], 'the instruments only the deleted shape played go');
  show = ok(show, { type: 'deleteScene', sceneId: 's1' });
  assert.deepEqual(show.scenes.map(s => s.id), ['s2']);
  assert.equal(show.sceneId, null, 'deleting the live scene leaves no scene live; the shapes stay as they are');
  refused(show, { type: 'switchScene', sceneId: 'nope' }, 'not-found');
});

test('links: added, changed, removed; a shape’s links go with it; ready-made reactions add ordinary links', () => {
  let show = base();
  show = ok(show, { type: 'addLink', link: { id: 'l1', input: 'audio.bass', target: 'shape.a.brightness', mode: 'modulate', amount: .5, low: 0, high: 1, attackMs: 10, releaseMs: 200, on: true, name: 'Bass' } });
  show = ok(show, { type: 'updateLink', linkId: 'l1', change: { amount: 3 } });
  assert.equal(show.links[0].amount, 1, 'amount is kept within ±100 %');
  refused(show, { type: 'addLink', link: { ...show.links[0], id: 'l2', target: 'shape.zz.brightness' } }, 'bad-target');
  show = ok(show, { type: 'addReaction', reaction: 'pulse', shapeId: 'b', ids: ['r1'] });
  assert.deepEqual(show.links.map(l => [l.id, l.input, l.target]), [['l1', 'audio.bass', 'shape.a.brightness'], ['r1', 'beat.pulse', 'shape.b.brightness']]);
  show = ok(show, { type: 'addReaction', reaction: 'instrument-bass', shapeId: 'a', ids: ['r2'] });
  assert.match(show.links[2].target, /^source\.sa\.param\.0\./);
  show = ok(show, { type: 'removeLink', linkId: 'l1' });
  show = ok(show, { type: 'delete', shapeId: 'b' });
  assert.deepEqual(show.links.map(l => l.id), ['r2']);
});

test('triggers and tempo sync', () => {
  let show = ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' });
  show = ok(show, { type: 'addTrigger', trigger: { id: 't1', input: 'midi.note.1.36', when: 'on', every: 1, action: { kind: 'scene', sceneId: 's1' }, on: true } });
  show = ok(show, { type: 'addTrigger', trigger: { id: 't2', input: 'tempo.beat', when: 'beats', every: 8, action: { kind: 'next-scene' }, on: true } });
  refused(show, { type: 'addTrigger', trigger: { id: 't3', input: 'midi.note.1.37', when: 'on', every: 1, action: { kind: 'scene', sceneId: 'gone' }, on: true } }, 'bad-target');
  show = ok(show, { type: 'setTempoSync', sourceId: 'sa', beats: 4 });
  assert.equal(show.sources[0].tempoSync, 4);
  refused(show, { type: 'setTempoSync', sourceId: 'sa', beats: 3 }, 'bad-tempo');
  show = ok(show, { type: 'deleteScene', sceneId: 's1' });
  assert.deepEqual(show.triggers.map(t => t.id), ['t2'], 'a trigger for a deleted scene goes');
});

test('version 5 round-trips; older shows open with no scenes, links or triggers, unrepaired; damaged links are dropped', () => {
  let show = ok(ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' }), { type: 'addReaction', reaction: 'pulse', shapeId: 'a', ids: ['r1'] });
  show = ok(show, { type: 'setTempoSync', sourceId: 'sa', beats: 8 });
  const r = validateShow(JSON.parse(JSON.stringify(show)));
  assert.equal(r.repaired, false);
  assert.deepEqual(r.show, show);
  const v4 = validateShow({ ...JSON.parse(JSON.stringify(base())), version: 4, scenes: undefined, sceneId: undefined, sceneFade: undefined, links: undefined, triggers: undefined });
  assert.equal(v4.repaired, false);
  assert.deepEqual([v4.show.scenes, v4.show.links, v4.show.triggers, v4.show.sceneFade], [[], [], [], 2]);
  const damaged = validateShow({ ...JSON.parse(JSON.stringify(show)), links: [{ id: 'x', input: 'audio.bass', target: 'shape.missing.brightness' }, 'nonsense'] });
  assert.deepEqual(damaged.show.links, []);
  assert.equal(damaged.repaired, true);
});

test('the wall gets links and tempo sync, never scenes or triggers', () => {
  let show = ok(ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' }), { type: 'addReaction', reaction: 'pulse', shapeId: 'a', ids: ['r1'] });
  show = ok(show, { type: 'addTrigger', trigger: { id: 't', input: 'tempo.beat', when: 'beats', every: 4, action: { kind: 'next-scene' }, on: true } });
  const wire = toWire(show) as unknown as Record<string, unknown>;
  assert.equal((wire.links as unknown[]).length, 1);
  assert.equal('scenes' in wire, false);
  assert.equal('triggers' in wire, false);
});

test('review fix: a scene bringing back a Pin whose own corners no longer carry a picture pins on its box', () => {
  let show = ok(createShow(), { type: 'addShape', id: 'q', points: sq(.2, .2, .4, .4), colour: '#ff0000' });
  show = ok(show, { type: 'setPlacement', shapeId: 'q', placement: { kind: 'pin' } });
  show = ok(ok(show, { type: 'addScene', sceneId: 'a', name: 'A' }), { type: 'addScene', sceneId: 'b', name: 'B' });
  show = ok(show, { type: 'setPlacement', shapeId: 'q', placement: { kind: 'fit' } });
  // Folded in scene B, where it is not pinned.
  show = ok(show, { type: 'movePoint', shapeId: 'q', index: 0, to: { x: .35, y: .35 } });
  const back = ok(show, { type: 'switchScene', sceneId: 'a' });
  const q = shapeOf(back, 'q');
  assert.equal(q.placement.kind, 'pin');
  assert.equal(isPinnable(pinCorners(q)).ok, true, 'it pins on corners that carry the picture (its box)');
  // Switching to the live scene, or renaming to the same name, is no step at all.
  assert.equal(applyEdit(back, { type: 'switchScene', sceneId: 'a' }).ok && (applyEdit(back, { type: 'switchScene', sceneId: 'a' }) as { show: ShowDocument }).show, back);
});

test('edits made by triggers are one undo step however often they fire', async () => {
  const { mapReducer, initialMapState } = await import('../src/map/state');
  const { createShow } = await import('../src/map/show');
  let state = initialMapState(createShow());
  state = mapReducer(state, { type: 'edit', action: { type: 'addScene', sceneId: 'a', name: 'A' } });
  state = mapReducer(state, { type: 'edit', action: { type: 'addScene', sceneId: 'b', name: 'B' } });
  const before = state.past.length;
  for (let i = 0; i < 20; i++) state = mapReducer(state, { type: 'edit', action: { type: 'switchScene', sceneId: i % 2 ? 'b' : 'a' }, merge: 'trigger' });
  assert.equal(state.past.length, before + 1);
  state = mapReducer(state, { type: 'undo' });
  assert.equal(state.show.sceneId, 'b');
});
