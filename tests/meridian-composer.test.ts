import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, composeCandidates, pickBest, scoreQuality } from '../src/meridian/composer';
import { PHRASE_STATES } from '../src/meridian/types';

const DEFAULTS = { symmetry: 0, zones: 4, ringCount: 7, spokeCount: 12, nodeDensity: 0.5, latticeType: 0.35 };

test('same seed and settings give the same score', () => assert.deepEqual(compose(42, DEFAULTS), compose(42, DEFAULTS)));
test('1,000 seeds pass every hard limit', () => { for (let s = 0; s < 1000; s++) assert.deepEqual(scoreQuality(compose(s, DEFAULTS)).hardFailures, [], `seed ${s}`); });
test('seeds differ', () => assert.ok(new Set(Array.from({ length: 200 }, (_, s) => JSON.stringify(compose(s, DEFAULTS).elements.slice(0, 8)))).size > 190));
test('the best of eight candidates is kept', () => {
  for (let s = 0; s < 50; s++) {
    const candidates = composeCandidates(s, DEFAULTS);
    assert.equal(candidates.length, 8);
    const kept = scoreQuality(compose(s, DEFAULTS)).value;
    for (const candidate of candidates) assert.ok(kept >= scoreQuality(candidate).value, `seed ${s}`);
  }
});
test('candidates differ in structure', () => {
  const plans = new Set(composeCandidates(4, DEFAULTS).map((c) => `${c.symmetry}:${c.elements.find((e) => e.group === 'hero')?.zone}`));
  assert.ok(plans.size > 1);
});
test('an explicit symmetry holds for every candidate', () => {
  for (const candidate of composeCandidates(4, { ...DEFAULTS, symmetry: 5 })) assert.equal(candidate.symmetry, 5);
});
test('a hard-failing candidate loses to a clean one, even with a higher value', () => {
  const ranked = [...composeCandidates(9, DEFAULTS)].sort((a, b) => scoreQuality(b).value - scoreQuality(a).value);
  const clean = ranked[ranked.length - 1];
  const extra = [7, 8, 9].map((weight) => ({ ...ranked[0].elements[1], group: 'tick' as const, weight }));
  const broken = { ...ranked[0], elements: [...ranked[0].elements, ...extra] };
  assert.ok(scoreQuality(broken).hardFailures.length > 0);
  assert.deepEqual(scoreQuality(clean).hardFailures, []);
  assert.ok(scoreQuality(broken).value > scoreQuality(clean).value, 'the broken candidate must score higher for this test to mean anything');
  assert.equal(pickBest([broken, clean]), clean);
  assert.equal(pickBest([clean, broken]), clean);
});
test('only the hub survives into Rest, so contrast measures Peak against Rest', () => {
  const score = compose(12, DEFAULTS);
  const restAt = (score.stateEnds[5] + 1) / 2;
  assert.deepEqual(score.elements.filter((e) => e.enter <= restAt && e.exit > restAt).map((e) => e.group), ['hub']);
  const withoutHubExit = { ...score, elements: score.elements.map((e) => ({ ...e, exit: 1 })) };
  assert.ok(scoreQuality(score).value > scoreQuality(withoutHubExit).value);
});
test('symmetry is honoured', () => assert.equal(compose(3, { ...DEFAULTS, symmetry: 6 }).symmetry, 6));

test('stateEnds has one rising value per phrase state, ending at exactly 1', () => {
  const { stateEnds } = compose(5, DEFAULTS);
  assert.equal(stateEnds.length, PHRASE_STATES.length);
  stateEnds.forEach((end, i) => assert.ok(end > (i ? stateEnds[i - 1] : 0)));
  assert.equal(stateEnds[stateEnds.length - 1], 1);
});

test('scoreQuality reports each broken hard limit', () => {
  const good = compose(11, DEFAULTS);
  const ring = { group: 'ring', zone: 0, radius: 0.2, angle: 0, length: Math.PI * 2, weight: 1, colour: 0, enter: 0, exit: 1, slot: 0, shape: 'dot' } as const;
  const failures = (elements: typeof good.elements, stateEnds = good.stateEnds) => scoreQuality({ ...good, elements, stateEnds }).hardFailures.length;
  assert.ok(failures(good.elements.filter((e) => e.group !== 'hero')) > 0, 'no hero');
  assert.ok(failures([...good.elements, ring, { ...ring, radius: 0.205 }]) > 0, 'near-tangent rings');
  assert.ok(failures(good.elements, [0.1, 0.2, 0.3, 0.3, 0.5, 0.6, 0.99]) > 0, 'stateEnds');
});
