import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLayer, createProject, validateProject } from '../src/core/project';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { advanceTransport, createTransport, evaluatePulse, exactClock, pulseHeroFires, pulseRate, pulseTickSeconds, SCORE_STYLE_DENSE, SCORE_STYLE_PULSE, type PulseClock } from '../src/meridian/pulse';
import { PRIMITIVE } from '../src/meridian/types';

const clock = (): PulseClock => ({ phrase: 0, tick: 0, frac: 0, ticks: 128, tickSeconds: 0.06 });
const at = (phrase: number, tick: number, frac = 0.3): PulseClock => ({ phrase, tick, frac, ticks: 128, tickSeconds: 60 / 124 / 8 });
const draw = (c: PulseClock, params: Record<string, number> = {}, seed = 1729) => { const list = new DisplayList(4000); evaluatePulse(seed, c, { ...MERIDIAN_DEFAULTS, ...params }, list); return list; };
const bytes = (list: DisplayList) => Array.from(list.data.subarray(0, list.count * STRIDE));
const ringRadii = (list: DisplayList) => { const radii: number[] = []; for (let i = 0; i < list.count; i++) if (list.data[i * STRIDE] === PRIMITIVE.ring) radii.push(list.data[i * STRIDE + 3]); return radii; };

test('a project saved before Pulse keeps the Dense look', () => {
  const old = createLayer('meridian');
  delete old.params.scoreStyle;
  assert.equal(validateProject({ ...createProject(), layers: [old] }).layers[0].params.scoreStyle, SCORE_STYLE_DENSE);
});

test('a frame depends only on seed, params and musical time, in any order', () => {
  const first = bytes(draw(at(2, 40)));
  draw(at(7, 90)); draw(at(0, 3), {}, 99); draw(at(5, 11));
  assert.deepEqual(bytes(draw(at(2, 40))), first);
});

test('between hits the picture holds still', () => {
  // Spokes may turn slowly and a hero's light decays, but once a hit has landed no ring moves until the next one.
  for (let phrase = 0; phrase < 6; phrase++) for (let tick = 0; tick < 128; tick++) {
    assert.deepEqual(ringRadii(draw(at(phrase, tick, .9), { macroTension: 0 })), ringRadii(draw(at(phrase, tick, .99), { macroTension: 0 })), `phrase ${phrase} tick ${tick}`);
  }
});

test('phrases differ from one another across a long run', () => {
  const seen = new Set<string>();
  for (let phrase = 0; phrase < 64; phrase++) seen.add(JSON.stringify(bytes(draw(at(phrase, 50)))));
  assert.ok(seen.size >= 60, `${seen.size} of 64`);
});

test('each phrase ends on a single dot', () => {
  for (let phrase = 0; phrase < 8; phrase++) {
    const list = draw(at(phrase, 126));
    assert.equal(list.count, 1);
    assert.equal(list.data[0], PRIMITIVE.dot);
  }
});

test('an export holds a whole number of phrases and closes', () => {
  for (const duration of [2, 7.7, 10, 20, 33.3]) for (const macroSpeed of [0, .5, 1]) {
    const params = { ...MERIDIAN_DEFAULTS, macroSpeed };
    const start = exactClock(0, duration, params, clock()), end = exactClock(1, duration, params, clock());
    assert.deepEqual(end, start);
    const last = exactClock(1 - 1e-7, duration, params, clock());
    assert.ok(last.tick === last.ticks - 1, `${duration}s ends on the last tick`);
    assert.ok(Math.abs(Math.round(duration / (last.tickSeconds * last.ticks)) - duration / (last.tickSeconds * last.ticks)) < 1e-6);
  }
});

test('the preview runs past the project loop, stands still when paused, and scrubs', () => {
  const t = createTransport(), params = { ...MERIDIAN_DEFAULTS }, out = clock(), duration = 2;
  let phase = 0, phrases = new Set<number>();
  advanceTransport(t, phase, duration, params, out);
  for (let i = 0; i < 60 * 40; i++) { phase = (phase + (1 / 60 / duration) * Math.PI * 2) % (Math.PI * 2); advanceTransport(t, phase, duration, params, out); phrases.add(out.phrase); }
  assert.ok(phrases.size >= 5, `${phrases.size} phrases in 40 s of a 2 s project`);
  const paused = { ...advanceTransport(t, phase, duration, params, out) };
  assert.deepEqual({ ...advanceTransport(t, phase, duration, params, out) }, paused);
  const there = { ...advanceTransport(t, phase + .4, duration, params, out) };
  const back = { ...advanceTransport(t, phase, duration, params, out) };
  assert.notDeepEqual(there, paused);
  assert.equal(back.phrase, paused.phrase);
  assert.ok(Math.abs(back.tick + back.frac - paused.tick - paused.frac) < 1e-6);
});

test('Loop this phrase holds one composition', () => {
  const t = createTransport(), params = { ...MERIDIAN_DEFAULTS, scoreLoopPhrase: 1 }, out = clock();
  let phase = 0;
  advanceTransport(t, phase, 2, params, out);
  for (let i = 0; i < 2400; i++) { phase = (phase + (1 / 60 / 2) * Math.PI * 2) % (Math.PI * 2); advanceTransport(t, phase, 2, params, out); assert.equal(out.phrase, 0); }
});

test('Speed runs from a quarter to four times', () => {
  assert.equal(pulseRate(0), .25); assert.equal(pulseRate(.5), 1); assert.equal(pulseRate(1), 4);
  assert.ok(Math.abs(pulseTickSeconds({ ...MERIDIAN_DEFAULTS, macroSpeed: 0 }) / pulseTickSeconds({ ...MERIDIAN_DEFAULTS, macroSpeed: 1 }) - 16) < 1e-9);
});

test('Glitch at 0 draws no tear, and Heat at 0 draws no colour', () => {
  for (let phrase = 0; phrase < 12; phrase++) for (let tick = 0; tick < 128; tick += 2) {
    const clean = draw(at(phrase, tick), { macroGlitch: 0, macroHeat: 0, macroTension: 1 });
    for (let i = 0; i < clean.count; i++) {
      assert.notEqual(clean.data[i * STRIDE], PRIMITIVE.arc);
      assert.equal(clean.data[i * STRIDE + 8], 0);
    }
  }
});

test('hero ignitions stay under three a second at any speed and tension', () => {
  for (const macroSpeed of [0, .25, .5, .75, 1]) for (let phrase = 0; phrase < 6; phrase++) {
    const params = { ...MERIDIAN_DEFAULTS, macroSpeed, macroTension: 1 }, tickSeconds = pulseTickSeconds(params);
    let last = -Infinity, fired = 0;
    for (let tick = 0; tick < 128; tick++) {
      if (!pulseHeroFires(1729, { phrase, tick, frac: 0, ticks: 128, tickSeconds }, params, tick)) continue;
      assert.ok((tick - last) * tickSeconds >= 1 / 3, `${(tick - last) * tickSeconds}s apart at speed ${macroSpeed}`);
      last = tick; fired++;
    }
    assert.ok(fired > 0, `speed ${macroSpeed} phrase ${phrase} never fires`);
  }
});

test('the Flash guard holds heavy, fast picture changes to the flash grid, and can be turned off', () => {
  const heavy = { ...MERIDIAN_DEFAULTS, macroWeight: 1, macroSpeed: 1, macroTension: 0, macroGlitch: 0 }, tickSeconds = pulseTickSeconds(heavy);
  const every = Math.ceil(0.34 / (tickSeconds * 4)) * 4, frame = (tick: number, params: Record<string, number>) => JSON.stringify(ringRadii(draw({ phrase: 2, tick, frac: .9, ticks: 128, tickSeconds }, params)));
  let offGrid = 0, unguarded = 0;
  for (let tick = 1; tick < 100; tick++) {
    // The first few ticks after a grid hit are its short ease.
    if (tick % every >= 5 && frame(tick, heavy) !== frame(tick - 1, heavy)) offGrid++;
    if (tick % every >= 5 && frame(tick, { ...heavy, safetyFlashGuard: 0 }) !== frame(tick - 1, { ...heavy, safetyFlashGuard: 0 })) unguarded++;
  }
  assert.equal(offGrid, 0);
  assert.ok(unguarded > 0);
});

test('the Pulse hot path has no allocating syntax', () => {
  const source = readFileSync(new URL('../src/meridian/pulse.ts', import.meta.url), 'utf8');
  const hot = source.slice(source.indexOf('// HOT PATH')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/: [A-Za-z]+(?=[,)])/g, '');
  for (const pattern of [/\bnew\s/, /=>/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.\.\./, /\.(map|filter|slice|concat|flatMap|reduce|forEach)\(/, /`/]) assert.equal(pattern.test(hot), false, String(pattern));
});
