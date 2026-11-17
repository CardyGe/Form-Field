import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyEdit } from '../src/map/editor';
import { createShow, validateWireShow, type ShowDocument } from '../src/map/show';
import { acceptMapMessage, toWire, sourcesToSend, MAP_MESSAGE_LIMIT, SOURCE_MESSAGE_LIMIT } from '../src/map/messages';
import { applyMapMessage, initialWall } from '../src/map/wall';

const mainProcess = createRequire(import.meta.url)('../electron/map.cjs') as { acceptMapMessage: (value: unknown) => boolean };

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
  assert.deepEqual(wire.sources, show.sources.map(s => ({ id: s.id, kind: 'instrument', speed: s.speed, revision: s.revision })));
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
  ['unknown', { type: 'explode' }, false],
  ['null', null, false],
  ['array', [], false],
  ['oversized show', { type: 'show', show: { padding: 'x'.repeat(MAP_MESSAGE_LIMIT) } }, false],
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
