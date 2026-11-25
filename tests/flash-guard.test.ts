import test from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_DELTA, flashGuardApplyGLSL, flashGuardGateGLSL, flashGuardStepGLSL, guardBlend, guardSoftness, newGuardTile, stepGuardGate, stepGuardTile } from '../src/rendering/flash-guard';

const FPS = 60;
/** The most opposing changes of at least the flash delta in any one second of what is shown. */
function worstReversals(levels: number[]): number {
  let direction = 0, low = levels[0], high = levels[0], worst = 0;
  const events: number[] = [];
  levels.forEach((v, frame) => {
    if (direction >= 0 && v > high) high = v;
    if (direction <= 0 && v < low) low = v;
    let event = false;
    if (direction >= 0 && high - v >= GUARD_DELTA) { direction = -1; low = v; event = true; }
    else if (direction <= 0 && v - low >= GUARD_DELTA) { direction = 1; high = v; event = true; }
    if (event) events.push(frame);
    worst = Math.max(worst, events.filter(at => at > frame - FPS).length);
  });
  return worst;
}
function run(signal: (frame: number) => number, seconds = 10, fps = FPS) {
  let tile = newGuardTile(signal(0));
  const shown: number[] = [signal(0)];
  for (let f = 1; f < seconds * fps; f++) { const next = stepGuardTile(tile, signal(f), 1 / fps); shown.push(next.shown); tile = next; }
  return shown;
}
const square = (hz: number, low: number, high: number) => (f: number) => Math.floor(2 * hz * f / FPS) % 2 === 0 ? high : low;

test('fast full-range flashing never exceeds three flashes in any second', () => {
  for (const hz of [4, 5, 8, 10, 15, 20, 30]) {
    const unguarded = Array.from({ length: 600 }, (_, f) => square(hz, 0, 1)(f));
    assert.ok(worstReversals(unguarded) > 6, `${hz} Hz is a real flash before the guard`);
    assert.ok(worstReversals(run(square(hz, 0, 1))) <= 6, `${hz} Hz`);
  }
});

test('small and dim flashes are limited too', () => {
  for (const [low, high] of [[.02, .06], [.4, .46], [.9, 1]]) assert.ok(worstReversals(run(square(12, low, high))) <= 6, `${low}-${high}`);
});

test('slow changes and flashes within the limit pass through untouched', () => {
  const slow = (f: number) => .5 + .45 * Math.sin(f / FPS);
  run(slow).forEach((v, f) => assert.equal(v, slow(f)));
  const allowed = square(2, .1, .9);
  run(allowed).forEach((v, f) => assert.equal(v, allowed(f)));
});

test('a still picture is never changed', () => {
  let tile = newGuardTile(.37);
  for (let f = 0; f < 600; f++) { const next = stepGuardTile(tile, .37, 1 / FPS); assert.equal(next.blend, 0); tile = next; }
});

test('the guard recovers once the flashing stops', () => {
  const signal = (f: number) => f < 300 ? square(15, 0, 1)(f) : .8;
  const shown = run(signal, 8);
  assert.equal(shown[shown.length - 1], .8);
});

test('a stalled or broken frame time cannot bypass the rule', () => {
  for (const seconds of [NaN, -1, Infinity]) {
    let tile = newGuardTile(0);
    const shown: number[] = [];
    for (let f = 0; f < 240; f++) { const next = stepGuardTile(tile, f % 2 ? 1 : 0, seconds); shown.push(next.shown); tile = next; }
    assert.ok(worstReversals(shown) <= 6, String(seconds));
    assert.ok(shown.every(Number.isFinite));
  }
});

test('a held cell blends towards its last frame, and never makes a bad number', () => {
  assert.equal(guardBlend(.8, .5, .2), .5);
  assert.equal(guardBlend(.8, .1, .2), 1, 'never past the last frame');
  assert.equal(guardBlend(.5, .4, .5), 0, 'no difference to blend');
  assert.ok(Number.isFinite(guardBlend(0, 0, 0)));
  assert.ok(flashGuardApplyGLSL.includes('uGuardPrevious'));
});

/** A screen of 100 cells where the first `lit` flash at hz and the rest stay still, run through the area gate. */
function runScreen(lit: number, hz: number, seconds = 6) {
  const flash = square(hz, 0, 1);
  let tiles = Array.from({ length: 100 }, (_, i) => newGuardTile(i < lit ? flash(0) : .4)), timer = 0;
  const shown: number[][] = tiles.map((_, i) => [i < lit ? flash(0) : .4]);
  for (let f = 1; f < seconds * FPS; f++) {
    const holding = timer > 0;
    tiles = tiles.map((tile, i) => { const next = stepGuardTile(tile, i < lit ? flash(f) : .4, 1 / FPS, holding, guardSoftness(timer, 1 / FPS)); shown[i].push(next.shown); return next; });
    timer = stepGuardGate(timer, tiles.filter(t => t.tokens < 0).length / 100, 1 / FPS);
  }
  return { shown, flash };
}

test('flashing over a small part of the screen is left alone', () => {
  const { shown, flash } = runScreen(10, 10);
  shown[0].forEach((v, f) => assert.equal(v, flash(f)));
});

test('flashing over a large part of the screen is limited everywhere it happens', () => {
  for (const lit of [20, 30, 60, 100]) for (const hz of [5, 10, 30]) {
    const { shown } = runScreen(lit, hz);
    assert.ok(worstReversals(shown[0]) <= 6, `${lit}% at ${hz} Hz`);
  }
});

test('one big cut is never held', () => {
  let tiles = Array.from({ length: 100 }, () => newGuardTile(.1)), timer = 0;
  for (let f = 0; f < 120; f++) {
    const level = f < 60 ? .1 : .9, holding = timer > 0;
    tiles = tiles.map(tile => { const next = stepGuardTile(tile, level, 1 / FPS, holding); assert.equal(next.shown, level); return next; });
    timer = stepGuardGate(timer, tiles.filter(t => t.tokens < 0).length / 100, 1 / FPS);
  }
});

test('the gate stays on past the counting window, then lets go', () => {
  assert.ok(stepGuardGate(0, .3, 1 / FPS) > 1);
  assert.equal(stepGuardGate(0, .1, 1 / FPS), 0);
  assert.ok(flashGuardGateGLSL.includes('uGuardGateLast'));
});

test('smoothing is off with the gate open and fades out as it closes', () => {
  assert.equal(guardSoftness(0, 1 / FPS), 0);
  assert.equal(guardSoftness(1, 0), 0, 'a redraw with no time passed is not smoothed');
  assert.ok(guardSoftness(1, 1 / FPS) > .7);
  assert.ok(guardSoftness(.05, 1 / FPS) < guardSoftness(.2, 1 / FPS));
  for (const seconds of [NaN, -1, Infinity]) assert.ok(Number.isFinite(guardSoftness(1, seconds)));
});

test('the shader carries the same limits', () => {
  assert.ok(flashGuardStepGLSL.includes(String(GUARD_DELTA)));
  for (const needle of ['uGuardReset', 'texelFetch', 'tokens -= 1.']) assert.ok(flashGuardStepGLSL.includes(needle), needle);
});
