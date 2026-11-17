import test from 'node:test';
import assert from 'node:assert/strict';
import { stageCommands, type DrawOptions } from '../src/map/draw';
import { createShow, STAGE_SIZE, type Shape } from '../src/map/show';

const opts = (o: Partial<DrawOptions> = {}): DrawOptions => ({
  blackout: false, testGrid: false, identifyId: null, crosshair: null,
  selectedId: null, selectedIndex: null, outlinesOnly: false, invalidIds: [], ...o,
});
const shape = (id: string, o: Partial<Shape> = {}): Shape => ({
  id, name: `Name ${id}`, colour: '#336699', visible: true, locked: false,
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

test('stageCommands: test grid adds lines every 10% and a name at each first point', () => {
    const cmds = stageCommands(show(shape('a')), opts({ testGrid: true }));
    assert.equal(cmds.filter((c) => c.kind === 'line').length, 18);
    const t = cmds.find((c) => c.kind === 'text')!;
    assert.equal(t.text, 'Name a');
    assert.deepEqual(t.at, { x: 0.1 * STAGE_SIZE.width, y: 0.2 * STAGE_SIZE.height });
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
