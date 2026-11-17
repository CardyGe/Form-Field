import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShow, validateShow, MAX_SHAPES, MAX_POINTS } from '../src/map/show';

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
  const pts = Array.from({ length: 40 }, (_, i) => ({ x: i / 40, y: 0.5 }));
  assert.equal(validateShow(doc([shape({ points: pts })])).show.shapes[0].points.length, MAX_POINTS);
});

test('unknown version still loads valid shapes', () => {
  const r = validateShow(doc([shape()], { version: 9 }));
  assert.equal(r.show.version, 1);
  assert.equal(r.show.shapes.length, 1);
});

test('duplicate ids: the later shape gets a fresh id', () => {
  const r = validateShow(doc([shape(), shape({ name: 'B' })]));
  assert.equal(r.show.shapes.length, 2);
  assert.equal(r.show.shapes[0].id, 'a');
  assert.notEqual(r.show.shapes[1].id, 'a');
  assert.equal(r.repaired, true);
});
