const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'work/sculpture-study/edge-final');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'work/sculpture-study/sculpture-final-snapshot.json'), 'utf8'));
  await fs.copyFile(path.join(root, 'work/sculpture-study/sculpture-final-renderer.js'), path.join(output, 'renderer.js'));
  await fs.copyFile(path.join(__dirname, 'sculpture-study.edges.mjs'), path.join(output, 'edges.mjs'));
  await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><canvas id="canvas"></canvas><script type="module" src="./edges.mjs"></script>');
  const messages = [];
  ipcMain.handle('study-config', () => ({ snapshot }));
  ipcMain.handle('study-write', (_, name, bytes) => {
    if (!/^[a-z0-9][a-z0-9_.-]*\.png$/.test(name)) throw new Error('Unexpected edge artifact.');
    return fs.writeFile(path.join(output, name), Buffer.from(bytes));
  });
  ipcMain.handle('study-note', (_, value) => console.log(JSON.stringify(value)));
  ipcMain.handle('study-done', async (_, report) => {
    report.snapshot = snapshot; report.gpuMessages = messages;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log('EDGES_COMPLETE ' + JSON.stringify(report)); setTimeout(() => app.quit(), 100);
  });
  ipcMain.handle('study-fail', async (_, error) => { await fs.writeFile(path.join(output, 'failure.txt'), error); console.error(error); app.exit(1); });
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'sculpture-study.preload.cjs'),
    sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error' || /webgl|shader/i.test(event.message)) messages.push({ level: event.level, message: event.message }); });
  await window.loadFile(path.join(output, 'index.html'));
}).catch(error => { console.error(error); app.exit(1); });
