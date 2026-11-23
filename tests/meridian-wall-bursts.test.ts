import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITER, limiterScales, stepLimiterFade, WallLimiter } from '../src/meridian/wall-limiter';

const COLS = 48, ROWS = 27, CELLS = COLS * ROWS, BRIGHT = .8, DARK = .02, SECONDS = 12, LIMIT = 6;
type Light = (t: number, col: number) => number;
const burst = (pulses: number, hz: number, gap: number): Light => { const length = pulses / hz, cycle = length + gap; return t => { const at = ((t % cycle) + cycle) % cycle; return at < length && (at * hz) % 1 < .5 ? BRIGHT : DARK; }; };
const strobe = (hz: number): Light => t => (((t * hz) % 1) + 1) % 1 < .5 ? BRIGHT : DARK;
const PATTERNS: Record<string, Light> = {
  '5 pulses 15 Hz, 0.5 s gap': burst(5, 15, .5), '4 pulses 10 Hz, 0.5 s gap': burst(4, 10, .5), '3 pulses 10 Hz, 0.35 s gap': burst(3, 10, .35), '3 pulses 5 Hz, 0.35 s gap': burst(3, 5, .35),
  'halves in antiphase at 5 Hz': (t, col) => strobe(5)(col < COLS / 2 ? t : t + .1, col), 'sustained 5 Hz': strobe(5), 'sustained 10 Hz': strobe(10), 'sustained 15 Hz': strobe(15),
};
/** Frame times, regular or irregular, repeatably. */
function clock(fps: number, irregular: boolean): number[] {
  const times: number[] = []; let t = 0, seed = 12345;
  while (t < SECONDS) { times.push(t); seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; t += irregular ? (.55 + .9 * (seed / 4294967296)) / fps : 1 / fps; }
  return times;
}
/** Counted from the output alone: a change is over 25% of the cells moving 0.1 one way, as the export checks count it. */
function worstSecond(series: Float32Array[], times: number[], step = .1, darker = .8): number {
  const anchor = Float32Array.from(series[0]), way = new Int8Array(CELLS), events: number[] = []; let last = 0;
  for (let f = 1; f < series.length; f++) {
    const v = series[f]; let up = 0, down = 0;
    for (let i = 0; i < CELLS; i++) {
      if (way[i] === 1 && v[i] > anchor[i]) anchor[i] = v[i]; if (way[i] === -1 && v[i] < anchor[i]) anchor[i] = v[i];
      if (way[i] >= 0 && v[i] <= anchor[i] - step && v[i] < darker) { way[i] = -1; anchor[i] = v[i]; down++; }
      else if (way[i] <= 0 && v[i] >= anchor[i] + step && anchor[i] < darker) { way[i] = 1; anchor[i] = v[i]; up++; }
    }
    const rose = up > .25 * CELLS, fell = down > .25 * CELLS;
    if (rose && fell) { events.push(times[f]); last = 0; } else if (rose && last !== 1) { events.push(times[f]); last = 1; } else if (fell && last !== -1) { events.push(times[f]); last = -1; }
  }
  let worst = 0;
  for (let i = 0; i < events.length; i++) { let n = 0; for (let k = i; k < events.length && events[k] < events[i] + 1; k++) n++; worst = Math.max(worst, n); }
  return worst;
}
function run(light: Light, times: number[], phase: number, startFromPicture = false) {
  const limiter = new WallLimiter(CELLS), input = new Float32Array(CELLS), red = new Float32Array(CELLS), raw: Float32Array[] = [], out: Float32Array[] = [];
  if (startFromPicture) for (let r = 0, i = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++, i++) input[i] = light(phase, c); else input.fill(DARK);
  limiter.step(0, input, red);
  times.forEach((t, f) => {
    for (let r = 0, i = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++, i++) input[i] = light(t + phase, c);
    limiter.step(f ? t - times[f - 1] : 1 / 60, input, red);
    raw.push(input.slice()); out.push(limiter.shown.slice());
  });
  return { raw, out };
}

const results: string[] = [];
for (const [name, light] of Object.entries(PATTERNS)) test(`no second holds more than six changes: ${name}`, () => {
  let worst = 0, rawWorst = 0;
  for (const fps of [30, 50, 60, 120]) for (const irregular of [false, true]) for (let p = 0; p < 5; p++) {
    const times = clock(fps, irregular), { raw, out } = run(light, times, p * .137);
    worst = Math.max(worst, worstSecond(out, times)); rawWorst = Math.max(rawWorst, worstSecond(raw, times));
    assert.ok(worst <= LIMIT, `${worst} changes at ${fps} fps${irregular ? ' irregular' : ''}, phase ${p}`);
  }
  assert.ok(rawWorst > LIMIT, `the pattern is over the limit unguarded (${rawWorst})`);
  results.push(`${name}: raw ${rawWorst}, limited ${worst}`);
});

test('the first bright frame is limited, at every frame rate', () => {
  for (const fps of [30, 50, 60, 120]) { const { out } = run(strobe(5), clock(fps, false), 0); assert.ok(out[0][0] <= DARK + LIMITER.band + 1e-6, `${fps} fps: ${out[0][0]}`); }
});

for (const bpm of [120, 128, 140, 150, 160, 174]) test(`${bpm} BPM with a 0.12 s pulse keeps a visible beat within the limit`, () => {
  const period = 60 / bpm, beat: Light = t => ((t % period) + period) % period < .12 ? BRIGHT : DARK;
  for (const fps of [30, 60, 120]) for (let p = 0; p < 5; p++) {
    const times = clock(fps, false), { out } = run(beat, times, p * .07), late = out.slice(Math.floor(out.length / 2)).map(o => o[100]);
    assert.ok(worstSecond(out, times) <= LIMIT);
    const top = Math.max(...late), bottom = Math.min(...late);
    assert.ok(top - bottom >= .08, `${fps} fps: the beat swings only ${(top - bottom).toFixed(3)}`);
    assert.ok(top >= DARK + .08, `${fps} fps: pinned at ${top.toFixed(3)}`);
  }
});

test('a held bright picture arrives in under a second and is then exact', () => {
  const light: Light = t => t < 1 ? DARK : BRIGHT, times = clock(60, false), { out } = run(light, times, 0);
  assert.ok(out[60][0] <= DARK + LIMITER.band + 1e-6);
  assert.equal(out[240][0], Math.fround(BRIGHT));
});

test('calm light and a small flashing area pass exactly', () => {
  const calm: Light = (t, c) => .2 + .04 * Math.sin(t * 1.6 + c / 9), times = clock(60, true), a = run(calm, times, 0, true);
  a.out.forEach((o, f) => assert.deepEqual(o, a.raw[f]));
  const small: Light = (t, c) => c < COLS * .15 ? strobe(10)(t, c) : DARK, b = run(small, clock(60, false), 0);
  b.out.forEach((o, f) => assert.deepEqual(o, b.raw[f]));
});

test('it never adds light, and a fall follows the picture at once', () => {
  const times = clock(60, true), { raw, out } = run(burst(5, 15, .5), times, .2);
  out.forEach((o, f) => { for (let i = 0; i < CELLS; i += 97) assert.ok(o[i] <= raw[f][i] + 1e-6); });
});

test('saturated red is bounded to two flashes a second', () => {
  const limiter = new WallLimiter(CELLS), light = new Float32Array(CELLS), red = new Float32Array(CELLS), times = clock(60, false), out: Float32Array[] = [];
  limiter.step(0, light, red);
  times.forEach((t, f) => { red.fill(strobe(5)(t, 0) > .5 ? .7 : 0); limiter.step(f ? t - times[f - 1] : 1 / 60, light, red); out.push(limiter.red.slice()); });
  const worst = worstSecond(out, times, .0625, 2);
  assert.ok(worst <= 4, `${worst} red changes in a second`);
});

test('lower Max flashes and Red limit settings lengthen the holds', () => {
  assert.deepEqual(limiterScales({ safetyMaxFlashes: 3, safetyRedLimit: 1 }), { light: 1, red: 1 });
  assert.deepEqual(limiterScales({ safetyMaxFlashes: 1, safetyRedLimit: 1 }), { light: 3, red: 2 });
  assert.deepEqual(limiterScales({ safetyMaxFlashes: 3, safetyRedLimit: .5 }), { light: 1, red: 2 });
  const limiter = new WallLimiter(CELLS), light = new Float32Array(CELLS), red = new Float32Array(CELLS), times = clock(60, false), out: Float32Array[] = [];
  limiter.setScales(limiterScales({ safetyMaxFlashes: 1, safetyRedLimit: 1 }));
  limiter.step(0, light, red);
  times.forEach((t, f) => { light.fill(burst(1, 2, .1)(t, 0)); limiter.step(f ? t - times[f - 1] : 1 / 60, light, red); out.push(limiter.shown.slice()); });
  assert.ok(worstSecond(out, times) <= 2, `${worstSecond(out, times)} changes with one flash allowed`);
});

test('a stalled frame cannot arrive as one large jump', () => {
  const limiter = new WallLimiter(CELLS), input = new Float32Array(CELLS).fill(DARK), red = new Float32Array(CELLS);
  limiter.step(0, input, red); limiter.step(1, input, red);
  input.fill(BRIGHT); limiter.step(.5, input, red);
  assert.ok(limiter.shown[0] <= DARK + Math.max(LIMITER.band, LIMITER.climb * LIMITER.longestClimb) + 1e-6, `${limiter.shown[0]}`);
});

test('strange frame times cannot break it', () => {
  const limiter = new WallLimiter(CELLS), input = new Float32Array(CELLS).fill(DARK), red = new Float32Array(CELLS);
  limiter.step(0, input, red); input.fill(BRIGHT);
  for (const dt of [Number.NaN, -1, 0]) { limiter.step(dt, input, red); assert.ok(limiter.shown[0] <= DARK + LIMITER.band + 1e-6); }
});

// ---- Round 3: patterns that took turns, leaked gain or ratcheted past the rule. Counted per cell on what is shown. ----
const WALL_COLS = 48, WALL_ROWS = 27;
/** The worst changes any cell makes in a second, and the largest share of the wall over six at once. */
function perCell(series: Float32Array[], fps: number): { worst: number; together: number } {
  const counts: number[][] = Array.from({ length: CELLS }, () => []);
  for (let i = 0; i < CELLS; i++) {
    let anchor = series[0][i], way = 0;
    for (let f = 1; f < series.length; f++) {
      const v = series[f][i];
      if (way === 1 && v > anchor) anchor = v; if (way === -1 && v < anchor) anchor = v;
      if (way >= 0 && v <= anchor - .1 && v < .8) { way = -1; anchor = v; counts[i].push(f); }
      else if (way <= 0 && v >= anchor + .1 && anchor < .8) { way = 1; anchor = v; counts[i].push(f); }
    }
  }
  let worst = 0, together = 0;
  for (let start = 0; start + fps <= series.length; start += 3) {
    let over = 0;
    for (const list of counts) { let n = 0; for (const f of list) if (f >= start && f < start + fps) n++; worst = Math.max(worst, n); if (n > LIMIT) over++; }
    together = Math.max(together, over / CELLS);
  }
  return { worst, together };
}
function frames(light: (f: number, col: number, row: number) => number, count: number, fps = 60) {
  const limiter = new WallLimiter(CELLS), input = new Float32Array(CELLS), red = new Float32Array(CELLS), out: Float32Array[] = [];
  limiter.step(0, input, red);
  for (let f = 0; f < count; f++) {
    for (let r = 0, i = 0; r < WALL_ROWS; r++) for (let c = 0; c < WALL_COLS; c++, i++) input[i] = light(f, c, r);
    limiter.step(1 / fps, input, red);
    out.push(limiter.shown.slice());
  }
  return out;
}
const on5 = (f: number, shift = 0) => ((((f / 60 + shift) * 5) % 1) + 1) % 1 < .5;
const TAKING_TURNS: Record<string, (f: number, c: number, r: number) => number> = {
  'a one-cell checker at 5 Hz': (f, c, r) => on5(f) === ((c + r) % 2 === 0) ? 1 : 0,
  'a two-cell checker at 5 Hz': (f, c, r) => on5(f) === ((Math.floor(c / 2) + Math.floor(r / 2)) % 2 === 0) ? 1 : 0,
  'one-cell stripes at 5 Hz': (f, c) => on5(f) === (c % 2 === 0) ? 1 : 0,
  'two 18.75% bands in antiphase': (f, c) => c < 9 ? (on5(f) ? 1 : 0) : c < 18 ? (on5(f) ? 0 : 1) : 0,
  'four 18.75% bands 55 ms apart': (f, c) => { const band = Math.floor(c / 9); return band < 4 && on5(f, band * .055) ? 1 : 0; },
};
for (const [name, light] of Object.entries(TAKING_TURNS)) test(`no part of the wall over the flash area breaks the limit: ${name}`, () => {
  const { worst, together } = perCell(frames(light, 480), 60);
  results.push(`${name}: worst ${worst}, over the limit together ${(together * 100).toFixed(1)}%`);
  assert.ok(together < .25, `${(together * 100).toFixed(1)}% of the wall over the limit, worst ${worst}`);
});

test('a ratchet of small falls cannot climb past the threshold', () => {
  const steps = [0, 1, .009, 1, .018, 1, .027, 1, .036, 1, .045, 1];
  const out = frames(f => f < 2 ? 0 : steps[f % steps.length], 480), { worst, together } = perCell(out, 60);
  let peak = 0; for (const o of out) peak = Math.max(peak, o[0]);
  results.push(`ratchet: worst ${worst}, together ${(together * 100).toFixed(1)}%, peak ${peak.toFixed(3)}`);
  assert.ok(worst <= LIMIT, `${worst} changes`); assert.equal(together, 0);
});

// ---- Rounds 4 and 5: light that changes inside a block while a steady pixel holds its brightest pixel up. ----
function underSteadyPeak(report: (f: number) => { fell: number; drop: number; hot: number }, count = 360) {
  const limiter = new WallLimiter(CELLS), light = new Float32Array(CELLS).fill(1), red = new Float32Array(CELLS), none = new Float32Array(CELLS), noFlags = new Uint8Array(CELLS);
  const lightFell = new Uint8Array(CELLS), lightDrop = new Float32Array(CELLS), lightHot = new Float32Array(CELLS), out: number[] = [];
  limiter.step(0, light, red);
  for (let f = 0; f < count; f++) {
    const d = report(f); lightFell.fill(d.fell); lightDrop.fill(d.drop); lightHot.fill(d.hot);
    limiter.step(1 / 60, light, red, { lightFell, lightDrop, lightHot, redFell: noFlags, redDrop: none, redHot: none });
    out.push(limiter.shown[0]);
  }
  return out;
}

test('pixels flashing behind a steady bright pixel are limited, though the block peak never moves', () => {
  const out = underSteadyPeak(f => f % 6 === 0 ? { fell: 1, drop: 0, hot: f >= 12 ? 1 : 0 } : { fell: 0, drop: 1, hot: f >= 12 ? 1 : 0 });
  assert.ok(Math.max(...out.slice(30)) <= LIMITER.band + 1e-6, `peak ${Math.max(...out.slice(30))}`);
});

test('a block whose pixels report nothing passes exactly', () => {
  assert.ok(underSteadyPeak(() => ({ fell: 0, drop: 1, hot: 0 })).every(v => v === 1));
});

test('a slow ramp is followed from where it turned, so it counts as a flash', () => {
  const ramp: Light = t => { const at = ((t * 5) % 1 + 1) % 1; return .45 * (1 - Math.abs(2 * at - 1)); };
  const times = clock(60, false), { raw, out } = run(ramp, times, 0);
  assert.ok(worstSecond(raw, times) > LIMIT); assert.ok(worstSecond(out, times) <= LIMIT, `${worstSecond(out, times)} changes`);
});

test('switching the guard back on during its ease-out returns the limit gradually', () => {
  let fade: number | null = 0;
  for (let f = 0; f < 120; f++) fade = stepLimiterFade(fade!, 1 / 60, false);
  assert.ok(Math.abs(fade! - .5) < 1e-6);
  let frames = 0, last = fade!;
  while (fade !== null) { fade = stepLimiterFade(fade, 1 / 60, true); if (fade !== null) { assert.ok(last - fade <= 1 / (60 * LIMITER.fadeSeconds) + 1e-9); last = fade; } frames++; }
  assert.ok(frames >= 119, `back in ${frames} frames`);
  assert.equal(stepLimiterFade(.999, 1, false), null, 'and off, it finishes');
});

test.after(() => console.log(results.join('\n')));
