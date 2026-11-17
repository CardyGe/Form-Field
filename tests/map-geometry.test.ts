import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidOutline, rectangleFromDrag, nudge, clampToStage, pointInPolygon, stageFromPointer, stagePixelsPerScreenPixel, parsePixelField, MIN_OUTLINE_AREA } from '../src/map/geometry';
import { STAGE_SIZE } from '../src/map/show';
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
const ring = (n: number) => Array.from({length:n}, (_, i) => ({x:.5+.3*Math.cos(i/n*2*Math.PI), y:.5+.3*Math.sin(i/n*2*Math.PI)}));
test('a 12-point and a 13-point outline of the same shape are both valid', () => {
  const twelve = ring(12);
  // The same twelve corners with one more halfway along the last edge: the same shape, one more point.
  const a = twelve[11], b = twelve[0];
  const thirteen = [...twelve, {x:(a.x+b.x)/2, y:(a.y+b.y)/2}];
  assert.deepEqual(isValidOutline(twelve), {ok:true});
  assert.deepEqual(isValidOutline(thirteen), {ok:true});
});
test('a 13-point outline that crosses itself is crossing', () => {
  const pts = ring(13);
  [pts[2], pts[7]] = [pts[7], pts[2]];
  assert.deepEqual(isValidOutline(pts), {ok:false, reason:'crossing'});
});
test('a small 40 x 40 projector-pixel rectangle is valid', () => {
  const w = 40 / STAGE_SIZE.width, h = 40 / STAGE_SIZE.height;
  assert.deepEqual(isValidOutline([{x:.5,y:.5},{x:.5+w,y:.5},{x:.5+w,y:.5+h},{x:.5,y:.5+h}]), {ok:true});
});
test('an outline with no area, or less than one projector pixel of area, is collapsed', () => {
  assert.deepEqual(isValidOutline([{x:.1,y:.5},{x:.3,y:.5},{x:.6,y:.5}]), {ok:false, reason:'collapsed'});
  const w = .5 / STAGE_SIZE.width, h = .5 / STAGE_SIZE.height;
  assert.deepEqual(isValidOutline([{x:.5,y:.5},{x:.5+w,y:.5},{x:.5+w,y:.5+h},{x:.5,y:.5+h}]), {ok:false, reason:'collapsed'});
  assert.equal(MIN_OUTLINE_AREA, 1 / (1920 * 1080));
});
test('a repeated corner is collapsed', () => assert.deepEqual(isValidOutline([{x:0,y:0},{x:1,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]), {ok:false, reason:'collapsed'}));
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

test('shortcutFor maps keys to actions and ignores typing targets', async () => {
  const { shortcutFor } = await import('../src/map/keys');
  const ev = (key: string, extra = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: { tagName: 'DIV' }, onStage: true, ...extra });
  assert.equal(shortcutFor(ev('Delete')), 'delete');
  assert.equal(shortcutFor(ev('Backspace')), 'delete');
  assert.equal(shortcutFor(ev('z', { metaKey: true })), 'undo');
  assert.equal(shortcutFor(ev('Z', { metaKey: true, shiftKey: true })), 'redo');
  assert.equal(shortcutFor(ev('z', { ctrlKey: true })), 'undo');
  assert.equal(shortcutFor(ev('v')), 'select');
  assert.equal(shortcutFor(ev('r')), 'rectangle');
  assert.equal(shortcutFor(ev('Escape')), 'deselect');
  assert.equal(shortcutFor(ev('ArrowLeft')), 'arrow');
  assert.equal(shortcutFor(ev('Backspace', { target: { tagName: 'INPUT' } })), null);
  assert.equal(shortcutFor(ev('z', { metaKey: true, target: { tagName: 'INPUT' } })), null);
  assert.equal(shortcutFor(ev('r', { metaKey: true })), null);
});

test('Delete, Backspace and Tab act only when the stage has focus', async () => {
  const { shortcutFor } = await import('../src/map/keys');
  const ev = (key: string, extra = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: { tagName: 'BUTTON' }, onStage: false, ...extra });
  // Focus on a button (for example after clicking Identify): Backspace must not delete the selected shape.
  assert.equal(shortcutFor(ev('Backspace')), null);
  assert.equal(shortcutFor(ev('Delete')), null);
  assert.equal(shortcutFor(ev('Tab')), null);
  // Undo and the tool keys still work from anywhere outside a text box.
  assert.equal(shortcutFor(ev('z', { metaKey: true })), 'undo');
  assert.equal(shortcutFor(ev('v')), 'select');
  // On the stage, Tab steps to the next corner and Shift-Tab to the one before.
  assert.equal(shortcutFor(ev('Tab', { onStage: true })), 'next-corner');
  assert.equal(shortcutFor(ev('Tab', { onStage: true, shiftKey: true })), 'previous-corner');
  assert.equal(shortcutFor(ev('Backspace', { onStage: true })), 'delete');
});
