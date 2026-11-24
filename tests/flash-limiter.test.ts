import test from 'node:test';
import assert from 'node:assert/strict';
import { FlashLimiter, type FlashCorrection } from '../src/map/flash-limiter';

const W = 64, H = 36, FPS = 60;
const toLinear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const toByte = (v: number) => Math.round((v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055) * 255);
type Rgb = [number, number, number];

/** A picture from linear colour, with `area` of its rows lit and the rest black. */
function picture(colour: Rgb, area = 1): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4), rows = Math.round(H * area);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, c = y < rows ? colour : [0, 0, 0];
    data[i] = toByte(c[0]); data[i + 1] = toByte(c[1]); data[i + 2] = toByte(c[2]); data[i + 3] = 255;
  }
  return data;
}
function corrected(c: Rgb, f: FlashCorrection): Rgb {
  const l = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  return c.map(v => (l + (v - l) * f.redScale) * f.gain) as Rgb;
}
/** Independent referee: opposing transitions in brightness or saturated red at the output, as flashes in the worst second. */
function worstFlashes(frames: Rgb[]): number {
  const times = (measure: (c: Rgb) => number, size: number) => {
    const out: number[] = []; let extreme = measure(frames[0]), direction = 0;
    frames.forEach((c, n) => {
      const v = measure(c);
      if (direction > 0 && v > extreme || direction < 0 && v < extreme) extreme = v;
      if (Math.abs(v - extreme) >= size) { const d = Math.sign(v - extreme); if (d !== direction) { out.push(n); direction = d; } extreme = v; }
    });
    return out;
  };
  const worst = (t: number[]) => { let most = 0; for (let i = 0; i < t.length; i++) { let n = 0; while (i + n < t.length && t[i + n] - t[i] < FPS) n++; most = Math.max(most, Math.floor(n / 2)); } return most; };
  const luminance = times(c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2], .1);
  const red = times(c => { const sum = c[0] + c[1] + c[2]; return sum > 0 && c[0] / sum >= .8 ? Math.max(0, (c[0] - c[1] - c[2]) * 320) : 0; }, 20);
  return Math.max(worst(luminance), worst(red));
}
/** Plays a source through the limiter with the correction arriving two frames late, as a real readback does. */
function play(source: (n: number) => Rgb, seconds = 4, limiter = new FlashLimiter()): { out: Rgb[]; corrections: FlashCorrection[] } {
  const corrections: FlashCorrection[] = [], out: Rgb[] = [];
  for (let n = 0; n < seconds * FPS; n++) {
    const c = source(n);
    corrections.push(limiter.push(picture(c), W, H, n / FPS));
    out.push(corrected(c, corrections[n - 2] ?? { gain: 1, redScale: 1 }));
  }
  return { out, corrections };
}
const square = (hz: number, on: Rgb, off: Rgb = [0, 0, 0]) => (n: number): Rgb => Math.floor(n / FPS * hz * 2) % 2 === 0 ? on : off;

test('a steady picture is untouched', () => {
  for (const f of play(() => [.7, .3, .5]).corrections) assert.deepEqual(f, { gain: 1, redScale: 1 });
});

test('2 Hz pulses pass unchanged', () => {
  for (const f of play(square(2, [1, 1, 1])).corrections) assert.deepEqual(f, { gain: 1, redScale: 1 });
});

test('10 Hz full-frame white is limited to 3 flashes in any second', () => {
  const { out } = play(square(10, [1, 1, 1]));
  assert.ok(worstFlashes(out) <= 3, `${worstFlashes(out)} flashes`);
});

test('10 Hz saturated red is limited to 3 flashes in any second', () => {
  const { out } = play(square(10, [1, 0, 0]));
  assert.ok(worstFlashes(out) <= 3, `${worstFlashes(out)} flashes`);
});

test('a Map brightness link at 10 Hz on a red look stays within the limit', () => {
  const look: Rgb = [.8, .06, .12];
  const { out } = play(n => { const b = Math.floor(n / FPS * 20) % 2 === 0 ? 1 : .15; return look.map(v => v * b) as Rgb; });
  assert.ok(worstFlashes(out) <= 3, `${worstFlashes(out)} flashes`);
});

test('10 Hz flash on 5% of the frame is ignored', () => {
  const limiter = new FlashLimiter();
  for (let n = 0; n < 240; n++) {
    const on = Math.floor(n / FPS * 20) % 2 === 0;
    assert.deepEqual(limiter.push(picture(on ? [1, 1, 1] : [0, 0, 0], .05), W, H, n / FPS), { gain: 1, redScale: 1 });
  }
});

test('limiter releases smoothly within 2 seconds', () => {
  const flashing = square(10, [1, 1, 1]);
  const { corrections } = play(n => n < 180 ? flashing(n) : [.5, .5, .5], 7);
  const after = corrections.slice(180 + 60);
  for (let i = 1; i < after.length; i++) assert.ok(after[i].gain - after[i - 1].gain <= .08 + 1e-9, 'gain jumped upward');
  assert.deepEqual(corrections[180 + 60 + 120], { gain: 1, redScale: 1 });
});

test('a disabled limiter never changes the picture', () => {
  for (const f of play(square(10, [1, 1, 1]), 2, new FlashLimiter(false)).corrections) assert.deepEqual(f, { gain: 1, redScale: 1 });
});

test('a jump backwards in time cannot leave the picture dimmed', () => {
  const limiter = new FlashLimiter(), flashing = square(10, [1, 1, 1]);
  for (let n = 0; n < 120; n++) limiter.push(picture(flashing(n)), W, H, 100 + n / FPS);
  let last: FlashCorrection = { gain: 0, redScale: 0 };
  for (let n = 0; n < 240; n++) last = limiter.push(picture([.5, .5, .5]), W, H, n / FPS);
  assert.deepEqual(last, { gain: 1, redScale: 1 });
});

test('the referee itself sees an uncorrected 10 Hz flash', () => {
  const frames = Array.from({ length: 240 }, (_, n) => square(10, [1, 1, 1])(n));
  assert.ok(worstFlashes(frames) >= 9);
  assert.ok(toLinear(1) === 1);
});
