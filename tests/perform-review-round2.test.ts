// Task 9 review, round 2: every source field guards undo, and a zone's previous clip stays safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as grid from '../src/perform/grid-edit';
import { applyEdit, presetComposition, type EditAction } from '../src/map/editor';
import { createShow, type CurvePoint, type ShowDocument } from '../src/map/show';
import { initialLauncher, returnZone } from '../src/perform/launcher';
import { createPerformanceSet } from '../src/perform/set';
import type { ClockSnapshot } from '../src/perform/timing';
import type { Clip } from '../src/perform/types';
import { keysBelongElsewhere } from '../src/ui/usePerform';

const helpers = grid as unknown as { clipsInUse(l: ReturnType<typeof initialLauncher>): string[] };
const sq: CurvePoint[] = [{ x: .1, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .4 }, { x: .1, y: .4 }];
const ok = (show: ShowDocument, action: EditAction) => { const r = applyEdit(show, action); assert.ok(r.ok, `refused: ${!r.ok && r.reason}`); return r.show; };
const clip = (id: string, sourceId: string): Clip => ({ id, name: id, sourceId, hueOffset: 0, blend: null, audioBand: 'level' });
const clock: ClockSnapshot = { anchorMs: 0, anchorBeat: 0, bpm: 120, state: 'locked', barOffset: 0 };

test('during a show, undoing a change to any source field is refused, such as Follow outline', () => {
  let before = ok(createShow(), { type: 'addShape', id: 'shape', points: sq, colour: '#ff0000' });
  const set = grid.placeClip(grid.addRow(before.performance, 'row'), 0, 0, clip('c1', 's1'));
  before = ok(before, { type: 'addClipSource', sourceId: 's1', project: presetComposition('salt-mandala', 1)!, performance: set });
  const after = ok(before, { type: 'setFollowOutline', sourceId: 's1', mode: 'edge' });
  assert.equal(grid.historyBlock(after, before, ['c1']), 'picture');
});

test('a zone\'s previous clip counts as in use during a show', () => {
  const launcher = { ...initialLauncher(), playing: ['now', ...Array(7).fill(null)], previous: ['before', ...Array(7).fill(null)] };
  assert.deepEqual(helpers.clipsInUse(launcher).sort(), ['before', 'now']);
});

test('going back to a previous clip that no longer exists does nothing', () => {
  const set = createPerformanceSet();
  const s = { ...initialLauncher(), playing: ['now', ...Array(7).fill(null)], previous: ['gone', ...Array(7).fill(null)] };
  assert.equal(returnZone(s, set, 0, clock, 100, 'L1'), s);
});

test('a select that gives the controller its keys does not block them, and any other select does', () => {
  const select = (inside: boolean) => ({ tagName: 'SELECT', isContentEditable: false, closest: (q: string) => inside && q.includes('data-controller-keys') ? {} : null }) as unknown as HTMLElement;
  assert.equal(keysBelongElsewhere(select(true)), false);
  assert.equal(keysBelongElsewhere(select(false)), true);
});
