// A retained, resumable 300-frame 4K alpha proof of an immutable sculpture snapshot.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/sculpture-proof.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExportManager, resolveMediaTools, atomicWrite } = require('../electron/export-manager.cjs');
const root = path.resolve(__dirname, '..');
const proofDir = path.join(root, 'work', 'sculpture-proof');
const snapshotLabel = process.env.SCULPTURE_SNAPSHOT || 'sculpture-final';
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(snapshotLabel)) throw new Error('Invalid sculpture snapshot label.');
const deliverables = '/Users/grego/Documents/Codex/2026-11-06/h/outputs';
const started = Date.now();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let manager, window, queue = Promise.resolve(), finished = false;
function note(value) {
  const entry = { ...value, elapsedSeconds: (Date.now() - started) / 1000, updatedAt: new Date().toISOString() };
  queue = queue.then(() => atomicWrite(path.join(proofDir, 'progress.json'), JSON.stringify(entry, null, 2)));
  if (value.status !== 'rendering' || value.rendered % 10 === 0) {
    const line = entry.updatedAt + ' ' + JSON.stringify(entry);
    console.log(line); queue = queue.then(() => fs.appendFile(path.join(proofDir, 'proof.log'), line + '\n'));
  }
}
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.mkdir(proofDir, { recursive: true });
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'work/sculpture-study', snapshotLabel + '-snapshot.json'), 'utf8'));
  const rendererBytes = await fs.readFile(path.join(root, 'work/sculpture-study', snapshotLabel + '-renderer.js'));
  if (hash(rendererBytes) !== snapshot.bundleSha256) throw new Error('Frozen sculpture snapshot hash mismatch.');
  const lock = path.join(proofDir, 'snapshot.json');
  let previous = null; try { previous = JSON.parse(await fs.readFile(lock, 'utf8')); } catch {}
  if (previous && previous.bundleSha256 !== snapshot.bundleSha256) throw new Error('This proof directory belongs to a different immutable renderer snapshot.');
  await atomicWrite(lock, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(proofDir, 'renderer.js'), rendererBytes);
  await fs.copyFile(path.join(__dirname, 'sculpture-proof.browser.mjs'), path.join(proofDir, 'proof-browser.mjs'));
  await fs.writeFile(path.join(proofDir, 'proof.html'), '<!doctype html><html><body><canvas id="canvas"></canvas><script type="module" src="./proof-browser.mjs"></script></body></html>');
  const tools = resolveMediaTools();
  manager = new ExportManager({ jobsDirectory: path.join(proofDir, 'jobs'), defaultExportDir: proofDir,
    ...tools, rendererFingerprint: snapshot.bundleSha256, onProgress: note });
  const phaseChecks = { rendererFingerprint: snapshot.bundleSha256, width: 3840, height: 2160, checks: [] };
  let frameZeroHash;
  ipcMain.handle('sculpture-proof-start', async (_, request) => {
    const jobs = await manager.listJobs();
    const resumable = jobs.find(job => job.request.project.name === request.project.name);
    const job = resumable ? await manager.resumeExport(resumable.id) : await manager.beginExport(request);
    await atomicWrite(path.join(proofDir, 'active-job.json'), JSON.stringify({ jobId: job.id, directory: job.directory, rendererFingerprint: snapshot.bundleSha256 }, null, 2));
    return job;
  });
  ipcMain.handle('sculpture-proof-frame', (_, id, index, bytes) => manager.writeFrame(id, index, bytes));
  ipcMain.handle('sculpture-proof-phase', async (_, label, bytes) => {
    const sha256 = hash(Buffer.from(bytes));
    if (label === 'zero') frameZeroHash = sha256;
    if (!frameZeroHash || sha256 !== frameZeroHash) throw new Error(`4K sculpture ${label} is not byte-identical to phase zero.`);
    phaseChecks.checks.push({ label, sha256, equalToPhaseZero: true });
    await atomicWrite(path.join(proofDir, 'phase-verification.json'), JSON.stringify(phaseChecks, null, 2));
  });
  ipcMain.handle('sculpture-proof-still', async (_, name, bytes) => {
    if (!['Sculpted-Opal-v2-4K-alpha.png', 'sculpture-thumb.png'].includes(name)) throw new Error('Unexpected proof still name.');
    await atomicWrite(path.join(proofDir, name), Buffer.from(bytes));
    if (name === 'sculpture-thumb.png') {
      await fs.copyFile(path.join(proofDir, name), path.join(root, 'src/ui/assets/sculpture.png'));
      console.log('SCULPTURE_THUMBNAIL_READY ' + path.join(root, 'src/ui/assets/sculpture.png'));
    }
  });
  ipcMain.handle('sculpture-proof-finish', async (_, id, browserReport) => {
    const job = await manager.finishExport(id); // Native full-decode verification is mandatory.
    const probe = await manager.run(tools.ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_streams', '-show_format', '-of', 'json', job.outputPath]);
    const verification = { completedAt: new Date().toISOString(), rendererSnapshot: snapshot, jobId: job.id,
      cacheDirectory: path.join(job.directory, 'cache'), fullDecodeVerified: true, browser: browserReport,
      phaseChecks, ffprobe: JSON.parse(probe.stdout), elapsedSeconds: (Date.now() - started) / 1000 };
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    // The bundled tools intentionally exclude H.264. The separately installed
    // Homebrew codec makes a lightweight black-background viewing copy only.
    const preview = path.join(proofDir, 'Sculpted-Opal-v2-1080p-preview.mp4');
    const filter = "scale=1920:1080:flags=lanczos,format=rgba,split[fg][bg];[bg]lutrgb=r=0:g=0:b=0,colorchannelmixer=aa=1[black];[black][fg]overlay=alpha=straight:format=auto,format=yuv420p";
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-y', '-filter_complex_threads', '1', '-i', job.outputPath,
      '-filter_complex', filter, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-movflags', '+faststart',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', preview]);
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', preview, '-f', 'null', '-']);
    const previewProbe = await manager.run(tools.ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', preview]);
    verification.preview = { fullDecodeVerified: true, ffprobe: JSON.parse(previewProbe.stdout), note: '1080p H.264 black-background viewing derivative; alpha master is the ProRes 4444 MOV.' };
    verification.elapsedSeconds = (Date.now() - started) / 1000;
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    await fs.mkdir(deliverables, { recursive: true });
    await fs.copyFile(job.outputPath, path.join(deliverables, 'Sculpted-Opal-v2-4K-alpha.mov'));
    await fs.copyFile(path.join(proofDir, 'Sculpted-Opal-v2-4K-alpha.png'), path.join(deliverables, 'Sculpted-Opal-v2-4K-alpha.png'));
    await fs.copyFile(preview, path.join(deliverables, 'Sculpted-Opal-v2-1080p-preview.mp4'));
    finished = true; note({ status: 'complete', rendered: 300, total: 300, outputPath: path.join(deliverables, 'Sculpted-Opal-v2-4K-alpha.mov') });
    await queue; console.log('SCULPTURE_PROOF_COMPLETE ' + JSON.stringify(verification));
    setTimeout(() => app.quit(), 100); return verification;
  });
  ipcMain.handle('sculpture-proof-fail', async (_, error) => {
    note({ status: 'failed', error }); await queue; console.error(error); app.exit(1);
  });
  window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(__dirname, 'sculpture-proof.preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('RENDERER ' + event.message); });
  await window.loadFile(path.join(proofDir, 'proof.html'));
}).catch(async error => {
  console.error(error); await fs.mkdir(proofDir, { recursive: true });
  await fs.writeFile(path.join(proofDir, 'failure.txt'), error.stack || String(error)); app.exit(1);
});
app.on('before-quit', () => { if (!finished) void manager?.interruptAll(); });
