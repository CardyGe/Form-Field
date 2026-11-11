// Reusable source-level 4K proof. It bundles a frozen browser harness separately
// from dist/, then exercises the same renderer and ExportManager as the app.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/render-proof.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');
const { ExportManager, resolveMediaTools, atomicWrite } = require('../electron/export-manager.cjs');
const root = path.resolve(__dirname, '..');
const proofDir = path.join(root, 'work', 'proof-4k');
const deliverables = '/Users/grego/Documents/Codex/2026-11-06/h/outputs';
const started = Date.now();
let manager, window, lastLog = '', progressQueue = Promise.resolve(), finished = false;
function progress(value) {
  const entry = { ...value, elapsedSeconds: (Date.now() - started) / 1000, updatedAt: new Date().toISOString() };
  progressQueue = progressQueue.then(() => atomicWrite(path.join(proofDir, 'progress.json'), JSON.stringify(entry, null, 2)));
  const key = `${value.status}:${value.rendered ?? ''}:${value.encoded ?? ''}`;
  if (key !== lastLog && (value.status !== 'rendering' || value.rendered % 10 === 0)) {
    const line = `${new Date().toISOString()} ${JSON.stringify(entry)}`;
    console.log(line);
    progressQueue = progressQueue.then(() => fs.appendFile(path.join(proofDir, 'proof.log'), line + '\n'));
    lastLog = key;
  }
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.mkdir(proofDir, { recursive: true });
  // Hash the complete source tree: new instruments import shader/motion modules
  // transitively, and resumed proofs must never mix masters across those edits.
  const sourceFiles = ['package-lock.json'];
  async function collectSources(directory) {
    for (const entry of (await fs.readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await collectSources(filename);
      else if (entry.isFile()) sourceFiles.push(filename);
    }
  }
  await collectSources('src');
  const fingerprint = crypto.createHash('sha256');
  for (const file of sourceFiles) fingerprint.update(file).update(await fs.readFile(path.join(root, file)));
  const rendererFingerprint = fingerprint.digest('hex');
  await build({ entryPoints: [path.join(__dirname, 'render-proof-browser.ts')], bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', outfile: path.join(proofDir, 'proof-bundle.js'), sourcemap: false, logLevel: 'silent' });
  await fs.writeFile(path.join(proofDir, 'proof.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"></head><body><canvas id="canvas" width="960" height="540"></canvas><script type="module" src="./proof-bundle.js"></script></body></html>');
  const tools = resolveMediaTools();
  manager = new ExportManager({ jobsDirectory: path.join(proofDir, 'jobs'), defaultExportDir: proofDir,
    ...tools, rendererFingerprint, onProgress: progress });
  ipcMain.handle('proof-start', async (_, request) => {
    const jobs = await manager.listJobs();
    const resumable = process.env.PROOF_NEW !== '1' && jobs.find(job => job.request.project.name === request.project.name && job.status !== 'complete');
    const job = resumable ? await manager.resumeExport(resumable.id) : await manager.beginExport(request);
    await atomicWrite(path.join(proofDir, 'active-job.json'), JSON.stringify({ jobId: job.id, directory: job.directory, rendererFingerprint }, null, 2));
    return job;
  });
  ipcMain.handle('proof-frame', (_, id, index, bytes) => manager.writeFrame(id, index, bytes));
  ipcMain.handle('proof-note', (_, note) => atomicWrite(path.join(proofDir, 'renderer-checks.json'), JSON.stringify(note, null, 2)));
  ipcMain.handle('proof-still', async (_, name, bytes) => {
    if (!['Neon-Strata-4K.png', 'Pearlescent-Folds-4K-alpha.png'].includes(name)) throw new Error('Unexpected proof still.');
    await atomicWrite(path.join(proofDir, name), Buffer.from(bytes));
  });
  ipcMain.handle('proof-finish', async (_, id) => {
    const job = await manager.finishExport(id); // Includes full video decode with exact frame-count validation.
    const probe = await manager.run(tools.ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_streams', '-show_format', '-of', 'json', job.outputPath]);
    const verification = { completedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000,
      rendererFingerprint, jobId: job.id, cacheDirectory: path.join(job.directory, 'cache'), fullDecodeVerified: true,
      ffprobe: JSON.parse(probe.stdout) };
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    await fs.mkdir(deliverables, { recursive: true });
    await fs.copyFile(job.outputPath, path.join(deliverables, 'Neon-Strata-4K-10s-ProRes-HQ.mov'));
    for (const name of ['Neon-Strata-4K.png', 'Pearlescent-Folds-4K-alpha.png']) await fs.copyFile(path.join(proofDir, name), path.join(deliverables, name));
    finished = true;
    progress({ status: 'complete', rendered: 300, total: 300, outputPath: path.join(deliverables, 'Neon-Strata-4K-10s-ProRes-HQ.mov'), elapsedSeconds: verification.elapsedSeconds });
    await progressQueue;
    console.log('PROOF_COMPLETE ' + JSON.stringify(verification));
    setTimeout(() => app.quit(), 100);
    return verification;
  });
  ipcMain.handle('proof-fail', async (_, error) => {
    progress({ status: 'failed', error }); await progressQueue;
    console.error('PROOF_FAILED ' + error); app.exit(1);
  });
  window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(__dirname, 'render-proof-preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('RENDERER ' + event.message); });
  await window.loadFile(path.join(proofDir, 'proof.html'));
}).catch(async error => {
  console.error(error); await fs.mkdir(proofDir, { recursive: true });
  await fs.writeFile(path.join(proofDir, 'failure.txt'), error.stack || String(error)); app.exit(1);
});
app.on('before-quit', () => { if (!finished) void manager?.interruptAll(); });
