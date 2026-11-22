// Renderer benchmark harness.
//   npm run bench -- --case <id|a,b|all> --size 1080p|4k --frames 300 --out <file.json> [--images <dir>]
//   npm run bench -- --proof kaleidoscope [--allow-unproven] [--gates <id,id>] [--out <file.json>]
// The proof exits 1 on any FAIL and 2 on any NOT PROVEN gate; --allow-unproven lets only the latter exit 0.
// Runs in a hidden Electron window with a throwaway profile; nothing leaves this machine.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
const proof = option('--proof', null);
if (proof !== null && proof !== 'kaleidoscope') throw new Error('--proof must be kaleidoscope.');
const allowUnproven = args.includes('--allow-unproven');
if (allowUnproven && proof === null) throw new Error('--allow-unproven only applies to --proof.');
// For diagnosis only: skipped gates count as missing, so a partial run can never exit 0.
const onlyGates = option('--gates', null)?.split(',') ?? null;
const PROOF_GATES = ['existing-checks', 'fold-quality', 'loop-closure', 'centre', 'finite-output', '4k-budget', 'frame-stability', 'repeatability'];
const out = path.resolve(process.cwd(), option('--out', path.join(root, 'work', 'bench', proof ? 'kaleidoscope-proof.json' : 'latest.json')));
const images = option('--images', null);
const imageDir = images === null ? null : path.resolve(process.cwd(), images);
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

/** Never passes by default: a missing gate or an unknown result is a failure. */
function proofExit(report) {
  const gates = Array.isArray(report.gates) ? report.gates : [];
  const results = PROOF_GATES.map(id => ({ id, gate: gates.find(item => item.id === id) }));
  for (const { id, gate } of results) {
    const shown = gate ? `${gate.value === null ? 'no value' : typeof gate.value === 'number' ? gate.value.toFixed(3) : gate.value} ${gate.unit}` : 'missing';
    console.log(`GATE ${(gate?.status ?? 'FAIL').replace('_', ' ').padEnd(10)} ${id}: ${shown}`);
  }
  const statuses = results.map(({ gate }) => gate?.status);
  if (statuses.some(status => !['PASS', 'FAIL', 'NOT_PROVEN'].includes(status)) || statuses.includes('FAIL')) { console.log('PROOF FAILED'); return 1; }
  if (statuses.includes('NOT_PROVEN')) {
    console.log(allowUnproven ? 'PROOF NOT PROVEN (allowed by --allow-unproven)' : 'PROOF NOT PROVEN');
    return allowUnproven ? 0 : 2;
  }
  console.log('PROOF PASSED');
  return 0;
}

app.whenReady().then(async () => {
  await build({ stdin: { contents: [
    "export {StudioRenderer} from './src/rendering/StudioRenderer';",
    "export {GpuTimer} from './src/rendering/gpu-timer';",
    "export {summarise,agree} from './src/core/bench-stats';",
    "export {LiveRenderer} from './src/live/LiveRenderer';",
    "export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';",
    "export {SYMMETRY_GROUPS,foldPoint,spiralTau,parityAverage} from './src/core/kaleidoscope-math';",
    "export {kaleidoscopeGLSL,kaleidoscopeFragment,kaleidoscopeUniforms} from './src/rendering/kaleidoscope-glsl';",
    "export {KaleidoscopeRenderer} from './src/rendering/KaleidoscopeRenderer';",
    "export * as THREE from 'three';",
  ].join('\n'), resolveDir: root, sourcefile: 'bench-entry.ts', loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(scratch, 'renderer.js'), logLevel: 'silent' });
  fs.copyFileSync(path.join(__dirname, 'bench.browser.mjs'), path.join(scratch, 'bench.browser.mjs'));
  fs.copyFileSync(path.join(__dirname, 'kaleidoscope-proof.browser.mjs'), path.join(scratch, 'kaleidoscope-proof.browser.mjs'));
  fs.copyFileSync(path.join(__dirname, 'bench.preload.cjs'), path.join(scratch, 'bench.preload.cjs'));
  fs.writeFileSync(path.join(scratch, 'bench.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"></head><body><canvas id="canvas" width="1280" height="720"></canvas><script type="module" src="./bench.browser.mjs"></script></body></html>');

  const machine = { model: os.cpus()[0]?.model, cpus: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30),
    platform: os.platform(), release: os.release(), arch: os.arch() };
  ipcMain.handle('bench-config', () => ({ caseSelector, size, width: SIZES[size][0], height: SIZES[size][1], frames, images: imageDir !== null, proof, onlyGates }));
  // Read-only: the load average and any other process's GPU helper. Nothing here touches them.
  ipcMain.handle('bench-load', () => {
    const own = new Set(app.getAppMetrics().map(metric => metric.pid));
    const competingGpu = execFileSync('ps', ['-axo', 'pid=,pcpu=,comm='], { encoding: 'utf8' }).split('\n').flatMap(line => {
      const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(.*)$/);
      if (!match || own.has(Number(match[1])) || !/Helper \(GPU\)/.test(match[3])) return [];
      return [{ pid: Number(match[1]), cpu: Number(match[2]), command: path.basename(match[3]) }];
    });
    return { at: new Date().toISOString(), load: os.loadavg(), competingGpu };
  });
  ipcMain.handle('bench-note', (_, text) => { console.log(text); });
  ipcMain.handle('bench-image', (_, name, base64) => {
    if (!imageDir) return;
    if (!/^[\w-]+$/.test(name)) throw new Error(`Bad image name ${name}.`);
    fs.mkdirSync(imageDir, { recursive: true });
    fs.writeFileSync(path.join(imageDir, `${name}.png`), Buffer.from(base64, 'base64'));
  });
  ipcMain.handle('bench-done', (_, report) => {
    const result = { date: new Date().toISOString(), machine, electron: process.versions.electron, chrome: process.versions.chrome, ...report };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log('BENCH_COMPLETE ' + out);
    setTimeout(() => finish(proof ? proofExit(report) : 0), 100);
  });
  ipcMain.handle('bench-fail', (_, error) => { console.error('BENCH_FAILED ' + error); finish(1); });

  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(scratch, 'bench.preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('PAGE ' + event.message); });
  await window.loadFile(path.join(scratch, 'bench.html'));
}).catch(error => { console.error(error); finish(1); });
