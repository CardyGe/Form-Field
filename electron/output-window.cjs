'use strict';

// The artwork window, shared by Live and Map: frameless, full-display, Escape closes it,
// no navigation or new windows, and the display is kept awake while it is open.

/**
 * Creates the artwork window for a display. `windowed` (a small ordinary window, for scripted checks)
 * is decided by the caller, as is the window `title`. Returns the window and `release()`, which stops the power blocker if it is running.
 */
function createOutputWindow({ BrowserWindow, powerSaveBlocker, display, preload, title, windowed }) {
  const window = new BrowserWindow({
    ...(windowed ? { width: 960, height: 540 } : display.bounds), frame: false, show: false, backgroundColor: '#000000', title, resizable: false, movable: false,
    minimizable: false, fullscreenable: true, skipTaskbar: true, autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
  });
  window.displayId = display.id;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.close(); } });
  window.webContents.on('render-process-gone', () => { if (!window.isDestroyed()) window.close(); });
  window.once('ready-to-show', () => { if (window.isDestroyed()) return; window.show(); if (windowed) return; if (process.platform === 'darwin') window.setSimpleFullScreen(true); else window.setFullScreen(true); });
  // A projector gets no keyboard or mouse input, so without this macOS would dim or sleep it mid-show.
  const awake = powerSaveBlocker?.start('prevent-display-sleep');
  const release = () => { if (awake !== undefined && powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake); };
  return { window, release };
}

module.exports = { createOutputWindow };
