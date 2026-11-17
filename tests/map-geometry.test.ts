import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidOutline, rectangleFromDrag, nudge, clampToStage, pointInPolygon, stageFromPointer, stagePixelsPerScreenPixel, parsePixelField } from '../src/map/geometry';
import { isTypingTarget, shouldCommit } from '../src/map/keys';

const square = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];

test('square is valid', () => assert.deepEqual(isValidOutline(square), {ok:true}));
test('bowtie is crossing', () => assert.deepEqual(isValidOutline([{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}]), {ok:false, reason:'crossing'}));
test('collinear points are collapsed', () => assert.deepEqual(isValidOutline([{x:0,y:0},{x:.5,y:.5},{x:1,y:1}]), {ok:false, reason:'collapsed'}));
test('two points are too few', () => assert.deepEqual(isValidOutline([{x:0,y:0},{x:1,y:1}]), {ok:false, reason:'too-few'}));
test('33 points are too many', () => {
  const pts = Array.from({length:33}, (_, i) => ({x:.5+.4*Math.cos(i/33*2*Math.PI), y:.5+.4*Math.sin(i/33*2*Math.PI)}));
  assert.deepEqual(isValidOutline(pts), {ok:false, reason:'too-many'});
});
test('point outside the stage is outside', () => assert.deepEqual(isValidOutline([{x:0,y:0},{x:1.2,y:0},{x:1,y:1},{x:0,y:1}]), {ok:false, reason:'outside'}));
test('a simple 20-point polygon is valid', () => {
  const pts = Array.from({length:20}, (_, i) => ({x:.5+.4*Math.cos(i/20*2*Math.PI), y:.5+.4*Math.sin(i/20*2*Math.PI)}));
  assert.deepEqual(isValidOutline(pts), {ok:true});
});
test('rectangleFromDrag is clockwise from top-left whatever the direction', () => {
  const expected = [{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.6},{x:.2,y:.6}];
  assert.deepEqual(rectangleFromDrag({x:.8,y:.2},{x:.2,y:.6}), expected);
  assert.deepEqual(rectangleFromDrag({x:.2,y:.6},{x:.8,y:.2}), expected);
  assert.deepEqual(rectangleFromDrag({x:.2,y:.2},{x:.8,y:.6}), expected);
});
test('nudge clamps to the stage', () => assert.equal(nudge({x:.5,y:.5}, 1920, 0).x, 1));
test('nudge moves in projector pixels, screen y down', () => {
  const p = nudge({x:.5,y:.5}, 1, -1);
  assert.ok(Math.abs(p.x - (.5 + 1/1920)) < 1e-12);
  assert.ok(Math.abs(p.y - (.5 - 1/1080)) < 1e-12);
});
test('clampToStage', () => assert.deepEqual(clampToStage({x:-1,y:2}), {x:0,y:1}));
test('pointInPolygon', () => {
  assert.equal(pointInPolygon({x:.5,y:.5}, square), true);
  assert.equal(pointInPolygon({x:1.5,y:.5}, square), false);
});
test('stageFromPointer maps and clamps', () => {
  const rect = {left:100, top:50, width:200, height:100};
  assert.deepEqual(stageFromPointer(rect, 200, 100), {x:.5, y:.5});
  assert.deepEqual(stageFromPointer(rect, 0, 500), {x:0, y:1});
});
test('stageFromPointer returns the origin for a zero-size rect', () => {
  assert.deepEqual(stageFromPointer({left:10, top:10, width:0, height:0}, 50, 50), {x:0, y:0});
  assert.deepEqual(stageFromPointer({left:10, top:10, width:0, height:100}, 50, 60), {x:0, y:.5});
});
test('stagePixelsPerScreenPixel scales stage pixels to the displayed canvas', () => {
  assert.equal(stagePixelsPerScreenPixel(960), 2);
  assert.equal(stagePixelsPerScreenPixel(1920), 1);
  assert.equal(stagePixelsPerScreenPixel(0), 1);
});
test('parsePixelField', () => {
  const r = {min:0, max:1920};
  assert.equal(parsePixelField('1920', r), 1920);
  assert.equal(parsePixelField('-5', r), 0);
  assert.equal(parsePixelField('5000', r), 1920);
  assert.equal(parsePixelField(' 12 ', r), 12);
  assert.equal(parsePixelField('abc', r), null);
  assert.equal(parsePixelField('', r), null);
});
test('isTypingTarget is true for text boxes only', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'textarea' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'CANVAS' }), false);
  assert.equal(isTypingTarget(null), false);
});
test('shouldCommit only when the text was changed', () => {
  assert.equal(shouldCommit('641', '641'), false);
  assert.equal(shouldCommit('641', '642'), true);
  assert.equal(shouldCommit('641', ''), true);
});
