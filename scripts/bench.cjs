// Renderer benchmark harness.
//   npm run bench -- --case <id|a,b|all> --size 1080p|4k --frames 300 --out <file.json>
// Runs in a hidden Electron window with a throwaway profile; nothing leaves this machine.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  if (at + 1 >= args.length || args[at + 1].startsWith('--')) throw new Error(`${name} needs a value.`);
  return args[at + 1];
};
const caseSelector = option('--case', 'all');
const size = option('--size', '1080p');
const frames = Number(option('--frames', '300'));
const out = path.resolve(process.cwd(), option('--out', path.join(root, 'work', 'bench', 'latest.json')));
const SIZES = { '1080p': [1920, 1080], '4k': [3840, 2160] };
if (!SIZES[size]) throw new Error('--size must be 1080p or 4k.');
if (!Number.isInteger(frames) || frames < 10 || frames > 100000) throw new Error('--frames must be a whole number from 10 up.');

// A temporary profile keeps the run isolated and leaves nothing behind.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
const cleanup = () => fs.rmSync(scratch, { recursive: true, force: true });
const finish = code => { cleanup(); app.exit(code); };

app.whenReady().then(async () => {
  await build({ stdin: { contents: [
    "export {StudioRenderer} from './src/rendering/StudioRenderer';",
    "export {GpuTimer} from './src/rendering/gpu-timer';",
    "export {summarise} from './src/core/bench-stats';",
    "export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';",
    "export {SYMMETRY_GROUPS,foldPoint,spiralTau,parityAverage} from './src/core/kaleidoscope-math';",
    "export {kaleidoscopeGLSL,kaleidoscopeUniforms} from './src/rendering/kaleidoscope-glsl';",
    "export {KaleidoscopeRenderer} from './src/rendering/KaleidoscopeRenderer';",
    "export * as THREE from 'three';",
  ].join('\n'), resolveDir: root, sourcefile: 'bench-entry.ts', loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(scratch, 'renderer.js'), logLevel: 'silent' });
  fs.copyFileSync(path.join(__dirname, 'bench.browser.mjs'), path.join(scratch, 'bench.browser.mjs'));
  fs.copyFileSync(path.join(__dirname, 'bench.preload.cjs'), path.join(scratch, 'bench.preload.cjs'));
  fs.writeFileSync(path.join(scratch, 'bench.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"></head><body><canvas id="canvas" width="1280" height="720"></canvas><script type="module" src="./bench.browser.mjs"></script></body></html>');

  const machine = { model: os.cpus()[0]?.model, cpus: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30),
    platform: os.platform(), release: os.release(), arch: os.arch() };
  ipcMain.handle('bench-config', () => ({ caseSelector, size, width: SIZES[size][0], height: SIZES[size][1], frames }));
  ipcMain.handle('bench-note', (_, text) => { console.log(text); });
  ipcMain.handle('bench-done', (_, report) => {
    const result = { date: new Date().toISOString(), machine, electron: process.versions.electron, chrome: process.versions.chrome, ...report };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log('BENCH_COMPLETE ' + out);
    setTimeout(() => finish(0), 100);
  });
  ipcMain.handle('bench-fail', (_, error) => { console.error('BENCH_FAILED ' + error); finish(1); });

  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(scratch, 'bench.preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('PAGE ' + event.message); });
  await window.loadFile(path.join(scratch, 'bench.html'));
}).catch(error => { console.error(error); finish(1); });
