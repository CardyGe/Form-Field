'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { loadShowFile, saveShowFile, setupMap, acceptMapMessage } = require('./map.cjs');

async function inTempDir(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-show-'));
  try { await body(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('a missing show file loads as null', async () => {
  await inTempDir(async dir => {
    assert.equal(await loadShowFile(path.join(dir, 'show.json')), null);
  });
});

test('a valid show file loads as its parsed object', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    await fs.writeFile(file, '{"version":1,"surfaces":[]}');
    assert.deepEqual(await loadShowFile(file), { version: 1, surfaces: [] });
  });
});

test('a file that does not parse is copied byte for byte to .damaged and loads as null', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    const bytes = Buffer.from([0x7b, 0x22, 0x61, 0xff, 0xfe, 0x00]);
    await fs.writeFile(file, bytes);
    assert.equal(await loadShowFile(file), null);
    assert.deepEqual(await fs.readFile(`${file}.damaged`), bytes);
  });
});

test('valid JSON that is not a plain object is treated as damaged', async () => {
  for (const text of ['[]', '"x"', 'null', '3']) {
    await inTempDir(async dir => {
      const file = path.join(dir, 'show.json');
      await fs.writeFile(file, text);
      assert.equal(await loadShowFile(file), null, text);
      assert.equal(await fs.readFile(`${file}.damaged`, 'utf8'), text);
    });
  }
});

test('saving twice keeps the first version as .previous', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    await saveShowFile(file, '{"n":1}');
    await saveShowFile(file, '{"n":2}');
    assert.equal(await fs.readFile(file, 'utf8'), '{"n":2}');
    assert.equal(await fs.readFile(`${file}.previous`, 'utf8'), '{"n":1}');
  });
});

test('a failed rename leaves the original untouched and removes the temporary file', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'show.json');
    await saveShowFile(file, '{"n":1}');
    const real = fs.rename;
    fs.rename = async (from, to) => {
      if (to === file) throw new Error('disk full');
      return real(from, to);
    };
    try {
      await assert.rejects(saveShowFile(file, '{"n":2}'), /disk full/);
    } finally { fs.rename = real; }
    assert.equal(await fs.readFile(file, 'utf8'), '{"n":1}');
    const left = (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(left, []);
  });
});

function harness(overrides = {}) {
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
  const calls = { closeLive: 0 };
  const control = setupMap({
    BrowserWindow, screen, preload: '/preload.cjs', studio: () => studio, open() {}, autosavePath: '/nonexistent/map-autosave.formshow',
    closeLiveOutput: () => { calls.closeLive += 1; },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    powerSaveBlocker: { start: kind => { blocker.started.push(kind); return 42; }, stop: id => blocker.stopped.push(id), isStarted: () => true },
    ...overrides,
  });
  const fromStudio = { sender: studio.webContents, senderFrame: studio.webContents.mainFrame };
  const fromOutput = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
  return { handlers, listeners, screen, sent, blocker, windows, control, fromStudio, fromOutput, displays, calls, studio };
}
const stranger = { sender: {}, senderFrame: {} };

test('a window that is not the studio cannot control Map', async () => {
  const h = harness();
  for (const name of ['loadAutosave', 'saveAutosave', 'openShow', 'saveShow', 'displays', 'openOutput', 'closeOutput']) {
    await assert.rejects(async () => h.handlers.get(`studio:map:${name}`)(stranger, 7), { message: 'This window cannot control Map.' }, name);
  }
});

test('opening a display that is gone throws', async () => {
  const h = harness();
  await assert.rejects(async () => h.handlers.get('studio:map:openOutput')(h.fromStudio, 99), { message: 'That display is no longer connected.' });
  assert.equal(h.windows.length, 0);
});

test('opening Map output closes Live output first, once, and uses the Map title', async () => {
  const h = harness();
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 7);
  assert.equal(h.calls.closeLive, 1);
  assert.equal(h.windows[0].options.title, 'Form & Field Map');
  assert.deepEqual(h.blocker.started, ['prevent-display-sleep']);
  h.windows[0].close();
  assert.deepEqual(h.blocker.stopped, [42]);
});

test('unplugging the display closes the output and tells the studio', async () => {
  const h = harness();
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 7);
  h.screen.emit('display-removed', {}, h.displays[1]);
  assert.equal(h.windows[0].destroyed, true);
  assert.ok(h.sent.some(([channel, open]) => channel === 'studio:map:output' && open === false));
  assert.ok(h.sent.some(([channel]) => channel === 'studio:map:displays'));
});

test('only the output window can say it is ready, and only the studio can send messages', async () => {
  const h = harness();
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 7);
  h.listeners.get('studio:map:ready')(h.fromStudio);
  assert.equal(h.sent.some(([channel]) => channel === 'studio:map:output'), false);
  h.listeners.get('studio:map:ready')(h.fromOutput());
  assert.ok(h.sent.some(([channel, open]) => channel === 'studio:map:output' && open === true));
  const out = h.windows[0].webContents;
  const sentToOutput = () => h.sent.filter(([channel]) => channel === 'studio:map:message').length;
  h.listeners.get('studio:map:send')(h.fromOutput(), { type: 'blackout', on: true });
  h.listeners.get('studio:map:send')(h.fromStudio, { type: 'bogus' });
  h.listeners.get('studio:map:send')(h.fromStudio, { type: 'blackout', on: 'yes' });
  assert.equal(sentToOutput(), 0);
  const delivered = [];
  out.send = (...args) => delivered.push(args);
  h.listeners.get('studio:map:send')(h.fromStudio, { type: 'blackout', on: true });
  assert.deepEqual(delivered, [['studio:map:message', { type: 'blackout', on: true }]]);
});

test('acceptMapMessage checks the envelope and size', () => {
  assert.equal(acceptMapMessage({ type: 'show', show: {} }), true);
  assert.equal(acceptMapMessage({ type: 'show', show: 'x' }), false);
  assert.equal(acceptMapMessage({ type: 'identify', shapeId: null }), true);
  assert.equal(acceptMapMessage({ type: 'crosshair', shapeId: 'a', point: { x: 1, y: 2 } }), true);
  assert.equal(acceptMapMessage({ type: 'crosshair', shapeId: 'a', point: { x: 1 } }), false);
  assert.equal(acceptMapMessage({ type: 'show', show: { big: 'x'.repeat(600000) } }), false);
  assert.equal(acceptMapMessage({ type: 'show', show: { big: 'x'.repeat(400000) } }), true); // Map's limit is 512 KB (the largest stage 3 show is about 360 KB)
  assert.equal(acceptMapMessage(null), false);
});

test('autosave and show saves are serialised: overlapping saves never run at once', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'auto.formshow');
    const h = harness({ autosavePath: file });
    const saves = ['{"a":1}', '{"a":2}', '{"a":3}'].map(text => h.handlers.get('studio:map:saveAutosave')(h.fromStudio, text));
    await Promise.all(saves);
    assert.equal(await fs.readFile(file, 'utf8'), '{"a":3}');
    assert.deepEqual(await h.handlers.get('studio:map:loadAutosave')(h.fromStudio), { a: 3 });
  });
});

test('Save As writes to the chosen file; Save reuses it; cancel does nothing', async () => {
  await inTempDir(async dir => {
    const chosen = path.join(dir, 'show.formshow');
    let asked = 0;
    const h = harness({ autosavePath: path.join(dir, 'auto.formshow'), dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => { asked += 1; return asked === 1 ? { canceled: true } : { canceled: false, filePath: chosen }; } } });
    const save = h.handlers.get('studio:map:saveShow');
    assert.equal(await save(h.fromStudio, '{"a":1}', true), null);
    assert.equal(await save(h.fromStudio, '{"a":2}', true), chosen);
    assert.equal(await fs.readFile(chosen, 'utf8'), '{"a":2}');
    assert.equal(await save(h.fromStudio, '{"a":3}', false), chosen);
    assert.equal(asked, 2);
    assert.equal(await fs.readFile(chosen, 'utf8'), '{"a":3}');
  });
});

test('Open Show loads the chosen file', async () => {
  await inTempDir(async dir => {
    const chosen = path.join(dir, 'show.formshow');
    await fs.writeFile(chosen, '{"version":1}');
    const h = harness({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [chosen] }), showSaveDialog: async () => ({ canceled: true }) } });
    assert.deepEqual(await h.handlers.get('studio:map:openShow')(h.fromStudio), { version: 1 });
  });
});

test('Open Show tells a damaged file apart from a cancel, and a damaged file does not become the save target', async () => {
  await inTempDir(async dir => {
    const chosen = path.join(dir, 'show.formshow');
    await fs.writeFile(chosen, 'not json');
    let pick = [chosen];
    const target = path.join(dir, 'other.formshow');
    const h = harness({ autosavePath: path.join(dir, 'auto.formshow'), dialog: {
      showOpenDialog: async () => (pick ? { canceled: false, filePaths: pick } : { canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: false, filePath: target }) } });
    assert.deepEqual(await h.handlers.get('studio:map:openShow')(h.fromStudio), { damaged: true });
    pick = [path.join(dir, 'missing.formshow')];
    assert.deepEqual(await h.handlers.get('studio:map:openShow')(h.fromStudio), { damaged: true });
    pick = null;
    assert.equal(await h.handlers.get('studio:map:openShow')(h.fromStudio), null);
    // Save (not Save As) still asks for a file, because no show file was opened.
    assert.equal(await h.handlers.get('studio:map:saveShow')(h.fromStudio, '{"a":1}', false), target);
    assert.equal(await fs.readFile(chosen, 'utf8'), 'not json');
  });
});

test('loading the autosave waits for a save that is still being written', async () => {
  await inTempDir(async dir => {
    const file = path.join(dir, 'auto.formshow');
    const h = harness({ autosavePath: file });
    await h.handlers.get('studio:map:saveAutosave')(h.fromStudio, '{"n":1}');
    const real = fs.rename;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    fs.rename = async (from, to) => { await gate; return real(from, to); };
    try {
      const saving = h.handlers.get('studio:map:saveAutosave')(h.fromStudio, '{"n":2}');
      const loading = h.handlers.get('studio:map:loadAutosave')(h.fromStudio);
      await new Promise(resolve => setTimeout(resolve, 30));
      release();
      await saving;
      assert.deepEqual(await loading, { n: 2 });
    } finally { fs.rename = real; }
  });
});

test('the wall picture goes from the output window to the studio, and only from there', async () => {
  const h = harness();
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 7);
  const pictures = () => h.sent.filter(([channel]) => channel === 'studio:map:preview');
  const relay = h.listeners.get('studio:map:preview');
  relay(h.fromStudio, new ArrayBuffer(100));
  relay(stranger, new ArrayBuffer(100));
  relay(h.fromOutput(), new ArrayBuffer(0));
  relay(h.fromOutput(), new ArrayBuffer(600 * 1024)); // over Live's 512 KB picture limit
  assert.equal(pictures().length, 0);
  relay(h.fromOutput(), new ArrayBuffer(100));
  assert.equal(pictures().length, 1);
});

test('output on the studio\'s own screen opens as an ordinary window; on another display it fills the screen', async () => {
  const h = harness();
  h.studio.getBounds = () => ({ x: 100, y: 100, width: 1200, height: 800 });
  h.screen.getDisplayMatching = () => h.displays[0]; // the studio is on the built-in screen
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 1);
  assert.equal(h.windows.at(-1).options.frame, true);
  assert.equal(h.windows.at(-1).options.resizable, true);
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 7);
  assert.equal(h.windows.at(-1).options.frame, false);
  assert.equal(h.windows.at(-1).options.width, 1920);
});

test('the output reports its frame rate to the studio, and only small, well-formed reports pass', async () => {
  const h = harness();
  await h.handlers.get('studio:map:openOutput')(h.fromStudio, 7);
  const reports = () => h.sent.filter(([channel]) => channel === 'studio:map:state');
  const relay = h.listeners.get('studio:map:state');
  const good = { fps: 60, level: 0, failing: [], prepares: { a: 1 } };
  relay(h.fromStudio, good);
  relay(stranger, good);
  relay(h.fromOutput(), { fps: 'fast', level: 0, failing: [] });
  relay(h.fromOutput(), { fps: 60, level: 9, failing: [] });
  relay(h.fromOutput(), { fps: 60, level: 0, failing: 'x' });
  relay(h.fromOutput(), { ...good, padding: 'x'.repeat(20000) });
  assert.equal(reports().length, 0);
  relay(h.fromOutput(), good);
  assert.deepEqual(reports(), [['studio:map:state', good]]);
});
