import test from 'node:test';
import assert from 'node:assert/strict';
import { fadeKey, fadeSize, borderColour } from '../src/map/edge';
import { shapeExtras, type Shape } from '../src/map/show';

const shape = (over: Partial<Shape> = {}): Shape => ({ id: 'a', name: 'A', colour: '#112233', visible: true, locked: false, sourceId: null,
  points: [{ x: .1, y: .1 }, { x: .5, y: .1 }, { x: .5, y: .5 }], ...shapeExtras(), softEdge: 40, ...over });

test('the fade picture is made again when the outline, holes or soft edge change, not the colour or what plays', () => {
  const base = fadeKey(shape());
  assert.equal(fadeKey(shape({ colour: '#ffffff', sourceId: 'x', name: 'B', border: { width: 4, colour: 'shape', glow: 0 } })), base);
  assert.notEqual(fadeKey(shape({ softEdge: 41 })), base);
  assert.notEqual(fadeKey(shape({ points: [{ x: .1, y: .1 }, { x: .5, y: .1, in: { x: .01, y: 0 } }, { x: .5, y: .5 }] })), base);
  assert.notEqual(fadeKey(shape({ holes: [[{ x: .3, y: .15 }, { x: .4, y: .15 }, { x: .4, y: .2 }]] })), base);
});

test('the fade picture is drawn at half the projector resolution, at least one pixel', () => {
  assert.deepEqual(fadeSize({ w: 768, h: 432 }), { width: 384, height: 216, scale: .5 });
  assert.deepEqual(fadeSize({ w: 0.4, h: 1 }), { width: 1, height: 1, scale: .5 });
});

test('a border is the shape colour, the instrument palette’s first colour, or fixed', () => {
  assert.equal(borderColour(shape(), null), '#112233');
  const palette = shape({ border: { width: 4, colour: 'palette', glow: 0 } });
  assert.equal(borderColour(palette, ['#abcdef', '#000000']), '#abcdef');
  assert.equal(borderColour(palette, null), '#112233');
  assert.equal(borderColour(shape({ border: { width: 4, colour: '#00ff00', glow: 0 } }), ['#abcdef']), '#00ff00');
});
