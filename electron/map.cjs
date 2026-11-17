'use strict';

/** Show file I/O for the Map. The page validates the fields; the main process only checks the file is a JSON object. */
const fs = require('node:fs/promises');
const path = require('node:path');

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

/** The parsed show, or null when the file is missing. A file that is not a JSON object is copied to `${file}.damaged`. */
async function loadShowFile(file) {
  let bytes;
  try { bytes = await fs.readFile(file); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* falls through to the damaged copy */ }
  await fs.writeFile(`${file}.damaged`, bytes);
  return null;
}

/** Atomic save: the previous file is kept as `${file}.previous`; a failure leaves the original in place. */
async function saveShowFile(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, text);
    if (await exists(file)) await fs.copyFile(file, `${file}.previous`);
    await fs.rename(temporary, file);
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

const { createOutputWindow } = require('./output-window.cjs');
const { acceptPreview } = require('./live.cjs');

// A copy of acceptMapMessage in src/map/messages.ts (the main process cannot load TypeScript).
// tests/map-messages.test.ts runs one table of messages against both copies, so they stay in step.
const MESSAGE_LIMIT = 256 * 1024; // MAP_MESSAGE_LIMIT
const SOURCE_MESSAGE_LIMIT = 24 * 1024 * 1024; // a composition can hold images of up to 20 MB
const SHOW_TEXT_LIMIT = 128 * 1024 * 1024; // a show's compositions can hold images
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const within = (value, limit) => { try { const text = JSON.stringify(value); return typeof text === 'string' && text.length < limit; } catch { return false; } };
const idOrNull = value => value === null || typeof value === 'string';
const finite = value => typeof value === 'number' && Number.isFinite(value);

function acceptMapMessage(value) {
  if (!plain(value)) return false;
  if (!within(value, value.type === 'source' ? SOURCE_MESSAGE_LIMIT : MESSAGE_LIMIT)) return false;
  switch (value.type) {
    case 'show': return plain(value.show);
    case 'source': return typeof value.id === 'string' && value.id !== '' && Number.isInteger(value.revision) && value.revision >= 0 && plain(value.project);
    case 'blackout':
    case 'testGrid':
    case 'freeze': return typeof value.on === 'boolean';
    case 'identify': return idOrNull(value.shapeId);
    case 'crosshair': return idOrNull(value.shapeId) && (value.point === null || (plain(value.point) && finite(value.point.x) && finite(value.point.y)));
    default: return false;
  }
}

const FILTERS = [{ name: 'Form & Field Map show', extensions: ['formshow'] }];

/**
 * Registers Map in the main process, mirroring setupLive. `studio()` returns the studio window;
 * `open(window)` loads the app page into the output window with the hash #map-output;
 * `closeLiveOutput()` closes Live's output window. Map never holds Live's window.
 */
function setupMap({ BrowserWindow, ipcMain, screen, powerSaveBlocker, dialog, autosavePath, preload, studio, open, closeLiveOutput }) {
  let output = null;
  let showPath = null;
  // Every write, and the autosave read, goes through one queue, so two saves never overlap
  // and a read never sees a half-finished write (the same pattern as the studio autosave).
  let saveQueue = Promise.resolve();
  const queued = work => {
    const operation = saveQueue.then(work);
    saveQueue = operation.catch(() => {});
    return operation;
  };
  const queuedSave = (file, text) => queued(() => saveShowFile(file, text));
  const alive = window => !!window && !window.isDestroyed();
  const fromStudio = event => alive(studio()) && event.sender === studio().webContents && event.senderFrame === studio().webContents.mainFrame;
  const fromOutput = event => alive(output) && event.sender === output.webContents && event.senderFrame === output.webContents.mainFrame;
  const tellStudio = (channel, ...args) => { if (alive(studio())) studio().webContents.send(channel, ...args); };
  const handle = (name, operation) => ipcMain.handle(`studio:map:${name}`, async (event, ...args) => {
    if (!fromStudio(event)) throw new Error('This window cannot control Map.');
    return operation(...args);
  });
  const closeOutput = () => { if (alive(output)) output.close(); };
  const sameScreenAsStudio = display => {
    const window = studio();
    if (!alive(window) || typeof window.getBounds !== 'function' || typeof screen.getDisplayMatching !== 'function') return false;
    return screen.getDisplayMatching(window.getBounds())?.id === display.id;
  };
  const checkText = text => { if (typeof text !== 'string' || text.length > SHOW_TEXT_LIMIT) throw new Error('This show cannot be saved.'); };

  handle('loadAutosave', () => queued(() => loadShowFile(autosavePath)));
  handle('saveAutosave', text => { checkText(text); return queuedSave(autosavePath, text); });
  // The parsed show; null when the person cancelled; { damaged: true } when the chosen file cannot be read.
  handle('openShow', async () => {
    const result = await dialog.showOpenDialog(studio(), { properties: ['openFile'], filters: FILTERS });
    if (result.canceled || !result.filePaths?.length) return null;
    const file = result.filePaths[0];
    let show = null;
    try { show = await queued(() => loadShowFile(file)); } catch { show = null; }
    if (!show) return { damaged: true };
    showPath = file;
    return show;
  });
  // Returns the file written, or null when the person cancelled the dialog.
  handle('saveShow', async (text, saveAs) => {
    checkText(text);
    let target = showPath;
    if (saveAs || !target) {
      const result = await dialog.showSaveDialog(studio(), { defaultPath: 'Untitled.formshow', filters: FILTERS });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath;
    }
    await queuedSave(target, text);
    showPath = target;
    return target;
  });
  handle('displays', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => ({ id: display.id, primary: display.id === primary,
      label: `${display.label || `Display ${index + 1}`} · ${display.size.width} × ${display.size.height}${display.id === primary ? ' (this screen)' : ''}` }));
  });
  handle('openOutput', displayId => {
    const display = screen.getAllDisplays().find(candidate => candidate.id === displayId);
    if (!display) throw new Error('That display is no longer connected.');
    if (closeLiveOutput) closeLiveOutput();
    closeOutput();
    const windowed = process.env.STUDIO_LIVE_TEST_WINDOW === '1';
    // On the screen the controls are on, full screen would hide them: open an ordinary window there instead.
    const framed = !windowed && sameScreenAsStudio(display);
    const { window, release } = createOutputWindow({ BrowserWindow, powerSaveBlocker, display, preload, title: 'Form & Field Map', windowed, framed });
    output = window;
    window.on('closed', () => {
      release();
      if (output === window) { output = null; tellStudio('studio:map:output', false); }
    });
    open(window);
  });
  handle('closeOutput', () => closeOutput());

  // The output page says when it is ready; only then is the studio told the output is open (and sends the show).
  ipcMain.on('studio:map:ready', event => { if (fromOutput(event)) tellStudio('studio:map:output', true); });
  ipcMain.on('studio:map:close', event => { if (fromOutput(event)) closeOutput(); });
  // A small picture of the wall, so the operator screen shows what the projector really has.
  ipcMain.on('studio:map:preview', (event, bytes) => { if (fromOutput(event) && acceptPreview(bytes)) tellStudio('studio:map:preview', bytes); });
  ipcMain.on('studio:map:send', (event, message) => { if (fromStudio(event) && alive(output) && acceptMapMessage(message)) output.webContents.send('studio:map:message', message); });
  screen.on('display-removed', (_event, display) => { if (alive(output) && output.displayId === display.id) closeOutput(); });
  for (const change of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(change, () => tellStudio('studio:map:displays'));

  return { closeOutput, isOutput: contents => alive(output) && contents === output.webContents };
}

module.exports = { loadShowFile, saveShowFile, acceptMapMessage, setupMap };
