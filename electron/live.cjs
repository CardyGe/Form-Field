'use strict';

// Live mode in the main process: camera permission, the artwork window, and
// the relay between it and the studio window. Camera video never passes
// through here; only settings and a small preview picture do.

/** A permission request: only camera video, only from this app's own windows. */
function allowPermission(permission, details, isOurWindow, isStudioWindow = false) {
  if (isOurWindow !== true) return false;
  const types = details?.mediaTypes;
  if (permission === 'media' && Array.isArray(types) && types.length === 1 && types[0] === 'video') return true;
  // Sound and MIDI (never system-exclusive) for the reactivity engine, which listens in the studio window only.
  if (isStudioWindow !== true) return false;
  if (permission === 'media') return Array.isArray(types) && types.length === 1 && types[0] === 'audio';
  return permission === 'midi';
}

/** A permission check (made before and while the camera is used): the same rule. */
function allowPermissionCheck(permission, details, isOurWindow, isStudioWindow = false) {
  if (isOurWindow !== true) return false;
  if (permission === 'media' && details?.mediaType === 'video') return true;
  if (isStudioWindow !== true) return false;
  return (permission === 'media' && details?.mediaType === 'audio') || permission === 'midi';
}

/** Asks macOS for the microphone the first time only, for the reactivity engine. */
async function ensureMicrophoneAccess(systemPreferences) {
  const status = typeof systemPreferences.getMediaAccessStatus === 'function' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted';
  if (status === 'granted') return 'granted';
  if (status !== 'not-determined' || typeof systemPreferences.askForMediaAccess !== 'function') return 'refused';
  return await systemPreferences.askForMediaAccess('microphone') ? 'granted' : 'refused';
}

/** Asks macOS for the camera the first time only. A refusal can only be changed in System Settings. */
async function ensureCameraAccess(systemPreferences) {
  const status = typeof systemPreferences.getMediaAccessStatus === 'function' ? systemPreferences.getMediaAccessStatus('camera') : 'granted';
  if (status === 'granted') return 'granted';
  if (status !== 'not-determined' || typeof systemPreferences.askForMediaAccess !== 'function') return 'refused';
  return await systemPreferences.askForMediaAccess('camera') ? 'granted' : 'refused';
}

const fs = require('node:fs/promises');
const { createOutputWindow } = require('./output-window.cjs');
const path = require('node:path');

const MESSAGE_LIMIT = 16 * 1024;
const PREVIEW_LIMIT = 512 * 1024;
const MESSAGE_TYPES = new Set(['settings', 'blackout', 'clear', 'retry', 'captureRoom']);
const PEOPLE_STATES = new Set(['loading', 'running', 'failed', 'behind']);
const SOURCE_STATES = new Set(['idle', 'starting', 'running', 'refused', 'none', 'lost', 'error']);
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

/** What the artwork window may tell the studio about its camera. */
function acceptState(state) {
  if (!plain(state) || !SOURCE_STATES.has(state.status) || !small(state)) return false;
  if ('people' in state && !(plain(state.people) && PEOPLE_STATES.has(state.people.state))) return false;
  if ('roomCaptured' in state && typeof state.roomCaptured !== 'boolean') return false;
  return true;
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
 * `closeOtherOutput()` closes Map's artwork window before Live opens its own.
 * `open(window)` loads the app page into the artwork window with the hash #live-output.
 */
function setupLive({ BrowserWindow, ipcMain, screen, systemPreferences, powerSaveBlocker, settingsFile, preload, studio, open, closeOtherOutput }) {
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
  handle('microphoneAccess', () => ensureMicrophoneAccess(systemPreferences));
  handle('displays', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => ({ id: display.id, primary: display.id === primary,
      label: `${display.label || `Display ${index + 1}`} · ${display.size.width} × ${display.size.height}${display.id === primary ? ' (this screen)' : ''}` }));
  });
  handle('openOutput', displayId => {
    const display = pickDisplay(screen.getAllDisplays(), displayId);
    if (!display) throw new Error('That display is no longer connected.');
    // Only one artwork window at a time: Live and Map never share the screen.
    if (closeOtherOutput) closeOtherOutput();
    closeOutput();
    // The scripted checks open the artwork as an ordinary window so they do not take over the screen.
    const windowed = process.env.STUDIO_LIVE_TEST_WINDOW === '1';
    const { window, release } = createOutputWindow({ BrowserWindow, powerSaveBlocker, display, preload, title: 'Form & Field Live', windowed });
    output = window;
    window.on('closed', () => {
      release();
      if (output === window) { output = null; tellStudio('studio:live:output', false); }
    });
    open(window);
  });
  handle('closeOutput', () => closeOutput());

  // The artwork page says when it is ready; only then is the studio told the output is open.
  ipcMain.on('studio:live:ready', event => { if (fromOutput(event)) tellStudio('studio:live:output', true); });
  // Escape pressed in the artwork page. The window also listens for the key itself, in case the page is not responding.
  ipcMain.on('studio:live:close', event => { if (fromOutput(event)) closeOutput(); });
  ipcMain.on('studio:live:send', (event, message) => { if (fromStudio(event) && alive(output) && acceptMessage(message)) output.webContents.send('studio:live:message', message); });
  ipcMain.on('studio:live:state', (event, state) => { if (fromOutput(event) && acceptState(state)) tellStudio('studio:live:state', state); });
  ipcMain.on('studio:live:preview', (event, bytes, fps) => { if (fromOutput(event) && acceptPreview(bytes)) tellStudio('studio:live:preview', bytes, Number.isFinite(fps) ? fps : 0); });
  screen.on('display-removed', (_event, display) => { if (alive(output) && output.displayId === display.id) closeOutput(); });
  // The studio keeps its list of displays current, so a projector can be plugged in or pulled out at any time.
  for (const change of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(change, () => tellStudio('studio:live:displays'));

  return { closeOutput, isOutput: contents => alive(output) && contents === output.webContents };
}

module.exports = { allowPermission, allowPermissionCheck, ensureCameraAccess, ensureMicrophoneAccess, loadSettings, saveSettings, acceptMessage, acceptState, acceptPreview, pickDisplay, setupLive };
