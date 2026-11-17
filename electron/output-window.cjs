'use strict';

// The artwork window, shared by Live and Map: frameless, full-display, Escape closes it,
// no navigation or new windows, and the display is kept awake while it is open.

/** A 960 × 540 window centred in the display's work area (the screen less the menu bar and Dock). */
function centred(display) {
  const area = display.workArea || display.bounds, width = 960, height = 540;
  return { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) };
}

/**
 * Creates the artwork window for a display. The caller decides the window `title` and the kind of window:
 * `framed` is an ordinary movable, resizable window, for when the chosen display is the one the controls are on,
 * so full screen would hide them; `windowed` is a small fixed window for scripted checks; otherwise the window
 * fills the display, full screen. Returns the window and `release()`, which stops the power blocker if it is running.
 */
function createOutputWindow({ BrowserWindow, powerSaveBlocker, display, preload, title, windowed, framed }) {
  const kind = framed
    ? { ...centred(display), frame: true, resizable: true, movable: true, minimizable: true, fullscreenable: false, skipTaskbar: false }
    : { ...(windowed ? { width: 960, height: 540 } : display.bounds), frame: false, resizable: false, movable: false, minimizable: false, fullscreenable: true, skipTaskbar: true };
  const window = new BrowserWindow({
    ...kind, show: false, backgroundColor: '#000000', title, autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
  });
  window.displayId = display.id;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.close(); } });
  window.webContents.on('render-process-gone', () => { if (!window.isDestroyed()) window.close(); });
  window.once('ready-to-show', () => { if (window.isDestroyed()) return; window.show(); if (windowed || framed) return; if (process.platform === 'darwin') window.setSimpleFullScreen(true); else window.setFullScreen(true); });
  // A projector gets no keyboard or mouse input, so without this macOS would dim or sleep it mid-show.
  const awake = powerSaveBlocker?.start('prevent-display-sleep');
  const release = () => { if (awake !== undefined && powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake); };
  return { window, release };
}

module.exports = { createOutputWindow };
