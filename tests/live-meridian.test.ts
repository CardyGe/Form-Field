import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLiveSettings, LOOK_LABELS, MERIDIAN_LIVE_CONTROLS, MERIDIAN_LIVE_LOOKS, meridianFromStudioLook, personStillTimeout, usesPeople, validateLiveSettings } from '../src/live/settings';
import { LiveModulator, LIVE_REACTIONS, liveReactionLinks, liveTargetOptions, liveTargetRange, readLiveLink } from '../src/live/modulate';
import { MERIDIAN_DEFAULTS } from '../src/meridian/parameters';
import { MERIDIAN_LOOKS } from '../src/meridian/presets';
import { LIVE_DEFAULTS } from '../src/meridian/interactions';

test('Meridian is a Live look, and older settings files load with its defaults', () => {
  assert.equal(LOOK_LABELS.meridian, 'Meridian');
  assert.equal(validateLiveSettings({ look: 'meridian' }).look, 'meridian');
  const d = defaultLiveSettings();
  assert.equal(d.look, 'paint', 'Paint stays the first look');
  assert.deepEqual(validateLiveSettings(JSON.parse(JSON.stringify(d))), d);
  // A settings file from before Meridian: every other section is exactly as saved.
  const old = JSON.parse(JSON.stringify({ ...d, look: 'signal', sensitivity: 2 })) as Record<string, unknown>; delete old.meridian;
  const loaded = validateLiveSettings(old);
  assert.deepEqual(loaded.meridian, d.meridian);
  assert.equal(loaded.look, 'signal'); assert.equal(loaded.sensitivity, 2);
  assert.deepEqual({ ...loaded, meridian: undefined }, { ...validateLiveSettings({ ...old, meridian: d.meridian }), meridian: undefined });
  for (const c of MERIDIAN_LIVE_CONTROLS) { assert.ok(c.default >= c.min && c.default <= c.max, c.key); assert.equal(d.meridian[c.key], c.default, c.key); }
  assert.equal(d.meridian.liveOrbit, LIVE_DEFAULTS.liveOrbit);
  assert.equal(d.meridian.macroDensity, MERIDIAN_DEFAULTS.macroDensity);
});

test('bad Meridian values repair field by field', () => {
  const s = validateLiveSettings({ look: 'meridian', meridian: { liveOrbit: 9, liveMaxBodies: 3.7, liveChargeSeconds: 'x', macroHeat: -2, moveDrop: 7, palette: ['red'], seed: -5, preset: 42, liveMusic: 0.4 } });
  const d = defaultLiveSettings().meridian;
  assert.equal(s.meridian.liveOrbit, 1); assert.equal(s.meridian.liveMaxBodies, 4); assert.equal(s.meridian.liveChargeSeconds, d.liveChargeSeconds);
  assert.equal(s.meridian.macroHeat, 0); assert.equal(s.meridian.moveDrop, 1);
  assert.deepEqual(s.meridian.palette, d.palette); assert.equal(s.meridian.seed, d.seed); assert.equal(s.meridian.preset, d.preset);
  assert.equal(s.meridian.liveMusic, 0);
  assert.equal(validateLiveSettings({ meridian: { seed: 3187.6 } }).meridian.seed, 3188);
  assert.equal(validateLiveSettings({ meridian: { preset: null } }).meridian.preset, null);
  for (const v of [null, 'x', 7, []]) assert.deepEqual(validateLiveSettings({ meridian: v }).meridian, d);
});

test('Meridian Live sliders are link targets, and links reach the look', () => {
  assert.deepEqual(liveTargetRange('live.meridian.liveChargeSeconds'), { min: 0.5, max: 8, label: 'Meridian · Charge time' });
  assert.ok(liveTargetRange('live.meridian.macroHeat'));
  assert.ok(liveTargetRange('live.meridian.moveDrop'));
  assert.equal(liveTargetRange('live.meridian.nonsense'), null);
  assert.ok(readLiveLink({ id: 'a', input: 'beat.pulse', target: 'live.meridian.liveChargeSeconds', mode: 'modulate', amount: 0.5, low: 0, high: 1, attackMs: 0, releaseMs: 100, on: true }));
  const targets = liveTargetOptions('meridian').map(t => t.target);
  assert.ok(targets.includes('live.meridian.liveOrbit') && targets.includes('live.sensitivity'));
  const s = defaultLiveSettings(); s.look = 'meridian';
  s.links = [{ id: 'l1', input: 'audio.level', target: 'live.meridian.macroHeat', mode: 'control', amount: 1, low: 0, high: 1, attackMs: 0, releaseMs: 0, on: true, name: '' }];
  const drawn = new LiveModulator().apply(s, { 'audio.level': 1 }, 1 / 60);
  assert.equal(drawn.meridian.macroHeat, 1);
  assert.equal(s.meridian.macroHeat, defaultLiveSettings().meridian.macroHeat, 'the settings themselves are left as set');
  for (const reaction of Object.keys(LIVE_REACTIONS) as (keyof typeof LIVE_REACTIONS)[]) assert.ok(liveTargetRange(liveReactionLinks(s, reaction, ['x'])[0].target));
});

test('Meridian finds people and never erases someone standing still', () => {
  const s = defaultLiveSettings(); s.look = 'meridian'; s.people.ignoreStillSeconds = 10;
  assert.equal(usesPeople(s), true);
  assert.equal(personStillTimeout(s), null);
  s.look = 'smoke';
  assert.equal(personStillTimeout(s), 10, 'other looks keep their own still-object setting');
});

test('Load from Studio preset copies only Meridian values', () => {
  const s = defaultLiveSettings(); s.look = 'meridian'; s.meridian.liveOrbit = 0.3; s.meridian.macroTension = 0.9; s.sensitivity = 2.5; s.smoke.density = 0.1;
  const orrery = MERIDIAN_LOOKS.find(l => l.id === 'meridian-evolve-orrery')!;
  const next = meridianFromStudioLook(s, orrery.id);
  assert.equal(next.meridian.macroDensity, 0.82); assert.equal(next.meridian.macroSpeed, 0.62);
  assert.equal(next.meridian.macroTension, MERIDIAN_DEFAULTS.macroTension, 'what the look leaves out comes back to the Studio default');
  assert.equal(next.meridian.seed, 3187); assert.deepEqual(next.meridian.palette, orrery.palette); assert.equal(next.meridian.preset, orrery.id);
  assert.equal(next.meridian.liveOrbit, 0.3, 'the interaction mix is kept');
  assert.equal(next.sensitivity, 2.5); assert.deepEqual(next.smoke, s.smoke); assert.deepEqual(next.links, s.links);
  assert.equal(s.meridian.macroDensity, defaultLiveSettings().meridian.macroDensity, 'the settings passed in are not changed');
  assert.equal(meridianFromStudioLook(s, 'no-such-look'), s);
  // Only Evolve looks are offered: Live is always the slow living structure.
  assert.ok(MERIDIAN_LIVE_LOOKS.length >= 8 && MERIDIAN_LIVE_LOOKS.every(l => l.params.scoreStyle === 2));
});

// --- Fallbacks: the pure frame logic the Live look runs, with Evolve under it ---
import { MeridianLiveCore, STATUS_CAMERA_LOST, STATUS_MOVEMENT_ONLY, type LiveFeedState } from '../src/meridian/live-core';
import { DisplayList, STRIDE } from '../src/meridian/display-list';
import { advanceEvolve, createEvolveTransport, evaluateEvolve, type EvolveMoves } from '../src/meridian/evolve';
import { LIVE_CAPACITY } from '../src/meridian/interactions';
import { PRIMITIVE } from '../src/meridian/types';

const DT = 1 / 60;
const LIVE: LiveFeedState = { fresh: true, peopleReady: true, peopleFailed: false };
const LOST: LiveFeedState = { fresh: false, peopleReady: false, peopleFailed: false };
/** A presence grid as the look reads it back: RGBA, R presence, G movement, row 0 at the bottom. */
function grid(people: { x: number; y: number; move?: number }[]): Uint8Array {
  const data = new Uint8Array(64 * 36 * 4);
  for (const p of people) for (let r = 0; r < 36; r++) for (let c = 0; c < 64; c++) {
    const dx = ((c + 0.5) / 64 - p.x) / 0.07, dy = ((r + 0.5) / 36 - p.y) / 0.25;
    if (dx * dx + dy * dy > 1) continue;
    data[(r * 64 + c) * 4] = 255; data[(r * 64 + c) * 4 + 1] = Math.round((p.move ?? 0.1) * 255); data[(r * 64 + c) * 4 + 3] = 255;
  }
  return data;
}
class CoreRig {
  readonly core = new MeridianLiveCore();
  readonly transport = createEvolveTransport();
  readonly list = new DisplayList(LIVE_CAPACITY);
  readonly values = { ...defaultLiveSettings().meridian } as unknown as Record<string, number> & { preset: string | null; seed: number };
  readonly layer: Record<string, number> = {};
  readonly view: Record<string, number> = {};
  private readonly moves: EvolveMoves = { next: false, hold: false, drop: false, collapse: false, burst: false };
  t = 0;
  last: Float32Array | null = null; maxMove = 0; maxAlpha = 0;
  step(feed: LiveFeedState, people: { x: number; y: number; move?: number }[] | null) {
    this.t += DT;
    this.core.step(DT, feed);
    if (people && feed.fresh) this.core.grid(grid(people), 64, 36, DT, this.values);
    this.core.params(this.values, this.layer);
    this.moves.drop = this.layer.moveDrop >= 0.5; this.moves.burst = this.layer.moveBurst >= 0.5;
    const clock = advanceEvolve(this.transport, (this.t / 60) * Math.PI * 2, 60, DT, this.layer.seed, this.layer, this.moves);
    Object.assign(this.view, this.layer, this.transport.values);
    evaluateEvolve(this.layer.seed, clock, this.view, this.list);
    const frame = this.core.influence(this.list, this.t * 2, 120, 16 / 9, this.t, DT, this.layer);
    this.watch();
    return frame;
  }
  run(seconds: number, feed: LiveFeedState, people: { x: number; y: number; move?: number }[] | null) { let f = this.core.frame; for (let i = 0; i < Math.round(seconds / DT); i++) f = this.step(feed, people); return f; }
  private watch() {
    const d = this.list.data;
    if (this.last) for (let k = 0; k < this.list.count; k++) {
      const at = k * STRIDE, before = this.last[at + 9], now = d[at + 9];
      this.maxAlpha = Math.max(this.maxAlpha, Math.abs(now - before));
      if (Math.min(now, before) < 0.012 || Math.max(now, before) <= 0.04) continue;
      this.maxMove = Math.max(this.maxMove, move(this.last, d, at));
    }
    this.last = d.slice(0, this.list.count * STRIDE);
  }
}
function move(a: Float32Array, b: Float32Array, at: number): number {
  const ends = (d: Float32Array) => {
    const k = d[at];
    if (k === PRIMITIVE.arc) { const r = d[at + 3], s = d[at + 4], e = s + d[at + 5]; return [d[at + 1] + Math.cos(s) * r, d[at + 2] + Math.sin(s) * r, d[at + 1] + Math.cos(e) * r, d[at + 2] + Math.sin(e) * r]; }
    if (k === PRIMITIVE.segment) return [d[at + 1], d[at + 2], d[at + 3], d[at + 4]];
    const r = k === PRIMITIVE.ring ? d[at + 3] : 0; return [d[at + 1] + r, d[at + 2], d[at + 1] - r, d[at + 2]];
  };
  const p = ends(a), q = ends(b);
  return Math.max(Math.hypot(p[0] - q[0], p[1] - q[1]), Math.hypot(p[2] - q[2], p[3] - q[3]));
}

test('camera lost eases into Attract within two seconds, and says so', () => {
  const rig = new CoreRig();
  let frame = rig.run(3, LIVE, [{ x: 0.4, y: 0.5 }]);
  assert.equal(frame.bodies, 1); assert.ok(frame.attract < 0.1);
  assert.equal(rig.core.status, '1 person');
  frame = rig.run(2, LOST, null);
  assert.ok(frame.attract > 0.9, `attract ${frame.attract} two seconds after the camera went`);
  assert.equal(rig.core.status, STATUS_CAMERA_LOST);
  assert.equal(frame.bodies, 0);
});

test('a people-model failure falls back to movement-only bodies', () => {
  const rig = new CoreRig();
  const frame = rig.run(2, { fresh: true, peopleReady: false, peopleFailed: true }, [{ x: 0.6, y: 0.5, move: 0.5 }]);
  assert.equal(rig.core.mode, 'movement');
  assert.equal(frame.bodies, 1);
  assert.ok(rig.core.status.startsWith(STATUS_MOVEMENT_ONLY), rig.core.status);
  rig.run(0.2, LIVE, [{ x: 0.6, y: 0.5 }]);
  assert.equal(rig.core.mode, 'people', 'and back to people when the model answers');
});

test('camera return resumes without a jump', () => {
  const rig = new CoreRig();
  rig.run(3, LIVE, [{ x: 0.3, y: 0.5 }]);
  rig.run(3, LOST, null);
  const frame = rig.run(4, LIVE, [{ x: 0.7, y: 0.5, move: 0.3 }]);
  assert.equal(frame.bodies, 1);
  assert.ok(frame.attract < 0.2, `attract ${frame.attract}`);
  assert.ok(rig.maxMove <= 0.012 + 1e-6, `largest move ${rig.maxMove} frame heights in a frame`);
  assert.ok(rig.maxAlpha <= 0.08 + 1e-6, `largest light change ${rig.maxAlpha} in a frame`);
});

import { readFileSync } from 'node:fs';
test('the camera picture never reaches Meridian Live: no shader in the look samples it', () => {
  for (const file of ['src/live/Meridian.ts', 'src/live/meridian-presence.ts', 'src/meridian/live-core.ts', 'src/meridian/interactions.ts', 'src/meridian/bodies.ts']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/feed\.camera|uCamera|\.camera\b/.test(text), `${file} reads the camera picture`);
  }
  // The presence grid is drawn only from people, movement and stillness.
  const presence = readFileSync(new URL('../src/live/meridian-presence.ts', import.meta.url), 'utf8');
  assert.deepEqual([...presence.matchAll(/uniform sampler2D ([^;]+);/g)].map(m => m[1]), ['uPeople, uFlow, uStill']);
});

test('src/meridian stays free of three, the DOM and React', () => {
  for (const file of ['bodies', 'interactions', 'live-core']) {
    const text = readFileSync(new URL(`../src/meridian/${file}.ts`, import.meta.url), 'utf8');
    assert.ok(!/from 'three'|from 'react'|document\.|window\./.test(text), file);
  }
});
