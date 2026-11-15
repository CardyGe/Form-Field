'use strict';

// Live mode in the main process: camera permission, the artwork window, and
// the relay between it and the studio window. Camera video never passes
// through here; only settings and a small preview picture do.

/** A permission request: only camera video, only from this app's own windows. */
function allowPermission(permission, details, isOurWindow) {
  const types = details?.mediaTypes;
  return isOurWindow === true && permission === 'media' && Array.isArray(types) && types.length === 1 && types[0] === 'video';
}

/** A permission check (made before and while the camera is used): the same rule. */
function allowPermissionCheck(permission, details, isOurWindow) {
  return isOurWindow === true && permission === 'media' && details?.mediaType === 'video';
}

/** Asks macOS for the camera the first time only. A refusal can only be changed in System Settings. */
async function ensureCameraAccess(systemPreferences) {
  const status = typeof systemPreferences.getMediaAccessStatus === 'function' ? systemPreferences.getMediaAccessStatus('camera') : 'granted';
  if (status === 'granted') return 'granted';
  if (status !== 'not-determined' || typeof systemPreferences.askForMediaAccess !== 'function') return 'refused';
  return await systemPreferences.askForMediaAccess('camera') ? 'granted' : 'refused';
}

const fs = require('node:fs/promises');
const path = require('node:path');

const MESSAGE_LIMIT = 16 * 1024;
const PREVIEW_LIMIT = 512 * 1024;
const MESSAGE_TYPES = new Set(['settings', 'blackout', 'clear']);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const small = value => { try { return JSON.stringify(value).length < MESSAGE_LIMIT; } catch { return false; } };

/** The saved Live settings, or null when there are none or the file is damaged. The page repairs the fields. */
async function loadSettings(file) {
  try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return plain(value) ? value : null; }
  catch { return null; }
}

/** Writes to a temporary file, then renames, so a crash cannot leave half a file. */
async function saveSettings(file, settings) {
  if (!plain(settings) || !small(settings)) throw new Error('These Live settings cannot be saved.');
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(temporary, JSON.stringify(settings)); await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

/** What the studio window may send to the artwork window. Values are range-checked by the page that receives them. */
function acceptMessage(message) {
  return plain(message) && MESSAGE_TYPES.has(message.type) && small(message);
}

function acceptPreview(bytes) {
  const size = bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes) ? bytes.byteLength : 0;
  return size > 0 && size <= PREVIEW_LIMIT;
}

function pickDisplay(displays, id) {
  return displays.find(display => display.id === id) ?? null;
}

/**
 * Registers Live in the main process. `studio()` returns the studio window (or undefined);
 * `open(window)` loads the app page into the artwork window with the hash #live-output.
 */
function setupLive({ BrowserWindow, ipcMain, screen, systemPreferences, settingsFile, preload, studio, open }) {
  let output = null;
  const alive = window => !!window && !window.isDestroyed();
  const fromStudio = event => alive(studio()) && event.sender === studio().webContents && event.senderFrame === studio().webContents.mainFrame;
  const fromOutput = event => alive(output) && event.sender === output.webContents && event.senderFrame === output.webContents.mainFrame;
  const tellStudio = (channel, ...args) => { if (alive(studio())) studio().webContents.send(channel, ...args); };
  const handle = (name, operation) => ipcMain.handle(`studio:live:${name}`, async (event, ...args) => {
    if (!fromStudio(event)) throw new Error('This window cannot control Live.');
    return operation(...args);
  });
  const closeOutput = () => { if (alive(output)) output.close(); };

  handle('loadSettings', () => loadSettings(settingsFile));
  handle('saveSettings', settings => saveSettings(settingsFile, settings));
  handle('cameraAccess', () => ensureCameraAccess(systemPreferences));
  handle('displays', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => ({ id: display.id, primary: display.id === primary,
      label: `${display.label || `Display ${index + 1}`} · ${display.size.width} × ${display.size.height}${display.id === primary ? ' (this screen)' : ''}` }));
  });
  handle('openOutput', displayId => {
    const display = pickDisplay(screen.getAllDisplays(), displayId);
    if (!display) throw new Error('That display is no longer connected.');
    closeOutput();
    const window = new BrowserWindow({
      ...display.bounds, frame: false, show: false, backgroundColor: '#000000', title: 'Form & Field Live', resizable: false, movable: false,
      minimizable: false, fullscreenable: true, skipTaskbar: true, autoHideMenuBar: true,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
    });
    output = window;
    window.displayId = display.id;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.close(); } });
    window.webContents.on('render-process-gone', () => { if (!window.isDestroyed()) window.close(); });
    window.once('ready-to-show', () => { if (window.isDestroyed()) return; window.show(); if (process.platform === 'darwin') window.setSimpleFullScreen(true); else window.setFullScreen(true); });
    window.on('closed', () => { if (output === window) { output = null; tellStudio('studio:live:output', false); } });
    open(window);
  });
  handle('closeOutput', () => closeOutput());

  // The artwork page says when it is ready; only then is the studio told the output is open.
  ipcMain.on('studio:live:ready', event => { if (fromOutput(event)) tellStudio('studio:live:output', true); });
  ipcMain.on('studio:live:send', (event, message) => { if (fromStudio(event) && alive(output) && acceptMessage(message)) output.webContents.send('studio:live:message', message); });
  ipcMain.on('studio:live:preview', (event, bytes) => { if (fromOutput(event) && acceptPreview(bytes)) tellStudio('studio:live:preview', bytes); });
  screen.on('display-removed', (_event, display) => { if (alive(output) && output.displayId === display.id) closeOutput(); });

  return { closeOutput, isOutput: contents => alive(output) && contents === output.webContents };
}

module.exports = { allowPermission, allowPermissionCheck, ensureCameraAccess, loadSettings, saveSettings, acceptMessage, acceptPreview, pickDisplay, setupLive };
