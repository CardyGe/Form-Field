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
test('the studio window alone may listen to sound (its audio only) and to MIDI without system-exclusive messages', () => {
  assert.equal(live.allowPermission('media', { mediaTypes: ['audio'] }, true, true), true);
  assert.equal(live.allowPermission('media', { mediaTypes: ['audio'] }, true, false), false, 'not an output window');
  assert.equal(live.allowPermission('media', { mediaTypes: ['video', 'audio'] }, true, true), false);
  assert.equal(live.allowPermission('midi', {}, true, true), true);
  assert.equal(live.allowPermission('midiSysex', {}, true, true), false);
  assert.equal(live.allowPermission('midi', {}, true, false), false);
  assert.equal(live.allowPermission('midi', {}, false, true), false);
  assert.equal(live.allowPermissionCheck('media', { mediaType: 'audio' }, true, true), true);
  assert.equal(live.allowPermissionCheck('media', { mediaType: 'audio' }, true, false), false);
  assert.equal(live.allowPermissionCheck('midi', {}, true, true), true);
  assert.equal(live.allowPermissionCheck('midiSysex', {}, true, true), false);
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

const { EventEmitter } = require('node:events');

test('a retry message passes to the artwork window', () => assert.equal(live.acceptMessage({ type: 'retry' }), true));
test('camera states from the artwork window are small plain objects with a known status', () => {
  assert.equal(live.acceptState({ status: 'running', label: 'FaceTime HD', width: 1280, height: 720 }), true);
  assert.equal(live.acceptState({ status: 'lost' }), true);
  for (const bad of [null, 'lost', { status: 'hacked' }, { status: 'error', message: 'x'.repeat(20000) }]) assert.equal(live.acceptState(bad), false);
});

// A stand-in main process: enough of Electron to open the artwork window and unplug its display.
function harness(extra = {}) {
  const handlers = new Map(), listeners = new Map(), screen = new EventEmitter(), sent = [], blocker = { started: [], stopped: [] };
  const displays = [{ id: 1, label: 'Built-in', size: { width: 1512, height: 982 }, bounds: { x: 0, y: 0, width: 1512, height: 982 } }, { id: 7, label: 'Projector', size: { width: 1920, height: 1080 }, bounds: { x: 1512, y: 0, width: 1920, height: 1080 } }];
  screen.getAllDisplays = () => displays; screen.getPrimaryDisplay = () => displays[0];
  const contents = () => Object.assign(new EventEmitter(), { mainFrame: {}, send: (...args) => sent.push(args), setWindowOpenHandler() {} });
  const studio = { isDestroyed: () => false, webContents: contents() };
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = contents(); this.destroyed = false; windows.push(this); }
    isDestroyed() { return this.destroyed; } show() {} setSimpleFullScreen() {} setFullScreen() {}
    close() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
  }
  const control = live.setupLive({
    BrowserWindow, screen, systemPreferences: {}, settingsFile: '/nonexistent/live-settings.json', preload: '/preload.cjs', studio: () => studio, open() {}, ...extra,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    powerSaveBlocker: { start: kind => { blocker.started.push(kind); return 42; }, stop: id => blocker.stopped.push(id), isStarted: () => true },
  });
  const fromStudio = { sender: studio.webContents, senderFrame: studio.webContents.mainFrame };
  const fromOutput = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
  return { handlers, listeners, screen, sent, blocker, windows, control, fromStudio, fromOutput, displays };
}
test('the display stays awake while the artwork window is open', async () => {
  const h = harness();
  await h.handlers.get('studio:live:openOutput')(h.fromStudio, 7);
  assert.deepEqual(h.blocker.started, ['prevent-display-sleep']);
  h.windows[0].close();
  assert.deepEqual(h.blocker.stopped, [42]);
});
test('the artwork window keeps the Live title', async () => {
  const h = harness();
  await h.handlers.get('studio:live:openOutput')(h.fromStudio, 7);
  assert.equal(h.windows[0].options.title, 'Form & Field Live');
});
test('opening the Live output first closes the other output', async () => {
  let closed = 0;
  const h = harness({ closeOtherOutput: () => { closed += 1; } });
  await h.handlers.get('studio:live:openOutput')(h.fromStudio, 7);
  assert.equal(closed, 1);
});
test('unplugging the projector closes the artwork window and tells the studio', async () => {
  const h = harness();
  await h.handlers.get('studio:live:openOutput')(h.fromStudio, 7);
  h.screen.emit('display-removed', {}, h.displays[1]);
  assert.equal(h.windows[0].destroyed, true);
  assert.ok(h.sent.some(([channel, open]) => channel === 'studio:live:output' && open === false));
  assert.ok(h.sent.some(([channel]) => channel === 'studio:live:displays'), 'the studio was not told the displays changed');
});
test('the artwork window reports its camera state to the studio, and nobody else can', async () => {
  const h = harness();
  await h.handlers.get('studio:live:openOutput')(h.fromStudio, 7);
  h.listeners.get('studio:live:state')(h.fromStudio, { status: 'lost' });
  assert.equal(h.sent.some(([channel]) => channel === 'studio:live:state'), false);
  h.listeners.get('studio:live:state')(h.fromOutput(), { status: 'lost' });
  assert.deepEqual(h.sent.find(([channel]) => channel === 'studio:live:state'), ['studio:live:state', { status: 'lost' }]);
});
test('a window that is not the studio cannot open the output', async () => {
  const h = harness();
  await assert.rejects(h.handlers.get('studio:live:openOutput')({ sender: {}, senderFrame: {} }, 7), /cannot control Live/);
});

test('the empty room can be captured in the artwork window', () => assert.equal(live.acceptMessage({ type: 'captureRoom' }), true));
test('the artwork window may report people finding alongside its camera, and only in a known shape', () => {
  assert.equal(live.acceptState({ status: 'running', label: 'x', width: 1, height: 1, people: { state: 'behind' }, roomCaptured: true }), true);
  assert.equal(live.acceptState({ status: 'running', label: 'x', width: 1, height: 1, people: { state: 'hacked' } }), false);
  assert.equal(live.acceptState({ status: 'running', label: 'x', width: 1, height: 1, people: 'running' }), false);
  assert.equal(live.acceptState({ status: 'running', label: 'x', width: 1, height: 1, roomCaptured: 'yes' }), false);
});
