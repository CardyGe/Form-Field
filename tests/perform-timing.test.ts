import test from 'node:test';
import assert from 'node:assert/strict';
import { beatAt, launchPhaseOffset, msAtBeat, nextBoundary, quantizeBeats } from '../src/perform/timing';
import { BeatDetector } from '../src/react/beat';
import { TempoClock } from '../src/react/tempo';
import { ReactivityEngine } from '../src/react/engine';

const c = { anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'manual', barOffset: 0 } as const;
const BEAT_128 = 60 / 128;

type Hear = (t: number, hint?: number | null, strength?: number) => void;
/** Onsets as the detector's follow output can emit them: at most one every 0.12 s. */
function listener(clock: TempoClock): Hear {
  let last = -Infinity;
  return (t, hint = null, strength = 1) => {
    if (t - last < 0.12 - 1e-9) return;
    last = t;
    clock.followOnset(t, hint, strength);
    clock.followTick(t);
  };
}
/** Plays a repeating pattern of [beat, strength] hits for `beats` beats from time `from`. Returns when it ends. */
function play(hear: Hear, from: number, bpm: number, beats: number, pattern: [number, number][], period = 1): number {
  const beat = 60 / bpm, hits: [number, number][] = [];
  for (let n = 0; n * period < beats; n++) for (const [at, strength] of pattern) hits.push([from + (n * period + at) * beat, strength]);
  hits.sort((a, b) => a[0] - b[0]);
  for (const [t, strength] of hits) hear(t, null, strength);
  return from + beats * beat;
}
const KICK: [number, number][] = [[0, 1]];
const OFF_BEAT: [number, number][] = [[0.5, 0.4]];
const KICK_AND_OFF: [number, number][] = [[0, 1], [0.5, 0.4]];

/** A clock following steady onsets from time 0 for `count` beats. Returns the time of the next beat. */
function followed(count: number, hint: number | null = null, bpm = 128): { clock: TempoClock; next: number; hear: Hear } {
  const clock = new TempoClock(), hear = listener(clock), beat = 60 / bpm;
  clock.setSource('follow');
  for (let i = 0; i < count; i++) hear(i * beat, hint);
  return { clock, next: count * beat, hear };
}
/** How far the clock's nearest beat is from time t, in milliseconds. */
function phaseErrorMs(clock: TempoClock, t: number): number {
  const { beats, bpm } = clock.snapshot(t);
  return Math.abs(beats - Math.round(beats)) * 60000 / bpm;
}
function withStorage(saved: unknown, run: (writes: string[]) => void): void {
  const writes: string[] = [];
  const owner = globalThis as unknown as { localStorage?: unknown };
  const before = owner.localStorage;
  owner.localStorage = { getItem: () => saved === null ? null : JSON.stringify(saved), setItem: (_: string, value: string) => { writes.push(value); } };
  try { run(writes); } finally { owner.localStorage = before; }
}

test('next bar', () => assert.deepEqual(nextBoundary(c, 1900, '1bar'), { beat: 4, atMs: 2000, late: false }));
test('a press within 100 ms after the bar counts as that bar and fires now', () => assert.deepEqual(nextBoundary(c, 2050, '1bar'), { beat: 4, atMs: 2050, late: true }));
test('a press later than that waits for the next bar', () => assert.deepEqual(nextBoundary(c, 2150, '1bar'), { beat: 8, atMs: 4000, late: false }));
test('bars follow the offset', () => assert.equal(nextBoundary({ ...c, barOffset: 1 }, 1900, '1bar').beat, 5));
test('quantize values', () => assert.deepEqual(quantizeBeats, { '1/4': 1, '1/2': 2, '1bar': 4, '2bar': 8, '4bar': 16 }));

test('a press exactly on the bar is that bar and is not late', () => assert.deepEqual(nextBoundary(c, 2000, '1bar'), { beat: 4, atMs: 2000, late: false }));
test('beat and time convert both ways from the anchor', () => {
  const moved = { ...c, anchorMs: 1000, anchorBeat: 10 };
  assert.equal(beatAt(moved, 2000), 12);
  assert.equal(msAtBeat(moved, 12), 2000);
});
test('a locked clip launched after a correction is shifted by the bar offset', () => {
  assert.equal(launchPhaseOffset(c), 0);
  assert.equal(launchPhaseOffset({ ...c, barOffset: 3 }), 3);
});

test('follow: on-beat onsets lock at 128 ±1 BPM within 8 seconds', () => {
  const { clock } = followed(Math.floor(8 / BEAT_128));
  assert.equal(clock.followState, 'locked');
  assert.ok(Math.abs(clock.bpm - 128) <= 1, `bpm ${clock.bpm}`);
});
test('follow: a tempo hint starts the clock from the first onset, folded into range', () => {
  const clock = new TempoClock();
  clock.setSource('follow');
  clock.followOnset(1, 64);
  assert.equal(clock.bpm, 128);
});
test('follow: an off-beat onset does not move the beat', () => {
  const { clock, next, hear } = followed(16);
  const before = clock.snapshot(next + BEAT_128 / 2), bpm = clock.bpm;
  hear(next + BEAT_128 / 2);
  assert.equal(clock.snapshot(next + BEAT_128 / 2).beats, before.beats);
  assert.equal(clock.bpm, bpm);
});
test('follow: phase converges within 30 ms after a small timing error', () => {
  const { clock, next, hear } = followed(16);
  const shift = 0.05; // inside the 15% window at 128 BPM (about 70 ms)
  for (let i = 0; i < 16; i++) hear(next + shift + i * BEAT_128);
  assert.ok(phaseErrorMs(clock, next + shift + 16 * BEAT_128) < 30);
});
test('follow: 4 s without onsets is holding, at the last tempo', () => {
  const { clock, next } = followed(16);
  const bpm = clock.bpm;
  clock.followTick(next + 3);
  assert.equal(clock.followState, 'locked');
  clock.followTick(next - BEAT_128 + 4);
  assert.equal(clock.followState, 'holding');
  assert.equal(clock.bpm, bpm);
});
test('follow: music in a new phase after a drop out is picked up again', () => {
  const { clock, next, hear } = followed(16);
  const start = next + 5 + BEAT_128 * 0.4;
  clock.followTick(next + 5);
  assert.equal(clock.followState, 'holding');
  for (let i = 0; i < 12; i++) hear(start + i * BEAT_128);
  assert.equal(clock.followState, 'locked');
  assert.ok(phaseErrorMs(clock, start + 12 * BEAT_128) < 30);
});
for (const [from, to] of [[96, 128], [96, 129], [128, 96], [116, 174], [116, 172], [174, 116], [128, 140]]) {
  test(`follow: a new track moving ${from} to ${to} BPM is picked up, though some onsets land near the old beat`, () => {
    const { clock, next, hear } = followed(32, null, from);
    play(hear, next, to, 140, KICK);
    assert.ok(Math.abs(clock.bpm - to) <= 1, `bpm ${clock.bpm}`);
    assert.equal(clock.followState, 'locked');
  });
}
test('follow: a steady off-beat bass between the kicks does not unlock or move the clock', () => {
  const { clock, next, hear } = followed(16, null, 118);
  const end = play(hear, next, 118, 32, KICK_AND_OFF);
  assert.equal(clock.followState, 'locked');
  assert.ok(Math.abs(clock.bpm - 118) <= 1, `bpm ${clock.bpm}`);
  assert.ok(phaseErrorMs(clock, end) < 30);
});
for (const bpm of [118, 120, 124, 128, 140, 174]) {
  test(`follow: a 4-bar off-beat breakdown at ${bpm} BPM never moves the beat, and the kick returning keeps it`, () => {
    const { clock, next, hear } = followed(32, null, bpm);
    const kicksBack = play(hear, next, bpm, 16, OFF_BEAT);
    assert.ok(phaseErrorMs(clock, kicksBack) < 30, `after the breakdown ${phaseErrorMs(clock, kicksBack)} ms`);
    const end = play(hear, kicksBack, bpm, 128, KICK_AND_OFF);
    assert.ok(phaseErrorMs(clock, end) < 30, `after the kick returned ${phaseErrorMs(clock, end)} ms`);
  });
}
test('follow: kicks on 1 and 3 with off-beats on every beat keep the beat at 128', () => {
  const { clock, next, hear } = followed(32);
  const end = play(hear, next, 128, 64, [[0, 1], [0.5, 0.4], [1.5, 0.4]], 2);
  assert.ok(phaseErrorMs(clock, end) < 30, `${phaseErrorMs(clock, end)} ms`);
});
test('follow: a 3-3-2 rhythm does not change the tempo or the beat', () => {
  const { clock, next, hear } = followed(32, null, 100);
  const end = play(hear, next, 100, 64, [[0, 1], [0.75, 0.6], [1.5, 0.6]], 2);
  assert.ok(Math.abs(clock.bpm - 100) <= 1, `bpm ${clock.bpm}`);
  assert.ok(phaseErrorMs(clock, end) < 30, `${phaseErrorMs(clock, end)} ms`);
});
for (const hint of [118, null]) {
  test(`follow: a show starting on an off-beat finds the kick (hint ${hint})`, () => {
    const clock = new TempoClock(), hear = listener(clock), beat = 60 / 118;
    clock.setSource('follow');
    for (let i = 0; i < 24; i++) { hear(i * beat, hint, 0.4); hear((i + 0.5) * beat, hint, 1); }
    assert.equal(clock.followState, 'locked');
    assert.ok(phaseErrorMs(clock, 24.5 * beat) < 30, `${phaseErrorMs(clock, 24.5 * beat)} ms`);
  });
}
/** Bass at 60 fps through the real detector into a following clock, as ReactivityEngine.read does it. */
function detected(frameOffset = 0) {
  const clock = new TempoClock(), detector = new BeatDetector();
  clock.setSource('follow');
  let frame = 0;
  /** Plays [time, strength] hits until `until` seconds. */
  const listen = (hits: [number, number][], until: number) => {
    for (; (frame + frameOffset) / 60 < until; frame++) {
      const t = (frame + frameOffset) / 60;
      let bass = 0;
      for (const [at, strength] of hits) if (at <= t && t - at < 0.6) bass += strength * Math.exp(-(t - at) / 0.06);
      const heard = detector.update(bass, t);
      if (heard.followOnset) clock.followOnset(t, detector.state(t).bpm, heard.strength);
      clock.followTick(t);
    }
  };
  return { clock, listen };
}
const grid = (from: number, bpm: number, beats: number, pattern: [number, number][]): [number, number][] =>
  Array.from({ length: beats }, (_, n) => pattern.map(([at, strength]): [number, number] => [from + (n + at) * 60 / bpm, strength])).flat();

for (const bpm of [124, 128, 140, 174]) for (const startsOn of ['kick', 'off-beat']) {
  test(`detected at 60 fps: kick and off-beat at ${bpm} BPM, started on the ${startsOn}, locks on the kick`, () => {
    const { clock, listen } = detected(), kickAt = startsOn === 'kick' ? 0 : 0.5;
    const start = 0.5, beats = 64;
    listen(grid(start, bpm, beats, [[kickAt, 1], [kickAt === 0 ? 0.5 : 0, 0.4]]), start + (beats - 1) * 60 / bpm);
    assert.equal(clock.followState, 'locked');
    const error = phaseErrorMs(clock, start + (beats - 1 + kickAt) * 60 / bpm);
    assert.ok(error < 30, `${error} ms from the kick`);
  });
}
test('detected at 60 fps: a 4-bar off-beat breakdown then the kick returning holds phase at 128', () => {
  const { clock, listen } = detected(), beat = 60 / 128, start = 0.5;
  const hits = [...grid(start, 128, 32, KICK), ...grid(start + 32 * beat, 128, 16, OFF_BEAT), ...grid(start + 48 * beat, 128, 64, KICK_AND_OFF)];
  listen(hits, start + 48 * beat);
  assert.ok(phaseErrorMs(clock, start + 48 * beat) < 30, 'after the breakdown');
  listen(hits, start + 111 * beat);
  assert.equal(clock.followState, 'locked');
  assert.ok(phaseErrorMs(clock, start + 111 * beat) < 30, 'after the kick returned');
});
for (const [from, to] of [[96, 128], [96, 129], [128, 96], [116, 174], [116, 172], [174, 116]]) {
  test(`detected at 60 fps: a tempo change from ${from} to ${to} BPM is picked up`, () => {
    const { clock, listen } = detected(), start = 0.5, change = start + 32 * 60 / from, end = change + 140 * 60 / to;
    listen([...grid(start, from, 32, KICK), ...grid(change, to, 140, KICK)], end);
    assert.ok(Math.abs(clock.bpm - to) <= 1, `bpm ${clock.bpm}`);
    assert.equal(clock.followState, 'locked');
  });
}
const OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7].map(n => n / 8);
/** A repeating pattern of [beat, strength] hits, every `period` beats, for `beats` beats. */
const bars = (from: number, bpm: number, beats: number, period: number, pattern: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (let n = 0; n * period < beats; n++) for (const [at, strength] of pattern) if (n * period + at < beats) out.push([from + (n * period + at) * 60 / bpm, strength]);
  return out;
};
/** LOCKED must mean the right tempo on the kick. Not locked is an honest answer. */
function assertNoFalseLock(clock: TempoClock, kick: number, bpm: number, label: string): void {
  if (clock.followState !== 'locked') return;
  const error = phaseErrorMs(clock, kick);
  assert.ok(error < 30 && Math.abs(clock.bpm - bpm) <= 1, `${label}: LOCKED ${error.toFixed(0)} ms out at ${clock.bpm.toFixed(1)}`);
}
for (const bpm of [124, 128, 140]) {
  for (const off of [0.5, 0.7, 0.9]) {
    test(`detected: kicks on 1 and 3 with ${off} off-beats at ${bpm} BPM never lock on the off-beats`, () => {
      for (const offset of OFFSETS) {
        const { clock, listen } = detected(offset), start = 0.5, beat = 60 / bpm;
        listen(bars(start, bpm, 64, 2, [[0, 1], [0.5, off], [1.5, off]]), start + 63.2 * beat);
        assertNoFalseLock(clock, start + 62 * beat, bpm, `offset ${offset}`);
      }
    });
  }
  test(`detected: equal onsets with one kick in four dropped at ${bpm} BPM never lock on the off-beats`, () => {
    for (const offset of OFFSETS) {
      const { clock, listen } = detected(offset), start = 0.5, beat = 60 / bpm;
      listen(bars(start, bpm, 64, 4, [[0, 1], [0.5, 1], [1, 1], [1.5, 1], [2, 1], [2.5, 1], [3.5, 1]]), start + 63.2 * beat);
      assertNoFalseLock(clock, start + 60 * beat, bpm, `offset ${offset}`);
    }
  });
}
for (const bpm of [176, 178, 180, 182, 185]) {
  test(`detected: a kick at ${bpm} BPM, above the ceiling, never shows LOCKED`, () => {
    for (const offset of OFFSETS) {
      const { clock, listen } = detected(offset), start = 0.5, beat = 60 / bpm;
      const hits = bars(start, bpm, 128, 1, [[0, 1]]);
      for (const at of [32, 64, 96, 127.2]) {
        listen(hits, start + at * beat);
        assert.notEqual(clock.followState, 'locked', `offset ${offset} at beat ${at}, ${clock.bpm.toFixed(1)} BPM`);
      }
    }
  });
}
test('detected: a kick at 174 BPM still locks at every frame offset', () => {
  for (const offset of OFFSETS) {
    const { clock, listen } = detected(offset), start = 0.5, beat = 60 / 174;
    listen(bars(start, 174, 128, 1, [[0, 1]]), start + 127.2 * beat);
    assert.equal(clock.followState, 'locked', `offset ${offset}`);
    assert.ok(Math.abs(clock.bpm - 174) <= 1, `bpm ${clock.bpm}`);
    assert.ok(phaseErrorMs(clock, start + 127 * beat) < 30);
  }
});
for (const [name, step] of [['dotted-eighth', 0.375], ['dotted-quarter', 0.75], ['triplet', 2 / 3]] as [string, number][]) {
  test(`detected: an 8-bar ${name} breakdown keeps the 128 tempo and beat, and the kick returning locks them again`, () => {
    for (const offset of OFFSETS) {
      const { clock, listen } = detected(offset), start = 0.5, beat = 60 / 128, back = start + 64 * beat;
      const hits = [...bars(start, 128, 32, 1, [[0, 1]]), ...bars(start + 32 * beat, 128, 32, step, [[0, 0.7]]), ...bars(back, 128, 64, 1, [[0, 1]])];
      listen(hits, back - 0.05);
      assert.notEqual(clock.followState, 'locked', `offset ${offset}: LOCKED during the breakdown at ${clock.bpm.toFixed(1)}`);
      assert.ok(Math.abs(clock.bpm - 128) <= 1, `offset ${offset}: held ${clock.bpm}`);
      assert.ok(phaseErrorMs(clock, back) < 30, `offset ${offset}: ${phaseErrorMs(clock, back)} ms at the return`);
      listen(hits, back + 63.2 * beat);
      assert.equal(clock.followState, 'locked', `offset ${offset}`);
      assert.ok(Math.abs(clock.bpm - 128) <= 1, `offset ${offset}: ${clock.bpm}`);
      assert.ok(phaseErrorMs(clock, back + 63 * beat) < 30);
    }
  });
}
for (const [from, to] of [[96, 128], [128, 96], [116, 174], [174, 116]]) {
  test(`detected: a ratio change ${from} to ${to} is not LOCKED until it is confirmed, then re-acquires at every offset`, () => {
    for (const offset of OFFSETS) {
      const { clock, listen } = detected(offset), start = 0.5, change = start + 32 * 60 / from, end = change + 140 * 60 / to;
      const hits = [...bars(start, from, 32, 1, [[0, 1]]), ...bars(change, to, 140, 1, [[0, 1]])];
      listen(hits, change + 14);
      assert.notEqual(clock.followState, 'locked', `offset ${offset}: LOCKED 14 s after the change at ${clock.bpm.toFixed(1)}`);
      listen(hits, end);
      assert.equal(clock.followState, 'locked', `offset ${offset}`);
      assert.ok(Math.abs(clock.bpm - to) <= 1, `offset ${offset}: ${clock.bpm}`);
    }
  });
}
test('follow: equal kick and off-beat onsets are not guessed into a lock, and Tap settles the phase', () => {
  const clock = new TempoClock(), hear = listener(clock), beat = 60 / 128;
  clock.setSource('follow');
  for (let i = 0; i < 32; i++) { hear(i * beat, 128, 1); hear((i + 0.5) * beat, 128, 1); }
  assert.equal(clock.followState, 'holding');
  clock.manualTap(32 * beat);
  clock.resumeFollow(32 * beat);
  for (let i = 33; i < 64; i++) { hear(i * beat, 128, 1); hear((i + 0.5) * beat, 128, 1); }
  assert.equal(clock.followState, 'locked');
  assert.ok(phaseErrorMs(clock, 64 * beat) < 30);
});
test('the detector onset, its 0.25 s gap and its tempo match the original detector on the same input', () => {
  const beat = 60 / 128, detector = new BeatDetector(), frames: number[] = [];
  let seed = 12345;
  for (let n = 0; n < 900; n++) {
    const t = n / 60;
    seed = (seed * 16807) % 2147483647;
    let bass = 0.01 * (seed / 2147483647);
    for (let i = 0; i * beat <= t; i++) {
      const at = 0.5 + i * beat;
      if (at <= t) bass += Math.exp(-(t - at) / 0.06);
      if (at + beat / 2 <= t) bass += 0.4 * Math.exp(-(t - at - beat / 2) / 0.06);
    }
    if (detector.update(bass, t).onset) frames.push(n);
  }
  // Captured from the detector as it was before Perform (commit fa25385).
  assert.deepEqual(frames, [20, 45, 73, 101, 129, 157, 185, 213, 241, 284, 312, 340, 368, 396, 424, 452, 480, 509, 537, 565, 593, 621, 649, 677, 705, 734, 762, 790, 818, 846, 874]);
  assert.equal(detector.count, 31);
  assert.equal(detector.state(15).bpm, 128.57142857142853);
});
test('follow: tempo stays within 85 to 175', () => {
  for (const hint of [40, 60, 80, 176, 200, 240]) {
    const clock = new TempoClock();
    clock.setSource('follow');
    clock.followOnset(0, hint);
    assert.ok(clock.bpm >= 85 && clock.bpm <= 175, `hint ${hint} gave ${clock.bpm}`);
  }
  for (const gap of [0.25, 1.5]) { // 240 and 40 BPM by onset spacing
    const clock = new TempoClock();
    clock.setSource('follow');
    for (let i = 0; i < 12; i++) clock.followOnset(i * gap, null);
    assert.ok(clock.bpm >= 85 && clock.bpm <= 175, `gap ${gap} gave ${clock.bpm}`);
  }
});
test('follow: a tempo from before the show is folded into range as following starts, keeping the beat count', () => {
  const clock = new TempoClock();
  clock.setBpm(60);
  clock.advance(0);
  const before = clock.advance(10).beat;
  clock.setSource('follow');
  assert.equal(clock.bpm, 120);
  assert.equal(clock.advance(10).beat, before);
});
test('follow: a MIDI Start from other gear does not reset the beat count', () => {
  const { clock, next } = followed(16);
  const before = clock.snapshot(next).beats;
  clock.midiStart(next);
  assert.equal(clock.snapshot(next).beats, before);
});
test('setBarStart changes barOffset and never changes the beat count', () => {
  const clock = new TempoClock();
  clock.setBpm(120);
  clock.advance(0);
  const t = 3.5; // beat 7, so the bar now starts on 7 % 4 = 3
  const before = clock.snapshot(t).beats;
  clock.setBarStart(t);
  assert.equal(clock.barOffset, 3);
  assert.equal(clock.snapshot(t).beats, before);
  assert.equal(clock.advance(t).beat, 7);
});
test('manualTap is manual until resumeFollow', () => {
  const { clock, next } = followed(16);
  clock.manualTap(next);
  clock.manualTap(next + 0.5);
  assert.equal(clock.followState, 'manual');
  assert.equal(clock.bpm, 120);
  clock.followOnset(next + 0.75, 140);
  clock.followTick(next + 10);
  assert.equal(clock.followState, 'manual');
  assert.equal(clock.bpm, 120);
  clock.resumeFollow(next + 11);
  assert.notEqual(clock.followState, 'manual');
});
test('the existing beat source still re-anchors on each onset', () => {
  const clock = new TempoClock();
  clock.setSource('beat');
  clock.advance(0);
  clock.detected(1.13, 100);
  assert.equal(clock.bpm, 100);
  assert.equal(clock.advance(1.13).phase, 0);
  clock.followOnset(1.4, 150); // the follow path leaves the beat source alone
  assert.equal(clock.bpm, 100);
});

test('a show uses follow, never saves it, and ends on the saved source and tempo', () => {
  withStorage({ audioDevice: null, midi: false, tempo: 'fixed', bpm: 97 }, writes => {
    const engine = new ReactivityEngine();
    engine.beginShowClock();
    assert.equal(engine.tempo.source, 'follow');
    engine.tempo.followOnset(1, 128);
    engine.showTap();
    engine.tap();
    engine.followAgain();
    engine.setBarStart();
    assert.equal(engine.prefs.tempo, 'fixed');
    engine.endShowClock();
    assert.equal(engine.tempo.source, 'fixed');
    assert.equal(engine.tempo.bpm, 97);
    assert.equal(writes.length, 0);
  });
});
test('a new show starts with no bar offset from the last one', () => {
  withStorage({ audioDevice: null, midi: false, tempo: 'fixed', bpm: 120 }, () => {
    const engine = new ReactivityEngine();
    engine.tempo.advance(0);
    engine.tempo.setBarStart(3.5);
    assert.equal(engine.tempo.barOffset, 3);
    engine.beginShowClock();
    assert.equal(engine.tempo.barOffset, 0);
  });
});
test('a show leaves a saved MIDI clock in charge', () => {
  withStorage({ audioDevice: null, midi: false, tempo: 'midi', bpm: 120 }, () => {
    const engine = new ReactivityEngine();
    engine.beginShowClock();
    assert.equal(engine.tempo.source, 'midi');
    assert.equal(engine.tempo.followState, 'manual');
    engine.endShowClock();
    assert.equal(engine.tempo.source, 'midi');
  });
});
test('follow in saved preferences is refused', () => {
  withStorage({ audioDevice: null, midi: false, tempo: 'follow', bpm: 120 }, () => {
    assert.equal(new ReactivityEngine().prefs.tempo, 'beat');
  });
});
