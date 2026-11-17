import test from 'node:test';
import assert from 'node:assert/strict';
import { stageCommands, type DrawOptions } from '../src/map/draw';
import { createShow, shapeExtras, STAGE_SIZE, type Shape } from '../src/map/show';

const opts = (o: Partial<DrawOptions> = {}): DrawOptions => ({
  blackout: false, testGrid: false, identifyId: null, crosshair: null,
  selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [], ...o,
});
const shape = (id: string, o: Partial<Shape> = {}): Shape => ({
  id, name: `Name ${id}`, colour: '#336699', visible: true, locked: false, sourceId: null, ...shapeExtras(),
  points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }], ...o,
});
const show = (...shapes: Shape[]) => ({ ...createShow(), shapes });

test('stageCommands: blackout gives exactly one black rect', () => {
    const cmds = stageCommands(show(shape('a')), opts({ blackout: true, testGrid: true, crosshair: { x: 0.5, y: 0.5 } }));
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].kind, 'rect');
    assert.equal(cmds[0].colour, '#000000');
});

test('stageCommands: visible shape fills in stage pixels; hidden shape draws nothing', () => {
    const cmds = stageCommands(show(shape('a'), shape('b', { visible: false })), opts());
    assert.equal(cmds.length, 1);
    assert.partialDeepStrictEqual(cmds[0], { kind: 'fill', shapeId: 'a', colour: '#336699' });
    assert.deepEqual(cmds[0].points![0], { x: 0.1 * STAGE_SIZE.width, y: 0.2 * STAGE_SIZE.height });
});

test('stageCommands: test grid adds numbered lines every 10%, and each shape as an outline in its colour with its name, no fills', () => {
    const cmds = stageCommands(show(shape('a'), shape('b', { visible: false })), opts({ testGrid: true }));
    assert.equal(cmds.filter((c) => c.kind === 'line').length, 18);
    const numbers = cmds.filter((c) => c.kind === 'text' && /^\d+$/.test(c.text ?? '')).map((c) => c.text);
    assert.equal(numbers.length, 18);
    assert.ok(numbers.includes('192') && numbers.includes('1728') && numbers.includes('108') && numbers.includes('972'));
    assert.equal(cmds.some((c) => c.kind === 'fill'), false);
    assert.partialDeepStrictEqual(cmds.find((c) => c.kind === 'stroke'), { shapeId: 'a', colour: '#336699' });
    const names = cmds.filter((c) => c.kind === 'text' && c.text?.startsWith('Name'));
    assert.deepEqual(names.map((c) => c.text), ['Name a']);
    assert.deepEqual(names[0].at, { x: 0.1 * STAGE_SIZE.width, y: 0.2 * STAGE_SIZE.height });
    assert.equal(cmds.some((c) => c.shapeId === 'b'), false);
});

test('stageCommands: identify strokes the shape in white on top of its fill', () => {
    const cmds = stageCommands(show(shape('a'), shape('b')), opts({ identifyId: 'a' }));
    const fi = cmds.findIndex((c) => c.kind === 'fill' && c.shapeId === 'a');
    const si = cmds.findIndex((c) => c.kind === 'stroke' && c.shapeId === 'a');
    assert.ok(fi >= 0);
    assert.ok(si > fi);
    assert.equal(cmds[si].colour, '#ffffff');
    assert.equal(cmds.some((c) => c.kind === 'stroke' && c.shapeId === 'b'), false);
});

test('stageCommands: crosshair gives two lines through the point, drawn last', () => {
    const cmds = stageCommands(show(shape('a')), opts({ testGrid: true, crosshair: { x: 0.25, y: 0.5 } }));
    const last = cmds.slice(-2);
    assert.equal(last.every((c) => c.kind === 'line'), true);
    const x = 0.25 * STAGE_SIZE.width, y = 0.5 * STAGE_SIZE.height;
    assert.equal(last[0].points!.some((p) => p.x === x), true);
    assert.equal(last[1].points!.some((p) => p.y === y), true);
});

test('stageCommands: invalid shape gets a red outline and no fill', () => {
    const cmds = stageCommands(show(shape('a')), opts({ invalidIds: ['a'] }));
    assert.equal(cmds.some((c) => c.kind === 'fill'), false);
    assert.partialDeepStrictEqual(cmds.find((c) => c.kind === 'stroke'), { shapeId: 'a', colour: '#ff0000' });
});

test('stageCommands: outlines only strokes instead of filling', () => {
    const cmds = stageCommands(show(shape('a')), opts({ outlinesOnly: true }));
    assert.equal(cmds.some((c) => c.kind === 'fill'), false);
    assert.partialDeepStrictEqual(cmds.find((c) => c.kind === 'stroke'), { shapeId: 'a', colour: '#336699' });
});

test('stageCommands: selected shape and point are marked', () => {
    const cmds = stageCommands(show(shape('a')), opts({ selectedId: 'a', selectedIndex: 1 }));
    assert.equal(cmds.some((c) => c.kind === 'stroke' && c.shapeId === 'a'), true);
    assert.equal(cmds.some((c) => c.kind === 'rect'), true);
});

test('stageCommands: identify highlight comes after all fills and labels, before the crosshair', () => {
  const cmds = stageCommands(show(shape('a'), shape('b')), opts({ identifyId: 'a', testGrid: true, crosshair: { x: 0.5, y: 0.5 } }));
  const id = cmds.findIndex((c) => c.kind === 'stroke' && c.colour === '#ffffff');
  const lastFill = cmds.map((c) => c.kind).lastIndexOf('fill');
  const lastGridOrText = Math.max(cmds.map((c) => c.kind).lastIndexOf('text'), cmds.map((c) => c.kind === 'line' && c.width === 1).lastIndexOf(true));
  const firstCross = cmds.length - 2;
  assert.ok(id > lastFill);
  assert.ok(id > lastGridOrText);
  assert.ok(id < firstCross);
});

test('stageCommands: a refused outline stays red even when its shape is selected', () => {
  const cmds = stageCommands(show(shape('a')), opts({ selectedId: 'a', selectedIndex: 0, invalidIds: ['a'] }));
  const strokes = cmds.filter(c => c.kind === 'stroke' && c.shapeId === 'a');
  assert.deepEqual(strokes.map(c => c.colour), ['#ff0000']);
  assert.equal(cmds.some(c => c.kind === 'fill'), false);
  // Without the refusal the same selection draws its yellow outline.
  const normal = stageCommands(show(shape('a')), opts({ selectedId: 'a' }));
  assert.ok(normal.some(c => c.kind === 'stroke' && c.colour === '#ffd400'));
});

// Stage 3: curves, holes, blockers, solo and groups.
import { shownOnWall } from '../src/map/draw';

test('a shape is drawn as its outline and holes, curve handles in projector pixels', () => {
  const holed = shape('a', {
    points: [{ x: .1, y: .1, out: { x: .1, y: 0 } }, { x: .6, y: .1 }, { x: .6, y: .6 }, { x: .1, y: .6 }],
    holes: [[{ x: .2, y: .2 }, { x: .3, y: .2 }, { x: .3, y: .3 }]],
  });
  const fill = stageCommands(show(holed), opts()).find(c => c.kind === 'fill')!;
  assert.equal(fill.rings!.length, 2);
  assert.deepEqual(fill.rings![0][0].out, { x: .1 * STAGE_SIZE.width, y: 0 });
  assert.deepEqual(fill.rings![1][1], { x: .3 * STAGE_SIZE.width, y: .2 * STAGE_SIZE.height });
});

test('a blocker is black on the wall, hatched on the operator screen, and outlined in grey on the test grid', () => {
  const b = shape('b', { blocker: true });
  assert.partialDeepStrictEqual(stageCommands(show(b), opts()).find(c => c.shapeId === 'b'), { kind: 'fill', colour: '#000000' });
  assert.partialDeepStrictEqual(stageCommands(show(b), opts({ operator: true })).find(c => c.shapeId === 'b'), { kind: 'hatch' });
  assert.partialDeepStrictEqual(stageCommands(show(b), opts({ testGrid: true })).find(c => c.shapeId === 'b'), { kind: 'stroke', colour: '#808080' });
});

test('solo shows only the soloed shapes; a hidden group hides its members', () => {
  const s = show(shape('a'), shape('b'));
  const ids = (o: Partial<DrawOptions>) => stageCommands(s, opts(o)).filter(c => c.kind === 'fill').map(c => c.shapeId);
  assert.deepEqual(ids({ solo: ['b'] }), ['b']);
  assert.deepEqual(ids({ solo: [] }), ['a', 'b']);
  const grouped = { ...createShow(), shapes: [shape('a', { groupId: 'g' }), shape('b')], groups: [{ id: 'g', name: 'G', visible: false, locked: false }] };
  assert.deepEqual(stageCommands(grouped, opts()).filter(c => c.kind === 'fill').map(c => c.shapeId), ['b']);
  assert.equal(shownOnWall(grouped, grouped.shapes[0], []), false);
});
