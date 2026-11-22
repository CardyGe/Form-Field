import test from 'node:test';
import assert from 'node:assert/strict';
import { MACROS, applyMacros, neutralMacros, type MacroKey } from '../src/morphogen/macros';
import { MORPH_LOOKS } from '../src/morphogen/looks';
import { MorphPerformer } from '../src/morphogen/performer';
import { MORPH_CONTROLS, defaultMorphParams, validateMorphParams, type MorphParams } from '../src/morphogen/params';
import { defaultLiveSettings, validateLiveSettings } from '../src/live/settings';
import { liveTargetRange } from '../src/live/modulate';

const base = defaultMorphParams(), neutral = neutralMacros(), STEP = 1 / 60;
const run = (p: MorphPerformer, seconds: number, from: MorphParams = base) => { let out = p.frame(STEP, from, neutral); for (let i = 1; i < seconds * 60; i++) out = p.frame(STEP, from, neutral); return out; };

test('there are eight macros and centre leaves the look exactly as it is', () => {
  assert.deepEqual([...MACROS], ['growth', 'chaos', 'density', 'liquid', 'heat', 'prism', 'warp', 'impact']);
  assert.deepEqual(applyMacros(base, neutral), base);
});

test('every macro changes the picture in both directions', () => {
  for (const key of MACROS) for (const value of [0, 1]) assert.notDeepEqual(applyMacros(base, { ...neutral, [key]: value }), base, `${key} at ${value}`);
});

test('macro output is always valid', () => {
  const corners: Record<MacroKey, number>[] = [Object.fromEntries(MACROS.map(k => [k, 0])) as Record<MacroKey, number>, Object.fromEntries(MACROS.map(k => [k, 1])) as Record<MacroKey, number>];
  for (const look of MORPH_LOOKS) for (const macros of corners) {
    const out = applyMacros({ ...base, ...look.params }, macros);
    assert.deepEqual(out, validateMorphParams(out), look.name);
  }
});

test('six named party looks are valid and far apart', () => {
  assert.deepEqual(MORPH_LOOKS.map(l => l.name), ['Orchid Lens', 'Solar Fingers', 'Mercury Coral', 'Abyss Filament', 'Acid Petri', 'Twin Moons']);
  assert.equal(new Set(MORPH_LOOKS.map(l => l.params.palette)).size, 6);
  for (const look of MORPH_LOOKS) for (const [key, value] of Object.entries(look.params)) {
    const c = MORPH_CONTROLS.find(x => x.key === key);
    assert.ok(c && value >= c.min && value <= c.max, `${look.name}.${key}`);
  }
});

test('a morph moves steadily and ends exactly on its target', () => {
  const p = new MorphPerformer(), target = { ...base, ...MORPH_LOOKS[3].params };
  p.frame(STEP, base, neutral);
  p.morphTo(3, 2);
  let last = base.wavelength, direction = Math.sign(target.wavelength - base.wavelength);
  for (let i = 0; i < 119; i++) { const v = p.frame(STEP, base, neutral).params.wavelength; assert.ok((v - last) * direction >= -1e-9); last = v; }
  const end = run(p, .2).params;
  for (const c of MORPH_CONTROLS) assert.equal(end[c.key], target[c.key], c.key);
});

test('whole-number choices switch at the midpoint', () => {
  const p = new MorphPerformer();
  p.frame(STEP, base, neutral);
  p.morphTo(1, 1);
  assert.equal(p.frame(STEP, base, neutral).params.palette, base.palette);
  for (let i = 0; i < 40; i++) p.frame(STEP, base, neutral);
  assert.equal(p.frame(STEP, base, neutral).params.palette, MORPH_LOOKS[1].params.palette);
});

test('a new morph during a morph starts from the current picture', () => {
  const p = new MorphPerformer();
  p.frame(STEP, base, neutral);
  p.morphTo(1, 2);
  let before = base;
  for (let i = 0; i < 40; i++) before = p.frame(STEP, base, neutral).params;
  p.morphTo(2, 2);
  const after = p.frame(STEP, base, neutral).params;
  assert.ok(Math.abs(after.wavelength - before.wavelength) < .25, `jumped ${before.wavelength} to ${after.wavelength}`);
});

test('moving a slider after a look wins over that look', () => {
  const p = new MorphPerformer();
  p.frame(STEP, base, neutral);
  p.morphTo(1, .1);
  run(p, .5);
  const moved = { ...base, depth: 1.77 };
  assert.equal(p.frame(STEP, moved, neutral).params.depth, 1.77);
});

test('Hold stops growth and leaves colour motion alone', () => {
  const p = new MorphPerformer();
  p.hold(true);
  const out = p.frame(STEP, base, neutral).params;
  assert.equal(out.speed, 0);
  assert.equal(out.shimmer, base.shimmer);
  p.hold(false);
  assert.equal(p.frame(STEP, base, neutral).params.speed, base.speed);
});

test('Mutate stays in range and Undo restores exactly', () => {
  for (let seed = 1; seed < 40; seed++) {
    const p = new MorphPerformer();
    p.frame(STEP, base, neutral);
    p.mutate(seed);
    const mutated = run(p, 3).params;
    assert.deepEqual(mutated, validateMorphParams(mutated));
    assert.notDeepEqual(mutated, base);
    p.undo();
    assert.deepEqual(run(p, 2).params, base);
  }
});

test('Undo with nothing to undo does nothing', () => {
  const p = new MorphPerformer();
  p.undo();
  assert.deepEqual(p.frame(STEP, base, neutral).params, base);
});

test('Scramble kicks the pattern and fades to nothing within four seconds', () => {
  const p = new MorphPerformer();
  p.scramble();
  assert.ok(p.frame(STEP, base, neutral).input.seedBurst > 0);
  const end = run(p, 4);
  assert.equal(end.input.seedBurst, 0);
  assert.equal(end.input.impulse, 0);
  assert.deepEqual(end.params, base);
});

test('macros are saved, repaired and available to sound links', () => {
  const v = validateLiveSettings({ ...defaultLiveSettings(), morphogen: { ...base, growth: 9 } });
  assert.equal(v.morphogen.growth, 1);
  assert.ok(liveTargetRange('live.morphogen.impact'));
});

test('performance cues survive saving and a damaged file', () => {
  const cue = { ...defaultLiveSettings().morphogenCue, look: 4, cue: 7, seconds: 8, hold: true };
  assert.deepEqual(validateLiveSettings({ ...defaultLiveSettings(), morphogenCue: cue }).morphogenCue, cue);
  assert.deepEqual(validateLiveSettings({ ...defaultLiveSettings(), morphogenCue: { look: 99, cue: 'x', seconds: -1 } }).morphogenCue, defaultLiveSettings().morphogenCue);
});
