/** Rehearsal start and stop, with a fake audio element whose loading is finished by hand, so every ordering can be forced. */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AudioInput, TEST_TONE } from '../src/react/audio';
import { ReactivityEngine } from '../src/react/engine';

class FakeElement extends EventTarget {
  static made: FakeElement[] = [];
  src = ''; loop = false; preload = ''; paused = true; loads = 0; srcRemoved = false;
  constructor() { super(); FakeElement.made.push(this); }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  load() { this.loads++; }
  removeAttribute(name: string) { if (name === 'src') { this.src = ''; this.srcRemoved = true; } }
  ready() { this.dispatchEvent(new Event('canplay')); }
  fail() { this.dispatchEvent(new Event('error')); }
  get released() { return this.paused && this.srcRemoved && this.loads > 0; }
}
const node = () => ({ connect() {}, disconnect() {} });
class FakeContext {
  sampleRate = 48000; destination = {}; closed = false;
  createAnalyser() { return { ...node(), fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 1024, getFloatFrequencyData() {}, getFloatTimeDomainData() {} }; }
  createMediaElementSource() { return node(); }
  createBufferSource() { return { ...node(), buffer: null, loop: false, start() {}, stop() {} }; }
  createBuffer(_c: number, length: number) { return { length, getChannelData: () => new Float32Array(length) }; }
  async resume() {} async suspend() {}
  async close() { this.closed = true; }
}
const revoked: string[] = [];
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const mix = () => new Blob(['sound']);
const beatOf = (e: ReactivityEngine) => (e as unknown as { beat: object }).beat;

beforeEach(() => {
  FakeElement.made = []; revoked.length = 0;
  Object.assign(globalThis, { Audio: FakeElement, AudioContext: FakeContext });
  URL.createObjectURL = () => `blob:fake-${FakeElement.made.length}`;
  URL.revokeObjectURL = (url: string) => { revoked.push(url); };
});

describe('rehearsal start', () => {
  it('reports that it started, and holds the input until the file can play', async () => {
    const audio = new AudioInput();
    await audio.start(TEST_TONE, async () => 'granted');
    const started = audio.startFile(mix());
    assert.equal(audio.fileLoading, true);
    assert.equal(audio.rehearsal, null);
    assert.deepEqual(audio.status, { state: 'on', label: 'Test beat' }, 'the input was closed before the file could play');
    FakeElement.made[0].ready();
    assert.equal(await started, true);
    assert.equal(audio.fileLoading, false);
    assert.equal(audio.rehearsal, 'playing');
    assert.equal(FakeElement.made[0].loop, true);
  });

  it('Stop while the file is loading: the file never takes over', async () => {
    const engine = new ReactivityEngine();
    const first = engine.rehearse(mix());
    await engine.rehearse(null);
    FakeElement.made[0].ready();
    await first;
    await settle();
    assert.equal(engine.audio.rehearsal, null);
    assert.equal(FakeElement.made[0].released, true);
  });

  it('Change mix then Stop: the new mix cannot replace the restored input', async () => {
    const engine = new ReactivityEngine();
    const playing = engine.rehearse(mix());
    FakeElement.made[0].ready();
    await playing;
    const change = engine.rehearse(mix());
    await engine.rehearse(null);
    FakeElement.made[1].ready();
    await change;
    await settle();
    assert.equal(engine.audio.rehearsal, null);
    assert.equal(engine.audio.status.state, 'off');
    assert.ok(FakeElement.made.every(e => e.released));
  });

  for (const order of ['newer file ready first', 'older file ready first']) {
    it(`two picks, ${order}: the newer pick wins`, async () => {
      const audio = new AudioInput();
      const a = audio.startFile(mix()), b = audio.startFile(mix());
      const [older, newer] = FakeElement.made;
      if (order.startsWith('newer')) { newer.ready(); older.ready(); } else { older.ready(); newer.ready(); }
      assert.deepEqual(await Promise.all([a, b]), [false, true]);
      assert.equal(older.released, true);
      assert.equal(newer.paused, false);
      assert.equal(audio.rehearsal, 'playing');
    });
  }

  it('a superseded start does not clear the onsets of the mix that is playing', async () => {
    const engine = new ReactivityEngine();
    const a = engine.rehearse(mix()), b = engine.rehearse(mix());
    FakeElement.made[1].ready();
    await b;
    const detector = beatOf(engine);
    FakeElement.made[0].ready();
    await a;
    await settle();
    assert.equal(beatOf(engine), detector);
  });

  it('a bad file throws and leaves the current input running', async () => {
    const audio = new AudioInput();
    const playing = audio.startFile(mix());
    FakeElement.made[0].ready();
    await playing;
    const bad = audio.startFile(mix());
    FakeElement.made[1].fail();
    await assert.rejects(bad);
    assert.equal(audio.rehearsal, 'playing');
    assert.equal(FakeElement.made[0].paused, false);
    assert.equal(FakeElement.made[1].released, true);
    assert.equal(audio.fileLoading, false);
  });

  it('stopping releases the element, its URL and its context', async () => {
    const audio = new AudioInput();
    const playing = audio.startFile(mix());
    FakeElement.made[0].ready();
    await playing;
    audio.stop();
    assert.equal(FakeElement.made[0].released, true);
    assert.deepEqual(revoked, ['blob:fake-0']);
  });

  it('after a pause the detector starts afresh only once the sound is really back', async () => {
    const engine = new ReactivityEngine();
    const playing = engine.rehearse(mix());
    FakeElement.made[0].ready();
    await playing;
    engine.audio.pauseFile(true);
    const detector = beatOf(engine);
    engine.audio.pauseFile(false);
    assert.equal(beatOf(engine), detector);
    assert.deepEqual(engine.audio.read(), { bass: 0, mids: 0, highs: 0, level: 0 }, 'sound was read before playback resumed');
    FakeElement.made[0].dispatchEvent(new Event('playing'));
    assert.notEqual(beatOf(engine), detector);
  });

  it('a read error during playback ends the rehearsal and raises the fault', async () => {
    const engine = new ReactivityEngine();
    const playing = engine.rehearse(mix());
    FakeElement.made[0].ready();
    await playing;
    FakeElement.made[0].fail();
    await settle();
    assert.equal(engine.audio.rehearsal, null);
    assert.equal(engine.rehearsalFault, true);
    assert.equal(FakeElement.made[0].released, true);
  });
});
