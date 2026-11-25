import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyEdit } from '../src/map/editor';
import { createShow, validateWireShow, type ShowDocument } from '../src/map/show';
import { acceptMapMessage, toWire, sourcesToSend, wallInputs, MAP_MESSAGE_LIMIT, SOURCE_MESSAGE_LIMIT } from '../src/map/messages';
import { applyMapMessage, fitWallReport, initialWall, WALL_REPORT_LIMIT } from '../src/map/wall';

const mainProcess = createRequire(import.meta.url)('../electron/map.cjs') as { acceptMapMessage: (value: unknown) => boolean; acceptState: (value: unknown) => boolean };

test('a wall report too big for the main process leaves out the check-only fields first, and one that fits is sent as it is', () => {
  const small = { fps: 60, level: 0, failing: [], meridian: { a: { status: 'x' } } };
  assert.equal(fitWallReport(small), small);
  // Many Meridian sources during a Perform show, with a full step of landings.
  const meridian = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`${'m'.repeat(60)}${i}`, { status: 'following the music', beats: 123.456789, wave: .123456789, frames: 123456, drops: 12, holds: 3, linkedSeed: false, phase: .123456789 }]));
  const landed = Array.from({ length: 32 }, () => ({ launchId: 'x'.repeat(128), zones: [0, 1, 2, 3, 4, 5, 6, 7] }));
  // Every source failing, each reason at the compositor's 200-character cap.
  const failing = Array.from({ length: 24 }, (_, i) => ({ id: `${'f'.repeat(60)}${i}`, reason: 'r'.repeat(200) }));
  const big = { fps: 60, level: 0, failing, landed, meridian, linked: { a: 1 }, meridianRecords: 24 };
  assert.ok(JSON.stringify(big).length >= WALL_REPORT_LIMIT);
  assert.equal(mainProcess.acceptState(big), false);
  const fitted = fitWallReport(big);
  assert.deepEqual(fitted, { fps: 60, level: 0, failing, landed });
  assert.equal(mainProcess.acceptState(fitted), true);
});

function showWithInstruments(count = 2): ShowDocument {
  let show = createShow();
  for (let i = 0; i < count; i++) {
    const shape = applyEdit(show, { type: 'addRectangle', id: `s${i}`, a: { x: 0.1 + i * 0.3, y: 0.1 }, b: { x: 0.3 + i * 0.3, y: 0.3 }, colour: '#ff0000' });
    assert.ok(shape.ok);
    const content = applyEdit(shape.show, { type: 'setContent', shapeId: `s${i}`, content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: `src${i}`, seed: i } });
    assert.ok(content.ok);
    show = content.show;
  }
  return show;
}

test('toWire leaves the compositions out and keeps speed and revision', () => {
  const show = showWithInstruments();
  const wire = toWire(show);
  assert.deepEqual(wire.sources, show.sources.map(s => ({ id: s.id, kind: 'instrument', speed: s.speed, revision: s.revision, tempoSync: s.tempoSync })));
  assert.ok(!('project' in wire.sources[0]));
  assert.equal(wire.shapes[0].sourceId, 'src0');
  // What the wall reads back is the same show without the compositions.
  assert.deepEqual(validateWireShow(JSON.parse(JSON.stringify(wire))), wire);
});

test('sourcesToSend sends each composition once per revision, and again for a new output', () => {
  const show = showWithInstruments();
  const first = sourcesToSend(show, new Map());
  assert.deepEqual(first.messages.map(m => m.type === 'source' && m.id), ['src0', 'src1']);
  assert.deepEqual(sourcesToSend(show, first.sent).messages, []);
  const varied = applyEdit(show, { type: 'varySource', sourceId: 'src1', entropy: 3 });
  assert.ok(varied.ok);
  const second = sourcesToSend(varied.show, first.sent);
  assert.deepEqual(second.messages.map(m => m.type === 'source' && [m.id, m.revision]), [['src1', 1]]);
  // A source that left the show leaves the record too, so it is sent again if it comes back.
  const removed = applyEdit(varied.show, { type: 'setContent', shapeId: 's0', content: { kind: 'colour' } });
  assert.ok(removed.ok);
  assert.deepEqual([...sourcesToSend(removed.show, second.sent).sent.keys()], ['src1']);
  // A new output starts with an empty record: everything is sent.
  assert.equal(sourcesToSend(varied.show, new Map()).messages.length, 2);
});

test('source messages have their own, larger limit; everything else stays at 256 KB', () => {
  const show = showWithInstruments(1);
  const project = show.sources[0].project;
  assert.ok(acceptMapMessage({ type: 'source', id: 'src0', revision: 0, project }));
  const big = { ...project, padding: 'x'.repeat(MAP_MESSAGE_LIMIT * 2) };
  assert.ok(acceptMapMessage({ type: 'source', id: 'src0', revision: 0, project: big }), 'a 512 KB composition is a normal source');
  assert.equal(acceptMapMessage({ type: 'source', id: 'src0', revision: 0, project: { ...project, padding: 'x'.repeat(SOURCE_MESSAGE_LIMIT) } }), false);
  assert.equal(acceptMapMessage({ type: 'show', show: { ...toWire(show), padding: 'x'.repeat(MAP_MESSAGE_LIMIT) } }), false);
  assert.ok(acceptMapMessage({ type: 'freeze', on: true }));
});

function performParity(): [string, unknown, boolean][] {
  const picture = { shapeIds: ['a'], sourceId: 'x', launched: true };
  const zones = Array.from({ length: 8 }, () => picture);
  const change = { zone: 0, sourceId: 'x', shapeIds: ['a'], blend: { kind: 'fade', durationMs: 500 }, phaseOffsetBeats: 0 };
  const launch = { id: 'l1', atMs: 1000, barMs: 2000, changes: [change] };
  const withChange = (extra: object) => ({ type: 'performLaunch', launch: { ...launch, changes: [{ ...change, ...extra }] } });
  const withLaunch = (extra: object) => ({ type: 'performLaunch', launch: { ...launch, ...extra } });
  const valueZone = { brightness: 1, hueDeg: 0, speed: 1 };
  const valueZones = Array.from({ length: 8 }, () => valueZone);
  const withValue = (extra: object) => ({ type: 'performValues', values: { master: 1, zones: [{ ...valueZone, ...extra }, ...valueZones.slice(1)] } });
  // eslint-disable-next-line no-sparse-arrays
  const holed = [, 'a'];
  return [
    ['perform start', { type: 'performStart', zones }, true],
    ['perform start black zone', { type: 'performStart', zones: [{ shapeIds: [], sourceId: null, launched: false }, ...zones.slice(1)] }, true],
    ['perform start too few zones', { type: 'performStart', zones: zones.slice(1) }, false],
    ['perform start too many zones', { type: 'performStart', zones: [...zones, picture] }, false],
    ['perform start bad launched', { type: 'performStart', zones: [{ ...picture, launched: 1 }, ...zones.slice(1)] }, false],
    ['perform start bad source', { type: 'performStart', zones: [{ ...picture, sourceId: 3 }, ...zones.slice(1)] }, false],
    ['perform start too many shapes', { type: 'performStart', zones: [{ ...picture, shapeIds: Array(65).fill('a') }, ...zones.slice(1)] }, false],
    ['perform start hole in shapes', { type: 'performStart', zones: [{ ...picture, shapeIds: holed }, ...zones.slice(1)] }, false],
    ['perform start with offsets', { type: 'performStart', zones, phaseOffsets: { x: 1.5, y: -2 } }, true],
    ['perform start no offsets', { type: 'performStart', zones, phaseOffsets: {} }, true],
    ['perform start __proto__ offset', { type: 'performStart', zones, phaseOffsets: JSON.parse('{"__proto__":2}') }, true],
    ['perform start bad __proto__ offset', { type: 'performStart', zones, phaseOffsets: JSON.parse('{"__proto__":"x"}') }, false],
    ['perform start 8 offsets', { type: 'performStart', zones, phaseOffsets: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`s${i}`, i])) }, true],
    ['perform start 9 offsets', { type: 'performStart', zones, phaseOffsets: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, i])) }, false],
    ['perform start offsets not a record', { type: 'performStart', zones, phaseOffsets: 3 }, false],
    ['perform start offsets null', { type: 'performStart', zones, phaseOffsets: null }, false],
    ['perform start offsets a list', { type: 'performStart', zones, phaseOffsets: [1] }, false],
    ['perform start NaN offset', { type: 'performStart', zones, phaseOffsets: { x: Number.NaN } }, false],
    ['perform start infinite offset', { type: 'performStart', zones, phaseOffsets: { x: Number.POSITIVE_INFINITY } }, false],
    ['perform start text offset', { type: 'performStart', zones, phaseOffsets: { x: '1' } }, false],
    ['perform start empty offset key', { type: 'performStart', zones, phaseOffsets: { '': 1 } }, false],
    ['perform start long offset key', { type: 'performStart', zones, phaseOffsets: { ['x'.repeat(65)]: 1 } }, false],
    ['perform end', { type: 'performEnd' }, true],
    ['perform arm', { type: 'performArm', sourceIds: ['a', 'b'] }, true],
    ['perform arm none', { type: 'performArm', sourceIds: [] }, true],
    ['perform arm over budget', { type: 'performArm', sourceIds: Array(9).fill('a') }, false],
    ['perform arm bad id', { type: 'performArm', sourceIds: [3] }, false],
    ['perform arm empty id', { type: 'performArm', sourceIds: [''] }, false],
    ['perform arm long id', { type: 'performArm', sourceIds: ['x'.repeat(65)] }, false],
    ['perform arm hole', { type: 'performArm', sourceIds: holed }, false],
    ['perform arm not a list', { type: 'performArm', sourceIds: 'a' }, false],
    ['perform launch', { type: 'performLaunch', launch }, true],
    ['perform launch empty', withLaunch({ changes: [] }), true],
    ['perform launch stop', withChange({ sourceId: null }), true],
    ['perform launch derived id', withLaunch({ id: `${'x'.repeat(64)}:ceiling` }), true],
    ['perform launch no launch', { type: 'performLaunch' }, false],
    ['perform launch empty id', withLaunch({ id: '' }), false],
    ['perform launch long id', withLaunch({ id: 'x'.repeat(129) }), false],
    ['perform launch NaN time', withLaunch({ atMs: Number.NaN }), false],
    ['perform launch infinite time', withLaunch({ atMs: Number.POSITIVE_INFINITY }), false],
    ['perform launch zero bar', withLaunch({ barMs: 0 }), false],
    ['perform launch NaN bar', withLaunch({ barMs: Number.NaN }), false],
    ['perform launch too long a bar', withLaunch({ barMs: 60001 }), false],
    ['perform launch too many changes', withLaunch({ changes: Array.from({ length: 9 }, (_, i) => ({ ...change, zone: i % 8 })) }), false],
    ['perform launch one zone twice', withLaunch({ changes: [change, change] }), false],
    ['perform launch hole in changes', withLaunch({ changes: [, change] }), false],
    ['perform change zone too high', withChange({ zone: 8 }), false],
    ['perform change zone negative', withChange({ zone: -1 }), false],
    ['perform change zone fractional', withChange({ zone: 1.5 }), false],
    ['perform change bad source', withChange({ sourceId: 3 }), false],
    ['perform change bad shapes', withChange({ shapeIds: [3] }), false],
    ['perform change too many shapes', withChange({ shapeIds: Array(65).fill('a') }), false],
    ['perform change bad blend kind', withChange({ blend: { kind: 'wipe', durationMs: 0 } }), false],
    ['perform change blend not an object', withChange({ blend: 'cut' }), false],
    ['perform change negative blend', withChange({ blend: { kind: 'fade', durationMs: -1 } }), false],
    ['perform change NaN blend', withChange({ blend: { kind: 'fade', durationMs: Number.NaN } }), false],
    ['perform change blend too long', withChange({ blend: { kind: 'fade', durationMs: 3600001 } }), false],
    ['perform change NaN phase', withChange({ phaseOffsetBeats: Number.NaN }), false],
    ['perform cancel', { type: 'performCancel', launchId: 'l1' }, true],
    ['perform cancel empty', { type: 'performCancel', launchId: '' }, false],
    ['perform cancel bad', { type: 'performCancel', launchId: 3 }, false],
    ['perform cancel long', { type: 'performCancel', launchId: 'x'.repeat(129) }, false],
    ['perform values', { type: 'performValues', values: { master: 0.5, zones: valueZones } }, true],
    ['perform values not an object', { type: 'performValues', values: 3 }, false],
    ['perform values NaN master', { type: 'performValues', values: { master: Number.NaN, zones: valueZones } }, false],
    ['perform values infinite master', { type: 'performValues', values: { master: Number.POSITIVE_INFINITY, zones: valueZones } }, false],
    ['perform values NaN brightness', withValue({ brightness: Number.NaN }), false],
    ['perform values infinite hue', withValue({ hueDeg: Number.NEGATIVE_INFINITY }), false],
    ['perform values NaN speed', withValue({ speed: Number.NaN }), false],
    ['perform values too few zones', { type: 'performValues', values: { master: 1, zones: valueZones.slice(1) } }, false],
    ['perform values too many zones', { type: 'performValues', values: { master: 1, zones: [...valueZones, valueZone] } }, false],
    ['perform values hole', { type: 'performValues', values: { master: 1, zones: [, ...valueZones.slice(1)] } }, false],
  ];
}

test('new message types are accepted in both copies of the check', () => {
  const table = performParity().filter(([, , expected]) => expected);
  assert.ok(table.length >= 8);
  for (const [name, message] of table) {
    assert.equal(acceptMapMessage(message), true, `page: ${name}`);
    assert.equal(mainProcess.acceptMapMessage(message), true, `main process: ${name}`);
  }
});

test('performValues with non-finite numbers is refused', () => {
  const zones = Array.from({ length: 8 }, () => ({ brightness: 1, hueDeg: 0, speed: 1 }));
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const message of [
      { type: 'performValues', values: { master: bad, zones } },
      { type: 'performValues', values: { master: 1, zones: [{ brightness: bad, hueDeg: 0, speed: 1 }, ...zones.slice(1)] } },
      { type: 'performValues', values: { master: 1, zones: [{ brightness: 1, hueDeg: bad, speed: 1 }, ...zones.slice(1)] } },
      { type: 'performValues', values: { master: 1, zones: [{ brightness: 1, hueDeg: 0, speed: bad }, ...zones.slice(1)] } },
    ]) {
      assert.equal(acceptMapMessage(message), false);
      assert.equal(mainProcess.acceptMapMessage(message), false);
    }
  }
});

// One table, run against both copies of the check (the page's and the main process's), so they cannot drift.
const PARITY: [string, unknown, boolean][] = [
  ['show', { type: 'show', show: { shapes: [] } }, true],
  ['show not an object', { type: 'show', show: 'x' }, false],
  ['blackout', { type: 'blackout', on: true }, true],
  ['blackout bad', { type: 'blackout', on: 'yes' }, false],
  ['test grid', { type: 'testGrid', on: false }, true],
  ['freeze', { type: 'freeze', on: true }, true],
  ['freeze bad', { type: 'freeze', on: 1 }, false],
  ['identify', { type: 'identify', shapeId: 'a' }, true],
  ['identify null', { type: 'identify', shapeId: null }, true],
  ['identify bad', { type: 'identify', shapeId: 3 }, false],
  ['crosshair', { type: 'crosshair', point: { x: 0.5, y: 0.5 }, shapeId: 'a' }, true],
  ['crosshair null', { type: 'crosshair', point: null, shapeId: null }, true],
  ['crosshair bad point', { type: 'crosshair', point: { x: 1 }, shapeId: null }, false],
  ['crosshair NaN', { type: 'crosshair', point: { x: Number.NaN, y: 0 }, shapeId: null }, false],
  ['source', { type: 'source', id: 'a', revision: 2, project: { layers: [] } }, true],
  ['source no id', { type: 'source', revision: 2, project: {} }, false],
  ['source bad revision', { type: 'source', id: 'a', revision: -1, project: {} }, false],
  ['source fractional revision', { type: 'source', id: 'a', revision: 1.5, project: {} }, false],
  ['source no project', { type: 'source', id: 'a', revision: 0 }, false],
  ['solo', { type: 'solo', ids: ['a', 'b'] }, true],
  ['solo none', { type: 'solo', ids: [] }, true],
  ['solo bad', { type: 'solo', ids: [3] }, false],
  ['solo not a list', { type: 'solo', ids: 'a' }, false],
  ['signals', { type: 'signals', signals: { 'audio.bass': 0.4, 'midi.cc.1.7': 1 } }, true],
  ['signals bad name', { type: 'signals', signals: { 'Audio Bass': 0.4 } }, false],
  ['signals not numbers', { type: 'signals', signals: { 'audio.bass': 'loud' } }, false],
  ['fade', { type: 'fade', ms: 2000 }, true],
  ['fade too long', { type: 'fade', ms: 99999 }, false],
  ['live settings', { type: 'liveSettings', settings: { look: 'smoke' } }, true],
  ['live settings off', { type: 'liveSettings', settings: null }, true],
  ['live settings not a record', { type: 'liveSettings', settings: 'smoke' }, false],
  ['live settings over 16 KB', { type: 'liveSettings', settings: { padding: 'x'.repeat(16 * 1024) } }, false],
  ['live clear', { type: 'liveClear' }, true],
  ['live capture room', { type: 'liveCaptureRoom' }, true],
  ['live retry', { type: 'liveRetry' }, true],
  ['video retry', { type: 'videoRetry' }, true],
  ['performance reset', { type: 'performanceReset' }, true],
  ['unknown', { type: 'explode' }, false],
  ['null', null, false],
  ['array', [], false],
  ['oversized show', { type: 'show', show: { padding: 'x'.repeat(MAP_MESSAGE_LIMIT) } }, false],
  ...performParity(),
];
test('the page and the main process accept and refuse exactly the same messages', () => {
  for (const [name, message, expected] of PARITY) {
    assert.equal(acceptMapMessage(message), expected, `page: ${name}`);
    assert.equal(mainProcess.acceptMapMessage(message), expected, `main process: ${name}`);
  }
});

test('the wall takes any composition revision different from the one it holds, and ignores broken ones', () => {
  const show = showWithInstruments(1);
  const project = show.sources[0].project;
  let wall = applyMapMessage(initialWall(), { type: 'source', id: 'src0', revision: 2, project });
  assert.equal(wall.projects.get('src0')?.revision, 2);
  // Undo brings back an older revision: the wall must show it.
  const undone = applyMapMessage(wall, { type: 'source', id: 'src0', revision: 1, project: { ...project, name: 'old' } });
  assert.equal(undone.projects.get('src0')?.project.name, 'old');
  // The same revision again is the same composition: nothing to do.
  assert.equal(applyMapMessage(wall, { type: 'source', id: 'src0', revision: 2, project }), wall);
  const broken = applyMapMessage(wall, { type: 'source', id: 'src0', revision: 3, project: { layers: 'nonsense' } });
  assert.equal(broken, wall);
  wall = applyMapMessage(wall, { type: 'show', show: toWire(show) });
  assert.equal(wall.show.shapes[0].sourceId, 'src0');
  // A show without that source lets the wall forget its composition.
  const colour = applyEdit(show, { type: 'setContent', shapeId: 's0', content: { kind: 'colour' } });
  assert.ok(colour.ok);
  wall = applyMapMessage(wall, { type: 'show', show: toWire(colour.show) });
  assert.equal(wall.projects.has('src0'), false);
  assert.equal(applyMapMessage(wall, { type: 'freeze', on: true }).freeze, true);
});

test('undo and redo of a composition change reach the wall', () => {
  const show = showWithInstruments(1);
  const varied = applyEdit(show, { type: 'varySource', sourceId: 'src0', entropy: 99 });
  assert.ok(varied.ok);
  let wall = initialWall(), sent = new Map<string, number>();
  const push = (s: ShowDocument) => {
    const out = sourcesToSend(s, sent); sent = out.sent;
    for (const m of [...out.messages, { type: 'show', show: toWire(s) }]) wall = applyMapMessage(wall, m);
  };
  push(show); push(varied.show);
  assert.deepEqual(wall.projects.get('src0')?.project.layers[0].params, varied.show.sources[0].project.layers[0].params);
  push(show); // undo
  assert.deepEqual(wall.projects.get('src0')?.project.layers[0].params, show.sources[0].project.layers[0].params);
  const again = applyEdit(show, { type: 'varySource', sourceId: 'src0', entropy: 7 }); // the same revision number as before, new content
  assert.ok(again.ok);
  push(again.show);
  assert.deepEqual(wall.projects.get('src0')?.project.layers[0].params, again.show.sources[0].project.layers[0].params);
});

// Stage 3: the largest show now has curve handles, holes, groups and borders; the photo never travels.
import { createShow as createShow3, shapeExtras, MAX_SHAPES, MAX_POINTS, MAX_NAME_LENGTH, MAX_ID_LENGTH, MAX_GROUPS, type ShowDocument as Show3 } from '../src/map/show';

test('the largest valid version 3 show fits in one message, rounded or not', () => {
  const groups = Array.from({ length: MAX_GROUPS }, (_, i) => ({ id: 'g'.repeat(MAX_ID_LENGTH - 3) + String(i).padStart(3, '0'), name: 'n'.repeat(MAX_NAME_LENGTH), visible: true, locked: false }));
  const shapes = Array.from({ length: MAX_SHAPES }, (_, i) => ({
    id: 'i'.repeat(MAX_ID_LENGTH - 3) + String(i).padStart(3, '0'), name: 'n'.repeat(MAX_NAME_LENGTH), colour: '#ff9f0a', visible: true, locked: false,
    sourceId: 's'.repeat(MAX_ID_LENGTH - 3) + String(i).padStart(3, '0'), ...shapeExtras(), groupId: groups[i % MAX_GROUPS].id, softEdge: 123.456789, border: { width: 12.3456789, colour: '#123456', glow: 33.3333333 },
    points: Array.from({ length: MAX_POINTS }, (_, k) => ({
      x: 0.5 + 0.3 * Math.cos(k / MAX_POINTS * 2 * Math.PI) + 1 / 3e5, y: 0.5 + 0.3 * Math.sin(k / MAX_POINTS * 2 * Math.PI) + 1 / 7e5,
      in: { x: -0.0123456789012345, y: 0.0234567890123456 }, out: { x: 0.0123456789012345, y: -0.0234567890123456 },
    })),
  }));
  const show: Show3 = { ...createShow3(), shapes, groups };
  assert.ok(acceptMapMessage({ type: 'show', show }), `${JSON.stringify(show).length} bytes unrounded`);
  assert.ok(acceptMapMessage({ type: 'show', show: toWire(show) }));
});

test('the photo never goes to the wall, and handles and holes are rounded for the trip', () => {
  const show: Show3 = { ...createShow3(), photo: { data: 'data:image/jpeg;base64,AAAA', opacity: .5 }, shapes: [{
    id: 'a', name: 'A', colour: '#ffffff', visible: true, locked: false, sourceId: null, ...shapeExtras(),
    points: [{ x: .1, y: .1, out: { x: 1 / 3, y: 0 } }, { x: .6, y: .1 }, { x: .6, y: .6 }],
    holes: [[{ x: .4, y: .2 }, { x: .5, y: .2 + 1 / 3e5 }, { x: .5, y: .3 }]],
  }] };
  const wire = toWire(show);
  assert.equal('photo' in wire, false);
  assert.equal(wire.shapes[0].points[0].out!.x, 0.3333);
  assert.equal(wire.shapes[0].holes[0][1].y, 0.2);
});

test('a shape that rounding would make touch itself goes to the wall at full precision', () => {
  // A hole a twentieth of a pixel inside the outline's top side: rounded, it would touch it.
  const top = .2 + 1 / 3e5;
  const show: Show3 = { ...createShow3(), shapes: [{
    id: 'a', name: 'A', colour: '#ffffff', visible: true, locked: false, sourceId: null, ...shapeExtras(),
    points: [{ x: .1, y: .2 }, { x: .6, y: .2 }, { x: .6, y: .6 }, { x: .1, y: .6 }],
    holes: [[{ x: .3, y: top }, { x: .4, y: top }, { x: .35, y: .4 }]],
  }] };
  const wire = toWire(show);
  assert.equal(wire.shapes[0].holes[0][0].y, top);
});

test('Ember preset smoke receives the live kick and bands on the wall without a manual link', () => {
  const result = applyEdit(showWithInstruments(1), { type: 'setContent', shapeId: 's0',
    content: { kind: 'preset', presetId: 'ember-glacier', sourceId: 'ember', seed: 67 } });
  assert.ok(result.ok);
  assert.equal(result.show.links.length, 0);
  assert.equal(result.show.sources[0].project.transparent, true);
  const inputs = wallInputs(result.show, null);
  const signals = { 'beat.count': 4, 'beat.pulse': .9, 'audio.bass': .6, 'audio.highs': .4 };
  assert.ok(Object.keys(signals).every(key => inputs.has(key)));
  assert.ok(acceptMapMessage({type: 'signals', signals}));
  assert.ok(mainProcess.acceptMapMessage({type: 'signals', signals}));
});

test('the installation message is read the same by the main process and the wall', () => {
  const cases: [unknown, boolean][] = [
    [{ type: 'installation', autopilot: true, everyBeats: 32 }, true],
    [{ type: 'installation', autopilot: false, everyBeats: 16 }, true],
    [{ type: 'installation', autopilot: true, everyBeats: 128 }, true],
    [{ type: 'installation', autopilot: true, everyBeats: 64.5 }, true],
    [{ type: 'installation', autopilot: true, everyBeats: 15.99 }, false],
    [{ type: 'installation', autopilot: true, everyBeats: 128.01 }, false],
    [{ type: 'installation', autopilot: true, everyBeats: Number.NaN }, false],
    [{ type: 'installation', autopilot: true, everyBeats: Infinity }, false],
    [{ type: 'installation', autopilot: true, everyBeats: '32' }, false],
    [{ type: 'installation', autopilot: 1, everyBeats: 32 }, false],
    [{ type: 'installation', autopilot: 'true', everyBeats: 32 }, false],
    [{ type: 'installation', everyBeats: 32 }, false],
    [{ type: 'installation', autopilot: true }, false],
    [{ type: 'installation' }, false],
  ];
  for (const [message, ok] of cases) {
    assert.equal(acceptMapMessage(message), ok, `wall: ${JSON.stringify(message)}`);
    assert.equal(mainProcess.acceptMapMessage(message), ok, `main: ${JSON.stringify(message)}`);
  }
});
