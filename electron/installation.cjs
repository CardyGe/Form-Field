'use strict';

/**
 * Installation mode, in the main process: its settings, a small fault log, and keeping the display awake while it runs.
 *
 * The log holds fault strings only: a line of plain text each, cut to FAULT_LIMIT characters, and never anything that looks
 * like a picture, a sound or camera data (no data or blob URLs, no long runs of encoded bytes, no binary). It never grows past
 * LOG_LIMIT: when it would, the oldest half goes.
 */

const INSTALLATION_DEFAULTS = Object.freeze({ on: false, surface: 'map', autopilot: true, everyBeats: 32, display: null });
const SURFACES = new Set(['map', 'live']);
const LOG_LIMIT = 5 * 1024 * 1024;
const FAULT_LIMIT = 300;
/** A run this long of base64 or hex characters is encoded data, not a fault. */
const ENCODED_RUN = /[A-Za-z0-9+/=_-]{160,}/;
const MEDIA = /\b(data|blob):|base64,/i;

function validateInstallation(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const beats = typeof v.everyBeats === 'number' && Number.isFinite(v.everyBeats) ? Math.max(16, Math.min(128, Math.round(v.everyBeats))) : INSTALLATION_DEFAULTS.everyBeats;
  return {
    on: v.on === true,
    surface: SURFACES.has(v.surface) ? v.surface : INSTALLATION_DEFAULTS.surface,
    autopilot: typeof v.autopilot === 'boolean' ? v.autopilot : INSTALLATION_DEFAULTS.autopilot,
    everyBeats: beats,
    display: Number.isSafeInteger(v.display) ? v.display : null,
  };
}

/** One fault as a line of text, or null when it is not a plain fault string. */
function faultText(value) {
  if (typeof value !== 'string') return null;
  if (MEDIA.test(value) || ENCODED_RUN.test(value)) return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, FAULT_LIMIT) : null;
}

/** The fault log. Appends run one at a time. */
function createFaultLog({ fs, file, limit = LOG_LIMIT }) {
  let size = null, queue = Promise.resolve();
  const measure = async () => { try { return (await fs.stat(file)).size; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; } };
  const trim = async () => {
    let text = '';
    try { text = String(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Keep the newest half, from the start of a line.
    let kept = Buffer.from(text).subarray(-Math.floor(limit / 2)).toString('utf8');
    const cut = kept.indexOf('\n');
    kept = cut >= 0 ? kept.slice(cut + 1) : '';
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, kept);
    await fs.rename(temporary, file);
    size = Buffer.byteLength(kept);
  };
  return {
    /** Adds one fault. Resolves false, writing nothing, if it is not a plain fault string. */
    append(value, when = new Date()) {
      const text = faultText(value);
      if (text === null) return Promise.resolve(false);
      const line = `${when.toISOString()} ${text}\n`, bytes = Buffer.byteLength(line);
      const run = queue.then(async () => {
        if (size === null) size = await measure();
        if (size + bytes > limit) await trim();
        await fs.appendFile(file, line);
        size += bytes;
        return true;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

/**
 * Registers installation mode. `studio()` returns the studio window, the only one that may use it. Returns `ready` (the saved
 * settings have been read), `settings()`, `running()` and `stop()`, which lets the display sleep again (on quit).
 */
function setupInstallation({ ipcMain, powerSaveBlocker, settingsFile, logFile, studio, fs }) {
  let settings = { ...INSTALLATION_DEFAULTS }, awake = null;
  const log = createFaultLog({ fs, file: logFile });
  const hold = () => {
    if (settings.on && awake === null) awake = powerSaveBlocker.start('prevent-display-sleep');
    if (!settings.on && awake !== null) { if (powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake); awake = null; }
  };
  const ready = (async () => {
    try { settings = validateInstallation(JSON.parse(String(await fs.readFile(settingsFile, 'utf8')))); }
    catch { settings = { ...INSTALLATION_DEFAULTS }; }
    hold();
  })();
  const trusted = event => {
    const window = studio();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('This window cannot control the installation.');
  };
  const handle = (name, operation) => ipcMain.handle(`studio:installation:${name}`, async (event, ...args) => { trusted(event); await ready; return operation(...args); });
  const state = () => ({ settings: { ...settings }, running: settings.on });
  handle('get', () => state());
  handle('set', async value => {
    const next = validateInstallation(value);
    const temporary = `${settingsFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next));
    await fs.rename(temporary, settingsFile);
    settings = next;
    hold();
    return state();
  });
  handle('log', text => log.append(text));
  return {
    ready,
    settings: () => ({ ...settings }),
    running: () => settings.on,
    stop: () => { if (awake !== null && powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake); awake = null; },
  };
}

module.exports = { INSTALLATION_DEFAULTS, LOG_LIMIT, FAULT_LIMIT, validateInstallation, faultText, createFaultLog, setupInstallation };
