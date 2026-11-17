const {app, BrowserWindow} = require('electron');
const path = require('node:path');

let window;
function openTable() {
  if (window) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    title: 'Tilt Club', width: 1180, height: 720, minWidth: 640, minHeight: 400,
    backgroundColor: '#0c1020', show: false,
    webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false},
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  window.loadFile(path.join(__dirname, 'Tilt Club.html'));
}
app.whenReady().then(openTable);
app.on('activate', () => { if (app.isReady()) openTable(); });
app.on('window-all-closed', () => app.quit());
