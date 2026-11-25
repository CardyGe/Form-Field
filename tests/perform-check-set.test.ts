// Perform stage 6: Check Set (read-only warnings) and Import Map scenes (a one-time copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSet } from '../src/perform/check-set';
import { importMapScenes } from '../src/perform/import-scenes';
import { createShow, LIVE_SOURCE_ID, MAX_SOURCES, type Shape, type ShowDocument } from '../src/map/show';
import { capture } from '../src/map/scenes';
import { applyPreset, createLayer, createProject } from '../src/core/project';
import type { Clip, Scene } from '../src/perform/types';

const shape = (id: string, over: Partial<Shape> = {}): Shape => ({
  id, name: id, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], colour: '#ff8800', visible: true, locked: false, sourceId: null,
  holes: [], groupId: null, blocker: false, softEdge: 20, border: { width: 0, colour: 'shape', glow: 0 }, fill: 'colour',
  placement: { kind: 'fit', zoom: 1, offset: { x: 0, y: 0 }, turn: 0, pin: null }, brightness: 1, tint: '#ffffff', ...over,
});
const source = (id: string, kind: 'relief' | 'texturecuts' | 'glitchtunnel' = 'relief') => {
  const project = createProject();
  project.layers = [kind === 'relief' ? applyPreset(createLayer('relief'), 'porcelain-shutters') : createLayer(kind)];
  return { id, kind: 'instrument' as const, project, speed: 1, revision: 0, tempoSync: null };
};
const clip = (id: string, sourceId: string): Clip => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'level' });
const cells = (over: Record<number, string>) => Array.from({ length: 8 }, (_, i) => over[i] ?? null);
const scene = (id: string, c: (string | null)[]): Scene => ({ id, name: id, cells: c, includeProtected: false, follow: null });

/** A show with zone 0 on shape a (a clip in it), zone 7 (the Ceiling) on shape sky. */
function room(): ShowDocument {
  const show = createShow();
  show.shapes = [shape('a'), ...[1, 2, 3, 4, 5, 6].map(i => shape(`r${i}`)), shape('sky')];
  show.sources = [source('s1'), source('s2')];
  show.performance.zones.forEach((z, i) => { z.target = { kind: 'shape', id: i === 0 ? 'a' : i === 7 ? 'sky' : `r${i}` }; });
  show.performance.clips = [clip('c1', 's1'), clip('c2', 's2')];
  show.performance.scenes = [scene('p1', Array.from({ length: 8 }, (_, i) => i === 7 ? 'c2' : 'c1'))];
  return show;
}
const STANDING = /does not analyse|not checked until|not been timed/;
const messages = (show: ShowDocument, stats?: Parameters<typeof checkSet>[1]) => checkSet(show, stats).filter(r => !STANDING.test(r.message));

test('a tidy set raises nothing but the standing reminder about flashing inside looks', () => {
  const all = checkSet(room(), { midiInputs: [], prepareMs: { c1: 100, c2: 100 } });
  assert.deepEqual(messages(room()), []);
  assert.equal(all.length, 1);
  assert.match(all[0].message, /by eye/);
  assert.match(all[0].message, /audio/i);
  assert.equal(all[0].level, 'warning'); assert.equal(all[0].zone, null);
});

test('a zone with no target is reported by name, as an error when scenes play clips there', () => {
  const show = room();
  show.performance.zones[0].target = null; show.performance.zones[0].name = 'Left speaker';
  const r = messages(show).find(x => x.zone === 0 && /no place/.test(x.message));
  assert.ok(r); assert.equal(r.level, 'error'); assert.match(r.message, /Left speaker/);
  show.performance.zones[3].target = null; show.performance.scenes[0].cells[3] = null;
  const empty = messages(show).filter(x => x.zone === 3 && /no place/.test(x.message));
  assert.equal(empty.length, 1); assert.equal(empty[0].level, 'warning');
});

test('a zone with a place but no clips is reported', () => {
  const show = room();
  show.performance.zones[2].name = 'Sofa'; show.performance.scenes[0].cells[2] = null;
  const r = messages(show).filter(x => x.zone === 2);
  assert.equal(r.length, 1); assert.match(r[0].message, /Sofa/); assert.match(r[0].message, /no clips/);
});

test('a visible shape outside every zone is named, a hidden shape and a blocker are not', () => {
  const show = room();
  show.shapes.push(shape('Table', { name: 'Table' }), shape('Hidden', { visible: false }), shape('Wall', { blocker: true }));
  const r = messages(show).filter(x => /stays black/.test(x.message));
  assert.equal(r.length, 1); assert.match(r[0].message, /Table/); assert.equal(r[0].zone, null);
});

test('a malformed scene naming more than 8 looks is an error (guards hand-edited sets)', () => {
  const show = room();
  show.sources = Array.from({ length: 9 }, (_, i) => source(`m${i}`));
  show.performance.clips = show.sources.map(s => clip(`k-${s.id}`, s.id));
  show.performance.scenes = [scene('big', show.performance.clips.map(c => c.id))];
  const r = messages(show).find(x => /9 looks/.test(x.message));
  assert.ok(r); assert.equal(r.level, 'error'); assert.match(r.message, /big/);
  assert.equal(messages(room()).some(x => /looks at once/.test(x.message)), false);
});

test('a clip that takes longer than two bars to get ready is flagged, as the red dot is, with the bar set by the tempo', () => {
  const show = room();
  const r = messages(show, { prepareMs: { c1: 4500, c2: 100 } });
  assert.equal(r.filter(x => /too long to get ready/.test(x.message)).length, 1);
  const hit = r.find(x => /too long to get ready/.test(x.message))!;
  assert.equal(hit.zone, 0); assert.match(hit.message, /c1/);
  assert.match(hit.message, /more than two bars/);
  assert.equal(messages(show, { prepareMs: { c1: 4500 }, bpm: 60 }).some(x => /too long/.test(x.message)), false);
  // Two bars: 3750 ms at the default 128 BPM, 4000 ms at 120.
  assert.equal(messages(show, { prepareMs: { c1: 3800 } }).some(x => /too long/.test(x.message)), true);
  assert.equal(messages(show, { prepareMs: { c1: 3700 } }).some(x => /too long/.test(x.message)), false);
  assert.equal(messages(show, { prepareMs: { c1: 3800 }, bpm: 120 }).some(x => /too long/.test(x.message)), false);
  assert.equal(messages(show, { prepareMs: { c1: 4100 }, bpm: 120 }).some(x => /too long/.test(x.message)), true);
});

test('a ceiling clip using Texture Cuts or Feedback Glitch is a warning naming the zone', () => {
  for (const kind of ['texturecuts', 'glitchtunnel'] as const) {
    const show = room();
    show.sources[1] = source('s2', kind);
    const r = messages(show).filter(x => x.zone === 7 && /fine detail|shimmer/.test(x.message));
    assert.equal(r.length, 1, kind); assert.equal(r[0].level, 'warning'); assert.match(r[0].message, /Ceiling/);
  }
  const quiet = room();
  quiet.sources[0] = source('s1', 'texturecuts'); // a room zone, not the ceiling
  assert.equal(messages(quiet).some(x => /shimmer/.test(x.message)), false);
});

test('any clip with a known fast-flashing kind gets a flicker warning', () => {
  const show = room();
  show.sources[0] = source('s1', 'texturecuts');
  const r = messages(show).filter(x => x.zone === 0 && /flash/.test(x.message));
  assert.equal(r.length, 1); assert.equal(r[0].level, 'warning');
});

test('a ceiling shape with a hard edge is named', () => {
  const show = room();
  show.shapes[show.shapes.length - 1] = shape('sky', { name: 'Tulle', softEdge: 0 });
  const r = messages(show).filter(x => x.zone === 7 && /soft edge/.test(x.message));
  assert.equal(r.length, 1); assert.match(r[0].message, /Tulle/); assert.equal(r[0].level, 'warning');
  assert.equal(messages(room()).some(x => /soft edge/.test(x.message)), false);
});

test('a link or trigger using a MIDImix control is flagged, and no midiInputs skips the check', () => {
  const show = room();
  show.links = [{ id: 'l', input: 'midi.cc.1.19', target: 'x', mode: 'modulate', amount: 1, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: 'Glow' }];
  show.triggers = [{ id: 't', input: 'midi.note.1.1', when: 'on', every: 1, action: { kind: 'tap' }, on: true }];
  assert.equal(messages(show).filter(x => /MIDImix/.test(x.message)).length, 0);
  const r = messages(show, { midiInputs: ['midi.cc.1.19', 'midi.note.1.1', 'midi.cc.1.20'] }).filter(x => /MIDImix/.test(x.message));
  assert.equal(r.length, 2); assert.match(r[0].message, /Glow/);
  assert.equal(messages(show, { midiInputs: [] }).length, 0);
});

test('checkSet never changes the show', () => {
  const show = room(); show.links = []; show.shapes.push(shape('x'));
  const before = structuredClone(show);
  checkSet(show, { prepareMs: { c1: 99999 }, midiInputs: ['midi.cc.1.1'] });
  assert.deepEqual(show, before);
});

// ---- Import ----

function mapShow(sceneCount = 2): ShowDocument {
  const show = createShow();
  show.shapes = [shape('a', { name: 'Left', groupId: 'g' }), shape('a2', { groupId: 'g' }), shape('b', { name: 'Sofa' }), shape('sky')];
  show.groups = [{ id: 'g', name: 'Speakers', visible: true, locked: false }];
  show.sources = [source('s1'), source('s2')];
  show.performance.zones[0].target = { kind: 'group', id: 'g' };
  show.performance.zones[1].target = { kind: 'shape', id: 'b' };
  show.performance.zones[7].target = { kind: 'shape', id: 'sky' };
  show.scenes = Array.from({ length: sceneCount }, (_, i) => ({ id: `m${i}`, name: `Map ${i}`, fadeSeconds: null,
    shapes: capture(show.shapes.map(s => s.id === 'a' ? { ...s, sourceId: i % 2 ? 's2' : 's1' } : s.id === 'b' ? { ...s, sourceId: 's2' } : s.id === 'sky' && i === 0 ? { ...s, sourceId: 's1' } : s)) }));
  return show;
}
const counter = () => { let n = 0; return () => `id${++n}`; };

test('import makes one row per Map scene from each zone\'s first shape, reusing sources', () => {
  const show = mapShow();
  const out = importMapScenes(show, counter());
  assert.equal(out.scenes.length, 2);
  assert.equal(out.scenes[0].name, 'Map 0');
  const clipOf = (row: number, zone: number) => out.clips.find(c => c.id === out.scenes[row].cells[zone])?.sourceId ?? null;
  assert.equal(clipOf(0, 0), 's1'); assert.equal(clipOf(1, 0), 's2');
  assert.equal(clipOf(0, 1), 's2'); assert.equal(clipOf(1, 1), 's2');
  assert.equal(out.scenes[0].cells[1], out.scenes[1].cells[1], 'the same look shares one clip');
  assert.equal(clipOf(0, 7), 's1'); assert.equal(clipOf(1, 7), null);
  assert.equal(out.scenes[0].includeProtected, false, 'a ceiling clip is kept in the cell, but the scene leaves the ceiling alone until switched on');
  assert.equal(out.scenes[1].includeProtected, false);
  assert.equal(out.scenes[0].cells[7] !== null, true);
  assert.equal(clipOf(0, 3), null);
  assert.ok(out.clips.every(c => show.sources.some(s => s.id === c.sourceId)));
  assert.equal(new Set(out.clips.map(c => c.id)).size, out.clips.length);
});

test('import leaves Map and the source count alone, and stops at 16 rows', () => {
  const show = mapShow(20);
  const before = structuredClone(show);
  const out = importMapScenes(show, counter());
  assert.deepEqual(show, before);
  assert.equal(out.scenes.length, 16);
  assert.deepEqual(out.scenes.map(s => s.id).length, new Set(out.scenes.map(s => s.id)).size);
});

test('import adds after existing rows without touching them, up to the limit', () => {
  const show = mapShow(5);
  show.performance.clips = [clip('keep', 's1')];
  show.performance.scenes = Array.from({ length: 14 }, (_, i) => scene(`old${i}`, cells(i === 0 ? { 0: 'keep' } : {})));
  const before = structuredClone(show.performance.scenes);
  const out = importMapScenes(show, counter());
  assert.equal(out.scenes.length, 16);
  assert.deepEqual(out.scenes.slice(0, 14), before);
  assert.ok(out.clips.some(c => c.id === 'keep'));
});

test('import skips plain colours, keeps Live and videos, and reads the live scene from the shapes on screen', () => {
  const show = mapShow(1);
  show.videos = [{ id: 'video-1', path: '/x.mp4', name: 'Loop', speed: 1, tempoSync: null }];
  show.sceneId = 'm0';
  show.shapes = show.shapes.map(s => s.id === 'b' ? { ...s, sourceId: LIVE_SOURCE_ID } : s.id === 'sky' ? { ...s, sourceId: 'video-1' } : s);
  const out = importMapScenes(show, counter());
  const src = (zone: number) => out.clips.find(c => c.id === out.scenes[0].cells[zone])?.sourceId;
  assert.equal(src(1), LIVE_SOURCE_ID); assert.equal(src(7), 'video-1');
});

test('import never goes past the source limit: it adds no sources at all', () => {
  const show = mapShow();
  show.sources = Array.from({ length: MAX_SOURCES }, (_, i) => source(i === 0 ? 's1' : i === 1 ? 's2' : `x${i}`));
  const out = importMapScenes(show, counter());
  assert.ok(out.clips.length <= MAX_SOURCES);
  assert.ok(out.clips.every(c => show.sources.some(s => s.id === c.sourceId)));
});

test('import with no zone placed changes nothing', () => {
  const show = mapShow();
  show.performance.zones.forEach(z => { z.target = null; });
  const out = importMapScenes(show, counter());
  assert.deepEqual(out, show.performance);
});

test('import does not reuse a clip tuned with a hue, blend or band: it makes a default clip on the same source', () => {
  const show = mapShow();
  show.performance.clips = [{ ...clip('tuned', 's2'), hueOffset: 90 }, { ...clip('blended', 's1'), blend: { kind: 'fade', bars: 2 } }, { ...clip('banded', 's9'), audioBand: 'bass' }];
  const out = importMapScenes(show, counter());
  const used = out.scenes.flatMap(sc => sc.cells).filter((c): c is string => c !== null);
  assert.ok(!used.includes('tuned') && !used.includes('blended'));
  for (const id of used) { const c = out.clips.find(x => x.id === id)!; assert.equal(c.hueOffset, 0); assert.equal(c.blend, null); assert.equal(c.audioBand, 'level'); }
  assert.deepEqual(out.clips.slice(0, 3), show.performance.clips, 'existing clips are untouched');
  assert.ok(out.clips.every(c => c.sourceId === 's9' || show.sources.some(s => s.id === c.sourceId)));
});

test('import reuses an existing clip that has default settings', () => {
  const show = mapShow();
  show.performance.clips = [{ ...clip('plain', 's2'), audioBand: 'level' }];
  const out = importMapScenes(show, counter());
  assert.ok(out.scenes.flatMap(sc => sc.cells).includes('plain'));
  assert.equal(out.clips.filter(c => c.sourceId === 's2').length, 1);
});

test('without midiInputs Check Set says MIDI clashes are not checked yet; with them it does not', () => {
  const show = room();
  const none = checkSet(show).filter(r => /not checked until the MIDImix is set up/.test(r.message));
  assert.equal(none.length, 1); assert.equal(none[0].zone, null);
  assert.equal(checkSet(show, { midiInputs: [] }).some(r => /not checked until/.test(r.message)), false);
});

test('Check Set says how many looks have not been timed', () => {
  const show = room();
  assert.equal(checkSet(show).filter(r => /2 looks have not been timed/.test(r.message) && /rehearsal/.test(r.message)).length, 1);
  assert.equal(checkSet(show, { prepareMs: { c1: 100 } }).filter(r => /1 look has not been timed/.test(r.message)).length, 1);
  assert.equal(checkSet(show, { prepareMs: { c1: 100, c2: 100 } }).some(r => /not been timed/.test(r.message)), false);
});
