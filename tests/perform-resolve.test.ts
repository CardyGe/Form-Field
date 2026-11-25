// Perform: which shapes each zone owns, and the overlay a running show puts over the Map show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneShapes, overlayShow, linkedZones, type ZonePicture } from '../src/perform/resolve';
import type { Zone } from '../src/perform/types';
import { isShapeShown, type Group, type Shape } from '../src/map/show';

const shape = (id: string, over: Partial<Shape> = {}): Shape => ({
  id, name: id, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], colour: '#ff8800', visible: true, locked: false, sourceId: null,
  holes: [], groupId: null, blocker: false, softEdge: 0, border: { width: 4, colour: 'palette', glow: 1, run: { lapsPerMinute: 10, beats: null, length: 0.2 } }, fill: 'grid',
  placement: { kind: 'fit', zoom: 1, offset: { x: 0, y: 0 }, turn: 0, pin: null }, brightness: 1, tint: '#ffffff', ...over,
});
const group = (id: string): Group => ({ id, name: id, visible: true, locked: false });
const zone = (id: string, target: Zone['target']): Zone => ({ id, name: id, target, protected: false });
const pic = (shapeIds: string[], sourceId: string | null, launched = true): ZonePicture => ({ shapeIds, sourceId, launched });
const byId = (shapes: Shape[], id: string) => shapes.find(s => s.id === id)!;

test('a group target returns its members, a shape target returns itself', () => {
  const shapes = [shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c')];
  const out = zoneShapes([zone('z0', { kind: 'group', id: 'g' }), zone('z1', { kind: 'shape', id: 'c' }), zone('z2', null)], shapes);
  assert.deepEqual(out, [['a', 'b'], ['c'], []]);
});

test('a shape claimed twice goes to the first zone', () => {
  const shapes = [shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' })];
  const out = zoneShapes([zone('z0', { kind: 'shape', id: 'a' }), zone('z1', { kind: 'group', id: 'g' })], shapes);
  assert.deepEqual(out, [['a'], ['b']]);
});

test('a deleted target returns an empty list without throwing', () => {
  const out = zoneShapes([zone('z0', { kind: 'group', id: 'gone' }), zone('z1', { kind: 'shape', id: 'gone' })], [shape('a')]);
  assert.deepEqual(out, [[], []]);
});

test('a launched zone plays its source; unlaunched zones and unassigned shapes are hidden', () => {
  const show = { shapes: [shape('a'), shape('b'), shape('loose')], groups: [group('g')] };
  const out = overlayShow(show, [pic(['a'], 'inst-1'), pic(['b'], 'inst-2', false)]);
  assert.equal(byId(out.shapes, 'a').sourceId, 'inst-1');
  assert.equal(byId(out.shapes, 'a').visible, true);
  assert.equal(byId(out.shapes, 'b').visible, false);
  assert.equal(byId(out.shapes, 'loose').visible, false);
});

test('a launched zone with no source is visible and black, with no border', () => {
  const out = overlayShow({ shapes: [shape('a', { sourceId: 'old' })], groups: [] }, [pic(['a'], null)]);
  const a = out.shapes[0];
  assert.equal(a.visible, true); assert.equal(a.sourceId, null); assert.equal(a.colour, '#000000'); assert.equal(a.fill, 'colour');
  assert.equal(a.border.width, 0); assert.ok(!a.border.run);
});

test('a blocker stays visible and a blocker, in a zone or outside', () => {
  const show = { shapes: [shape('wall', { blocker: true }), shape('in', { blocker: true })], groups: [] };
  const out = overlayShow(show, [pic(['in'], 'inst-1', false)]);
  for (const s of out.shapes) { assert.equal(s.blocker, true); assert.equal(s.visible, true); }
});

test('overlayShow does not mutate its input', () => {
  const show = { shapes: [shape('a'), shape('loose')], groups: [group('g')] };
  const before = JSON.parse(JSON.stringify(show));
  const out = overlayShow(show, [pic(['a'], null)]);
  assert.deepEqual(show, before);
  assert.notEqual(out, show);
  assert.equal(show.shapes[0].border.width, 4);
});

test('a launched member of a hidden group is effectively visible; an unassigned one stays hidden', () => {
  const show = { shapes: [shape('a', { groupId: 'g' }), shape('loose', { groupId: 'g' })], groups: [{ ...group('g'), visible: false }] };
  const out = overlayShow(show, [pic(['a'], 'inst-1')]);
  assert.equal(isShapeShown(out, byId(out.shapes, 'a')), true);
  assert.equal(isShapeShown(out, byId(out.shapes, 'loose')), false);
});

test('a blocker keeps its Map visibility: hidden itself or by its group stays hidden, and the input is untouched', () => {
  const show = { shapes: [shape('b1', { blocker: true, groupId: 'g' }), shape('b2', { blocker: true, visible: false }), shape('b3', { blocker: true })], groups: [{ ...group('g'), visible: false }] };
  const before = JSON.parse(JSON.stringify(show));
  const out = overlayShow(show, []);
  assert.equal(isShapeShown(out, byId(out.shapes, 'b1')), false);
  assert.equal(isShapeShown(out, byId(out.shapes, 'b2')), false);
  assert.equal(isShapeShown(out, byId(out.shapes, 'b3')), true);
  assert.deepEqual(show, before);
});

test('linkedZones reports zones sharing a source', () => {
  const links = linkedZones([pic([], 'x'), pic([], 'x'), pic([], 'y'), pic([], null), pic([], null), pic([], 'z', false)]);
  assert.deepEqual([...links], [['x', [0, 1]]]);
});

test('a launched zone whose look cannot play falls back to black, never its Map colour or test grid', () => {
  const show = { shapes: [shape('grid', { fill: 'grid' }), shape('flat', { fill: 'colour', colour: '#ff8800' })], groups: [] };
  const out = overlayShow(show, [pic(['grid', 'flat'], 'inst-1')]);
  for (const s of out.shapes) {
    assert.equal(s.sourceId, 'inst-1');
    assert.equal(s.fill, 'colour', `${s.id} falls back to a flat fill`);
    assert.equal(s.colour, '#000000', `${s.id} falls back to black`);
  }
});

test('a launched zone keeps the border colour it had in Map', () => {
  const show = { shapes: [
    shape('own', { colour: '#ff8800', border: { width: 4, colour: 'shape', glow: 1, run: null } }),
    shape('video', { colour: '#ff8800', border: { width: 4, colour: 'palette', glow: 1, run: null } }),
    shape('look', { colour: '#ff8800', border: { width: 4, colour: 'palette', glow: 1, run: null } }),
    shape('fixed', { colour: '#ff8800', border: { width: 4, colour: '#00ff00', glow: 1, run: null } }),
  ], groups: [] };
  const out = overlayShow(show, [pic(['own'], 'inst-1'), pic(['video'], 'video-1'), pic(['look'], 'inst-2'), pic(['fixed'], 'inst-3')]);
  assert.equal(byId(out.shapes, 'own').border.colour, '#ff8800');
  // A video has no palette, so its palette border was always the shape's colour.
  assert.equal(byId(out.shapes, 'video').border.colour, '#ff8800');
  assert.equal(byId(out.shapes, 'look').border.colour, 'palette');
  assert.equal(byId(out.shapes, 'fixed').border.colour, '#00ff00');
});
