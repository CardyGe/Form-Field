// Isolated, immutable renderer snapshots for surface art review and GPU QA.
// env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/surface-study.cjs --label before
// Use a fresh label after an art change. --quick captures presets only; --reuse repeats a snapshot.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');
const mainSha256 = crypto.createHash('sha256').update(require('node:fs').readFileSync(__filename)).digest('hex');
const root = path.resolve(__dirname, '..');
const study = path.join(root, 'work', 'surface-study');
const args = process.argv.slice(2);
const labelIndex = args.indexOf('--label');
const label = labelIndex < 0 ? 'before' : args[labelIndex + 1];
const compareIndex = args.indexOf('--compare');
const compare = compareIndex < 0 ? 'before' : args[compareIndex + 1];
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label || '')) throw new Error('A short lowercase --label is required.');
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(compare || '')) throw new Error('A short lowercase --compare is required.');
const quick = args.includes('--quick');
const grid = args.includes('--grid');
const styleIndex = args.indexOf('--style');
const gridStyle = styleIndex < 0 ? null : Number(args[styleIndex + 1]);
if (gridStyle !== null && (!Number.isInteger(gridStyle) || gridStyle < 0 || gridStyle > 3)) throw new Error('--style must be 0, 1, 2 or 3.');
const presetIndex = args.indexOf('--preset');
const gridPreset = presetIndex < 0 ? 'acid-tide' : args[presetIndex + 1];
if (!['acid-tide', 'orchid-rings', 'solar-melt', 'deep-bloom', 'mineral-silk'].includes(gridPreset)) throw new Error('Unknown --preset for study grid.');
const started = Date.now();
const output = path.join(study, label);
const sourceFiles = ['src/rendering/StudioRenderer.ts', 'src/rendering/shaders.ts', 'src/rendering/png.ts', 'src/core/project.ts', 'src/core/timeline.ts'];
let window;
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  const bundle = path.join(study, label + '-renderer.js');
  let exists = true;
  try { await fs.access(bundle); } catch { exists = false; }
  if (!exists) {
    const sources = {};
    for (const file of sourceFiles) sources[file] = await fs.readFile(path.join(root, file), 'utf8');
    await fs.writeFile(path.join(study, label + '-sources.json'), JSON.stringify(sources, null, 2));
    await build({ stdin: { contents: [
      "export {StudioRenderer} from './src/rendering/StudioRenderer';",
      "export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';",
      "export {phaseAtFrame} from './src/core/timeline';",
      "export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';",
      "export {FloatType} from 'three';",
    ].join('\n'), resolveDir: root, sourcefile: 'surface-snapshot.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: bundle, logLevel: 'silent',
    plugins: [{ name: 'captured-studio-sources', setup(builder) {
      builder.onLoad({ filter: /\.(ts|tsx)$/ }, args => {
        const captured = sources[path.relative(root, args.path).split(path.sep).join('/')];
        if (captured !== undefined) return { contents: captured, loader: 'ts', resolveDir: path.dirname(args.path) };
        return undefined;
      });
    } }] });
    await fs.writeFile(path.join(study, label + '-snapshot.json'), JSON.stringify({
      frozenAt: new Date().toISOString(), sourceFiles,
      bundleSha256: crypto.createHash('sha256').update(await fs.readFile(bundle)).digest('hex'),
    }, null, 2));
  } else if (label !== 'before' && !args.includes('--reuse')) {
    throw new Error(`Snapshot ${label} already exists. Use a new --label or --reuse; snapshots are immutable.`);
  }
  const snapshot = JSON.parse(await fs.readFile(path.join(study, label + '-snapshot.json'), 'utf8'));
  const actualBundleHash = crypto.createHash('sha256').update(await fs.readFile(bundle)).digest('hex');
  if (actualBundleHash !== snapshot.bundleSha256) throw new Error('Frozen renderer bundle hash differs from its snapshot record.');
  await fs.copyFile(path.join(__dirname, 'surface-study.browser.mjs'), path.join(study, label + '-browser.mjs'));
  await fs.copyFile(path.join(__dirname, 'surface-study.preload.cjs'), path.join(study, label + '-preload.cjs'));
  const qaRunner = { mainSha256,
    browserSha256: crypto.createHash('sha256').update(await fs.readFile(path.join(study, label + '-browser.mjs'))).digest('hex'),
    preloadSha256: crypto.createHash('sha256').update(await fs.readFile(path.join(study, label + '-preload.cjs'))).digest('hex') };
  await fs.writeFile(path.join(study, label + '.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"></head><body><canvas id="canvas" width="1280" height="720"></canvas><script type="module" src="./' + label + '-browser.mjs"></script></body></html>');
  ipcMain.handle('study-config', () => ({ label, compare, quick, grid, gridPreset, gridStyle, snapshot, qaRunner }));
  ipcMain.handle('study-baseline', async () => {
    if (compare === label) return null;
    try {
      return await Promise.all(['acid-tide', 'orchid-rings', 'solar-melt', 'deep-bloom', 'mineral-silk'].map(async id => ({
        id, bytes: await fs.readFile(path.join(study, compare, id + '-p0.png')),
      })));
    } catch { return null; }
  });
  ipcMain.handle('study-write', async (_, name, bytes) => {
    if (!/^[a-z0-9][a-z0-9_.-]*\.(png|exr|json)$/.test(name)) throw new Error('Unexpected study filename.');
    await fs.writeFile(path.join(output, name), Buffer.from(bytes));
  });
  ipcMain.handle('study-note', async (_, value) => {
    const line = new Date().toISOString() + ' ' + JSON.stringify(value);
    console.log(line); await fs.appendFile(path.join(output, 'study.log'), line + '\n');
  });
  ipcMain.handle('study-done', async (_, report) => {
    report.wallSeconds = (Date.now() - started) / 1000;
    report.gpuMessages = gpuMessages;
    report.qaRunner = qaRunner;
    const gpuFailure = gpuMessages.some(entry => entry.level === 'error' || (/shader|webgl/i.test(entry.message) && /error|failed|invalid/i.test(entry.message)));
    report.status = gpuFailure ? 'failed' : quick ? 'captured' : 'passed';
    report.validationMode = quick ? 'visual-only' : 'full';
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log('STUDY_COMPLETE ' + JSON.stringify(report));
    setTimeout(() => gpuFailure ? app.exit(1) : app.quit(), 100);
  });
  ipcMain.handle('study-fail', async (_, error) => {
    await fs.writeFile(path.join(output, 'failure.txt'), error);
    console.error('STUDY_FAILED ' + error); app.exit(1);
  });
  const gpuMessages = [];
  window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(study, label + '-preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => {
    if (event.level === 'error' || /shader|webgl/i.test(event.message)) {
      gpuMessages.push({ level: event.level, message: event.message });
      console.error('GPU ' + event.message);
    }
  });
  await window.loadFile(path.join(study, label + '.html'));
}).catch(async error => {
  console.error(error); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'failure.txt'), error.stack || String(error)); app.exit(1);
});
