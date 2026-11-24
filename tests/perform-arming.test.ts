import test from 'node:test';
import assert from 'node:assert/strict';
import { inStartOrder, rendererToEvict } from '../src/map/playout';
import { ProgramGate, ProgramsCompiling, retryWhenLinked } from '../src/rendering/program-gate';

const program = (ready: boolean) => { const p = { ready, isReady: () => p.ready }; return p; };

test('the gate never refuses a draw while it is off, as in plain Map', () => {
  const gate = new ProgramGate();
  assert.doesNotThrow(() => gate.before([program(false)]));
  assert.doesNotThrow(() => gate.check());
  assert.equal(gate.linking, false);
});

test('the gate refuses a draw whose program is linking, and lets it through once it has linked', () => {
  const gate = new ProgramGate(), p = program(false);
  gate.open();
  assert.throws(() => gate.before([program(true), p]), ProgramsCompiling);
  assert.equal(gate.linking, true);
  assert.throws(() => gate.check(), ProgramsCompiling);
  p.ready = true;
  assert.equal(gate.linking, false);
  assert.doesNotThrow(() => gate.check());
  assert.doesNotThrow(() => gate.before([p]));
});

test('closing the gate forgets what it was waiting for', () => {
  const gate = new ProgramGate();
  gate.open();
  assert.throws(() => gate.before([program(false)]), ProgramsCompiling);
  gate.close();
  assert.equal(gate.linking, false);
  assert.doesNotThrow(() => gate.check());
});

test('only one renderer links at a time, and a program that never answers stops holding up the others', () => {
  let now = 0;
  const first = new ProgramGate(() => now), second = new ProgramGate(() => now), p = program(false);
  first.open(); second.open();
  assert.throws(() => first.before([p]), ProgramsCompiling);
  assert.throws(() => second.awaitTurn(), ProgramsCompiling);
  p.ready = true;
  assert.doesNotThrow(() => second.awaitTurn());
  p.ready = false;
  first.open();
  assert.throws(() => first.before([p]), ProgramsCompiling);
  now = 5001;
  assert.doesNotThrow(() => second.awaitTurn());
  first.close(); second.close();
});

test('work refused behind another renderer yields, and is not tried again until the turn is free', async () => {
  const holder = new ProgramGate(), waiter = new ProgramGate(), link = program(false);
  holder.open(); waiter.open();
  assert.throws(() => holder.before([link]), ProgramsCompiling);
  let attempts = 0, pauses = 0;
  const done = await retryWhenLinked(() => { attempts++; waiter.awaitTurn(); }, waiter, async () => { pauses++; if (pauses === 25) link.ready = true; }, () => true);
  assert.equal(done, true);
  assert.equal(pauses, 25, 'it gave the page a turn while it waited');
  assert.equal(attempts, 2, 'once refused, then once when the turn was free: its targets are not rebuilt meanwhile');
  holder.close(); waiter.close();
});

test('work no longer wanted stops waiting, and other errors are not swallowed', async () => {
  const gate = new ProgramGate();
  gate.open();
  assert.equal(await retryWhenLinked(() => gate.before([program(false)]), gate, async () => {}, () => false), false);
  gate.close();
  await assert.rejects(retryWhenLinked(() => { throw new Error('broken'); }, gate, async () => {}, () => true), /broken/);
});

test('a queued look gets the start before a look kept for later, whatever the order of the show', () => {
  const sources = [{ id: 'next-row' }, { id: 'playing' }, { id: 'queued' }];
  assert.deepEqual(inStartOrder(sources, ['queued', 'next-row']).map(s => s.id), ['playing', 'queued', 'next-row']);
  assert.equal(inStartOrder(sources, []), sources, 'plain Map keeps its order');
});

test('a material is checked again after it changes', () => {
  const gate = new ProgramGate(), material = { version: 1 };
  assert.equal(gate.knows([material]), false);
  gate.remember([material]);
  assert.equal(gate.knows([material]), true);
  material.version = 2;
  assert.equal(gate.knows([material]), false);
});

test('after a restored context every material is checked again, and an old wait is over, with the gate left as it was', () => {
  const gate = new ProgramGate(), material = { version: 1 };
  gate.open();
  gate.remember([material]);
  assert.throws(() => gate.before([program(false)]), ProgramsCompiling);
  gate.forget();
  assert.equal(gate.knows([material]), false);
  assert.equal(gate.linking, false);
  assert.equal(gate.on, true);
  assert.throws(() => gate.before([program(false)]), ProgramsCompiling, 'still on: a program linking on the new context is refused');
  gate.close();
});

test('the renderer to give up is the lowest rank, and the longest unused among equals', () => {
  const slot = (rank: number, lastUsed: number) => ({ rank, lastUsed });
  const slots: [string, { rank: number; lastUsed: number }][] = [['playing', slot(3, 1)], ['armed', slot(1, 2)], ['warm new', slot(-1, 90)], ['warm old', slot(-1, 10)]];
  assert.equal(rendererToEvict(slots, 1)?.[0], 'warm old');
});

test('a look never takes a renderer from one that matters as much or more', () => {
  const slots: [string, { rank: number; lastUsed: number }][] = [['playing', { rank: 3, lastUsed: 1 }], ['armed', { rank: 1, lastUsed: 1 }]];
  assert.equal(rendererToEvict(slots, 1), null);
  assert.equal(rendererToEvict(slots, 3)?.[0], 'armed');
});
