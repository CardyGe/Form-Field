// A retained, resumable 300-frame 4K opaque Surface proof from a frozen snapshot.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/surface-study.proof.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExportManager, resolveMediaTools, atomicWrite } = require('../electron/export-manager.cjs');
const root = path.resolve(__dirname, '..');
const proofDir = path.join(root, 'work', 'surface-study', 'proof');
const snapshotLabel = process.env.SURFACE_SNAPSHOT || 'surface-final';
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(snapshotLabel)) throw new Error('Invalid surface snapshot label.');
const deliverables = '/Users/grego/Documents/Codex/2026-11-06/h/outputs';
const started = Date.now();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let manager, window, queue = Promise.resolve(), finished = false;
const gpuErrors = [];
const stillNames = ['Acid-Tide-v3-4K.png', 'Orchid-Rings-v3-4K.png', 'Solar-Melt-v3-4K.png', 'Deep-Bloom-v3-4K.png', 'Mineral-Silk-v3-4K.png'];
const projectName = 'Liquid-Strata-v3.formfield';
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
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'work/surface-study', snapshotLabel + '-snapshot.json'), 'utf8'));
  const rendererBytes = await fs.readFile(path.join(root, 'work/surface-study', snapshotLabel + '-renderer.js'));
  if (hash(rendererBytes) !== snapshot.bundleSha256) throw new Error('Frozen surface snapshot hash mismatch.');
  const lock = path.join(proofDir, 'snapshot.json');
  let previous = null; try { previous = JSON.parse(await fs.readFile(lock, 'utf8')); } catch {}
  if (previous && previous.bundleSha256 !== snapshot.bundleSha256) throw new Error('This proof directory belongs to a different immutable renderer snapshot.');
  await atomicWrite(lock, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(proofDir, 'renderer.js'), rendererBytes);
  await fs.copyFile(path.join(__dirname, 'surface-study.proof.browser.mjs'), path.join(proofDir, 'proof-browser.mjs'));
  await fs.writeFile(path.join(proofDir, 'proof.html'), '<!doctype html><html><body><canvas id="canvas"></canvas><script type="module" src="./proof-browser.mjs"></script></body></html>');
  const tools = resolveMediaTools();
  manager = new ExportManager({ jobsDirectory: path.join(proofDir, 'jobs'), defaultExportDir: proofDir,
    ...tools, rendererFingerprint: snapshot.bundleSha256, onProgress: note });
  const phaseChecks = { rendererFingerprint: snapshot.bundleSha256, width: 3840, height: 2160, checks: [] };
  let frameZeroHash;
  ipcMain.handle('surface-proof-start', async (_, request) => {
    const jobs = await manager.listJobs();
    const resumable = jobs.find(job => job.request.project.name === request.project.name);
    const job = resumable ? await manager.resumeExport(resumable.id) : await manager.beginExport(request);
    await atomicWrite(path.join(proofDir, 'active-job.json'), JSON.stringify({ jobId: job.id, directory: job.directory, rendererFingerprint: snapshot.bundleSha256 }, null, 2));
    return job;
  });
  ipcMain.handle('surface-proof-frame', (_, id, index, bytes) => manager.writeFrame(id, index, bytes));
  ipcMain.handle('surface-proof-phase', async (_, label, bytes) => {
    const sha256 = hash(Buffer.from(bytes));
    if (label === 'zero') frameZeroHash = sha256;
    if (!frameZeroHash || sha256 !== frameZeroHash) throw new Error(`4K surface ${label} is not byte-identical to phase zero.`);
    phaseChecks.checks.push({ label, sha256, equalToPhaseZero: true });
    await atomicWrite(path.join(proofDir, 'phase-verification.json'), JSON.stringify(phaseChecks, null, 2));
  });
  ipcMain.handle('surface-proof-still', async (_, name, bytes) => {
    if (![...stillNames, 'surface-thumb.png', projectName].includes(name)) throw new Error('Unexpected proof artifact name.');
    await atomicWrite(path.join(proofDir, name), Buffer.from(bytes));
  });
  ipcMain.handle('surface-proof-finish', async (_, id, browserReport) => {
    const job = await manager.finishExport(id); // Native full-decode verification is mandatory.
    const probe = await manager.run(tools.ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_streams', '-show_format', '-of', 'json', job.outputPath]);
    const verification = { completedAt: new Date().toISOString(), rendererSnapshot: snapshot, jobId: job.id,
      cacheDirectory: path.join(job.directory, 'cache'), fullDecodeVerified: true, browser: browserReport,
      phaseChecks, ffprobe: JSON.parse(probe.stdout), elapsedSeconds: (Date.now() - started) / 1000 };
    if (gpuErrors.length) throw new Error('GPU errors occurred during proof: ' + gpuErrors.join('\n'));
    const alphaPath = path.join(proofDir, 'decoded-alpha-samples.gray16');
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-y', '-i', job.outputPath, '-vf',
      "select='eq(n,0)+eq(n,150)+eq(n,299)',alphaextract,format=gray16le", '-fps_mode', 'passthrough', '-f', 'rawvideo', alphaPath]);
    const alpha = await fs.readFile(alphaPath);
    if (alpha.length !== 3840*2160*2*3) throw new Error('Unexpected decoded opacity sample count.');
    let minAlpha = 65535, maxAlpha = 0, nonOpaque = 0;
    for (let i=0;i<alpha.length;i+=2) { const v=alpha.readUInt16LE(i); minAlpha=Math.min(minAlpha,v); maxAlpha=Math.max(maxAlpha,v); if(v<65520)nonOpaque++; }
    if (nonOpaque) throw new Error('The intended opaque Surface master has unexpected transparency.');
    verification.decodedOpacity = { frames: [0, 150, 299], minAlpha, maxAlpha, nonOpaque, note: 'Fully opaque artwork. Alpha-capable ProRes4444 container; no transparent-art claim.' };
    await fs.rm(alphaPath);
    for (const name of stillNames) await manager.run(tools.ffmpegPath, ['-v','error','-xerror','-i',path.join(proofDir,name),'-f','null','-']);
    verification.stillsFullDecodeVerified = stillNames;
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    // The bundled tools intentionally exclude H.264. The separately installed
    // Homebrew codec makes a lightweight opaque viewing copy only.
    const preview = path.join(proofDir, 'Liquid-Strata-v3-1080p-preview.mp4');
    const filter = 'scale=1920:1080:flags=lanczos,format=yuv420p';
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-y', '-filter_complex_threads', '1', '-i', job.outputPath,
      '-filter_complex', filter, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-movflags', '+faststart',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', preview]);
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', preview, '-f', 'null', '-']);
    const previewProbe = await manager.run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', preview]);
    const previewMetadata = JSON.parse(previewProbe.stdout);
    if (previewMetadata.streams?.[0]?.nb_read_frames !== '300') throw new Error('Preview frame-count verification failed.');
    verification.preview = { fullDecodeVerified: true, ffprobe: previewMetadata, note: '1080p H.264 viewing derivative. Fully opaque ProRes4444 master retains delivery quality.' };
    verification.elapsedSeconds = (Date.now() - started) / 1000;
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    await fs.mkdir(deliverables, { recursive: true });
    await fs.copyFile(job.outputPath, path.join(deliverables, 'Liquid-Strata-v3-4K-ProRes4444.mov'));
    for (const name of [...stillNames, projectName]) await fs.copyFile(path.join(proofDir, name), path.join(deliverables, name));
    await fs.copyFile(preview, path.join(deliverables, 'Liquid-Strata-v3-1080p-preview.mp4'));
    finished = true; note({ status: 'complete', rendered: 300, total: 300, outputPath: path.join(deliverables, 'Liquid-Strata-v3-4K-ProRes4444.mov') });
    await queue; console.log('SURFACE_PROOF_COMPLETE ' + JSON.stringify(verification));
    setTimeout(() => app.quit(), 100); return verification;
  });
  ipcMain.handle('surface-proof-fail', async (_, error) => {
    note({ status: 'failed', error }); await queue; console.error(error); app.exit(1);
  });
  window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(__dirname, 'surface-study.proof.preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => { if (event.level === 'error') { gpuErrors.push(event.message); console.error('RENDERER ' + event.message); } });
  await window.loadFile(path.join(proofDir, 'proof.html'));
}).catch(async error => {
  console.error(error); await fs.mkdir(proofDir, { recursive: true });
  await fs.writeFile(path.join(proofDir, 'failure.txt'), error.stack || String(error)); app.exit(1);
});
app.on('before-quit', () => { if (!finished) void manager?.interruptAll(); });
