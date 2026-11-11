// Loop seam audit of the preset library, using the same renderer and the same
// seam check that runs on every export.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/seam-audit.cjs [preset-id ...]
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const { resolveMediaTools, frameName, srgbToLinear } = require('../electron/export-manager.cjs');
const { checkSeam, seamFrames } = require('../electron/seam-check.cjs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'work', 'seam-audit');
const only = process.argv.slice(2).filter(arg => !arg.startsWith('-') && !arg.endsWith('.cjs'));
const WIDTH = 640, HEIGHT = 360;
const { ffmpegPath } = resolveMediaTools();
const results = [];

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim())));
  });
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, 'cache'), { recursive: true });
  await build({ entryPoints: [path.join(__dirname, 'seam-audit.browser.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(outDir, 'bundle.js'), logLevel: 'silent' });
  await fs.writeFile(path.join(outDir, 'audit.html'), '<!doctype html><html><body><canvas id="canvas" width="640" height="360"></canvas><script type="module" src="./bundle.js"></script></body></html>');
  ipcMain.handle('audit-begin', () => ({ width: WIDTH, height: HEIGHT, only }));
  ipcMain.handle('audit-indices', (_, total) => seamFrames(total));
  ipcMain.handle('audit-frame', (_, id, index, bytes) => fs.writeFile(path.join(outDir, 'cache', frameName(index)), Buffer.from(bytes)));
  ipcMain.handle('audit-measure', async (_, id, name, kind, frameCount) => {
    const request = { width: WIDTH, height: HEIGHT, frameCount, transparent: false, background: '#100d1c' };
    const result = await checkSeam({ run: ffmpeg, directory: outDir, request, frameName, toLinear: srgbToLinear });
    results.push({ id, name, kind, ...result });
    const flag = result.status === 'seam' ? 'SEAM ' : 'ok   ';
    console.log(`${flag}${id.padEnd(28)} jump ${result.jump.ratio.toFixed(2)} (${(result.jump.seam * 255).toFixed(2)}/255)  hitch ${result.hitch.ratio.toFixed(2)} (${(result.hitch.seam * 255).toFixed(2)}/255)`);
    await fs.rm(path.join(outDir, 'cache'), { recursive: true, force: true });
    await fs.mkdir(path.join(outDir, 'cache'));
  });
  ipcMain.handle('audit-done', async (_, error) => {
    await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    const seams = results.filter(r => r.status === 'seam');
    console.log(`\n${results.length} presets checked, ${seams.length} with a visible seam.`);
    if (error) console.error(error);
    app.exit(error ? 1 : 0);
  });
  const window = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { preload: path.join(__dirname, 'seam-audit.preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  window.webContents.on('console-message', (_, level, message) => { if (level >= 2) console.error('[renderer]', message); });
  await window.loadFile(path.join(outDir, 'audit.html'));
});
