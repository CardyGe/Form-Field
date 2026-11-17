// Map stage 0 spike: throwaway measurement harness. Not part of the app.
// Usage: npx electron scripts/map-spike/main.cjs --mode separate --sources 8 --seconds 20 --label s8
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..', '..');
const work = path.join(root, 'work', 'map-spike');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const config = {
  mode: arg('--mode', 'separate'),          // separate | shared (cost floor only) | probe (context cap)
  sources: Number(arg('--sources', 8)),
  instruments: Number(arg('--instruments', 4)),
  kinds: arg('--kinds', '') ? arg('--kinds', '').split(',') : null,  // optional explicit instrument kinds
  sourceWidth: Number(arg('--source-width', 640)),
  sourceHeight: Number(arg('--source-height', 360)),
  stageWidth: 1920, stageHeight: 1080,
  seconds: Number(arg('--seconds', 20)),
  warmup: Number(arg('--warmup', 3)),
  label: arg('--label', 'run'),
};

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.whenReady().then(async () => {
  fs.mkdirSync(path.join(work, 'results'), { recursive: true });
  await build({
    entryPoints: [path.join(__dirname, 'page.mjs')], bundle: true, format: 'iife', platform: 'browser',
    target: 'es2022', outfile: path.join(work, 'page.js'), logLevel: 'warning',
  });
  fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(work, 'index.html'));
  ipcMain.handle('spike-config', () => config);
  ipcMain.handle('spike-done', (_event, report) => {
    const file = path.join(work, 'results', config.label + '.json');
    fs.writeFileSync(file, JSON.stringify({ config, ...report }, null, 2));
    console.log(JSON.stringify({ file, ...report.summary }, null, 2));
    app.quit();
  });
  ipcMain.handle('spike-fail', (_event, message) => { console.error('SPIKE FAILED:', message); app.exit(1); });
  const win = new BrowserWindow({
    width: 1100, height: 700, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  await win.loadFile(path.join(work, 'index.html'));
});
