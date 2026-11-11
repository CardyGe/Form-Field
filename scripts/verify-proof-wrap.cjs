// Full-resolution repeatability check against frame zero, using the exact frozen
// renderer bundle that created the retained proof frames (not newer source).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const proofDir = path.resolve(__dirname, '../work/proof-4k');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
app.whenReady().then(async () => {
  const active = JSON.parse(await fs.readFile(path.join(proofDir, 'active-job.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(active.directory, 'manifest.json'), 'utf8'));
  const original = await fs.readFile(path.join(proofDir, 'proof-bundle.js'), 'utf8');
  const boundary = original.indexOf('// scripts/render-proof-browser.ts');
  if (boundary < 0) throw new Error('Frozen renderer bundle entry point not found.');
  const cached = digest(await fs.readFile(path.join(active.directory, 'cache/frame-000000.exr')));
  const results = { width: 3840, height: 2160, rendererFingerprint: active.rendererFingerprint,
    frozenBundleSha256: digest(original), cacheFrameZeroSha256: cached, checks: [] };
  ipcMain.handle('proof-start', () => manifest.job);
  ipcMain.handle('proof-frame', (_, id, index, bytes) => {
    if (id !== manifest.job.id) throw new Error('Wrong proof job.');
    const sha256 = digest(Buffer.from(bytes));
    if (sha256 !== cached) throw new Error(`Full-resolution phase ${index ? '2π' : '0'} does not match cached frame zero.`);
    results.checks.push({ phase: index ? '2π' : '0', sha256, byteIdenticalToCache: true });
  });
  ipcMain.handle('proof-note', async () => {
    results.completedAt = new Date().toISOString(); results.exactPhaseWrap4K = results.checks.length === 2;
    await fs.writeFile(path.join(proofDir, 'phase-4k-verification.json'), JSON.stringify(results, null, 2));
    console.log('FULL_4K_PHASE_VERIFIED ' + JSON.stringify(results)); setTimeout(() => app.quit(), 100);
  });
  ipcMain.handle('proof-fail', (_, error) => { console.error(error); app.exit(1); });
  const code = original.slice(0, boundary) + `
  (async()=>{const r=new StudioRenderer(document.querySelector('#canvas'));try{
    const job=await window.proof.start();const project=structuredClone(job.request.project);project.transparent=true;
    await r.prepare(project);for(let i=0;i<2;i++)await window.proof.frame(job.id,i,await r.exportEXR(project,i*Math.PI*2,3840,2160));
    await window.proof.note();}finally{r.dispose();}})().catch(e=>window.proof.fail(e.stack||String(e)));
  ` + original.slice(original.indexOf('/*! Bundled license information:'));
  await fs.writeFile(path.join(proofDir, 'wrap-bundle.js'), code);
  await fs.writeFile(path.join(proofDir, 'wrap.html'), '<!doctype html><html><body><canvas id="canvas"></canvas><script type="module" src="./wrap-bundle.js"></script></body></html>');
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'render-proof-preload.cjs'),
    sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadFile(path.join(proofDir, 'wrap.html'));
}).catch(error => { console.error(error); app.exit(1); });
