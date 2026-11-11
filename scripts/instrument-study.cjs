// Immutable, isolated GPU study for every instrument. --quick captures the art;
// --reuse reruns its frozen renderer and browser runner, including full validation.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const syncFS = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const study = path.join(root, 'work', 'instrument-study');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const label = option('--label', 'art-1');
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label || '')) throw new Error('A short lowercase --label is required.');
const quick = args.includes('--quick');
const quality = args.includes('--quality');
const output = path.join(study, label);
const inheritedPath = option('--source', null);
const inheritedSources = inheritedPath ? JSON.parse(syncFS.readFileSync(path.resolve(root, inheritedPath), 'utf8')) : null;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function renderingFiles(directory) {
  return syncFS.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = directory + '/' + entry.name;
    return entry.isDirectory() ? renderingFiles(file) : /\.ts$/.test(file) ? [file] : [];
  });
}
const sourceFiles = inheritedSources ? Object.keys(inheritedSources) : [...renderingFiles('src/rendering'), 'src/core/project.ts', 'src/core/timeline.ts', 'src/shared/types.ts'];
const started = Date.now();
const profile = path.join(study, 'profiles', label);
syncFS.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  const bundle = path.join(study, label + '-renderer.js');
  let exists = true; try { await fs.access(bundle); } catch { exists = false; }
  if (exists && !args.includes('--reuse')) throw new Error('Snapshot exists; use a new label or --reuse.');
  if (!exists) {
    const sources = {};
    for (const file of sourceFiles) sources[file] = inheritedSources ? inheritedSources[file] : await fs.readFile(path.join(root, file), 'utf8');
    await fs.writeFile(path.join(study, label + '-sources.json'), JSON.stringify(sources, null, 2));
    await build({ stdin: { contents: [
      "export {StudioRenderer} from './src/rendering/StudioRenderer';",
      "export {createProject,createLayer,applyPreset,validateProject,parameterDefinitions,PRESETS} from './src/core/project';",
      "export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';",
      "export {FloatType} from 'three';",
    ].join('\n'), resolveDir: root, sourcefile: 'instrument-snapshot.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: bundle, logLevel: 'silent', plugins: [{ name: 'frozen-renderer', setup(builder) {
      builder.onLoad({ filter: /\.(ts|tsx)$/ }, args => {
        const captured = sources[path.relative(root, args.path).split(path.sep).join('/')];
        return captured === undefined ? undefined : { contents: captured, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }] });
    for (const suffix of ['browser.mjs', 'preload.cjs']) await fs.copyFile(path.join(__dirname, 'instrument-study.' + suffix), path.join(study, label + '-' + suffix));
    const baseline = await fs.readFile(path.join(root, 'work/fractal-study/v5-art-6-renderer.js'));
    await fs.writeFile(path.join(study, label + '-v5-baseline.js'), baseline);
    await fs.writeFile(path.join(study, label + '-snapshot.json'), JSON.stringify({ frozenAt: new Date().toISOString(), sourceFiles,
      bundleSha256: sha(await fs.readFile(bundle)), baselineSha256: sha(baseline),
      sourceSha256: Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, sha(text)])),
      browserSha256: sha(await fs.readFile(path.join(study, label + '-browser.mjs'))),
      preloadSha256: sha(await fs.readFile(path.join(study, label + '-preload.cjs'))),
    }, null, 2));
  }
  const snapshot = JSON.parse(await fs.readFile(path.join(study, label + '-snapshot.json'), 'utf8'));
  for (const [suffix, expected] of [['renderer.js', snapshot.bundleSha256], ['v5-baseline.js', snapshot.baselineSha256], ['browser.mjs', snapshot.browserSha256], ['preload.cjs', snapshot.preloadSha256]]) {
    if (sha(await fs.readFile(path.join(study, label + '-' + suffix))) !== expected) throw new Error('Frozen snapshot hash mismatch: ' + suffix);
  }
  await fs.writeFile(path.join(study, label + '.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"></head><body><canvas id="canvas"></canvas><script type="module" src="./' + label + '-browser.mjs"></script></body></html>');
  const gpuMessages = [];
  ipcMain.handle('study-config', () => ({ label, quick, quality, snapshot }));
  ipcMain.handle('study-write', async (_, name, bytes) => {
    if (!/^[a-z0-9][a-z0-9_.-]*\.(png|exr|json)$/.test(name)) throw new Error('Unexpected study filename.');
    await fs.writeFile(path.join(output, name), Buffer.from(bytes));
  });
  ipcMain.handle('study-note', async (_, value) => {
    const line = new Date().toISOString() + ' ' + JSON.stringify(value);
    console.log(line); await fs.appendFile(path.join(output, 'study.log'), line + '\n');
  });
  ipcMain.handle('study-done', async (_, report) => {
    const gpuFailure = gpuMessages.some(entry => entry.level === 'error' || (/shader|webgl/i.test(entry.message) && /error|failed|invalid/i.test(entry.message)));
    Object.assign(report, { wallSeconds: (Date.now() - started) / 1000, gpuMessages, mainSha256: sha(syncFS.readFileSync(__filename)),
      status: gpuFailure ? 'failed' : quick ? 'captured' : 'passed', validationMode: quick ? quality ? 'visual-and-4K' : 'visual-only' : 'full' });
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log('STUDY_COMPLETE ' + JSON.stringify({ label, status: report.status, captures: report.captures.length, checks: report.checks.length, wallSeconds: report.wallSeconds, snapshot: snapshot.bundleSha256 }));
    setTimeout(() => gpuFailure ? app.exit(1) : app.quit(), 100);
  });
  ipcMain.handle('study-fail', async (_, message) => {
    await fs.writeFile(path.join(output, 'failure.txt'), message); console.error('STUDY_FAILED ' + message); app.exit(1);
  });
  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(study, label + '-preload.cjs'), backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => {
    if (event.level === 'error' || /shader|webgl/i.test(event.message)) { gpuMessages.push({ level: event.level, message: event.message }); console.error('GPU ' + event.message); }
  });
  await window.loadFile(path.join(study, label + '.html'));
}).catch(async error => {
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'failure.txt'), error.stack || String(error)); console.error(error); app.exit(1);
});
