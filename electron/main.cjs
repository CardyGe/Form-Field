'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, screen, systemPreferences, powerSaveBlocker, protocol } = require('electron');
const { createVideoFiles } = require('./video-files.cjs');
// Stage 6: Map's video files reach the page only through this scheme, which answers only files Greg chose.
protocol.registerSchemesAsPrivileged([{ scheme: 'formfield-video', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
let videoFiles = createVideoFiles({ fs: require('node:fs/promises') });
const { version: applicationVersion } = require('../package.json');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const live = require('./live.cjs');
const map = require('./map.cjs');
const installation = require('./installation.cjs');
const { ExportManager, atomicWrite, asBuffer, validateProject, resolveMediaTools } = require('./export-manager.cjs');

app.setName('Form & Field');
const explicitUserData = app.commandLine.getSwitchValue('user-data-dir');
if (explicitUserData) {
  if (!path.isAbsolute(explicitUserData)) throw new Error('--user-data-dir must be an absolute path.');
  mkdirSync(explicitUserData, { recursive: true });
  app.setPath('userData', explicitUserData);
}
let window;
let manager;
let liveControl;
let mapControl;
let installationControl;
let quitting = false;
let quitRequested = false;
let closingPromise = null;
let closeWaiter = null;
const approvedClosures = new WeakSet();
let autosaveQueue = Promise.resolve();
let autosaveBackedUp = false;
let documentPath = null;
const defaultExportDir = () => path.join(app.getPath('documents'), 'Form & Field Exports');
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.formfield');
const safeName = value => String(value || 'Untitled').replace(/[\x00-\x1f/\\:*?"<>|]/g, '-').slice(0, 100);

async function preserveExistingAutosave() {
  if (autosaveBackedUp) return;
  let bytes;
  try { bytes = await fs.readFile(autosavePath()); }
  catch (error) { if (error.code === 'ENOENT') { autosaveBackedUp = true; return; } throw error; }
  const directory = path.join(app.getPath('userData'), 'recovery');
  const name = `autosave-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.formfield`;
  // Preserve raw bytes, including a malformed-but-recoverable old document.
  // If this write fails, the caller must not replace the original autosave.
  await atomicWrite(path.join(directory, name), bytes);
  autosaveBackedUp = true;
  const backups = (await fs.readdir(directory)).filter(file => /^autosave-[0-9TZ.-]+-[a-f0-9]{8}\.formfield$/.test(file)).sort();
  for (const previous of backups.slice(0, Math.max(0, backups.length - 10))) await fs.unlink(path.join(directory, previous)).catch(() => {});
}

function flushRenderer(target) {
  if (!target || target.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const token = crypto.randomUUID();
    const finish = (error) => {
      clearTimeout(timeout);
      if (closeWaiter?.token === token) closeWaiter = null;
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('The editor did not respond to the save request within 8 seconds.')), 8000);
    closeWaiter = { token, sender: target.webContents, finish };
    target.webContents.send('studio:before-close', token);
  });
}

function requestClose() {
  if (closingPromise) return closingPromise;
  const target = window;
  closingPromise = (async () => {
    let approved = false;
    try {
      await flushRenderer(target);
      await autosaveQueue;
      await manager?.interruptAll();
      approved = true;
    } catch (error) {
      console.error(`Close save failed: ${error.message}`);
      const options = { type: 'warning', title: 'Keep your latest changes', message: 'Your latest changes could not be saved.', detail: `${error.message}\n\nKeep editing to retry or save a project manually. Closing without saving can discard your latest edits. Existing recovery files are retained.`, buttons: ['Keep editing', 'Close without saving'], defaultId: 0, cancelId: 0, noLink: true };
      const result = target && !target.isDestroyed() ? await dialog.showMessageBox(target, options) : await dialog.showMessageBox(options);
      approved = result.response === 1;
    }
    if (!approved) { quitRequested = false; return; }
    if (quitRequested) { quitting = true; app.quit(); }
    else if (target && !target.isDestroyed()) {
      approvedClosures.add(target); target.close();
      if (quitRequested) { quitting = true; app.quit(); }
    }
  })().catch(error => { quitRequested = false; console.error(error); }).finally(() => { closingPromise = null; });
  return closingPromise;
}

function rendererTrusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('This window cannot access the local studio.');
}

function handle(name, operation) {
  ipcMain.handle(`studio:${name}`, async (event, ...args) => { rendererTrusted(event); return operation(...args); });
}

async function rendererFingerprint() {
  const digest = crypto.createHash('sha256');
  const base = path.join(__dirname, '..');
  async function collect(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(filename);
      else if (!entry.name.endsWith('.test.cjs') && !entry.name.endsWith('.map')) {
        digest.update(path.relative(base, filename)); digest.update(await fs.readFile(filename));
      }
    }
  }
  digest.update(await fs.readFile(path.join(base, 'package.json')));
  await collect(path.join(base, app.isPackaged ? 'dist' : process.env.STUDIO_DEV_URL ? 'src' : 'dist'));
  await collect(__dirname);
  return digest.digest('hex');
}

function validatePNG(data) {
  const bytes = asBuffer(data);
  if (bytes.length < 45 || bytes.length > 512 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('The still is not valid PNG data.');
  let offset = 8, header = false, end = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error('The PNG is incomplete.');
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (!header) {
      if (kind !== 'IHDR' || length !== 13 || bytes.readUInt32BE(offset + 8) < 1 || bytes.readUInt32BE(offset + 12) < 1) throw new Error('The PNG header is invalid.');
      header = true;
    }
    offset += length + 12;
    if (kind === 'IEND') { end = true; break; }
  }
  if (!end || offset !== bytes.length) throw new Error('The PNG is incomplete.');
  return bytes;
}

function setupIPC() {
  handle('getStatus', async () => ({ version: applicationVersion, platform: process.platform, ...await manager.capabilities(), defaultExportDir: defaultExportDir() }));
  handle('loadAutosave', async () => {
    try { return validateProject(JSON.parse(await fs.readFile(autosavePath(), 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`Cannot restore the autosave: ${error.message}`); }
  });
  handle('saveAutosave', project => {
    const saved = validateProject(project);
    const operation = autosaveQueue.then(async () => { await preserveExistingAutosave(); await atomicWrite(autosavePath(), JSON.stringify(saved)); });
    autosaveQueue = operation.catch(() => {});
    return operation;
  });
  // The file this window's project was last opened from or saved to. Only a
  // path the user picked in a native dialog is ever stored here, so the
  // renderer can ask to save in place without being able to name a path.
  handle('saveProject', async (project, saveAs) => {
    const saved = validateProject(project);
    if (saveAs !== true && documentPath) {
      await atomicWrite(documentPath, JSON.stringify(saved, null, 2));
      return { canceled: false, path: documentPath };
    }
    const result = await dialog.showSaveDialog(window, { title: 'Save Form & Field project', defaultPath: documentPath || path.join(app.getPath('documents'), `${safeName(saved.name)}.formfield`), filters: [{ name: 'Form & Field project', extensions: ['formfield'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await atomicWrite(result.filePath, JSON.stringify(saved, null, 2));
    documentPath = result.filePath;
    return { canceled: false, path: result.filePath };
  });
  handle('forgetProjectPath', async () => { documentPath = null; });
  handle('openProject', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open Form & Field project', properties: ['openFile'], filters: [{ name: 'Form & Field project', extensions: ['formfield', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filename = result.filePaths[0];
    const stat = await fs.stat(filename);
    if (stat.size > 256 * 1024 * 1024) throw new Error('Project exceeds the local document size limit.');
    const project = validateProject(JSON.parse(await fs.readFile(filename, 'utf8')));
    documentPath = filename;
    return { canceled: false, project, path: filename };
  });
  handle('chooseExportDirectory', async () => {
    await fs.mkdir(defaultExportDir(), { recursive: true });
    const result = await dialog.showOpenDialog(window, { title: 'Choose export folder', defaultPath: defaultExportDir(), properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('saveStill', async (data, suggestedName) => {
    const bytes = validatePNG(data);
    await fs.mkdir(defaultExportDir(), { recursive: true });
    const filename = safeName(suggestedName).replace(/\.png$/i, '') + '.png';
    const result = await dialog.showSaveDialog(window, { title: 'Save PNG still', defaultPath: path.join(defaultExportDir(), filename), filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await atomicWrite(result.filePath, bytes);
    return { canceled: false, path: result.filePath };
  });
  for (const name of ['beginExport', 'writeFrame', 'finishExport', 'cancelExport', 'listJobs', 'resumeExport']) handle(name, (...args) => manager[name](...args));
  handle('revealPath', async filename => {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('Expected a saved local path.');
    await fs.access(filename);
    shell.showItemInFolder(filename);
  });
  ipcMain.on('studio:close-ready', (event, token, result) => {
    try { rendererTrusted(event); } catch { return; }
    if (!closeWaiter || token !== closeWaiter.token || event.sender !== closeWaiter.sender) return;
    closeWaiter.finish(result?.ok === true ? null : new Error(typeof result?.error === 'string' ? result.error : 'The editor could not save its latest changes.'));
  });
}

function createWindow() {
  window = new BrowserWindow({
    title: 'Form & Field', width: 1600, height: 1000, minWidth: 960, minHeight: 640,
    backgroundColor: '#101110', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
  });
  const devURL = process.env.STUDIO_DEV_URL;
  if (devURL && (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(devURL))) throw new Error('STUDIO_DEV_URL must be a local development server.');
  const session = window.webContents.session;
  // Everything is refused except camera video for this app's own windows: the studio, Live's output, and Map's output (Live in Map).
  const ours = contents => live.isCameraWindow(contents, { studio: () => window, isLiveOutput: c => !!liveControl?.isOutput(c), isMapOutput: c => !!mapControl?.isOutput(c) });
  // The studio window may also listen to sound and MIDI for reactivity; output windows never do.
  const studioWindow = contents => !!contents && !!window && !window.isDestroyed() && contents === window.webContents;
  if (!session.protocol.isProtocolHandled('formfield-video')) session.protocol.handle('formfield-video', request => videoFiles.handle(request));
  session.setPermissionRequestHandler((contents, permission, callback, details) => callback(live.allowPermission(permission, details, ours(contents), studioWindow(contents))));
  session.setPermissionCheckHandler((contents, permission, _origin, details) => live.allowPermissionCheck(permission, details, ours(contents), studioWindow(contents)));
  const csp = ["default-src 'self'", `script-src 'self' 'wasm-unsafe-eval'${devURL ? " 'unsafe-inline'" : ''}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' blob: formfield-video:", "font-src 'self' data:", `connect-src 'self' formfield-video:${devURL ? ` ${devURL} ${devURL.replace(/^http/, 'ws')}` : ''}`, "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-src 'none'"].join('; ');
  session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { closeWaiter?.finish(new Error('The editor stopped before it could save its latest changes.')); manager.interruptAll().catch(error => console.error(error)); });
  window.webContents.on('did-fail-load', (_event, code, description) => { if (code !== -3) console.error(`Studio could not load: ${description}`); });
  window.once('ready-to-show', () => window?.show());
  window.on('close', event => { if (!quitting && !approvedClosures.has(window)) { event.preventDefault(); void requestClose(); } });
  window.on('closed', () => { window = undefined; liveControl?.closeOutput(); mapControl?.closeOutput(); manager.interruptAll().catch(error => console.error(error)); });
  if (devURL) window.loadURL(devURL);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  // Videos Greg granted are kept in the app's own data, so a restored autosave can play them again (and nothing else).
  videoFiles = createVideoFiles({ fs: require('node:fs/promises'), recordFile: path.join(app.getPath('userData'), 'granted-videos.json') });
  const tools = resolveMediaTools({ allowSystemFallback: !app.isPackaged && process.env.STUDIO_ALLOW_SYSTEM_FFMPEG === '1' });
  manager = new ExportManager({ ...tools, rendererFingerprint: await rendererFingerprint(), jobsDirectory: path.join(app.getPath('userData'), 'export-jobs'), defaultExportDir: defaultExportDir(), onProgress: progress => { if (window && !window.isDestroyed()) window.webContents.send('studio:export', progress); } });
  await manager.initializing;
  setupIPC();
  const pageOpener = hash => target => { const devURL = process.env.STUDIO_DEV_URL; if (devURL) target.loadURL(`${devURL.replace(/\/$/, '')}/#${hash}`); else target.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash }); };
  liveControl = live.setupLive({ allowChecks: !app.isPackaged, closeOtherOutput: () => mapControl?.closeOutput(), BrowserWindow, ipcMain, screen, systemPreferences, powerSaveBlocker, settingsFile: path.join(app.getPath('userData'), 'live-settings.json'),
    preload: path.join(__dirname, 'preload.cjs'), studio: () => window,
    open: pageOpener('live-output') });
  // Installation mode: on launch with it on, the display is kept awake at once; the studio window then restores the last show.
  installationControl = installation.setupInstallation({ ipcMain, powerSaveBlocker, fs, studio: () => window,
    settingsFile: path.join(app.getPath('userData'), 'installation.json'), logFile: path.join(app.getPath('userData'), 'installation-faults.log') });
  mapControl = map.setupMap({ allowChecks: !app.isPackaged, videoFiles, BrowserWindow, ipcMain, screen, powerSaveBlocker, dialog, autosavePath: path.join(app.getPath('userData'), 'map-autosave.formshow'),
    preload: path.join(__dirname, 'preload.cjs'), studio: () => window, open: pageOpener('map-output'), closeLiveOutput: () => liveControl?.closeOutput() });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Form & Field', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { console.error(error); dialog.showErrorBox('Form & Field could not start', error.message); app.quit(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || process.env.STUDIO_DEV_URL) { quitRequested = true; if (!closingPromise) void requestClose(); }
});
app.on('will-quit', () => installationControl?.stop());
app.on('before-quit', event => {
  if (quitting || !manager) return;
  event.preventDefault(); quitRequested = true; void requestClose();
});
