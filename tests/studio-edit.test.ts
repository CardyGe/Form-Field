import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/project';
import { projectForStudioSave, stashStudio } from '../src/ui/studio-edit';
import { applyStudioEdit, initialMapState, mapReducer } from '../src/map/state';
import { applyEdit } from '../src/map/editor';
import { createShow } from '../src/map/show';

test('while a shape is edited in Studio, Studio saves its own project, never the shape\'s', () => {
  const own = createProject(), shapes = createProject();
  const stash = stashStudio({ project: own, history: [], future: [], filePath: '/a.formfield', selectedId: 'x', phase: 1 });
  assert.equal(projectForStudioSave(shapes, { sourceId: 's', shapeName: 'Door', stash }), own);
  assert.equal(projectForStudioSave(own, null), own);
});

test('the stash keeps Studio\'s history as it was, even if the live arrays change afterwards', () => {
  const a = createProject(), b = createProject();
  const history = [a], future = [b];
  const stash = stashStudio({ project: a, history, future, filePath: '', selectedId: '', phase: 0 });
  history.push(b); future.length = 0;
  assert.deepEqual(stash.history, [a]);
  assert.deepEqual(stash.future, [b]);
});

test('a whole Studio editing session is one undo step in Map', () => {
  let show = createShow();
  const shape = applyEdit(show, { type: 'addRectangle', id: 'a', a: { x: 0.1, y: 0.1 }, b: { x: 0.3, y: 0.3 }, colour: '#ff0000' });
  assert.ok(shape.ok);
  const content = applyEdit(shape.show, { type: 'setContent', shapeId: 'a', content: { kind: 'preset', presetId: 'porcelain-shutters', sourceId: 'src', seed: 1 } });
  assert.ok(content.ok);
  show = content.show;
  let state = mapReducer(initialMapState(createShow()), { type: 'load', show });
  const pastBefore = state.past.length;
  const edits = [0.9, 0.8, 0.7].map(opacity => { const p = structuredClone(show.sources[0].project); p.layers[0].opacity = opacity; return p; });
  state = applyStudioEdit(state, 'src', edits[0], true);
  state = applyStudioEdit(state, 'src', edits[1], false);
  state = applyStudioEdit(state, 'src', edits[2], false);
  assert.equal(state.show.sources[0].project.layers[0].opacity, 0.7);
  assert.equal(state.past.length, pastBefore + 1);
  assert.equal(state.show.sources[0].revision, 3);
  // Undo returns to before the editing session.
  const undone = mapReducer(state, { type: 'undo' });
  assert.equal(undone.show.sources[0].project.layers[0].opacity, show.sources[0].project.layers[0].opacity);
  // A refused composition leaves the show as it was and says why.
  const big = structuredClone(edits[2]); big.layers = [0, 1, 2, 3, 4].map(i => ({ ...big.layers[0], id: `l${i}` }));
  const refused = applyStudioEdit(state, 'src', big, false);
  assert.equal(refused.show, state.show);
  assert.equal(refused.refusal, 'too-many-layers');
});
