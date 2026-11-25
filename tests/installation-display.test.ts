import test from 'node:test';
import assert from 'node:assert/strict';
import { installationDisplay } from '../src/ui/installation-display';

const laptop = { id: 1, label: 'Built-in', primary: true }, projector = { id: 7, label: 'Projector', primary: false }, other = { id: 9, label: 'TV', primary: false };

test('a saved projector is used when it is connected, and waited for when it is not, never the laptop screen', () => {
  assert.deepEqual(installationDisplay(7, [laptop, projector]), { id: 7, waiting: null });
  const waiting = installationDisplay(7, [laptop]);
  assert.equal(waiting.id, null); assert.match(waiting.waiting!, /waiting for its projector/);
  assert.equal(installationDisplay(7, [laptop, other]).id, null, 'another screen does not stand in for the saved projector');
});

test('with none saved, the first display that is not the main screen; with only the main screen, it waits', () => {
  assert.deepEqual(installationDisplay(null, [laptop, projector]), { id: 7, waiting: null });
  const waiting = installationDisplay(null, [laptop]);
  assert.equal(waiting.id, null); assert.match(waiting.waiting!, /second display/);
  assert.equal(installationDisplay(null, []).id, null);
});
