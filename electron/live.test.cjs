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

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('settings survive a round trip and leave no temporary file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'live-settings-')), file = path.join(dir, 'live-settings.json');
  try {
    assert.equal(await live.loadSettings(file), null);
    await live.saveSettings(file, { version: 1, mirror: false, paint: { fadeSeconds: 12 } });
    assert.deepEqual(await live.loadSettings(file), { version: 1, mirror: false, paint: { fadeSeconds: 12 } });
    assert.deepEqual(await fs.readdir(dir), ['live-settings.json']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('a damaged settings file loads as nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'live-settings-')), file = path.join(dir, 'live-settings.json');
  try {
    await fs.writeFile(file, '{oops'); assert.equal(await live.loadSettings(file), null);
    await fs.writeFile(file, '[1,2]'); assert.equal(await live.loadSettings(file), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('settings that are not a small plain object are not saved', async () => {
  for (const bad of [null, 'x', [1], { blob: 'x'.repeat(20000) }]) await assert.rejects(live.saveSettings('/nonexistent/never-written.json', bad), /settings/i);
});
test('only the three known messages pass to the artwork window', () => {
  assert.equal(live.acceptMessage({ type: 'settings', settings: { version: 1 } }), true);
  assert.equal(live.acceptMessage({ type: 'blackout', on: true }), true);
  assert.equal(live.acceptMessage({ type: 'clear' }), true);
  for (const bad of [null, 'clear', [], { type: 'eval' }, {}, { type: 'settings', settings: { blob: 'x'.repeat(20000) } }]) assert.equal(live.acceptMessage(bad), false);
});
test('previews are small byte buffers', () => {
  assert.equal(live.acceptPreview(new Uint8Array(1000)), true);
  assert.equal(live.acceptPreview(new ArrayBuffer(1000)), true);
  assert.equal(live.acceptPreview(new Uint8Array(600 * 1024)), false);
  assert.equal(live.acceptPreview(new Uint8Array(0)), false);
  assert.equal(live.acceptPreview('jpeg'), false);
});
test('a display is picked by id, or not at all', () => {
  const displays = [{ id: 1 }, { id: 7 }];
  assert.equal(live.pickDisplay(displays, 7), displays[1]);
  assert.equal(live.pickDisplay(displays, 3), null);
  assert.equal(live.pickDisplay(displays, null), null);
});
