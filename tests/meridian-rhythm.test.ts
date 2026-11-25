import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../src/meridian/random';
import { euclid, subdivisionAt } from '../src/meridian/rhythm';

test('euclid spreads hits evenly', () => {
  assert.deepEqual(euclid(3, 8).map(Number), [1,0,0,1,0,0,1,0]);
  assert.equal(euclid(5, 16).filter(Boolean).length, 5);
  assert.deepEqual(euclid(0, 4), [false,false,false,false]);
  assert.equal(euclid(9, 4).filter(Boolean).length, 4);
});
test('rotation moves the pattern', () => assert.deepEqual(euclid(1, 4, 1).map(Number), [0,1,0,0]));
test('random is reproducible', () => { const a=createRandom(7), b=createRandom(7); for(let i=0;i<100;i++) assert.equal(a(), b()); });
test('random stays in [0,1)', () => { const r=createRandom(3); for(let i=0;i<1000;i++){ const v=r(); assert.ok(v>=0 && v<1); } });
test('subdivisions tighten', () => { assert.equal(subdivisionAt(0,1,8),1); assert.equal(subdivisionAt(1,1,8),8); assert.ok([1,2,4,8].includes(subdivisionAt(.5,1,8))); });
test('subdivisions never decrease', () => { let last=0; for(let i=0;i<=100;i++){ const s=subdivisionAt(i/100,1,8); assert.ok(s>=last); last=s; } });
test('subdivisions treat a non-finite progress as the start', () => { for (const bad of [NaN, Infinity, -Infinity]) assert.equal(subdivisionAt(bad,2,8),2); });
test('euclid gives a safe pattern for non-finite input', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(euclid(3, bad), []);
    assert.deepEqual(euclid(bad, 4), [false,false,false,false]);
    assert.deepEqual(euclid(1, 4, bad), euclid(1, 4));
  }
});
