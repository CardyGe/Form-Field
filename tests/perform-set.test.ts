// Perform stage 1: the set saved in the show file (version 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceSet, validatePerformanceSet, clipSourceIds } from '../src/perform/set';
import { applyEdit, type EditAction } from '../src/map/editor';
import { createShow, validateShow, validateWireShow, LIVE_SOURCE_ID, type CurvePoint, type ShowDocument } from '../src/map/show';
import { toWire } from '../src/map/messages';
import { applyPreset, createLayer, createProject } from '../src/core/project';

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ok = (show: ShowDocument, action: EditAction): ShowDocument => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const composition = () => { const p = createProject(); p.layers = [applyPreset(createLayer('relief'), 'porcelain-shutters')]; return p; };
const source = (id: string) => ({ id, kind: 'instrument', project: composition(), speed: 1, revision: 0 });
const clip = (id: string, sourceId: string, over: Record<string, unknown> = {}) => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'bass', ...over });
const scene = (id: string, cells: unknown[], over: Record<string, unknown> = {}) => ({ id, name: id, cells, includeProtected: false, follow: null, ...over });
const emptyCells = () => Array.from({ length: 8 }, () => null);

test('a new set has 8 unassigned zones, the last protected and named Ceiling', () => {
  const s = createPerformanceSet();
  assert.equal(s.zones.length, 8); assert.equal(s.zones[7].name, 'Ceiling'); assert.equal(s.zones[7].protected, true);
  assert.ok(s.zones.every(z => z.target === null)); assert.equal(s.launchQuantize, '1bar');
  assert.equal(s.zones.filter(z => z.protected).length, 1);
});

test('a good set validates to itself, unrepaired', () => {
  const raw = { ...createPerformanceSet(), clips: [clip('c1', 'a', { hueOffset: 90, blend: { kind: 'dip', bars: 2 }, audioBand: 'high' })],
    scenes: [scene('s1', ['c1', ...emptyCells().slice(1)], { follow: { afterBars: 8, to: 's2' } }), scene('s2', emptyCells(), { follow: { afterBars: 4, to: 'random' } })], launchQuantize: '2bar' };
  const { set, repaired } = validatePerformanceSet(raw, new Set(['a']));
  assert.equal(repaired, false);
  assert.deepEqual(set, raw);
});

test('repair: too many scenes, a clip with a missing source, and wrong cell counts', () => {
  const raw = { ...createPerformanceSet(), scenes: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: 'x', cells: ['gone'], includeProtected: false, follow: null })),
    clips: [{ id: 'gone', name: 'x', sourceId: 'missing', hueOffset: 0, blend: null, audioBand: 'bass' }] };
  const { set, repaired } = validatePerformanceSet(raw, new Set());
  assert.equal(repaired, true); assert.equal(set.scenes.length, 16); assert.equal(set.clips.length, 0);
  assert.ok(set.scenes.every(s => s.cells.length === 8 && s.cells.every(c => c === null)));
});

test('hue wraps to 0-360, and a bad follow or blend becomes null', () => {
  const raw = { ...createPerformanceSet(),
    clips: [clip('c1', 'a', { hueOffset: -30, blend: { kind: 'wipe', bars: 1 } }), clip('c2', 'a', { hueOffset: 725 })],
    scenes: [scene('s1', emptyCells(), { follow: { afterBars: 5, to: 'next' } }), scene('s2', emptyCells(), { follow: { afterBars: 4, to: 'nowhere' } })] };
  const { set, repaired } = validatePerformanceSet(raw, new Set(['a']));
  assert.equal(repaired, true);
  assert.equal(set.clips[0].hueOffset, 330); assert.equal(set.clips[0].blend, null); assert.equal(set.clips[1].hueOffset, 5);
  assert.equal(set.scenes[0].follow, null); assert.equal(set.scenes[1].follow, null);
});

test('a clip may play an instrument, a video or Live', () => {
  const raw = { ...createPerformanceSet(), clips: [clip('c1', 'a'), clip('c2', 'video-b'), clip('c3', LIVE_SOURCE_ID)] };
  const { set, repaired } = validatePerformanceSet(raw, new Set(['a', 'video-b', LIVE_SOURCE_ID]));
  assert.equal(repaired, false); assert.equal(set.clips.length, 3);
  assert.deepEqual(clipSourceIds(set), ['a', 'video-b', LIVE_SOURCE_ID]);
});

test('a version 8 show opens with an empty set and becomes version 9', () => {
  const r = validateShow({ format: 'formshow', version: 8, stage: { width: 1920, height: 1080 }, shapes: [] });
  assert.equal(r.show.version, 9); assert.equal(r.repaired, false);
  assert.deepEqual(r.show.performance, createPerformanceSet());
  assert.deepEqual(createShow().performance, createPerformanceSet());
});

test('an instrument used only by a clip survives load, wire and an unrelated shape delete', () => {
  const raw = { format: 'formshow', version: 9, stage: { width: 1920, height: 1080 }, shapes: [{ id: 'sh', name: 'S', points: sq(.1, .1, .3, .3), colour: '#ff0000', visible: true, locked: false }],
    sources: [source('a')], performance: { ...createPerformanceSet(), clips: [clip('c1', 'a')] } };
  const loaded = validateShow(raw);
  assert.equal(loaded.repaired, false);
  assert.deepEqual(loaded.show.sources.map(s => s.id), ['a']);
  const wire = toWire(loaded.show);
  assert.deepEqual(wire.clipSourceIds, ['a']); assert.equal(wire.version, 9);
  assert.deepEqual(validateWireShow(JSON.parse(JSON.stringify(wire))).sources.map(s => s.id), ['a']);
  const after = ok(loaded.show, { type: 'delete', shapeId: 'sh' });
  assert.deepEqual(after.sources.map(s => s.id), ['a']);
});

test('a video used only by a clip survives an unrelated shape delete', () => {
  const raw = { format: 'formshow', version: 9, stage: { width: 1920, height: 1080 }, shapes: [{ id: 'sh', name: 'S', points: sq(.1, .1, .3, .3), colour: '#ff0000', visible: true, locked: false }],
    videos: [{ id: 'video-b', path: '/clips/b.mp4', name: 'b.mp4', speed: 1, tempoSync: null }], performance: { ...createPerformanceSet(), clips: [clip('c1', 'video-b')] } };
  const loaded = validateShow(raw);
  assert.deepEqual(loaded.show.videos.map(v => v.id), ['video-b']);
  assert.deepEqual(ok(loaded.show, { type: 'delete', shapeId: 'sh' }).videos.map(v => v.id), ['video-b']);
});

test('deleting the group a zone targets leaves the zone unassigned on next validation', () => {
  let show = ok(ok(createShow(), { type: 'addShape', id: 'a', points: sq(.1, .1, .3, .3), colour: '#ff0000' }), { type: 'group', shapeIds: ['a'], groupId: 'g1', name: 'G' });
  show = { ...show, performance: { ...show.performance, zones: show.performance.zones.map((z, i) => i === 0 ? { ...z, target: { kind: 'group', id: 'g1' } } : z) } };
  assert.deepEqual(validateShow(JSON.parse(JSON.stringify(show))).show.performance.zones[0].target, { kind: 'group', id: 'g1' });
  const gone = JSON.parse(JSON.stringify({ ...show, groups: [] }));
  const r = validateShow(gone);
  assert.equal(r.show.performance.zones[0].target, null);
  assert.equal(r.repaired, true);
});
