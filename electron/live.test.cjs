'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.cjs');

test('only our windows may use the camera, and only its video', () => {
  assert.equal(live.allowPermission('media', { mediaTypes: ['video'] }, true), true);
  assert.equal(live.allowPermission('media', { mediaTypes: ['video', 'audio'] }, true), false);
  assert.equal(live.allowPermission('media', { mediaTypes: ['audio'] }, true), false);
  assert.equal(live.allowPermission('media', { mediaTypes: [] }, true), false);
  assert.equal(live.allowPermission('media', undefined, true), false);
  assert.equal(live.allowPermission('media', { mediaTypes: ['video'] }, false), false);
  for (const other of ['geolocation', 'notifications', 'display-capture', 'clipboard-read', 'midi']) assert.equal(live.allowPermission(other, { mediaTypes: ['video'] }, true), false, other);
});
test('permission checks follow the same rule', () => {
  assert.equal(live.allowPermissionCheck('media', { mediaType: 'video' }, true), true);
  assert.equal(live.allowPermissionCheck('media', { mediaType: 'audio' }, true), false);
  assert.equal(live.allowPermissionCheck('media', { mediaType: 'unknown' }, true), false);
  assert.equal(live.allowPermissionCheck('media', { mediaType: 'video' }, false), false);
  assert.equal(live.allowPermissionCheck('geolocation', { mediaType: 'video' }, true), false);
});
test('camera access is asked for once, and never when already refused', async () => {
  const stub = status => { const calls = []; return { calls, getMediaAccessStatus: () => status, askForMediaAccess: async kind => { calls.push(kind); return true; } }; };
  const refused = stub('denied'); assert.equal(await live.ensureCameraAccess(refused), 'refused'); assert.deepEqual(refused.calls, []);
  const restricted = stub('restricted'); assert.equal(await live.ensureCameraAccess(restricted), 'refused');
  const granted = stub('granted'); assert.equal(await live.ensureCameraAccess(granted), 'granted'); assert.deepEqual(granted.calls, []);
  const fresh = stub('not-determined'); assert.equal(await live.ensureCameraAccess(fresh), 'granted'); assert.deepEqual(fresh.calls, ['camera']);
  const declined = { getMediaAccessStatus: () => 'not-determined', askForMediaAccess: async () => false }; assert.equal(await live.ensureCameraAccess(declined), 'refused');
});
