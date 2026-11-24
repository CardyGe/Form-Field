import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MERIDIAN_MOVES, MERIDIAN_PARAMETERS } from '../src/meridian/parameters';
import { MERIDIAN_LIVE_CONTROLS } from '../src/live/settings';
import { StructureHold } from '../src/meridian/structure-hold';
import { MeridianRenderer } from '../src/rendering/MeridianRenderer';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('move descriptions describe what a move does now, with no phrases or quantise points', () => {
  for (const key of [...MERIDIAN_MOVES, 'moveRecall']) {
    const d = MERIDIAN_PARAMETERS.find(p => p.key === key)!;
    assert.ok(!/phrase|quantis/i.test(d.description ?? ''), `${key}: ${d.description}`);
  }
  // Live's tooltips come from the same words.
  for (const c of MERIDIAN_LIVE_CONTROLS.filter(c => c.group === 'Moves')) assert.ok(!/phrase|quantis/i.test(c.description ?? ''), c.key);
});

test('the catalogue no longer calls Meridian phrases of light', () => {
  assert.ok(!/phrases of light/.test(read('src/ui/App.tsx')));
});

test('the unused queued prop and its Next phrase badge are gone', () => {
  const controls = read('src/ui/MeridianControls.tsx');
  assert.ok(!/queued/.test(controls)); assert.ok(!/Next phrase/.test(controls)); assert.ok(!/m-next/.test(read('src/ui/meridian.css')));
});

test('the Dense and Pulse display lists (about 2 MB) are made only when first drawn, not with every renderer', () => {
  const r = new MeridianRenderer() as unknown as { listStore: unknown; ghostStore: unknown };
  assert.equal(r.listStore, null); assert.equal(r.ghostStore, null);
});

test('StructureHold makes no closures per frame and still holds Dense structural links until the loop turns', () => {
  const body = read('src/meridian/structure-hold.ts').split('apply<')[1].split('forget(')[0];
  assert.ok(!/=>/.test(body), 'apply makes no arrow functions');
  const hold = new StructureHold();
  const dense = { layers: [{ kind: 'meridian', params: { scoreStyle: 1 } }] }, evolve = { layers: [{ kind: 'meridian', params: { scoreStyle: 2 } }] };
  const structural = MERIDIAN_PARAMETERS.find(d => d.structural)!.key, free = MERIDIAN_PARAMETERS.find(d => !d.structural && d.step !== 1)!.key;
  const at = (value: number) => [{ layer: 0, key: structural, value }, { layer: 0, key: free, value }];
  assert.deepEqual(hold.apply('a', dense, at(1), 0.1)!.map(o => o.value), [1, 1]);
  assert.deepEqual(hold.apply('a', dense, at(2), 0.5)!.map(o => o.value), [1, 2], 'held until the loop comes round');
  assert.deepEqual(hold.apply('a', dense, at(3), 0.05)!.map(o => o.value), [3, 3], 'taken as the loop turns');
  const passed = at(4);
  assert.equal(hold.apply('b', evolve, passed, 0.2), passed, 'Evolve passes straight through');
  assert.equal(hold.apply('c', dense, undefined, 0.2), undefined);
});
