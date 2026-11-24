'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const installation = require('./installation.cjs');

test('settings validate: defaults, ranges and unknown fields', () => {
  assert.deepEqual(installation.validateInstallation(null), installation.INSTALLATION_DEFAULTS);
  assert.deepEqual(installation.validateInstallation({ on: 'yes', surface: 'everywhere', autopilot: 1, everyBeats: 9999, display: 'x', extra: 1 }), { ...installation.INSTALLATION_DEFAULTS, everyBeats: 128 });
  assert.deepEqual(installation.validateInstallation({ on: true, surface: 'live', autopilot: false, everyBeats: 3, display: 7 }), { on: true, surface: 'live', autopilot: false, everyBeats: 16, display: 7 });
  assert.equal(installation.validateInstallation({ everyBeats: Number.NaN }).everyBeats, 32);
  assert.equal(installation.validateInstallation({ display: 1.5 }).display, null);
});

test('the fault log takes short fault strings only, never pictures, sound or camera data', () => {
  assert.equal(installation.faultText('Flash limiter unavailable: shader failed'), 'Flash limiter unavailable: shader failed');
  assert.equal(installation.faultText('  line one\nline two\u0000 '), 'line one line two');
  for (const bad of [
    null, 42, { message: 'x' }, ['x'], new Uint8Array(8), Buffer.from('x'), new ArrayBuffer(8),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA', 'see data:audio/wav;base64,UklGR', 'blob:file:///abc',
    'A'.repeat(400), `frame ${'QUJD'.repeat(80)}`, '', '   ',
  ]) assert.equal(installation.faultText(bad), null, `accepted ${String(bad).slice(0, 40)}`);
  assert.equal(installation.faultText('fault '.repeat(1000)).length, installation.FAULT_LIMIT, 'long text is cut, not refused');
});

test('the fault log never grows past 5 MB, keeping the newest faults', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-installation-'));
  try {
    const file = path.join(dir, 'faults.log'), log = installation.createFaultLog({ fs, file, limit: 64 * 1024 });
    for (let i = 0; i < 3000; i++) await log.append(`fault number ${i} on the wall`, new Date(Date.UTC(2026, 11, 6, 22, 0, i % 60)));
    const text = await fs.readFile(file, 'utf8'), lines = text.trim().split('\n');
    assert.ok(Buffer.byteLength(text) <= 64 * 1024, `${Buffer.byteLength(text)} bytes`);
    assert.match(lines.at(-1), /fault number 2999 on the wall$/);
    assert.match(lines[0], /^2026-12-06T22:00:\d\d\.000Z fault number \d+ on the wall$/);
    assert.equal(await log.append({ picture: 'x' }), false);
    assert.equal(installation.LOG_LIMIT, 5 * 1024 * 1024);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

// A stand-in main process.
function harness(saved) {
  const handlers = new Map(), files = new Map(), blocker = { started: [], stopped: [], live: new Set() };
  if (saved !== undefined) files.set('/data/installation.json', JSON.stringify(saved));
  const fakeFs = {
    readFile: async (file) => { if (!files.has(file)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; } return files.get(file); },
    writeFile: async (file, text) => { files.set(file, String(text)); },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    appendFile: async (file, text) => { files.set(file, (files.get(file) ?? '') + text); },
    stat: async (file) => { if (!files.has(file)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; } return { size: Buffer.byteLength(files.get(file)) }; },
    mkdir: async () => {},
  };
  const studio = { isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), { mainFrame: {} }) };
  let next = 1;
  const control = installation.setupInstallation({
    fs: fakeFs, settingsFile: '/data/installation.json', logFile: '/data/faults.log', studio: () => studio,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    powerSaveBlocker: { start: kind => { const id = next++; blocker.started.push(kind); blocker.live.add(id); return id; }, stop: id => { blocker.stopped.push(id); blocker.live.delete(id); }, isStarted: id => blocker.live.has(id) },
  });
  const fromStudio = { sender: studio.webContents, senderFrame: studio.webContents.mainFrame };
  return { handlers, files, blocker, control, fromStudio };
}

test('IPC: get, set and log, from the studio window only', async () => {
  const h = harness();
  assert.deepEqual(await h.handlers.get('studio:installation:get')(h.fromStudio), { settings: installation.INSTALLATION_DEFAULTS, running: false });
  const saved = await h.handlers.get('studio:installation:set')(h.fromStudio, { on: true, surface: 'map', everyBeats: 48 });
  assert.deepEqual(saved, { settings: { ...installation.INSTALLATION_DEFAULTS, on: true, everyBeats: 48 }, running: true });
  assert.deepEqual(JSON.parse(h.files.get('/data/installation.json')), saved.settings);
  assert.equal(await h.handlers.get('studio:installation:log')(h.fromStudio, 'Map: an instrument stopped'), true);
  assert.equal(await h.handlers.get('studio:installation:log')(h.fromStudio, 'data:image/jpeg;base64,/9j/4AAQ'), false);
  assert.match(h.files.get('/data/faults.log'), /Map: an instrument stopped\n$/);
  assert.doesNotMatch(h.files.get('/data/faults.log'), /base64/);
  for (const name of ['get', 'set', 'log']) await assert.rejects(h.handlers.get(`studio:installation:${name}`)({ sender: {}, senderFrame: {} }, 'x'), /cannot/);
});

test('the display is kept awake only while the installation runs', async () => {
  const h = harness();
  await h.control.ready;
  assert.deepEqual(h.blocker.started, []);
  await h.handlers.get('studio:installation:set')(h.fromStudio, { on: true });
  assert.deepEqual(h.blocker.started, ['prevent-display-sleep']);
  await h.handlers.get('studio:installation:set')(h.fromStudio, { on: true, everyBeats: 64 });
  assert.equal(h.blocker.started.length, 1, 'a change while running does not take a second blocker');
  await h.handlers.get('studio:installation:set')(h.fromStudio, { on: false });
  assert.equal(h.blocker.live.size, 0);
  await h.handlers.get('studio:installation:set')(h.fromStudio, { on: true });
  h.control.stop();
  assert.equal(h.blocker.live.size, 0, 'quitting lets the display sleep again');
});

test('on launch with Installation on, it is running and holding the display awake straight away', async () => {
  const h = harness({ on: true, surface: 'live', autopilot: true, everyBeats: 32, display: 2 });
  await h.control.ready;
  assert.equal(h.control.running(), true);
  assert.deepEqual(h.blocker.started, ['prevent-display-sleep']);
  assert.deepEqual((await h.handlers.get('studio:installation:get')(h.fromStudio)).settings.surface, 'live');
});

test('a damaged settings file opens as off', async () => {
  const h = harness();
  h.files.set('/data/installation.json', '{not json');
  const again = installation.setupInstallation({ fs: { readFile: async () => '{not json', writeFile: async () => {}, rename: async () => {}, appendFile: async () => {}, stat: async () => ({ size: 0 }), mkdir: async () => {} },
    settingsFile: '/x.json', logFile: '/f.log', studio: () => null, ipcMain: { handle() {} }, powerSaveBlocker: { start: () => 1, stop() {}, isStarted: () => false } });
  await again.ready;
  assert.equal(again.running(), false);
});
