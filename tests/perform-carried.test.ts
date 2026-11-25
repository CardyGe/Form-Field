import test from 'node:test';
import assert from 'node:assert/strict';
import { CarriedPace } from '../src/perform/wall-values';
import { videoClock, videoLoop } from '../src/map/videoRate';

const at = (beat: number, phase = 0) => ({ 'tempo.beat': beat, 'tempo.phase': phase, 'tempo.bpm': 120 });
const loop = (extra: Partial<{ speed: number; tempoSync: number | null }> = {}) => ({ id: 'x', speed: 1, tempoSync: 4 as number | null, ...extra });

test('after a 2× show a locked loop keeps its speed and bar only until its next loop boundary', () => {
  const c = new CarriedPace();
  c.keep(loop(), 2, 1);
  assert.deepEqual(c.get('x'), { speed: 2, offset: 1 });
  // A 4-beat loop at 2× with one beat off the count turns over every two beats, at beats 1, 3, 5…
  c.step([loop()], at(21, .2));
  assert.deepEqual(c.get('x'), { speed: 2, offset: 1 });
  c.step([loop()], at(22, .9));
  assert.deepEqual(c.get('x'), { speed: 2, offset: 1 });
  c.step([loop()], at(23, 0));
  assert.equal(c.get('x'), undefined, 'plain Map plays it at its own speed from the boundary on');
  c.step([loop()], at(24, 0));
  assert.equal(c.get('x'), undefined);
});

test('turning the tempo lock off in Map, or changing the source’s speed, ends the carried speed at once', () => {
  const c = new CarriedPace();
  c.keep(loop(), 2, 0);
  c.step([loop()], at(8, .1));
  c.step([loop({ tempoSync: null })], at(8, .2));
  assert.equal(c.get('x'), undefined, 'a source that is now free runs at its own speed');
  c.keep(loop(), 2, 0);
  c.step([loop({ tempoSync: 8 })], at(8, .3));
  assert.equal(c.get('x'), undefined, 'a new loop length');
  c.keep(loop(), 2, 0);
  c.step([loop({ speed: 1.5 })], at(8, .3));
  assert.equal(c.get('x'), undefined, 'a new speed');
});

test('a second show that ends at speed 1 leaves nothing behind from the first', () => {
  const c = new CarriedPace();
  c.keep(loop(), 2, 0);
  assert.deepEqual(c.get('x'), { speed: 2, offset: 0 });
  // The compositor clears when a show starts; even without that, keeping 1 and 0 removes what was there.
  c.keep(loop(), 1, 0);
  assert.equal(c.get('x'), undefined);
  assert.equal(c.size, 0);
});

test('a new show, or a lost graphics context, clears every carried speed', () => {
  const c = new CarriedPace();
  c.keep(loop(), 2, 0);
  c.keep({ id: 'video-1', speed: 1, tempoSync: 4 }, .5, 2);
  assert.equal(c.size, 2);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get('video-1'), undefined);
});

test('a free source is never carried; a source that left the show, a held loop, and a wall with no tempo carry nothing on', () => {
  const c = new CarriedPace();
  c.keep(loop({ tempoSync: null }), 2, 0);
  assert.equal(c.size, 0);
  c.keep(loop(), 2, 0);
  c.step([], at(8, .1));
  assert.equal(c.size, 0, 'the source is gone');
  c.keep(loop(), 0, 0);
  c.step([loop()], at(8, .1));
  assert.equal(c.size, 0, 'a loop held at speed 0 has no boundary to wait for');
  c.keep(loop(), 2, 0);
  c.step([loop()], {});
  assert.equal(c.size, 0, 'no tempo');
});

test('a locked video stepped from 2× back to 1× joins its loop where the beat is, part of a beat included', () => {
  // A 4-beat loop: at beat 20.9 it is 0.225 of the way in, at 23.9 it is 0.975.
  const join = (beat: number, phase: number) => videoLoop(videoClock(at(beat, phase), 1, 0, true).count!, 4);
  assert.equal(join(20, .9).loop, 5);
  assert.ok(Math.abs(join(20, .9).into - .225) < 1e-9);
  assert.equal(join(23, .9).loop, 5);
  assert.ok(Math.abs(join(23, .9).into - .975) < 1e-9);
  // The loop it is in is the one Map's whole-beat count gives, so the next boundary is unchanged.
  assert.equal(videoLoop(videoClock(at(23, .9), 1, 0).count!, 4).loop, 5);
});

test('Map’s own path still counts whole beats', () => {
  assert.deepEqual(videoClock(at(20, .9), 1, 0), { count: 20, bpm: 120 });
  assert.deepEqual(videoLoop(videoClock(at(23, .9), 1, 0).count!, 4), { loop: 5, into: .75 });
});
