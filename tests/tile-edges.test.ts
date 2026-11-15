import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/core/project';

test('tileEdges is optional and round-trips', () => {
  const p = createProject();
  assert.equal('tileEdges' in validateProject(structuredClone(p)), false);
  assert.equal(validateProject({ ...structuredClone(p), tileEdges: true }).tileEdges, true);
  assert.throws(() => validateProject({ ...structuredClone(p), tileEdges: 'yes' }));
});
