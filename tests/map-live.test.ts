// Live in Map: a shape can play Live (the Live screen's one look), shared, in scenes, and told to the wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, validateShow, validateWireShow, LIVE_SOURCE_ID, usesLive, type CurvePoint, type ShowDocument } from '../src/map/show';
import { toWire } from '../src/map/messages';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const shapeOf = (show: ShowDocument, id: string) => show.shapes.find(s => s.id === id)!;
/** a and b sharing one instrument, c on its own colour. */
const base = () => {
  let show = ok(ok(ok(createShow(), { type: 'addShape', id: 'a', points: sq(.1, .1, .3, .3), colour: '#ff0000' }), { type: 'addShape', id: 'b', points: sq(.4, .1, .6, .3), colour: '#00ff00' }), { type: 'addShape', id: 'c', points: sq(.7, .1, .9, .3), colour: '#0000ff' });
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'sa', seed: 1, linked: false } });
  return ok(show, { type: 'shareSource', shapeId: 'b', withShapeId: 'a' });
};

test('LIVE_SOURCE_ID is the reserved id "live"', () => { assert.equal(LIVE_SOURCE_ID, 'live'); });

test('a shape plays Live; linked shapes all change; Live is never in sources', () => {
  const all = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'live', linked: true } });
  assert.equal(shapeOf(all, 'a').sourceId, 'live');
  assert.equal(shapeOf(all, 'b').sourceId, 'live');
  assert.deepEqual(all.sources, [], 'the instrument nobody plays is gone, and Live is not a source');
  const one = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'live', linked: false } });
  assert.equal(shapeOf(one, 'a').sourceId, 'live');
  assert.equal(shapeOf(one, 'b').sourceId, 'sa');
});

test('Make separate on a Live shape keeps Live', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'live', linked: true } });
  show = ok(show, { type: 'makeSeparate', shapeId: 'a', sourceId: 'new' });
  assert.equal(shapeOf(show, 'a').sourceId, 'live');
  assert.ok(!show.sources.some(s => s.id === 'new'));
});

test('Share with a Live shape plays Live', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'live', linked: false } });
  show = ok(show, { type: 'shareSource', shapeId: 'c', withShapeId: 'a' });
  assert.equal(shapeOf(show, 'c').sourceId, 'live');
});

test('a blocker never plays Live', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
  show = ok(show, { type: 'setBlocker', shapeId: 'c', blocker: true });
  assert.equal(shapeOf(show, 'c').sourceId, null);
  assert.equal(applyEdit(show, { type: 'setContent', shapeId: 'c', content: { kind: 'live' } }).ok, false);
});

test('scenes keep Live, and a show uses Live while only a scene names it', () => {
  let show = ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' });
  show = ok(show, { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
  assert.equal(usesLive(show), true);
  show = ok(show, { type: 'addScene', sceneId: 's2', name: 'Two' });
  show = ok(show, { type: 'setContent', shapeId: 'c', content: { kind: 'colour' } });
  assert.equal(shapeOf(show, 'c').sourceId, null);
  assert.equal(usesLive(show), true, 'scene 1 still plays Live');
  show = ok(show, { type: 'switchScene', sceneId: 's1' });
  assert.equal(shapeOf(show, 'c').sourceId, 'live');
  show = ok(show, { type: 'setContent', shapeId: 'c', content: { kind: 'colour' } });
  show = ok(show, { type: 'switchScene', sceneId: 's2' });
  assert.equal(usesLive(show), false);
});

test('version 6 round-trips; version 5 files open unrepaired; "live" in a version 5 file is a missing source, repaired', () => {
  let show = ok(base(), { type: 'addScene', sceneId: 's1', name: 'One' });
  show = ok(show, { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
  assert.equal(show.version, 6);
  const again = validateShow(JSON.parse(JSON.stringify(show)));
  assert.equal(again.repaired, false);
  assert.equal(shapeOf(again.show, 'c').sourceId, 'live');
  const old = JSON.parse(JSON.stringify(base())); old.version = 5;
  assert.equal(validateShow(old).repaired, false);
  const oldLive = JSON.parse(JSON.stringify(show)); oldLive.version = 5;
  const read = validateShow(oldLive);
  assert.equal(read.repaired, true);
  assert.equal(shapeOf(read.show, 'c').sourceId, null);
});

test('the wall is told whether the show uses Live, and keeps Live shapes', () => {
  assert.equal(toWire(base()).usesLive, false);
  const show = ok(base(), { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
  const wire = toWire(show);
  assert.equal(wire.usesLive, true);
  const read = validateWireShow(JSON.parse(JSON.stringify(wire)));
  assert.equal(read.usesLive, true);
  assert.equal(read.shapes.find(s => s.id === 'c')!.sourceId, 'live');
});

test('a copy of a Live shape plays Live too, and takes no source id', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
  show = ok(show, { type: 'duplicateShapes', shapeIds: ['c'], ids: ['c2'], sourceIds: ['unused'] });
  assert.equal(shapeOf(show, 'c2').sourceId, 'live');
  assert.ok(!show.sources.some(s => s.id === 'unused'));
});

test('a grid made from a Live shape plays Live in every cell, spread or not', () => {
  for (const spread of [true, false]) {
    let show = ok(base(), { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
    show = ok(show, { type: 'makeGrid', shapeId: 'c', rows: 1, cols: 2, gapPx: 0, ids: ['g1', 'g2'], sourceIds: ['x1', 'x2'], groupId: 'grp', spread });
    assert.deepEqual(['g1', 'g2'].map(id => shapeOf(show, id).sourceId), ['live', 'live'], `spread ${spread}`);
  }
});

test('an instrument can never take the id "live"', () => {
  const r = applyEdit(base(), { type: 'setContent', shapeId: 'c', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'live', seed: 1 } });
  assert.deepEqual(r, { ok: false, reason: 'duplicate-id' });
});

test('the wall keeps Live’s settings; damaged ones are repaired; null lets Live go', async () => {
  const { initialWall, applyMapMessage } = await import('../src/map/wall');
  const { defaultLiveSettings } = await import('../src/live/settings');
  let wall = initialWall();
  assert.equal(wall.live, null);
  wall = applyMapMessage(wall, { type: 'liveSettings', settings: { ...defaultLiveSettings(), look: 'smoke', sensitivity: 99 } });
  assert.equal(wall.live?.look, 'smoke');
  assert.equal(wall.live?.sensitivity, 4, 'kept inside its range');
  wall = applyMapMessage(wall, { type: 'liveSettings', settings: null });
  assert.equal(wall.live, null);
});

test('the wall hears Live’s link inputs only while the show uses Live', async () => {
  const { wallInputs } = await import('../src/map/messages');
  const { defaultLiveSettings } = await import('../src/live/settings');
  const live = { ...defaultLiveSettings(), links: [{ id: 'l', input: 'audio.highs', target: 'live.paint.spread', mode: 'modulate' as const, amount: .3, low: 0, high: 1, attackMs: 0, releaseMs: 100, on: true, name: '' }] };
  const show = ok(base(), { type: 'addLink', link: { id: 'm', input: 'audio.bass', target: 'shape.a.brightness', mode: 'modulate', amount: .3, low: 0, high: 1, attackMs: 0, releaseMs: 100, on: true, name: '' } });
  assert.deepEqual([...wallInputs(show, live)].sort(), ['audio.bass', 'tempo.beat', 'tempo.phase']);
  const withLive = ok(show, { type: 'setContent', shapeId: 'c', content: { kind: 'live' } });
  assert.deepEqual([...wallInputs(withLive, live)].sort(), ['audio.bass', 'audio.highs', 'tempo.beat', 'tempo.phase']);
  assert.deepEqual([...wallInputs(withLive, null)].sort(), ['audio.bass', 'tempo.beat', 'tempo.phase']);
});

test('a wide picture on a square shape is cropped at its sides, never stretched', async () => {
  const { coverCrop } = await import('../src/map/placement');
  const { apply } = await import('../src/map/homography');
  const h = coverCrop(1, 16 / 9);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(apply(h, { x: 0, y: 0 }).x, 0.21875); near(apply(h, { x: 1, y: 0 }).x, 0.78125);
  near(apply(h, { x: 0, y: 0 }).y, 0); near(apply(h, { x: 0, y: 1 }).y, 1);
});

test('a tall shape crops the picture’s top and bottom', async () => {
  const { coverCrop } = await import('../src/map/placement');
  const { apply } = await import('../src/map/homography');
  const h = coverCrop(4, 16 / 9); // a shape four times as wide as tall: the picture is too tall for it
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(apply(h, { x: 0, y: 0 }).x, 0); near(apply(h, { x: 1, y: 0 }).x, 1);
  near(apply(h, { x: 0, y: 0 }).y, (1 - (16 / 9) / 4) / 2); near(apply(h, { x: 0, y: 1 }).y, 1 - (1 - (16 / 9) / 4) / 2);
});

test('a picture as wide as its shape is unchanged', async () => {
  const { coverCrop } = await import('../src/map/placement');
  assert.deepEqual(coverCrop(16 / 9, 16 / 9), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('review fix: a new look on one of several Live shapes gives them all one new instrument, never a crash', () => {
  let show = ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'live', linked: true } });
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'salt-mandala', sourceId: 'sx', seed: 2 } });
  assert.equal(shapeOf(show, 'a').sourceId, 'sx');
  assert.equal(shapeOf(show, 'b').sourceId, 'sx');
  assert.deepEqual(show.sources.map(s => s.id), ['sx']);
  const one = ok(ok(base(), { type: 'setContent', shapeId: 'a', content: { kind: 'live', linked: true } }), { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'salt-mandala', sourceId: 'sy', seed: 2, linked: false } });
  assert.equal(shapeOf(one, 'a').sourceId, 'sy');
  assert.equal(shapeOf(one, 'b').sourceId, 'live');
});

test('review fix: Live is waited for only while it is starting; a camera that cannot play lets the shapes show their fill', async () => {
  const { liveReadiness } = await import('../src/map/liveReady');
  assert.equal(liveReadiness({ status: 'starting' }, { file: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0 }), 'wait');
  assert.equal(liveReadiness({ status: 'idle' }, { file: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0 }), 'wait');
  for (const status of ['refused', 'none', 'lost', 'error'] as const)
    assert.equal(liveReadiness({ status } as never, { file: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0 }), 'cannot', status);
  assert.equal(liveReadiness({ status: 'running' } as never, { file: true, needsPeople: false, peopleLoading: false, drawnSinceRunning: 5 }), 'cannot', 'a video file plays on the Live screen only');
  // Running, but nothing drawn since the camera came up: a frame from before could be no camera picture at all.
  assert.equal(liveReadiness({ status: 'running' } as never, { file: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0 }), 'wait');
  assert.equal(liveReadiness({ status: 'running' } as never, { file: false, needsPeople: true, peopleLoading: true, drawnSinceRunning: 5 }), 'wait', 'people-finding still loading');
  assert.equal(liveReadiness({ status: 'running' } as never, { file: false, needsPeople: true, peopleLoading: false, drawnSinceRunning: 5 }), 'play');
  assert.equal(liveReadiness({ status: 'running' } as never, { file: false, needsPeople: false, peopleLoading: true, drawnSinceRunning: 1 }), 'play');
});
