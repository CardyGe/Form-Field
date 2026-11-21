// Benchmark harness: per-pass GPU time, cold start and repeatability for Studio compositions.
//
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/bench/bench.cjs [options]
//
//   --suite <file>     cases to run (default scripts/bench/suites/audit.json)
//   --case <name>      run only this case; repeatable
//   --label <name>     results go to work/bench/<label>/ (default: date and commit)
//   --runs <n>         run the whole suite n times in fresh renderers and report agreement (default 1)
//   --frames <n>       timed frames per case, overriding the suite (minimum 300 unless --smoke)
//   --smoke            a few frames per case, to check the harness works; numbers mean nothing
//   --software-gl      render with SwiftShader on the CPU, for machines without a usable GPU; numbers mean nothing
//
// Compare two result folders with: node scripts/bench/compare.mjs work/bench/<a> work/bench/<b>
// Running as root on Linux also needs --no-sandbox after the script path.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const options = name => args.flatMap((a, i) => a === name ? [args[i + 1]] : []);
const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

const commit = git('rev-parse', '--short', 'HEAD');
const dirty = Boolean(git('status', '--porcelain', '--', 'src'));
const label = option('--label') ?? `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${commit ?? 'nogit'}${dirty ? '-dirty' : ''}`;
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/.test(label)) throw new Error('--label: letters, digits, dot, dash and underscore only.');
const smoke = args.includes('--smoke');
const runs = Number(option('--runs') ?? 1);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1 to 10.');
const framesOverride = option('--frames') === null ? null : Number(option('--frames'));
if (framesOverride !== null && (!Number.isInteger(framesOverride) || framesOverride < 1)) throw new Error('--frames must be a whole number.');
if (framesOverride !== null && framesOverride < 300 && !smoke) throw new Error('--frames below 300 is only allowed with --smoke.');

const suitePath = path.resolve(root, option('--suite') ?? 'scripts/bench/suites/audit.json');
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
const only = options('--case');
const cases = suite.cases.filter(c => !only.length || only.includes(c.name));
if (!cases.length) throw new Error(`No cases to run${only.length ? ` named ${only.join(', ')}` : ''}.`);
for (const c of cases) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(c.name)) throw new Error(`Case name ${c.name}: lowercase letters, digits and dashes.`);
  if (!c.preset === !c.project) throw new Error(`Case ${c.name}: give either preset or project.`);
  if (!['preview', 'export'].includes(c.mode)) throw new Error(`Case ${c.name}: mode is preview or export.`);
  if (c.project) c.projectJSON = JSON.parse(fs.readFileSync(path.resolve(path.dirname(suitePath), c.project), 'utf8'));
  c.frames = smoke ? Math.min(framesOverride ?? 8, 8) : framesOverride ?? c.frames ?? suite.frames ?? 300;
  c.warmup = smoke ? 2 : c.warmup ?? suite.warmup ?? 60;
}

const work = path.join(root, 'work', 'bench');
const output = path.join(work, label);
if (fs.existsSync(path.join(output, 'results.json'))) throw new Error(`work/bench/${label} already has results. Choose another --label.`);
fs.mkdirSync(output, { recursive: true });

// A fresh profile and no shader disk cache, so cold start includes real shader compilation.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-bench-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const softwareGL = args.includes('--software-gl');
if (softwareGL) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); app.commandLine.appendSwitch('ignore-gpu-blocklist'); app.commandLine.appendSwitch('disable-gpu-watchdog'); }

const log = message => { console.log(message); fs.appendFileSync(path.join(output, 'bench.log'), `${new Date().toISOString()} ${message}\n`); };

app.whenReady().then(async () => {
  const bundle = path.join(output, 'renderer.js');
  await build({
    stdin: { contents: [
      "export {StudioRenderer} from './src/rendering/StudioRenderer';",
      "export {GpuTimer} from './src/rendering/gpu-timer';",
      "export {createProject,createLayer,applyPreset,validateProject,PRESETS} from './src/core/project';",
      "export {frameCount,phaseAtFrame} from './src/core/timeline';",
      "export {summarize,summarizeSamples} from './src/core/bench-stats';",
    ].join('\n'), resolveDir: root, sourcefile: 'bench-entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: bundle, logLevel: 'silent',
  });
  fs.copyFileSync(path.join(__dirname, 'bench.browser.mjs'), path.join(output, 'bench.browser.mjs'));
  fs.writeFileSync(path.join(output, 'bench.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'unsafe-inline\'"><style>html,body{margin:0;background:#000}canvas{width:320px;height:180px}</style></head><body><script type="module" src="./bench.browser.mjs"></script></body></html>');

  const meta = {
    label, commit, dirtySources: dirty, createdAt: new Date().toISOString(),
    suite: path.relative(root, suitePath), smoke, softwareGL, runs,
    bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'),
    machine: { platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30) },
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  };
  const gpuMessages = [];
  ipcMain.handle('bench-config', () => ({ cases: cases.map(({ projectJSON, ...c }) => ({ ...c, projectJSON })), runs }));
  ipcMain.handle('bench-log', (_, message) => log(message));
  ipcMain.handle('bench-done', (_, results) => {
    const report = { ...meta, gpu: results.gpu, timing: results.timing, gpuMessages, cases: results.cases, agreement: results.agreement };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    log(`Results: ${path.relative(root, path.join(output, 'results.json'))}`);
    const failed = gpuMessages.some(m => m.level === 'error');
    setTimeout(() => failed ? app.exit(1) : app.quit(), 100);
  });
  ipcMain.handle('bench-fail', (_, error) => {
    fs.writeFileSync(path.join(output, 'failure.txt'), error);
    console.error('BENCH_FAILED ' + error);
    app.exit(1);
  });

  // Shown, so requestAnimationFrame paces frames at the display's refresh as it does in a show.
  const window = new BrowserWindow({ width: 340, height: 200, show: true, webPreferences: {
    preload: path.join(__dirname, 'bench.preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => {
    if (event.level === 'error' || /shader|webgl|gl_/i.test(event.message)) { gpuMessages.push({ level: event.level, message: event.message }); console.error('GPU ' + event.message); }
  });
  await window.loadFile(path.join(output, 'bench.html'));
}).catch(error => {
  console.error(error);
  fs.writeFileSync(path.join(output, 'failure.txt'), error.stack || String(error));
  app.exit(1);
});

app.on('quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
