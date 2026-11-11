// A retained, resumable 300-frame 4K opaque Fractal proof from a frozen snapshot.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/fractal-study.proof.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExportManager, resolveMediaTools, atomicWrite } = require('../electron/export-manager.cjs');
const root = path.resolve(__dirname, '..');
const proofDir = path.join(root, 'work', 'fractal-study', 'proof');
const snapshotLabel = process.env.FRACTAL_SNAPSHOT || 'fractal-final';
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(snapshotLabel)) throw new Error('Invalid fractal snapshot label.');
const approvedRendererSha256 = '61101ede01ffce167dbffd0f87783f78293afb31006b0d9054d6d4645dd317b8';
const deliverables = '/Users/grego/Documents/Codex/2026-11-06/h/outputs';
const started = Date.now();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let manager, window, queue = Promise.resolve(), finished = false;
const gpuErrors = [];
const stillNames = ['Prismatic-Fold-v4-4K.png', 'Velvet-Julia-v4-4K.png', 'Abyssal-Cathedral-v4-4K.png'];
const projectName = 'Prismatic-Bloom-v4.formfield';
const projectNames = [projectName, 'Velvet-Julia-v4.formfield', 'Abyssal-Cathedral-v4.formfield'];
function note(value) {
  const entry = { ...value, elapsedSeconds: (Date.now() - started) / 1000, updatedAt: new Date().toISOString() };
  queue = queue.then(() => atomicWrite(path.join(proofDir, 'progress.json'), JSON.stringify(entry, null, 2)));
  if (value.status !== 'rendering' || value.rendered % 10 === 0) {
    const line = entry.updatedAt + ' ' + JSON.stringify(entry);
    console.log(line); queue = queue.then(() => fs.appendFile(path.join(proofDir, 'proof.log'), line + '\n'));
  }
}
const profile = path.join(proofDir, 'profile');
require('node:fs').mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async () => {
  await fs.mkdir(proofDir, { recursive: true });
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'work/fractal-study', snapshotLabel + '-snapshot.json'), 'utf8'));
  if (snapshot.bundleSha256 !== approvedRendererSha256) throw new Error('Proof renderer is not the approved v0.4 art-3 snapshot.');
  const rendererBytes = await fs.readFile(path.join(root, 'work/fractal-study', snapshotLabel + '-renderer.js'));
  if (hash(rendererBytes) !== snapshot.bundleSha256) throw new Error('Frozen fractal snapshot hash mismatch.');
  const lock = path.join(proofDir, 'snapshot.json');
  let previous = null; try { previous = JSON.parse(await fs.readFile(lock, 'utf8')); } catch {}
  if (previous && previous.bundleSha256 !== snapshot.bundleSha256) throw new Error('This proof directory belongs to a different immutable renderer snapshot.');
  await atomicWrite(lock, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(proofDir, 'renderer.js'), rendererBytes);
  await fs.copyFile(path.join(__dirname, 'fractal-study.proof.browser.mjs'), path.join(proofDir, 'proof-browser.mjs'));
  await fs.writeFile(path.join(proofDir, 'proof.html'), '<!doctype html><html><body><canvas id="canvas"></canvas><script type="module" src="./proof-browser.mjs"></script></body></html>');
  const tools = resolveMediaTools();
  manager = new ExportManager({ jobsDirectory: path.join(proofDir, 'jobs'), defaultExportDir: proofDir,
    ...tools, rendererFingerprint: snapshot.bundleSha256, onProgress: note });
  const phaseChecks = { rendererFingerprint: snapshot.bundleSha256, width: 3840, height: 2160, checks: [] };
  let frameZeroHash;
  ipcMain.handle('fractal-proof-start', async (_, request) => {
    const jobs = await manager.listJobs();
    const resumable = jobs.find(job => job.request.project.name === request.project.name);
    const job = resumable ? await manager.resumeExport(resumable.id) : await manager.beginExport(request);
    await atomicWrite(path.join(proofDir, 'active-job.json'), JSON.stringify({ jobId: job.id, directory: job.directory, rendererFingerprint: snapshot.bundleSha256 }, null, 2));
    return job;
  });
  ipcMain.handle('fractal-proof-frame', (_, id, index, bytes) => manager.writeFrame(id, index, bytes));
  ipcMain.handle('fractal-proof-phase', async (_, label, bytes) => {
    const sha256 = hash(Buffer.from(bytes));
    if (label === 'zero') frameZeroHash = sha256;
    if (!frameZeroHash || sha256 !== frameZeroHash) throw new Error(`4K fractal ${label} is not byte-identical to phase zero.`);
    phaseChecks.checks.push({ label, sha256, equalToPhaseZero: true });
    await atomicWrite(path.join(proofDir, 'phase-verification.json'), JSON.stringify(phaseChecks, null, 2));
  });
  ipcMain.handle('fractal-proof-still', async (_, name, bytes) => {
    if (![...stillNames, 'fractal-thumb.png', ...projectNames].includes(name)) throw new Error('Unexpected proof artifact name.');
    await atomicWrite(path.join(proofDir, name), Buffer.from(bytes));
  });
  ipcMain.handle('fractal-proof-motion-frame', async (_, index, bytes) => {
    if (!Number.isInteger(index) || index < 0 || index >= 300) throw new Error('Unexpected 3D motion frame index.');
    const directory = path.join(proofDir, 'cathedral-preview-frames');
    await fs.mkdir(directory, { recursive: true });
    await atomicWrite(path.join(directory, String(index).padStart(6, '0') + '.png'), Buffer.from(bytes));
  });
  ipcMain.handle('fractal-proof-finish', async (_, id, browserReport) => {
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
    if (nonOpaque) throw new Error('The intended opaque Fractal master has unexpected transparency.');
    verification.decodedOpacity = { frames: [0, 150, 299], minAlpha, maxAlpha, nonOpaque, note: 'Fully opaque artwork. Alpha-capable ProRes4444 container; no transparent-art claim.' };
    await fs.rm(alphaPath);
    for (const name of stillNames) await manager.run(tools.ffmpegPath, ['-v','error','-xerror','-i',path.join(proofDir,name),'-f','null','-']);
    verification.stillsFullDecodeVerified = stillNames;
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    // The bundled tools intentionally exclude H.264. The separately installed
    // Homebrew codec makes a lightweight opaque viewing copy only.
    const preview = path.join(proofDir, 'Prismatic-Bloom-v4-1080p-preview.mp4');
    const filter = 'scale=1920:1080:flags=lanczos,format=yuv420p';
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-y', '-filter_complex_threads', '1', '-i', job.outputPath,
      '-filter_complex', filter, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-movflags', '+faststart',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', preview]);
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', preview, '-f', 'null', '-']);
    const previewProbe = await manager.run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', preview]);
    const previewMetadata = JSON.parse(previewProbe.stdout);
    if (previewMetadata.streams?.[0]?.nb_read_frames !== '300') throw new Error('Preview frame-count verification failed.');
    verification.preview = { fullDecodeVerified: true, ffprobe: previewMetadata, note: '1080p H.264 viewing derivative. Fully opaque ProRes4444 master retains delivery quality.' };
    const cathedralPreview = path.join(proofDir, 'Abyssal-Cathedral-v4-720p-preview.mp4');
    const cathedralRaw = path.join(proofDir, 'cathedral-preview.yuv');
    // Bundled zimg owns colour conversion. Homebrew supplies H.264 only.
    await manager.run(tools.ffmpegPath, ['-hide_banner', '-y', '-framerate', '30', '-i', path.join(proofDir, 'cathedral-preview-frames', '%06d.png'),
      '-frames:v', '300', '-an', '-vf', 'format=gbrp16le,zscale=pin=709:tin=iec61966-2-1:min=gbr:rin=full:p=709:t=709:m=709:r=limited:d=error_diffusion,format=yuv420p',
      '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', cathedralRaw]);
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-y', '-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', '1280x720', '-framerate', '30', '-i', cathedralRaw,
      '-frames:v', '300', '-an', '-vf', 'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-movflags', '+faststart',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', cathedralPreview]);
    await fs.rm(cathedralRaw);
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', cathedralPreview, '-f', 'null', '-']);
    const cathedralProbe = JSON.parse((await manager.run('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', cathedralPreview])).stdout);
    if (cathedralProbe.streams?.[0]?.nb_read_frames !== '300') throw new Error('Cathedral viewing-copy frame-count verification failed.');
    verification.cathedralPreview = { fullDecodeVerified: true, ffprobe: cathedralProbe, note: '720p 30fps H.264 viewing study rendered from the same frozen shader. Explicit zscale sRGB-to-BT.709 transfer/matrix/range conversion; dark background.' };
    verification.elapsedSeconds = (Date.now() - started) / 1000;
    await atomicWrite(path.join(proofDir, 'verification.json'), JSON.stringify(verification, null, 2));
    await fs.mkdir(deliverables, { recursive: true });
    await fs.copyFile(job.outputPath, path.join(deliverables, 'Prismatic-Bloom-v4-4K-ProRes4444.mov'));
    for (const name of [...stillNames, ...projectNames]) await fs.copyFile(path.join(proofDir, name), path.join(deliverables, name));
    await fs.copyFile(preview, path.join(deliverables, 'Prismatic-Bloom-v4-1080p-preview.mp4'));
    await fs.copyFile(cathedralPreview, path.join(deliverables, 'Abyssal-Cathedral-v4-720p-preview.mp4'));
    finished = true; note({ status: 'complete', rendered: 300, total: 300, outputPath: path.join(deliverables, 'Prismatic-Bloom-v4-4K-ProRes4444.mov') });
    await queue; console.log('FRACTAL_PROOF_COMPLETE ' + JSON.stringify(verification));
    setTimeout(() => app.quit(), 100); return verification;
  });
  ipcMain.handle('fractal-proof-fail', async (_, error) => {
    note({ status: 'failed', error }); await queue; console.error(error); app.exit(1);
  });
  window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    preload: path.join(__dirname, 'fractal-study.proof.preload.cjs'), backgroundThrottling: false,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.on('console-message', event => { if (event.level === 'error') { gpuErrors.push(event.message); console.error('RENDERER ' + event.message); } });
  await window.loadFile(path.join(proofDir, 'proof.html'));
}).catch(async error => {
  console.error(error); await fs.mkdir(proofDir, { recursive: true });
  await fs.writeFile(path.join(proofDir, 'failure.txt'), error.stack || String(error)); app.exit(1);
});
app.on('before-quit', () => { if (!finished) void manager?.interruptAll(); });
