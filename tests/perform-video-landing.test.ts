import assert from 'node:assert/strict';
import test from 'node:test';
import type { Gpu } from '../src/map/gpu';
import { VideoSlot } from '../src/map/videoSlot';
import { CarriedTempo } from '../src/perform/wall-values';

function fakeVideo() {
  return { muted: false, loop: false, playsInline: false, preload: '', crossOrigin: '', src: '', currentTime: -1, duration: 2, playbackRate: 1, videoWidth: 0, videoHeight: 0, width: 0, height: 0,
    addEventListener() {}, play: () => Promise.resolve(), pause() {}, load() {}, removeAttribute() {} };
}
function slotAt() {
  const video = fakeVideo();
  (globalThis as unknown as { document: unknown }).document = { createElement: () => video };
  const slot = new VideoSlot({} as Gpu, { id: 'video-1', path: 'a.mp4', name: 'a', speed: 1, tempoSync: 4 });
  slot.state = 'playing';
  return { slot, video };
}
const at = (beat: number, phase: number) => ({ 'tempo.beat': beat, 'tempo.phase': phase, 'tempo.bpm': 120 });

test('an armed locked video landing at 1× late in a beat joins where the beat is, then starts its next loop', () => {
  const { slot, video } = slotAt();
  slot.holdArmed();
  slot.setFrozen(false);
  slot.frame(at(23, .99));
  assert.ok(Math.abs(video.currentTime / video.duration - .9975) < 1e-9, `joined at ${video.currentTime / video.duration}, not just before the loop's end`);
  slot.frame(at(24, 0));
  assert.equal(video.currentTime, 0);
});

test('an armed locked video landing at beat 21.8 joins at 0.45 of its loop', () => {
  const { slot, video } = slotAt();
  slot.holdArmed();
  slot.setFrozen(false);
  slot.frame(at(21, .8));
  assert.ok(Math.abs(video.currentTime / video.duration - .45) < 1e-9, `joined at ${video.currentTime / video.duration}`);
});

test("Map's own Freeze keeps its whole-beat join", () => {
  const { slot, video } = slotAt();
  slot.setFrozen(true);
  slot.setFrozen(false);
  slot.frame(at(23, .99));
  assert.equal(video.currentTime / video.duration, .75);
});

test('after End show a locked video keeps the show tempo to its next loop boundary, not 120', () => {
  const carried = new CarriedTempo(), source = { id: 'video-1', speed: 1, tempoSync: 4 };
  carried.keep(source, 128, 1, 0);
  const plain = { 'tempo.beat': 21, 'tempo.phase': .5 };
  carried.step([source], plain);
  assert.equal(carried.get('video-1'), 128);
  carried.step([source], { 'tempo.beat': 23, 'tempo.phase': .9 });
  assert.equal(carried.get('video-1'), 128);
  carried.step([source], { 'tempo.beat': 24, 'tempo.phase': 0 });
  assert.equal(carried.get('video-1'), undefined, 'from its next loop it plays as Map plays it');
});

test('a carried tempo ends at once when the beat stops or the source changes', () => {
  const carried = new CarriedTempo(), source = { id: 'video-1', speed: 1, tempoSync: 4 };
  carried.keep(source, 128, 1, 0);
  carried.step([source], {});
  assert.equal(carried.get('video-1'), undefined);
  carried.keep(source, 128, 1, 0);
  carried.step([{ ...source, tempoSync: 8 }], at(1, 0));
  assert.equal(carried.get('video-1'), undefined);
  carried.keep({ ...source, tempoSync: null }, 128, 1, 0);
  assert.equal(carried.get('video-1'), undefined, 'a free video carries nothing');
});
