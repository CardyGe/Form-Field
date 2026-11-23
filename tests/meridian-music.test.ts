import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer, createProject, readParameterDefinitions, validateProject } from '../src/core/project';
import { Conductor, type ConductorFrame } from '../src/meridian/conductor';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, applyEvolveLight, createEvolveClock, createEvolveTransport, evaluateEvolve, exactEvolveClock, type EvolveMoves } from '../src/meridian/evolve';
import { MoveRouter } from '../src/meridian/moves';
import { litShare, MusicLight } from '../src/meridian/music-light';
import { EVOLVE_INACTIVE, motionParameters } from '../src/meridian/panel';
import { MACRO_KEYS, MERIDIAN_DEFAULTS, MERIDIAN_PARAMETERS } from '../src/meridian/parameters';
import { canSkipPreparation } from '../src/meridian/preparation';

const DT = 1 / 60, LOOP = 60, idle: EvolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };
const phaseAt = (t: number) => t / LOOP * Math.PI * 2;
const sound = (t: number, level = 0.8): Record<string, number> => {
  const beats = t * 128 / 60, beat = Math.floor(beats), phase = beats - beat;
  return { 'tempo.beat': beat, 'tempo.phase': phase, 'tempo.bpm': 128, 'beat.pulse': Math.exp(-phase * 60 / 128 / 0.15), 'audio.bass': level * Math.exp(-phase * 3), 'audio.mids': level * .6, 'audio.highs': level * (phase > .5 ? .8 : .2), 'audio.level': level };
};

/** Plays Evolve through the live path with music, and hands each frame's list to `see`. */
function play(seconds: number, p: Record<string, number>, signals: ((t: number) => Record<string, number>) | null, see: (list: DisplayList, t: number) => void, seed = 1729) {
  const transport = createEvolveTransport(), list = new DisplayList(2000), view: Record<string, number> = {}, conductor = new Conductor(), music = new MusicLight();
  advanceEvolve(transport, 0, LOOP, 0, seed, p, idle);
  for (let f = 1; f <= seconds * 60; f++) {
    const t = f * DT;
    if (signals) music.update(conductor.update({ dt: DT, signals: signals(t), params: p }), p, DT, litShare(list, 16 / 9), 0, transport.clock.swell, transport.clock.music);
    const clock = advanceEvolve(transport, phaseAt(t), LOOP, DT, seed, p, idle);
    Object.assign(view, p, transport.values);
    evaluateEvolve(seed, clock, view, list);
    see(list, t);
  }
}

test('with reaction at zero, or no audio, the picture is exactly the default', () => {
  const quiet = { ...MERIDIAN_DEFAULTS, reactionBass: 0, reactionMids: 0, reactionHighs: 0, reactionBeat: 0 }, base: Float32Array[] = [];
  play(6, MERIDIAN_DEFAULTS as Record<string, number>, null, l => base.push(l.data.slice(0, l.count * STRIDE)));
  let i = 0; play(6, MERIDIAN_DEFAULTS as Record<string, number>, () => ({}), l => assert.deepEqual(l.data.slice(0, l.count * STRIDE), base[i++]));
  // Reaction at zero keeps the tempo of the music but adds no light of its own.
  let extra = 0; i = 0;
  play(6, quiet, sound, l => { const b = base[i++]; for (let k = 9; k < b.length; k += STRIDE) extra = Math.max(extra, l.data[k] - b[k] * 1.16); });
  assert.ok(extra < 0.02, `extra ${extra}`);
});

test('music moves light and never geometry', () => {
  const shapes: Float32Array[] = [], lit: number[] = [], heard: number[] = [];
  const shape = (l: DisplayList) => { const out = new Float32Array(l.count * 5); for (let i = 0; i < l.count; i++) for (let k = 0; k < 5; k++) out[i * 5 + k] = l.data[i * STRIDE + 1 + k]; return out; };
  const total = (l: DisplayList) => { let s = 0; for (let i = 0; i < l.count; i++) s += l.data[i * STRIDE + 9]; return s; };
  play(8, { ...MERIDIAN_DEFAULTS }, null, l => { shapes.push(shape(l)); lit.push(total(l)); });
  let i = 0;
  play(8, { ...MERIDIAN_DEFAULTS, reactionBass: 2, reactionMids: 2, reactionHighs: 2, reactionBeat: 2 }, sound, l => { assert.deepEqual(shape(l), shapes[i]); heard.push(total(l) - lit[i]); i++; });
  assert.ok(Math.max(...heard.slice(180)) > 3, `music added ${Math.max(...heard)}`);
});

test('under every reaction setting no mark changes light faster than the existing limit', () => {
  const settings: Record<string, number>[] = [{ reactionBeat: 2, reactionBass: 2, reactionMids: 2, reactionHighs: 2, reactionAttack: 0, reactionRelease: 0 }, { reactionBeat: 2, reactionTempoMultiplier: 4, rhythmAccent: 1, rhythmSwing: 1 }];
  for (const extra of settings) {
    let last: Float32Array | null = null, worst = 0;
    play(10, { ...MERIDIAN_DEFAULTS, ...extra }, sound, l => {
      const d = l.data.slice(0, l.count * STRIDE);
      if (last) for (let k = 9; k < d.length; k += STRIDE) worst = Math.max(worst, Math.abs(d[k] - last[k]));
      last = d;
    });
    assert.ok(worst <= 0.08, `alpha step ${worst}`);
  }
});

test('energy lifts Evolution slowly and only while there is sound', () => {
  const music = new MusicLight(), conductor = new Conductor(), out = createEvolveClock().music;
  let frame!: ConductorFrame, first = 0;
  for (let f = 1; f <= 1800; f++) { frame = conductor.update({ dt: DT, signals: sound(f * DT), params: MERIDIAN_DEFAULTS }); music.update(frame, MERIDIAN_DEFAULTS, DT, 0, 0, 0, out); if (f === 30) first = out.evolutionLift; }
  assert.ok(first < 0.06 && out.evolutionLift > 0.15 && out.evolutionLift <= 0.4, `${first} then ${out.evolutionLift}`);
});

test('moves from keys and links share one path, and a linked edit fires once per press', () => {
  const router = new MoveRouter(), out = { ...idle }, none = () => 0;
  assert.equal(router.read(none, { moveNext: 0.8 }, out).kind, 'none'); assert.equal(out.next, true);
  router.read(key => (key === 'moveHold' ? 1 : 0), {}, out); assert.deepEqual([out.hold, out.next], [true, false]);
  const fired: string[] = [];
  for (const v of [0, 1, 1, 1, 0, 1]) fired.push(router.read(none, { moveReseed: v }, out).kind);
  assert.deepEqual(fired.filter(k => k !== 'none'), ['reseed', 'reseed']);
  // A key press has already made its edit in the panel, so the router must not make it again.
  for (let i = 0; i < 3; i++) assert.equal(router.read(key => (key === 'moveMutate' || key === 'moveReseed' || key === 'moveRecall' ? 1 : 0), {}, out).kind, 'none');
  const recall = router.read(none, { moveRecall: 3 }, out); assert.deepEqual([recall.kind, recall.slot], ['recall', 2]);
  assert.equal(router.read(none, { moveRecall: 3 }, out).kind, 'none');
});

test('momentary moves are cleared on load and in saved snapshots', () => {
  const layer = createLayer('meridian'); Object.assign(layer.params, { moveNext: 1, moveMutate: 1, moveRecall: 4, moveBurst: 0.7 });
  const saved = validateProject({ ...createProject(), layers: [layer] }).layers[0];
  for (const d of MERIDIAN_PARAMETERS.filter(item => item.momentary)) assert.equal(saved.params[d.key], 0, d.key);
});

test('macros and moves are not offered on the Motion tab', () => {
  const keys = motionParameters(readParameterDefinitions('meridian')).map(d => d.key);
  for (const key of [...MACRO_KEYS, 'moveNext', 'moveBurst']) assert.ok(!keys.includes(key), key);
  assert.ok(keys.includes('lightExposure'));
});

test('a Meridian-only edit needs no preparation; anything else still does', () => {
  const project = createProject(), layer = createLayer('meridian'); project.layers = [layer];
  assert.equal(canSkipPreparation(project, { ...project, layers: [{ ...layer, params: { ...layer.params, seed: 99 } }] }), true);
  assert.equal(canSkipPreparation(project, { ...project, layers: [{ ...layer, mask: { ...layer.mask, kind: 'circle' } }] }), false);
  assert.equal(canSkipPreparation(project, { ...project, width: 1280 }), false);
  assert.equal(canSkipPreparation(project, { ...project, layers: [] }), false);
  const other = createLayer('surface'); const two = { ...project, layers: [other] };
  assert.equal(canSkipPreparation(two, { ...two, layers: [{ ...other, params: { ...other.params, seed: 5 } }] }), false);
});

test('every control marked inactive in Evolve really does nothing there', () => {
  const draw = (p: Record<string, number>, exact: boolean) => {
    const list = new DisplayList(2000), live = { ...p };
    if (exact) evaluateEvolve(7, exactEvolveClock(2, 60, p, createEvolveClock()), p, list);
    else { const t = createEvolveTransport(); evaluateEvolve(7, advanceEvolve(t, 0, 60, 0, 7, p, idle), { ...p, ...t.values }, list); }
    applyEvolveLight(p, live);
    return JSON.stringify([Array.from(list.data.subarray(0, list.count * STRIDE)), live.lightBloomAmount, live.lightLineGlow, live.colourSaturation, live.colourFringe]);
  };
  const base = { ...MERIDIAN_DEFAULTS };
  for (const key of EVOLVE_INACTIVE) {
    const d = MERIDIAN_PARAMETERS.find(item => item.key === key)!;
    for (const value of [d.min, d.max]) for (const exact of [false, true]) assert.equal(draw({ ...base, [key]: value }, exact), draw(base, exact), key);
  }
  for (const live of ['macroScale', 'reactionBass', 'rhythmAccent', 'rhythmSwing', 'safetyFlashGuard', 'ringCount']) assert.ok(!EVOLVE_INACTIVE.includes(live), live);
});
