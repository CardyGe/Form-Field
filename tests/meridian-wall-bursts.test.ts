import test from 'node:test';
import assert from 'node:assert/strict';
import { FlashGuard } from '../src/meridian/flash-guard';
import { WALL_CELLS, WallFlashGuard, wallGuardPolicy } from '../src/meridian/wall-guard';

const FPS = 60, SECONDS = 30, LIMIT = 6, BRIGHT = .8, DARK = .02;
const settings = wallGuardPolicy([{ layers: [{ kind: 'meridian', visible: true, params: {} }] }]).settings;
const BURSTS = [{ pulses: 5, hz: 15, gap: .5 }, { pulses: 4, hz: 10, gap: .5 }, { pulses: 3, hz: 10, gap: .35 }, { pulses: 3, hz: 5, gap: .35 }];

const wall = (light: number) => {
  const out = new Uint8Array(WALL_CELLS * 4), v = Math.round(Math.sqrt(light) * 255);
  for (let i = 0; i < WALL_CELLS; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
  return out;
};
const BRIGHT_WALL = wall(BRIGHT), DARK_WALL = wall(DARK);

/** Full-field light for each frame: bursts of pulses with a dark gap between them. */
function burstLight({ pulses, hz, gap }: typeof BURSTS[number]): Float32Array {
  const out = new Float32Array(FPS * SECONDS), burst = pulses / hz, cycle = burst + gap;
  for (let f = 0; f < out.length; f++) {
    const t = (f / FPS) % cycle;
    out[f] = t < burst && (t * hz) % 1 < .5 ? BRIGHT : DARK;
  }
  return out;
}

/** The changes of over 10% light in the worst second, and how many seconds' windows go over the limit. */
function count(shown: ArrayLike<number>): { worst: number; over: number } {
  const events: number[] = []; let anchor = shown[0], way = 0;
  for (let f = 1; f < shown.length; f++) {
    const v = shown[f];
    if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - .1 && v < .8) { way = -1; anchor = v; events.push(f); }
    else if (way <= 0 && v >= anchor + .1 && anchor < .8) { way = 1; anchor = v; events.push(f); }
  }
  let worst = 0; const bad = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    let n = 0; for (let k = i; k < events.length && events[k] < events[i] + FPS; k++) n++;
    worst = Math.max(worst, n); if (n > LIMIT) bad.add(Math.floor(events[i] / FPS));
  }
  return { worst, over: bad.size };
}

for (const burst of BURSTS) {
  const name = `${burst.pulses} pulses at ${burst.hz} Hz, ${burst.gap} s apart`;
  for (const lag of [1, 2]) test(`wall guard, ${lag} frame${lag > 1 ? 's' : ''} late: ${name}`, () => {
    const light = burstLight(burst), guard = new WallFlashGuard(), shown = new Float32Array(light.length);
    for (let f = 0; f < light.length; f++) {
      guard.step(1 / FPS, light[Math.max(0, f - lag)] > .5 ? BRIGHT_WALL : DARK_WALL, settings);
      shown[f] = light[f] * guard.gain;
    }
    const raw = count(light), seen = count(shown);
    assert.ok(raw.worst > LIMIT, `the pattern is over the limit unguarded (${raw.worst})`);
    assert.ok(seen.worst <= LIMIT, `${seen.worst} changes in a second, over the limit in ${seen.over} of ${SECONDS} s`);
  });
  test(`same-frame FlashGuard: ${name}`, () => {
    const light = burstLight(burst), guard = new FlashGuard(), shown = new Float32Array(light.length);
    for (let f = 0; f < light.length; f++) shown[f] = light[f] * guard.update(1 / FPS, light[f], 1, 0, { ...settings });
    const seen = count(shown);
    assert.ok(seen.worst <= LIMIT, `${seen.worst} changes in a second, over the limit in ${seen.over} of ${SECONDS} s`);
  });
}

test('the wall dim is held through a burst pattern, and only lifts after a clear second', () => {
  const light = burstLight(BURSTS[1]), guard = new WallFlashGuard();
  let lastBurst = 0, liftedEarly = false, lowest = 1;
  for (let f = 0; f < 600; f++) {
    const before = guard.gain;
    guard.step(1 / FPS, light[f] > .5 ? BRIGHT_WALL : DARK_WALL, settings);
    if (light[f] > .5) lastBurst = f;
    lowest = Math.min(lowest, guard.gain);
    if (f > 180 && guard.gain > before + 1e-6 && f - lastBurst < FPS * .9) liftedEarly = true;
  }
  assert.ok(lowest < .3); assert.equal(liftedEarly, false, 'the dim rose inside the pattern');
  for (let f = 0; f < 240; f++) guard.step(1 / FPS, DARK_WALL, settings);
  assert.equal(guard.gain, 1, 'and comes all the way back after the pattern ends');
});

test('a legal full-wall beat, two short pulses a second, is not dimmed', () => {
  const guard = new WallFlashGuard();
  for (let f = 0; f < 1200; f++) { guard.step(1 / FPS, f % 30 < 3 ? BRIGHT_WALL : DARK_WALL, settings); assert.equal(guard.gain, 1, `frame ${f}`); }
});

test('easing out after the guard is switched off never steps hard, and ends at exactly 1', () => {
  const guard = new WallFlashGuard();
  for (let f = 0; f < 120; f++) guard.step(1 / FPS, f % 6 < 3 ? BRIGHT_WALL : DARK_WALL, settings);
  assert.ok(guard.gain < .5);
  let last = guard.gain, frames = 0;
  while (!guard.easeOut(1 / FPS) && frames < 600) { assert.ok(guard.gain - last <= .05, `step ${guard.gain - last}`); last = guard.gain; frames++; }
  assert.ok(frames > 5, 'it took time'); assert.equal(guard.gain, 1); assert.equal(guard.saturation, Infinity);
});
