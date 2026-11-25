/**
 * Review I1: a show whose saved tempo source is MIDI clock. MIDI clock leads only while it is running; silent for two
 * seconds, the show follows the music, and a launch always lands. Tap and Follow always work, and nothing is saved.
 * The real engine, tempo clock, service and wall rules, on one fake time base (the engine's seconds are now / 1000).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapMessage } from '../src/map/messages';
import { createShow, type ShowDocument } from '../src/map/show';
import { clockSnapshot, PerformService } from '../src/perform/service';
import { applyPerformMessage, initialWallPerform, stepWallPerform } from '../src/perform/wall-perform';
import type { Clip, Scene } from '../src/perform/types';
import { ReactivityEngine } from '../src/react/engine';
import { TempoClock } from '../src/react/tempo';
import type { Signals } from '../src/react/signals';

const clip = (id: string, sourceId: string): Clip => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'bass' });
const scene = (id: string, cells: Record<number, string>): Scene => ({ id, name: id, cells: Array.from({ length: 8 }, (_, i) => cells[i] ?? null), includeProtected: false, follow: null });

function makeShow(): ShowDocument {
  const show = createShow();
  show.shapes = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, groupId: null })) as unknown as ShowDocument['shapes'];
  show.sources = ['a', 'b'].map(id => ({ id, speed: 1, tempoSync: 4, project: { layers: [] } })) as unknown as ShowDocument['sources'];
  show.performance.zones = show.performance.zones.map((z, i) => ({ ...z, target: { kind: 'shape', id: `s${i}` } }));
  show.performance.clips = [clip('ca', 'a'), clip('cb', 'b')];
  show.performance.scenes = [scene('one', { 0: 'ca' }), scene('two', { 0: 'cb' })];
  return show;
}

function rig() {
  const engine = new ReactivityEngine();
  engine.setPrefs({ tempo: 'midi' });
  const saved = { ...engine.prefs };
  const show = makeShow(), sent: MapMessage[] = [];
  let now = 10_000, next = 0, frame: ((s: Signals) => void) | null = null;
  const service = new PerformService({
    wall: { send: m => { sent.push(m); }, isOpen: () => true, sendWholeShow: () => {} },
    clock: {
      snapshot: nowMs => clockSnapshot(engine.tempo, nowMs, 0),
      begin: () => engine.beginShowClock(),
      end: () => engine.endShowClock(),
      tap: () => engine.tempo.manualTap(now / 1000),
      follow: () => engine.tempo.resumeFollow(now / 1000),
      setBarStart: () => engine.tempo.setBarStart(now / 1000),
      subscribe: fn => { frame = fn; return () => { frame = null; }; },
      midiClock: () => engine.showMidiClock(),
    },
    show: () => show, now: () => now, id: () => `L${++next}`, random: () => 0,
  });
  let wall = initialWallPerform(), seen = 0;
  /** One frame: the engine reads the clock, the service ticks, the wall lands what is due and reports it. */
  const step = () => {
    engine.read(now);
    frame?.({});
    for (; seen < sent.length; seen++) wall = applyPerformMessage(wall, sent[seen]);
    const out = stepWallPerform(wall, now, () => true);
    wall = out.perform;
    if (out.landed.length) service.wallState({ landed: out.landed });
  };
  /** MIDI clock at 120 BPM: 24 ticks a beat, a tick every 1/48 s. */
  const ticks = (count: number) => { for (let i = 0; i < count; i++) { now += 1000 / 48; engine.tempo.midiTick(now / 1000); step(); } };
  const run = (ms: number) => { const end = now + ms; while (now < end) { now += 1000 / 60; step(); } };
  return { engine, saved, service, ticks, run, step, at: () => now, wall: () => wall };
}

test('a stopped MIDI clock never leaves a launch queued: the show follows the music and the launch lands', () => {
  const r = rig();
  r.engine.tempo.midiStart(r.at() / 1000);
  r.ticks(24 * 2 + 7);
  r.engine.tempo.midiStop();
  r.service.startShow();
  r.service.control({ kind: 'sendAllStart' }); r.service.control({ kind: 'sendAllEnd' });
  r.run(300);
  // Pressed off the bar line.
  r.service.action({ type: 'bankNext' });
  r.run(30_000);
  const view = r.service.view();
  assert.equal(view.launcher.playing[0], 'ca', 'the launch landed');
  assert.equal(view.launcher.queue.length, 0, 'nothing is left queued');
  assert.equal(r.engine.tempo.source, 'follow');
  assert.ok(view.notices.some(n => /MIDI clock/.test(n)), `the status says so: ${view.notices.join(' | ')}`);
  assert.deepEqual(r.engine.prefs, r.saved, 'saved preferences are untouched');
});

test('MIDI clock silent for two seconds hands the show to the music, and takes it back when it runs again', () => {
  const r = rig();
  r.engine.tempo.midiStart(r.at() / 1000);
  r.ticks(24);
  r.service.startShow();
  r.ticks(24);
  assert.equal(r.engine.tempo.source, 'midi', 'a running MIDI clock leads the show');
  assert.equal(r.engine.showMidiClock(), 'leading');
  r.run(1500);
  assert.equal(r.engine.tempo.source, 'midi', 'a short gap is not silence');
  r.run(600);
  assert.equal(r.engine.tempo.source, 'follow', 'two seconds without a tick is silence');
  assert.equal(r.engine.tempo.followState, 'holding');
  assert.equal(r.engine.showMidiClock(), 'silent');
  r.ticks(24);
  assert.equal(r.engine.tempo.source, 'midi', 'MIDI clock takes over again when it runs');
  r.service.endShow();
  assert.equal(r.engine.tempo.source, 'midi');
  assert.equal(r.engine.showMidiClock(), null);
  assert.deepEqual(r.engine.prefs, r.saved, 'saved preferences are untouched');
});

test('Tap and Follow work during a MIDI clock show, and MIDI clock does not take back what the operator chose', () => {
  const r = rig();
  r.engine.tempo.midiStart(r.at() / 1000);
  r.service.startShow();
  r.ticks(48);
  assert.equal(r.engine.tempo.source, 'midi');
  r.service.action({ type: 'tap' });
  assert.equal(r.engine.tempo.source, 'follow');
  assert.equal(r.engine.tempo.followState, 'manual', 'Tap takes the show to MANUAL');
  r.ticks(48);
  assert.equal(r.engine.tempo.followState, 'manual', 'a running MIDI clock does not undo a tap');
  r.service.action({ type: 'follow' });
  assert.equal(r.engine.tempo.followState, 'holding', 'Follow goes back to following the music');
  r.ticks(48);
  assert.equal(r.engine.tempo.source, 'follow', 'and MIDI clock leaves it there while it keeps running');
  // Follow straight from MIDI clock follows the music too.
  const s = rig();
  s.engine.tempo.midiStart(s.at() / 1000);
  s.service.startShow();
  s.ticks(48);
  s.service.action({ type: 'follow' });
  assert.equal(s.engine.tempo.source, 'follow');
  assert.deepEqual(r.engine.prefs, r.saved, 'saved preferences are untouched');
});

test('without a MIDI show nothing changes: MIDI clock as a plain source still waits for its ticks', () => {
  const c = new TempoClock();
  c.setSource('midi');
  c.midiStart(0);
  c.midiStop();
  c.advance(10);
  assert.equal(c.source, 'midi');
  assert.equal(c.snapshot(10).beats, 0);
});
