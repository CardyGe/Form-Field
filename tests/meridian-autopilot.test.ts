import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Autopilot, AUTOPILOT } from '../src/meridian/autopilot';

/** Runs an autopilot over `beats` beats in 1/60 s frames at `bpm` and returns every change, copied. */
function play(pilot: Autopilot, beats: number, bpm = 124, params: Record<string, number> = {}, from = 0) {
  const changes: { at: number; seed: number; moves: string[] }[] = [];
  const step = bpm / 60 / 60;
  for (let b = from; b < from + beats; b += step) {
    const action = pilot.next({ beats: b }, params);
    if (action.moves.length) changes.push({ at: b, seed: action.seed, moves: [...action.moves] });
  }
  return changes;
}

test('the same seed plays the same changes', () => {
  assert.deepEqual(play(new Autopilot(7), 4000), play(new Autopilot(7), 4000));
  assert.notDeepEqual(play(new Autopilot(7), 4000).map(c => c.seed), play(new Autopilot(8), 4000).map(c => c.seed));
});

test('no seed repeats within 32 changes', () => {
  const seeds = play(new Autopilot(3, 16), 16 * 600).map(c => c.seed);
  assert.ok(seeds.length >= 300, `${seeds.length} changes`);
  for (let i = 0; i < seeds.length; i++) for (let k = Math.max(0, i - AUTOPILOT.history + 1); k < i; k++) assert.notEqual(seeds[i], seeds[k], `seed ${seeds[i]} repeats at ${k} and ${i}`);
  assert.ok(seeds.every(s => Number.isInteger(s) && s >= 1 && s <= AUTOPILOT.maxSeed));
});

test('it acts only through Next and Mutate, one move at a time, and varies them', () => {
  const changes = play(new Autopilot(11), 6000);
  assert.ok(changes.every(c => c.moves.length === 1 && (c.moves[0] === 'moveNext' || c.moves[0] === 'moveMutate')), 'only continuous moves');
  const kinds = changes.map(c => c.moves[0]);
  const mutates = kinds.filter(k => k === 'moveMutate').length;
  assert.ok(mutates > changes.length * .2 && mutates < changes.length * .6, `${mutates} of ${changes.length} are Mutate`);
  for (let i = 2; i < kinds.length; i++) assert.ok(!(kinds[i] === 'moveMutate' && kinds[i - 1] === 'moveMutate' && kinds[i - 2] === 'moveMutate'), 'never three Mutates running');
  const gaps = new Set(changes.slice(1).map((c, i) => Math.round(c.at - changes[i].at)));
  assert.ok(gaps.size >= 3, `gaps vary: ${[...gaps]}`);
});

test('changes land on the phrase grid and keep to the chosen pace', () => {
  const changes = play(new Autopilot(5, 32), 32 * 60);
  for (const c of changes) assert.ok(c.at % AUTOPILOT.phraseBeats < .05, `change at beat ${c.at.toFixed(3)} is off the grid`);
  const gaps = changes.slice(1).map((c, i) => c.at - changes[i].at);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(mean > 24 && mean < 48, `mean gap ${mean}`);
  assert.ok(Math.min(...gaps) >= 16, `shortest gap ${Math.min(...gaps)}`);
});

test('a jump in time, such as a stall, gives one change and not a burst', () => {
  const pilot = new Autopilot(2, 16);
  play(pilot, 40);
  let fired = 0;
  for (const beats of [400, 400.01, 400.02, 400.03]) if (pilot.next({ beats }, {}).moves.length) fired++;
  assert.ok(fired <= 1, `${fired} changes after the jump`);
});

test('Hold shape stops it; letting go starts it again', () => {
  const held = play(new Autopilot(4, 16), 400, 124, { scoreHoldShape: 1 });
  assert.equal(held.length, 0);
  const pilot = new Autopilot(4, 16);
  play(pilot, 100, 124, { scoreHoldShape: 1 });
  assert.ok(play(pilot, 100, 124, {}, 100).length > 0);
});

test('nonsense beats are ignored', () => {
  const pilot = new Autopilot(1);
  for (const beats of [Number.NaN, Infinity, -Infinity]) assert.equal(pilot.next({ beats }, {}).moves.length, 0);
});

test('next allocates nothing: the same action object comes back', () => {
  const pilot = new Autopilot(9, 16);
  const seen = new Set<object>();
  for (let b = 0; b < 400; b += .05) seen.add(pilot.next({ beats: b }, {}));
  assert.ok(seen.size <= 2, `${seen.size} different objects`);
});

test('it is pure: no three, DOM or React', () => {
  const source = readFileSync(new URL('../src/meridian/autopilot.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"](three|react)|document\.|window\./);
});
