import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, scoreQuality } from '../src/meridian/composer';
import { PHRASE_STATES } from '../src/meridian/types';

const DEFAULTS = { symmetry: 0, zones: 4, ringCount: 7, spokeCount: 12, nodeDensity: 0.5, latticeType: 0.35 };

test('same seed and settings give the same score', () => assert.deepEqual(compose(42, DEFAULTS), compose(42, DEFAULTS)));
test('1,000 seeds pass every hard limit', () => { for (let s = 0; s < 1000; s++) assert.deepEqual(scoreQuality(compose(s, DEFAULTS)).hardFailures, [], `seed ${s}`); });
test('seeds differ', () => assert.ok(new Set(Array.from({ length: 200 }, (_, s) => JSON.stringify(compose(s, DEFAULTS).elements.slice(0, 8)))).size > 190));
test('the best candidate is kept', () => assert.ok(compose(9, DEFAULTS).quality >= scoreQuality(compose(9, DEFAULTS)).value - 1e-9));
test('symmetry is honoured', () => assert.equal(compose(3, { ...DEFAULTS, symmetry: 6 }).symmetry, 6));

test('stateEnds has one rising value per phrase state, ending at exactly 1', () => {
  const { stateEnds } = compose(5, DEFAULTS);
  assert.equal(stateEnds.length, PHRASE_STATES.length);
  stateEnds.forEach((end, i) => assert.ok(end > (i ? stateEnds[i - 1] : 0)));
  assert.equal(stateEnds[stateEnds.length - 1], 1);
});

test('scoreQuality reports each broken hard limit', () => {
  const good = compose(11, DEFAULTS);
  const ring = { group: 'ring', zone: 0, radius: 0.2, angle: 0, length: Math.PI * 2, weight: 1, colour: 0, enter: 0, exit: 1, slot: 0 } as const;
  const failures = (elements: typeof good.elements, stateEnds = good.stateEnds) => scoreQuality({ ...good, elements, stateEnds }).hardFailures.length;
  assert.ok(failures(good.elements.filter((e) => e.group !== 'hero')) > 0, 'no hero');
  assert.ok(failures([...good.elements, ring, { ...ring, radius: 0.205 }]) > 0, 'near-tangent rings');
  assert.ok(failures(good.elements, [0.1, 0.2, 0.3, 0.3, 0.5, 0.6, 0.99]) > 0, 'stateEnds');
});
