// Map stage 7: the wild options — the show's fields and the rules behind them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, validateShow, MAX_SOURCES, type CurvePoint, type ShowDocument } from '../src/map/show';
import { staggerDelays, chaseOffsets, rotatePalette, outlinePolygon, nextAutoScene, autoAdvanceDue } from '../src/map/wild';
import { initialMapState, mapReducer } from '../src/map/state';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const refused = (show: ShowDocument, action: EditAction, reason: string) => assert.deepEqual(applyEdit(show, action), { ok: false, reason });
/** Three shapes a b c in group g, all playing one shared instrument sa. */
const grouped = () => {
  let show = createShow();
  for (const [i, id] of ['a', 'b', 'c'].entries()) show = ok(show, { type: 'addShape', id, points: sq(.1 + i * .3, .1, .3 + i * .3, .3), colour: '#ff0000' });
  show = ok(show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'sa', seed: 1, linked: false } });
  show = ok(ok(show, { type: 'shareSource', shapeId: 'b', withShapeId: 'a' }), { type: 'shareSource', shapeId: 'c', withShapeId: 'a' });
  return ok(show, { type: 'group', shapeIds: ['a', 'b', 'c'], groupId: 'g', name: 'G' });
};

test('version 8 round-trips; version 7 opens with every option off, unrepaired', () => {
  let show = grouped();
  show = ok(show, { type: 'setGroupStagger', groupId: 'g', seconds: .5 });
  show = ok(show, { type: 'setGroupChase', groupId: 'g', on: true });
  show = ok(show, { type: 'setFollowOutline', sourceId: 'sa', mode: 'emitter' });
  show = ok(show, { type: 'setBorder', shapeId: 'a', border: { width: 4, colour: 'shape', glow: 0 } });
  show = ok(show, { type: 'setBorderRun', shapeId: 'a', run: { lapsPerMinute: 30, beats: null, length: .2 } });
  show = ok(show, { type: 'setAutoAdvance', autoAdvance: { every: 30, unit: 'seconds', order: 'random' } });
  assert.equal(show.version, 8);
  const again = validateShow(JSON.parse(JSON.stringify(show)));
  assert.equal(again.repaired, false);
  assert.deepEqual(again.show.groups[0], show.groups[0]);
  assert.deepEqual(again.show.autoAdvance, { every: 30, unit: 'seconds', order: 'random' });
  assert.equal(again.show.sources[0].followOutline, 'emitter');
  assert.deepEqual(again.show.shapes[0].border.run, { lapsPerMinute: 30, beats: null, length: .2 });
  const old = JSON.parse(JSON.stringify(grouped())); old.version = 7;
  const read = validateShow(old);
  assert.equal(read.repaired, false);
  assert.ok(!read.show.groups[0].stagger && !read.show.groups[0].chase && !read.show.autoAdvance && !read.show.sources[0].followOutline);
});

test('stagger delays follow list order, first 0, last the full stagger; one shape has 0', () => {
  const show = ok(grouped(), { type: 'setGroupStagger', groupId: 'g', seconds: .8 });
  assert.deepEqual([...staggerDelays(show, 'g')], [['a', 0], ['b', .4], ['c', .8]]);
  assert.deepEqual([...staggerDelays(grouped(), 'g')], [['a', 0], ['b', 0], ['c', 0]], 'off');
  let one = createShow();
  one = ok(ok(one, { type: 'addShape', id: 'x', points: sq(.1, .1, .3, .3), colour: '#fff' }), { type: 'group', shapeIds: ['x'], groupId: 'g1', name: 'G1' });
  one = ok(one, { type: 'setGroupStagger', groupId: 'g1', seconds: 1 });
  assert.deepEqual([...staggerDelays(one, 'g1')], [['x', 0]]);
});

test('chase offsets spread 0..1 over the group in order', () => {
  assert.deepEqual([...chaseOffsets(grouped(), 'g')].map(([id, o]) => [id, +o.toFixed(3)]), [['a', 0], ['b', .333], ['c', .667]]);
});

test('rotatePalette turns by steps, wrapping', () => {
  assert.deepEqual(rotatePalette(['a', 'b', 'c'], 1), ['b', 'c', 'a']);
  assert.deepEqual(rotatePalette(['a', 'b', 'c'], 4), ['b', 'c', 'a']);
  assert.deepEqual(rotatePalette(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
});

test('outlinePolygon gives at most 12 points inside 0..1, y up, for a 30-point curved outline; a rectangle keeps its four corners', () => {
  const circle: CurvePoint[] = Array.from({ length: 30 }, (_, i) => ({ x: .5 + .2 * Math.cos(i / 30 * Math.PI * 2), y: .5 + .2 * Math.sin(i / 30 * Math.PI * 2) }));
  const box = { x: .3, y: .3, w: .4, h: .4 };
  const poly = outlinePolygon(circle, box);
  assert.ok(poly.length <= 12 && poly.length >= 3, `${poly.length} points`);
  assert.ok(poly.every(p => p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9));
  const rect = outlinePolygon(sq(.2, .2, .6, .4), { x: .2, y: .2, w: .4, h: .2 });
  assert.equal(rect.length, 4);
  // y up: the shape's top edge (y .2 on the stage) is at 1.
  assert.ok(rect.some(p => Math.abs(p.x) < 1e-9 && Math.abs(p.y - 1) < 1e-9));
});

test('nextAutoScene: none with one scene; in order wraps; random never repeats', () => {
  let show = ok(grouped(), { type: 'addScene', sceneId: 's1', name: 'One' });
  assert.equal(nextAutoScene(show, 's1', Math.random), null);
  show = ok(ok(show, { type: 'addScene', sceneId: 's2', name: 'Two' }), { type: 'addScene', sceneId: 's3', name: 'Three' });
  show = ok(show, { type: 'setAutoAdvance', autoAdvance: { every: 10, unit: 'seconds', order: 'next' } });
  assert.equal(nextAutoScene(show, 's1', Math.random), 's2');
  assert.equal(nextAutoScene(show, 's3', Math.random), 's1');
  show = ok(show, { type: 'setAutoAdvance', autoAdvance: { every: 10, unit: 'seconds', order: 'random' } });
  for (const r of [0, .3, .6, .99]) assert.notEqual(nextAutoScene(show, 's2', () => r), 's2');
});

test('autoAdvanceDue counts seconds or bars', () => {
  assert.equal(autoAdvanceDue(null, 100, 100), false);
  assert.equal(autoAdvanceDue({ every: 10, unit: 'seconds', order: 'next' }, 9.9, 0), false);
  assert.equal(autoAdvanceDue({ every: 10, unit: 'seconds', order: 'next' }, 10, 0), true);
  assert.equal(autoAdvanceDue({ every: 4, unit: 'bars', order: 'next' }, 1000, 3.9), false);
  assert.equal(autoAdvanceDue({ every: 4, unit: 'bars', order: 'next' }, 0, 4), true);
});

test('varyEach gives every shape in the group its own copy, each varied differently, in one undo step; past 64 sources it is refused and nothing changes', () => {
  const show = grouped();
  let state = initialMapState(show);
  state = mapReducer(state, { type: 'edit', action: { type: 'varyEach', groupId: 'g', sourceIds: ['v1', 'v2', 'v3'], entropy: 7 } });
  assert.equal(state.past.length, 1);
  const ids = state.show.shapes.map(s => s.sourceId);
  assert.equal(new Set(ids).size, 3, 'each its own');
  const params = state.show.sources.map(s => JSON.stringify(s.project.layers[0].params));
  assert.equal(new Set(params).size, 3, 'each varied differently');
  // A scene keeps the shared effect, so it stays; 61 more effects make 62, and three copies would make 65.
  let full = ok(show, { type: 'addScene', sceneId: 'keep', name: 'Keep' });
  for (let i = 0; full.shapes.length < 64; i++) {
    full = ok(full, { type: 'addShape', id: `f${i}`, points: sq(.01 * (i % 50), .6, .01 * (i % 50) + .005, .62), colour: '#fff' });
    full = ok(full, { type: 'setContent', shapeId: `f${i}`, content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: `fs${i}`, seed: i, linked: false } });
  }
  assert.ok(full.sources.length + 3 > MAX_SOURCES);
  refused(full, { type: 'varyEach', groupId: 'g', sourceIds: ['v1', 'v2', 'v3'], entropy: 7 }, 'too-many-sources');
});

test('paletteShift gives each shape in order the palette one more step round', () => {
  const show = ok(grouped(), { type: 'paletteShift', groupId: 'g', sourceIds: ['p1', 'p2', 'p3'] });
  const palette = grouped().sources[0].project.layers[0].palette;
  const of = (id: string) => show.sources.find(s => s.id === show.shapes.find(x => x.id === id)!.sourceId)!.project.layers[0].palette;
  assert.deepEqual(of('a'), palette);
  assert.deepEqual(of('b'), rotatePalette(palette, 1));
  assert.deepEqual(of('c'), rotatePalette(palette, 2));
});

test('every setter keeps values in range, and refuses on a locked shape or group', () => {
  let show = grouped();
  show = ok(show, { type: 'setGroupStagger', groupId: 'g', seconds: 5 });
  assert.equal(show.groups[0].stagger, 1);
  show = ok(show, { type: 'setBorder', shapeId: 'a', border: { width: 4, colour: 'shape', glow: 0 } });
  show = ok(show, { type: 'setBorderRun', shapeId: 'a', run: { lapsPerMinute: 999, beats: 3, length: 2 } });
  assert.deepEqual(show.shapes[0].border.run, { lapsPerMinute: 120, beats: null, length: .5 });
  show = ok(show, { type: 'setAutoAdvance', autoAdvance: { every: 1, unit: 'seconds', order: 'next' } });
  assert.equal(show.autoAdvance!.every, 5);
  const locked = ok(show, { type: 'setGroupLocked', groupId: 'g', locked: true });
  refused(locked, { type: 'setGroupStagger', groupId: 'g', seconds: .2 }, 'locked');
  refused(locked, { type: 'varyEach', groupId: 'g', sourceIds: ['v1', 'v2', 'v3'], entropy: 1 }, 'locked');
});
