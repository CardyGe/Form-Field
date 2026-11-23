import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayBudget, QualityGovernor } from '../src/morphogen/governor';
import { liveReadiness } from '../src/map/liveReady';

const BUDGET = 16.7;
const key = (s: { steps: number; simHeight: number; bloom: boolean }) => `${s.steps}/${s.simHeight}/${s.bloom}`;

test('overload lowers steps, then simulation size, then bloom', () => {
  const g = new QualityGovernor(576), seen = [key(g.state)];
  for (let i = 0; i < 2000; i++) { const k = key(g.update(34, BUDGET)); if (k !== seen[seen.length - 1]) seen.push(k); }
  assert.deepEqual(seen, ['12/576/true', '8/576/true', '5/576/true', '5/432/true', '5/432/false']);
});

test('a single spike changes nothing', () => {
  const g = new QualityGovernor(576);
  for (let i = 0; i < 600; i++) assert.equal(key(g.update(i === 300 ? 120 : 16.6, BUDGET)), '12/576/true');
});

test('quality returns only after ten seconds of headroom', () => {
  const g = new QualityGovernor(576);
  for (let i = 0; i < 60; i++) g.update(34, BUDGET);
  const lowered = key(g.state);
  assert.notEqual(lowered, '12/576/true');
  for (let i = 0; i < 9.5 * 60; i++) assert.equal(key(g.update(16.6, BUDGET)), lowered);
  for (let i = 0; i < 60; i++) g.update(16.6, BUDGET);
  assert.notEqual(key(g.state), lowered);
});

test('a constant load at a tier boundary does not keep flipping', () => {
  const g = new QualityGovernor(576);
  let changes = 0, last = key(g.state);
  for (let i = 0; i < 60 * 60 * 10; i++) {
    const k = key(g.update(g.state.steps > 8 ? 34 : 16.6, BUDGET));
    if (k !== last) { changes++; last = k; }
  }
  assert.ok(changes <= 11, `${changes} changes in ten minutes`);
});

test('a smaller base never raises the simulation above it', () => {
  const g = new QualityGovernor(432);
  assert.equal(g.state.simHeight, 432);
  for (let i = 0; i < 2000; i++) assert.equal(g.update(34, BUDGET).simHeight, 432);
});

test('the budget follows a 120 Hz display', () => {
  const b = new DisplayBudget();
  let budget = 0;
  for (let i = 0; i < 240; i++) budget = b.estimate(8.33);
  assert.ok(Math.abs(budget - 8.33) < .2);
});

test('overload cannot talk the budget into a slower display', () => {
  const b = new DisplayBudget();
  let budget = 0;
  for (let i = 0; i < 600; i++) budget = b.estimate(33.3);
  assert.equal(budget, 16.7);
});

test('one unusually short frame does not move the budget', () => {
  const b = new DisplayBudget();
  let budget = 0;
  for (let i = 0; i < 240; i++) budget = b.estimate(i === 120 ? 2 : 16.67);
  assert.ok(budget > 16);
});

test('shapes keep their fill until a fresh pattern has formed', () => {
  const at = { file: false, needsCamera: false, needsPeople: false, peopleLoading: false, drawnSinceRunning: 0, hasPicture: false };
  assert.equal(liveReadiness({ status: 'none' }, { ...at, warming: true }), 'wait');
  assert.equal(liveReadiness({ status: 'none' }, { ...at, warming: true, hasPicture: true }), 'hold');
  assert.equal(liveReadiness({ status: 'none' }, { ...at, warming: false }), 'play');
});
