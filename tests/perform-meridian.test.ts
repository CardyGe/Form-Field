// Meridian (from main) and Perform together: shows saved by either branch open, and the wall hears what both need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceSet } from '../src/perform/set';
import { createShow, validateShow, validateWireShow, type CurvePoint } from '../src/map/show';
import { toWire, wallInputs } from '../src/map/messages';
import { applyPreset, createLayer, createProject } from '../src/core/project';
import { isPerformMessage, PERFORM_WALL_MESSAGES } from '../src/perform/wall-perform';
import { applyMapMessage, initialWall } from '../src/map/wall';

test("Meridian's performanceReset and installation messages are not Perform's, so the wall passes them on to Meridian", () => {
  assert.equal(isPerformMessage('performanceReset'), false);
  assert.equal(isPerformMessage('installation'), false);
  for (const kind of ['performStart', 'performEnd', 'performArm', 'performLaunch', 'performCancel', 'performValues']) assert.ok(isPerformMessage(kind), kind);
  assert.equal(PERFORM_WALL_MESSAGES.size, 6);
  // Neither touches the wall's Perform state, during a show or not.
  const wall = initialWall();
  assert.equal(applyMapMessage(wall, { type: 'performanceReset' }), wall);
  assert.equal(applyMapMessage(wall, { type: 'installation', autopilot: true, everyBeats: 32 }), wall);
});

const sq = (x0: number, y0: number, x1: number, y1: number): CurvePoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const meridianProject = (flashGuard = 1) => { const p = createProject(); const l = createLayer('meridian'); l.params.safetyFlashGuard = flashGuard; p.layers = [l]; return p; };
const reliefProject = () => { const p = createProject(); p.layers = [applyPreset(createLayer('relief'), 'porcelain-shutters')]; return p; };
const source = (id: string, project = reliefProject()) => ({ id, kind: 'instrument', project, speed: 1, revision: 0 });
const shape = (id: string, sourceId: string | null) => ({ id, name: id, points: sq(.1, .1, .3, .3), colour: '#ff0000', visible: true, locked: false, sourceId });
const clip = (id: string, sourceId: string) => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'bass' });
// Round trip through a file, as the app writes it.
const asFile = (value: unknown) => JSON.parse(JSON.stringify(value));

test('a show saved by main (version 8) with a Meridian source opens as version 9 with every Meridian setting and an empty set', () => {
  const project = meridianProject();
  const raw = asFile({ format: 'formshow', version: 8, stage: { width: 1920, height: 1080 }, shapes: [shape('sh', 'm')], sources: [source('m', project)] });
  const { show, repaired } = validateShow(raw);
  assert.equal(repaired, false);
  assert.equal(show.version, 9);
  assert.deepEqual(show.performance, createPerformanceSet());
  const layer = show.sources[0].project.layers[0];
  assert.equal(layer.kind, 'meridian');
  assert.deepEqual(layer.params, asFile(project.layers[0]).params);
  // The wall is told to limit before the compositions arrive, as on main.
  assert.equal(toWire(show).guardWall, true);
});

test('a version 9 Perform show whose only Meridian source plays in a clip keeps it, and the wall is guarded and hears the music', () => {
  const raw = asFile({ ...createShow(), shapes: [shape('sh', 'r')], sources: [source('r'), source('m', meridianProject())],
    performance: { ...createPerformanceSet(), clips: [clip('c1', 'm')] } });
  const { show, repaired } = validateShow(raw);
  assert.equal(repaired, false);
  assert.deepEqual(show.sources.map(s => s.id), ['r', 'm']);
  assert.deepEqual(show.performance.clips.map(c => c.sourceId), ['m']);
  const wire = asFile(toWire(show));
  assert.equal(wire.guardWall, true);
  assert.deepEqual(wire.clipSourceIds, ['m']);
  const read = validateWireShow(wire);
  assert.equal(read.guardWall, true);
  assert.deepEqual(read.clipSourceIds, ['m']);
  // During a show the service sends only what wallInputs names: Meridian's sound and tempo source are among them.
  const inputs = wallInputs(show, null, true);
  for (const input of ['audio.bass', 'beat.pulse', 'tempo.bpm', 'tempo.external']) assert.ok(inputs.has(input), input);
});

test('a show with no Meridian is unguarded on the wire and its wall inputs are as Perform sends them', () => {
  const show = validateShow(asFile({ ...createShow(), shapes: [shape('sh', 'r')], sources: [source('r')], performance: { ...createPerformanceSet(), clips: [clip('c1', 'r')] } })).show;
  const wire = asFile(toWire(show));
  assert.equal('guardWall' in wire, false);
  assert.equal(validateWireShow(wire).guardWall, undefined);
  assert.deepEqual([...wallInputs(show, null, true)].sort(), ['tempo.beat', 'tempo.bpm', 'tempo.phase']);
});

test('a wire show from an older wall message (version 8, no clip list) is still read, keeping its guard', () => {
  const show = validateShow(asFile({ ...createShow(), shapes: [shape('sh', 'm')], sources: [source('m', meridianProject())] })).show;
  const wire = asFile(toWire(show));
  delete wire.clipSourceIds; wire.version = 8;
  const read = validateWireShow(wire);
  assert.equal(read.guardWall, true);
  assert.deepEqual(read.clipSourceIds, []);
  assert.deepEqual(read.sources.map(s => s.id), ['m']);
});
