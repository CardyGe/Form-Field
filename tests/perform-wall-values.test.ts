import test from 'node:test';
import assert from 'node:assert/strict';
import { performClock, performDraw } from '../src/perform/wall-values';
import { tempoPhase } from '../src/map/modulate';
import { videoClock, videoLoop, videoRate } from '../src/map/videoRate';
import { wallInputs } from '../src/map/messages';
import { createShow } from '../src/map/show';
import type { ZonePicture } from '../src/perform/resolve';

const zones = (): ZonePicture[] => Array.from({ length: 8 }, (_, i) => ({ shapeIds: [`s${i}`], sourceId: i < 2 ? `x${i}` : null, launched: i < 2 }));
const values = (master: number, zone0: Partial<{ brightness: number; hueDeg: number; speed: number }> = {}) => ({
  master, zones: Array.from({ length: 8 }, (_, i) => ({ brightness: 1, hueDeg: 0, speed: 1, ...(i === 0 ? zone0 : {}) })),
});

test('performDraw gives each zone shape its brightness and hue, and each launched source its speed', () => {
  const d = performDraw({ zones: zones(), values: values(.5, { brightness: .25, hueDeg: 90, speed: 2 }), phaseOffsets: { x0: 3 } });
  assert.equal(d.master, .5);
  assert.deepEqual(d.shapes.get('s0'), { brightness: .25, hueDeg: 90 });
  assert.deepEqual(d.shapes.get('s5'), { brightness: 1, hueDeg: 0 });
  assert.equal(d.speed.get('x0'), 2);
  assert.equal(d.speed.get('x1'), 1);
  assert.equal(d.speed.size, 2);
  assert.equal(d.phaseOffsets.get('x0'), 3);
});

test('performDraw holds every value inside its range', () => {
  const d = performDraw({ zones: zones(), values: values(7, { brightness: 99, hueDeg: 1e9, speed: -5 }), phaseOffsets: {} });
  assert.equal(d.master, 1);
  assert.deepEqual(d.shapes.get('s0'), { brightness: 2, hueDeg: 360 });
  assert.equal(d.speed.get('x0'), 0);
  const low = performDraw({ zones: zones(), values: values(-1, { brightness: -3, hueDeg: -1e9, speed: 99 }), phaseOffsets: {} });
  assert.equal(low.master, 0);
  assert.deepEqual(low.shapes.get('s0'), { brightness: 0, hueDeg: -360 });
  assert.equal(low.speed.get('x0'), 4);
  const odd = performDraw({ zones: zones(), values: values(NaN, { brightness: NaN, hueDeg: Infinity, speed: NaN }), phaseOffsets: { x0: NaN } });
  assert.equal(odd.master, 1);
  assert.deepEqual(odd.shapes.get('s0'), { brightness: 1, hueDeg: 0 });
  assert.equal(odd.speed.get('x0'), 1);
  assert.equal(odd.phaseOffsets.has('x0'), false);
});

test('performDraw with no values yet is plain, and still carries the phase offsets', () => {
  const d = performDraw({ zones: zones(), values: null, phaseOffsets: { x1: 2 } });
  assert.equal(d.master, 1);
  assert.equal(d.shapes.size, 0);
  assert.equal(d.speed.size, 0);
  assert.equal(d.phaseOffsets.get('x1'), 2);
});

test('performDraw: a shape belongs to the first zone that owns it, a shared source takes the first zone’s speed, and __proto__ is an ordinary id', () => {
  const z = zones();
  z[1] = { shapeIds: ['s0', 's1'], sourceId: 'x0', launched: true };
  const v = values(1, { brightness: .5, speed: 2 });
  v.zones[1] = { brightness: 2, hueDeg: 10, speed: .5 };
  const d = performDraw({ zones: z, values: v, phaseOffsets: Object.fromEntries([['__proto__', 1]]) });
  assert.equal(d.shapes.get('s0')!.brightness, .5);
  assert.equal(d.shapes.get('s1')!.brightness, 2);
  assert.equal(d.speed.get('x0'), 2);
  assert.equal(d.phaseOffsets.get('__proto__'), 1);
});

test('performClock leaves the clock alone at speed 1 with no offset, and without a beat', () => {
  const s = { 'tempo.beat': 23, 'tempo.phase': .5, 'tempo.bpm': 128, 'audio.bass': .3 };
  assert.equal(performClock(s, 0, 1), s);
  const none = { 'audio.bass': .3 };
  assert.equal(performClock(none, 2, 2), none);
});

test('performClock takes the offset off the count, so a locked loop starts on the corrected bar', () => {
  const at = (beat: number, phase: number) => tempoPhase(performClock({ 'tempo.beat': beat, 'tempo.phase': phase }, 3, 1), 4)!;
  assert.ok(Math.abs(at(3, 0)) < 1e-9, 'the loop is at its start on the corrected 1');
  assert.ok(Math.abs(at(5, 0) - Math.PI) < 1e-9, 'two beats on, a 4-beat loop is half way');
  assert.ok(Math.abs(at(2, .5) - Math.PI * 2 * .875) < 1e-9, 'before the corrected 1 it is near the end of the loop before');
});

test('performClock keeps the other signals and runs the count at the speed', () => {
  const c = performClock({ 'tempo.beat': 23, 'tempo.phase': .5, 'tempo.bpm': 120, 'audio.bass': .3 }, 1, 2);
  assert.equal(c['tempo.beat'], 45);
  assert.equal(c['tempo.phase'], 0);
  assert.equal(c['tempo.bpm'], 240);
  assert.equal(c['audio.bass'], .3);
});

test('a locked video at speed 1 hears the clock as it is', () => {
  assert.deepEqual(videoClock({ 'tempo.beat': 23, 'tempo.phase': .4, 'tempo.bpm': 128 }, 1, 0), { count: 23, bpm: 128 });
  assert.deepEqual(videoClock({}, 1, 0), { count: undefined, bpm: 120 });
});

test('a locked video’s speed changes its rate even when the wall has no tempo', () => {
  // An 8 s clip on a 4-beat loop: 2 s at 120, so 4×; at half speed the loop lasts 8 beats, so 2×.
  const half = videoClock({ 'tempo.beat': 0, 'tempo.phase': 0 }, .5, 0);
  assert.equal(half.bpm, 60);
  assert.equal(videoRate(8, 1, 4, half.bpm).rate, 2);
  assert.equal(videoRate(8, 1, 4, videoClock({ 'tempo.bpm': 100 }, 2, 0).bpm).rate, videoRate(8, 1, 4, 200).rate);
});

test('a 4-beat video loop stepped to 2× at beat 23 joins half way through its loop, on the grid', () => {
  const clock = videoClock({ 'tempo.beat': 23, 'tempo.phase': 0, 'tempo.bpm': 120 }, 2, 0);
  assert.equal(clock.count, 46);
  assert.deepEqual(videoLoop(clock.count!, 4), { loop: 11, into: .5 });
  // The offset moves the bar the loop starts on; the part of a beat already played is counted.
  const mid = videoClock({ 'tempo.beat': 23, 'tempo.phase': .5 }, 1, 1);
  assert.equal(mid.count, 22.5);
  assert.deepEqual(videoLoop(mid.count!, 4), { loop: 5, into: .625 });
});

test('videoLoop is the same loop and place Map has always used for a whole beat count', () => {
  assert.deepEqual(videoLoop(0, 4), { loop: 0, into: 0 });
  assert.deepEqual(videoLoop(7, 4), { loop: 1, into: .75 });
  assert.deepEqual(videoLoop(-1, 4), { loop: -1, into: .75 });
});

test('the wall hears the tempo’s speed during a Perform show, and only then', () => {
  const show = createShow();
  assert.equal(wallInputs(show, null).has('tempo.bpm'), false);
  assert.equal(wallInputs(show, null, true).has('tempo.bpm'), true);
  assert.deepEqual([...wallInputs(show, null, true)].filter(k => !wallInputs(show, null).has(k)), ['tempo.bpm']);
});
