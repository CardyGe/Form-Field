import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FlashGuard, FLASH_STEP } from '../src/meridian/flash-guard';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';

const DT = 1 / 60, on = { ...MERIDIAN_DEFAULTS };
const square = (hz: number, f: number) => (Math.floor(f * DT * hz * 2 + 1e-6) % 2 ? 0.1 : 0.9);

function play(hz: number, area: number, red: number, p: Record<string, number> = on, seconds = 12) {
  const guard = new FlashGuard(), out: number[] = [], gains: number[] = [];
  for (let f = 0; f < seconds * 60; f++) { const light = square(hz, f), gain = guard.update(DT, light, area, red, p); gains.push(gain); out.push(light * gain); }
  return { out, gains };
}

/** Independent count: flashes (pairs of opposing changes of at least FLASH_STEP) in the worst 1 s window. */
function worstFlashes(out: readonly number[]): number {
  const turns: number[] = []; let anchor = out[0], way = 0;
  out.forEach((v, i) => {
    if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - FLASH_STEP) { way = -1; anchor = v; turns.push(i); }
    else if (way <= 0 && v >= anchor + FLASH_STEP) { way = 1; anchor = v; turns.push(i); }
  });
  let worst = 0;
  for (let i = 0; i < turns.length; i++) { let n = 0; for (let k = i; k < turns.length && turns[k] < turns[i] + 60; k++) n++; worst = Math.max(worst, n); }
  return Math.ceil(worst / 2);
}

test('a 5 Hz full-field strobe is limited in every 1 s window', () => { assert.ok(worstFlashes(play(5, 1, 0).out) <= 3); assert.ok(worstFlashes(play(5, 1, 0, { ...on, safetyFlashGuard: 0 }).out) >= 5); });
test('a 2 Hz pulse is unchanged', () => assert.ok(play(2, 1, 0).gains.every(g => g === 1)));
test('small-area flashes are unchanged', () => assert.ok(play(8, 0.2, 0).gains.every(g => g === 1)));
test('saturated red is limited sooner than white', () => { const red = worstFlashes(play(5, 1, 1).out), white = worstFlashes(play(5, 1, 0).out); assert.ok(red < white, `${red} / ${white}`); assert.ok(red <= 1); });
test('Flashes per second sets the limit', () => assert.ok(worstFlashes(play(5, 1, 0, { ...on, safetyMaxFlashes: 1 }).out) <= 1));
test('a lower Full-field limit engages on a smaller area, and a higher one never loosens 25%', () => {
  assert.ok(play(8, 0.2, 0, { ...on, safetyFullField: 0.2 }).gains.some(g => g < 1));
  assert.ok(worstFlashes(play(5, 0.3, 0, { ...on, safetyFullField: 1 }).out) <= 3);
});
test('disabled leaves gain at 1', () => assert.ok(play(8, 1, 1, { ...on, safetyFlashGuard: 0 }).gains.every(g => g === 1)));
test('the guard only ever lowers light, ignores a bad dt, and has no dependencies', () => {
  assert.ok(play(5, 1, 1).gains.every(g => g >= 0 && g <= 1));
  const guard = new FlashGuard(); assert.equal(guard.update(NaN, 1, 1, 0, on), 1);
  assert.ok(!/^import /m.test(readFileSync('src/meridian/flash-guard.ts', 'utf8')));
});
