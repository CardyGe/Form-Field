import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShow, validateShow, validateWireShow, isShapeLocked, isShapeShown, MAX_SHAPES, MAX_POINTS, MAX_NAME_LENGTH, MAX_ID_LENGTH, MAX_GROUPS } from '../src/map/show';

const tri = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }];
const shape = (over: Record<string, unknown> = {}) => ({ id: 'a', name: 'A', points: tri, colour: '#ff0000', visible: true, locked: false, ...over });
const doc = (shapes: unknown[], over: Record<string, unknown> = {}) => ({ format: 'formshow', version: 1, stage: { width: 1920, height: 1080 }, shapes, ...over });

test('createShow is empty, 1920x1080, and validates to itself', () => {
  const s = createShow();
  assert.deepEqual(s.stage, { width: 1920, height: 1080 });
  assert.equal(s.shapes.length, 0);
  const r = validateShow(s);
  assert.deepEqual(r.show, s);
  assert.equal(r.repaired, false);
});

test('non-document values give an empty repaired show', () => {
  for (const v of [null, 'x', []]) {
    const r = validateShow(v);
    assert.deepEqual(r.show, createShow());
    assert.equal(r.repaired, true);
  }
});

test('bad colour becomes #ffffff, other fields kept', () => {
  const r = validateShow(doc([shape({ colour: 'red', name: 'Keep', locked: true })]));
  assert.equal(r.show.shapes[0].colour, '#ffffff');
  assert.equal(r.show.shapes[0].name, 'Keep');
  assert.equal(r.show.shapes[0].locked, true);
  assert.equal(r.repaired, true);
});

test('out-of-range point is clamped; NaN drops the shape', () => {
  const r = validateShow(doc([shape({ points: [{ x: 1.5, y: 0.2 }, tri[1], tri[2]] }), shape({ id: 'b', points: [{ x: NaN, y: 0 }, tri[1], tri[2]] })]));
  assert.equal(r.show.shapes.length, 1);
  assert.equal(r.show.shapes[0].points[0].x, 1);
  assert.equal(r.repaired, true);
});

test('limits: 64 shapes, 32 points', () => {
  const many = Array.from({ length: 70 }, (_, i) => shape({ id: `s${i}` }));
  assert.equal(validateShow(doc(many)).show.shapes.length, MAX_SHAPES);
  const ring = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos(i / n * 2 * Math.PI), y: 0.5 + 0.3 * Math.sin(i / n * 2 * Math.PI) }));
  // A 32-corner ring is kept whole.
  assert.equal(validateShow(doc([shape({ points: ring(MAX_POINTS) })])).show.shapes[0].points.length, MAX_POINTS);
  // A 40-corner ring is left out, not cut to 32 corners: cutting would silently change its outline.
  const over = validateShow(doc([shape({ points: ring(40) })]));
  assert.equal(over.show.shapes.length, 0);
  assert.equal(over.repaired, true);
});

test('long names are shortened and long ids replaced, so a show always fits on the wall', () => {
  const r = validateShow(doc([shape({ name: 'n'.repeat(500), id: 'i'.repeat(500) })]));
  assert.equal(r.show.shapes[0].name.length, MAX_NAME_LENGTH);
  assert.ok(r.show.shapes[0].id.length <= MAX_ID_LENGTH);
  assert.notEqual(r.show.shapes[0].id, 'i'.repeat(500));
  assert.equal(r.repaired, true);
  // A name at the limit is kept as it is.
  const ok = validateShow(doc([shape({ name: 'n'.repeat(MAX_NAME_LENGTH) })]));
  assert.equal(ok.show.shapes[0].name, 'n'.repeat(MAX_NAME_LENGTH));
  assert.equal(ok.repaired, false);
});

test('unknown version still loads valid shapes', () => {
  const r = validateShow(doc([shape()], { version: 9 }));
  assert.equal(r.show.version, 4);
  assert.equal(r.show.shapes.length, 1);
});

test('duplicate ids: the later shape gets a fresh id', () => {
  const r = validateShow(doc([shape(), shape({ name: 'B' })]));
  assert.equal(r.show.shapes.length, 2);
  assert.equal(r.show.shapes[0].id, 'a');
  assert.notEqual(r.show.shapes[1].id, 'a');
  assert.equal(r.repaired, true);
});

test('shapes with fewer than three points are dropped', () => {
  const r = validateShow(doc([shape({ id: 'e', points: [] }), shape({ id: 'two', points: tri.slice(0, 2) }), shape()]));
  assert.equal(r.show.shapes.length, 1);
  assert.equal(r.show.shapes[0].id, 'a');
  assert.equal(r.repaired, true);
});

test('a loaded shape whose outline crosses itself is dropped and the show is marked repaired', () => {
  const bowtie = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.9 }];
  const r = validateShow(doc([shape({ id: 'bad', points: bowtie }), shape({ id: 'good' })]));
  assert.deepEqual(r.show.shapes.map(s => s.id), ['good']);
  assert.equal(r.repaired, true);
});

test('a loaded shape with no area is dropped; valid shapes load unrepaired', () => {
  const flat = [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.6, y: 0.5 }];
  assert.deepEqual(validateShow(doc([shape({ id: 'flat', points: flat })])).show.shapes, []);
  const ok = validateShow(doc([shape({ id: 'a' }), shape({ id: 'b' })]));
  assert.deepEqual(ok.show.shapes.map(s => s.id), ['a', 'b']);
  assert.equal(ok.repaired, false);
});

// Version 2: instrument sources.
import { MAX_SOURCES, SPEED_RANGE } from '../src/map/show';
import { applyPreset, createLayer, createProject } from '../src/core/project';

const composition = () => { const p = createProject(); p.layers = [applyPreset(createLayer('relief'), 'porcelain-shutters')]; return p; };
const source = (over: Record<string, unknown> = {}) => ({ id: 'src-a', kind: 'instrument', project: composition(), speed: 1, revision: 0, ...over });
const doc2 = (shapes: unknown[], sources: unknown[], over: Record<string, unknown> = {}) => ({ format: 'formshow', version: 2, stage: { width: 1920, height: 1080 }, shapes, sources, ...over });

test('a version 1 file opens as an all-colour show without being called repaired', () => {
  const r = validateShow(doc([shape()]));
  assert.equal(r.show.version, 4);
  assert.equal(r.show.shapes[0].sourceId, null);
  assert.deepEqual(r.show.sources, []);
  assert.equal(r.repaired, false);
});

test('a version 2 show with an instrument source round-trips', () => {
  const input = doc2([shape({ sourceId: 'src-a' })], [source({ speed: 1.5, revision: 3 })]);
  const r = validateShow(input);
  assert.equal(r.repaired, false);
  assert.equal(r.show.shapes[0].sourceId, 'src-a');
  assert.equal(r.show.sources.length, 1);
  assert.equal(r.show.sources[0].speed, 1.5);
  assert.equal(r.show.sources[0].revision, 3);
  assert.equal(r.show.sources[0].project.layers[0].kind, 'relief');
  assert.deepEqual(validateShow(JSON.parse(JSON.stringify(r.show))).show, r.show);
});

test('a source whose composition cannot be read is dropped, and its shape plays its colour', () => {
  const r = validateShow(doc2([shape({ sourceId: 'src-a' })], [source({ project: { layers: 'nonsense' } })]));
  assert.equal(r.show.sources.length, 0);
  assert.equal(r.show.shapes[0].sourceId, null);
  assert.equal(r.repaired, true);
});

test('a shape naming a missing source plays its colour; a source no shape uses is dropped', () => {
  const missing = validateShow(doc2([shape({ sourceId: 'gone' })], []));
  assert.equal(missing.show.shapes[0].sourceId, null);
  assert.equal(missing.repaired, true);
  const orphan = validateShow(doc2([shape()], [source()]));
  assert.equal(orphan.show.sources.length, 0);
  assert.equal(orphan.repaired, true);
});

test('source speed is clamped, revision repaired, and at most 64 sources kept', () => {
  const r = validateShow(doc2([shape({ sourceId: 'src-a' })], [source({ speed: 99, revision: -2 })]));
  assert.equal(r.show.sources[0].speed, SPEED_RANGE.max);
  assert.equal(r.show.sources[0].revision, 0);
  assert.equal(r.repaired, true);
  const many = Array.from({ length: 70 }, (_, i) => source({ id: `s${i}` }));
  const shapes = Array.from({ length: 64 }, (_, i) => shape({ id: `sh${i}`, sourceId: `s${i}` }));
  assert.ok(validateShow(doc2(shapes, many)).show.sources.length <= MAX_SOURCES);
});

test('a composition with more than four layers is not a valid source', () => {
  const big = composition(); big.layers = [0, 1, 2, 3, 4].map(i => ({ ...big.layers[0], id: `l${i}` }));
  const r = validateShow(doc2([shape({ sourceId: 'src-a' })], [source({ project: big })]));
  assert.equal(r.show.sources.length, 0);
  assert.equal(r.show.shapes[0].sourceId, null);
});

// ---- Version 3: curves, holes, groups, edges, blockers and the photo ----

const sq = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const doc3 = (shapes: unknown[], over: Record<string, unknown> = {}) => ({ format: 'formshow', version: 3, stage: { width: 1920, height: 1080 }, shapes, sources: [], groups: [], photo: null, ...over });
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

test('version 1 and 2 shapes open with every new field at its default, unrepaired', () => {
  for (const input of [doc([shape()]), doc2([shape({ sourceId: 'src-a' })], [source()])]) {
    const r = validateShow(input);
    assert.equal(r.repaired, false);
    const s = r.show.shapes[0];
    assert.deepEqual(s.holes, []);
    assert.equal(s.groupId, null);
    assert.equal(s.blocker, false);
    assert.equal(s.softEdge, 0);
    assert.deepEqual(s.border, { width: 0, colour: 'shape', glow: 0 });
    assert.deepEqual(r.show.groups, []);
    assert.equal(r.show.photo, null);
  }
});

test('a version 3 show with curves, a hole, a group, edges and a photo round-trips unrepaired', () => {
  const points = sq(.1, .1, .9, .9).map((p, i) => i === 0 ? { ...p, out: { x: .05, y: -.05 } } : p);
  const input = doc3([
    shape({ id: 'a', points, holes: [sq(.3, .3, .5, .5)], groupId: 'g', softEdge: 40, border: { width: 6, colour: '#00ff00', glow: 10 } }),
    shape({ id: 'b', points: tri, groupId: 'g', blocker: true, border: { width: 2, colour: 'palette', glow: 0 } }),
  ], { groups: [{ id: 'g', name: 'Front wall', visible: true, locked: false }], photo: { data: JPEG, opacity: .4 } });
  const r = validateShow(input);
  assert.equal(r.repaired, false);
  assert.deepEqual(r.show.shapes[0].points[0].out, { x: .05, y: -.05 });
  assert.equal(r.show.shapes[0].holes.length, 1);
  assert.equal(r.show.shapes[1].blocker, true);
  assert.deepEqual(r.show.photo, { data: JPEG, opacity: .4 });
  assert.deepEqual(validateShow(JSON.parse(JSON.stringify(r.show))).show, r.show);
});

test('a bad handle makes its point a corner; a hole that does not fit is dropped and the shape kept', () => {
  const points = sq(.1, .1, .9, .9).map((p, i) => i === 1 ? { ...p, in: { x: 'left', y: 0 } } : p);
  const r = validateShow(doc3([shape({ points, holes: [sq(.3, .3, .5, .5), sq(.05, .4, .2, .6), sq(.6, .6, .7, .7)] })]));
  assert.equal(r.repaired, true);
  assert.deepEqual(r.show.shapes[0].points[1], { x: .9, y: .1 });
  assert.equal(r.show.shapes[0].holes.length, 2);
  // Handles longer than the stage are cut to it.
  const long = validateShow(doc3([shape({ points: sq(.1, .1, .9, .9).map((p, i) => i === 0 ? { ...p, out: { x: 0, y: -3 } } : p) })]));
  assert.deepEqual(long.show.shapes[0].points[0].out, { x: 0, y: -1 });
});

test('edges and borders are clamped; a blocker plays nothing', () => {
  const r = validateShow(doc2([shape({ sourceId: 'src-a', blocker: true, softEdge: 900, border: { width: -3, colour: 'blue', glow: 99 } })], [source()]));
  const s = r.show.shapes[0];
  assert.equal(s.sourceId, null);
  assert.equal(s.softEdge, 200);
  assert.deepEqual(s.border, { width: 0, colour: 'shape', glow: 40 });
  assert.deepEqual(r.show.sources, []);
  assert.equal(r.repaired, true);
});

test('groups: unknown groups are cleared, members are brought together, empty groups dropped, at most 32', () => {
  const groups = [{ id: 'g', name: 'G', visible: true, locked: false }, { id: 'empty', name: 'E', visible: true, locked: false }];
  const r = validateShow(doc3([shape({ id: 'a', groupId: 'g' }), shape({ id: 'b' }), shape({ id: 'c', groupId: 'g' }), shape({ id: 'd', groupId: 'nope' })], { groups }));
  assert.deepEqual(r.show.shapes.map(s => s.id), ['a', 'c', 'b', 'd']);
  assert.equal(r.show.shapes[3].groupId, null);
  assert.deepEqual(r.show.groups.map(g => g.id), ['g']);
  assert.equal(r.repaired, true);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, visible: true, locked: false }));
  const members = many.map((g, i) => shape({ id: `s${i}`, groupId: g.id }));
  assert.equal(validateShow(doc3(members, { groups: many })).show.groups.length, MAX_GROUPS);
});

test('a photo that is not a JPEG or PNG picture is dropped; opacity is clamped', () => {
  assert.equal(validateShow(doc3([], { photo: { data: 'https://example.com/x.jpg', opacity: .5 } })).show.photo, null);
  assert.equal(validateShow(doc3([], { photo: { data: JPEG, opacity: 4 } })).show.photo?.opacity, 1);
});

test('a hidden or locked group hides or locks its members; their own settings are kept', () => {
  const show = validateShow(doc3([shape({ id: 'a', groupId: 'g' }), shape({ id: 'b' })], { groups: [{ id: 'g', name: 'G', visible: false, locked: true }] })).show;
  assert.equal(isShapeShown(show, show.shapes[0]), false);
  assert.equal(isShapeLocked(show, show.shapes[0]), true);
  assert.equal(show.shapes[0].visible, true);
  assert.equal(isShapeShown(show, show.shapes[1]), true);
});

test('the wall reads the same shape fields and groups, and never a photo', () => {
  const wire = validateWireShow(doc3([shape({ id: 'a', groupId: 'g', holes: [sq(.4, .3, .5, .4)], softEdge: 20 })],
    { groups: [{ id: 'g', name: 'G', visible: false, locked: false }], photo: { data: JPEG, opacity: 1 } }));
  assert.equal(wire.shapes[0].holes.length, 1);
  assert.equal(wire.shapes[0].softEdge, 20);
  assert.equal(wire.groups[0].visible, false);
  assert.equal('photo' in wire, false);
});

// ---- Version 4: placement, look and stage corners ----
import { DEFAULT_PLACEMENT } from '../src/map/show';
const doc4 = (shapes: unknown[], over: Record<string, unknown> = {}) => ({ format: 'formshow', version: 4, stage: { width: 1920, height: 1080 }, shapes, sources: [], groups: [], photo: null, stageCorners: null, ...over });

test('version 1 to 3 shapes open with Fit, full brightness, no tint and no stage corners, unrepaired', () => {
  for (const input of [doc([shape()]), doc3([shape()])]) {
    const r = validateShow(input);
    assert.equal(r.repaired, false);
    assert.equal(r.show.version, 4);
    assert.deepEqual(r.show.shapes[0].placement, DEFAULT_PLACEMENT);
    assert.equal(r.show.shapes[0].brightness, 1);
    assert.equal(r.show.shapes[0].tint, '#ffffff');
    assert.equal(r.show.stageCorners, null);
  }
});

test('a version 4 show with placement, look and stage corners round-trips unrepaired', () => {
  const corners = [{ x: .01, y: .02 }, { x: .99, y: 0 }, { x: 1, y: .98 }, { x: 0, y: 1 }];
  const placement = { kind: 'pin', zoom: 1.5, offset: { x: .1, y: -.05 }, turn: 30, pin: [{ x: .2, y: .2 }, { x: .5, y: .25 }, { x: .5, y: .6 }, { x: .2, y: .55 }] };
  const r = validateShow(doc4([shape({ placement, brightness: .5, tint: '#ffe0c0' })], { stageCorners: corners }));
  assert.equal(r.repaired, false);
  assert.deepEqual(r.show.shapes[0].placement, placement);
  assert.equal(r.show.shapes[0].brightness, .5);
  assert.deepEqual(r.show.stageCorners, corners);
  assert.deepEqual(validateShow(JSON.parse(JSON.stringify(r.show))).show, r.show);
});

test('placement values are clamped; a folded pin or folded stage corners are dropped', () => {
  const r = validateShow(doc4([shape({ placement: { kind: 'sideways', zoom: 99, offset: { x: 5, y: 0 }, turn: 400,
    pin: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: .5, y: 0 }, { x: 0, y: .5 }] }, brightness: 9, tint: 'red' })],
    { stageCorners: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }));
  const p = r.show.shapes[0].placement;
  assert.deepEqual([p.kind, p.zoom, p.offset, p.turn, p.pin], ['fit', 4, { x: 1, y: 0 }, 180, null]);
  assert.equal(r.show.shapes[0].brightness, 2);
  assert.equal(r.show.shapes[0].tint, '#ffffff');
  assert.equal(r.show.stageCorners, null);
  assert.equal(r.repaired, true);
});
