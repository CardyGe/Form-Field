// Immutable 4K proof and native delivery for the v0.6 instrument expansion.
// INSTRUMENT_SNAPSHOT=<frozen-label> INSTRUMENT_APPROVED_SHA=<sha> ...electron this-file
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExportManager, resolveMediaTools, atomicWrite } = require('../electron/export-manager.cjs');
const root = path.resolve(__dirname, '..'), label = process.env.INSTRUMENT_SNAPSHOT;
const expectedHash = process.env.INSTRUMENT_APPROVED_SHA;
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label || '') || !/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('An approved frozen snapshot and SHA are required.');
const destination = '/Users/grego/Documents/Codex/2026-11-06/h/outputs';
const preset = process.env.INSTRUMENT_PROOF_PRESET || 'liquid-trefoil';
if (!/^[a-z0-9-]+$/.test(preset)) throw new Error('Invalid proof preset.');
const directory = path.join(root, 'work/instrument-study', label + '-delivery', preset);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const profile = path.join(directory, 'profile'); require('node:fs').mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let manager, finished = false, queue = Promise.resolve();
const gpuErrors = [], phaseChecks = [], artifacts = new Set();
const phaseZero = new Map(), started = Date.now();
function progress(value) {
  queue = queue.then(() => atomicWrite(path.join(directory, 'progress.json'), JSON.stringify(value, null, 2)));
  if (value.status !== 'rendering' || value.rendered % 10 === 0) console.log('QUALITY_PROOF ' + JSON.stringify(value));
}
app.whenReady().then(async () => {
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'work/instrument-study', label + '-snapshot.json'), 'utf8'));
  const bundle = await fs.readFile(path.join(root, 'work/instrument-study', label + '-renderer.js'));
  if (snapshot.bundleSha256 !== expectedHash || hash(bundle) !== expectedHash) throw new Error('Unapproved proof renderer.');
  const proofScripts = Object.fromEntries(await Promise.all(['cjs','browser.mjs','preload.cjs'].map(async suffix => [suffix, hash(await fs.readFile(path.join(__dirname, 'instrument-quality-proof.' + suffix)))])));
  const config = { renderer: expectedHash, version: 'v6', preset, frameCount: 120, width: 3840, height: 2160, fps: { num: 30, den: 1 }, proofScripts };
  const lockPath = path.join(directory, 'config.json');
  const previous = await fs.readFile(lockPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous && JSON.stringify(previous) !== JSON.stringify(config)) throw new Error('This proof directory is locked to another renderer or composition.');
  await atomicWrite(lockPath, JSON.stringify(config, null, 2));
  await fs.writeFile(path.join(directory, 'renderer.js'), bundle);
  await fs.copyFile(path.join(__dirname, 'instrument-quality-proof.browser.mjs'), path.join(directory, 'proof-browser.mjs'));
  await fs.writeFile(path.join(directory, 'proof.html'), '<!doctype html><html><body><canvas></canvas><script type="module" src="./proof-browser.mjs"></script></body></html>');
  const media = resolveMediaTools();
  manager = new ExportManager({ jobsDirectory: path.join(directory, 'jobs'), defaultExportDir: directory, ...media, rendererFingerprint: expectedHash, onProgress: progress });
  ipcMain.handle('instrument-proof-config', () => config);
  ipcMain.handle('instrument-proof-start', async (_, request) => {
    const old = (await manager.listJobs()).find(job => job.request.project.name === request.project.name);
    const job = old ? await manager.resumeExport(old.id) : await manager.beginExport(request);
    await atomicWrite(path.join(directory, 'active-job.json'), JSON.stringify(job, null, 2)); return job;
  });
  ipcMain.handle('instrument-proof-frame', (_, id, index, bytes) => manager.writeFrame(id, index, bytes));
  ipcMain.handle('instrument-proof-still', async (_, name, bytes) => {
    if (!/^[a-z0-9-]+-v6(?:-4K\.png|\.formfield)$/.test(name)) throw new Error('Invalid artifact name.');
    await atomicWrite(path.join(directory, name), Buffer.from(bytes)); artifacts.add(name);
  });
  ipcMain.handle('instrument-proof-phase', async (_, label, bytes) => {
    const [id, check] = label.split(':'); const sha = hash(Buffer.from(bytes));
    if (check === 'zero') phaseZero.set(id, sha);
    if (!phaseZero.has(id) || phaseZero.get(id) !== sha) throw new Error('4K phase/seek comparison failed: ' + label);
    phaseChecks.push({ preset: id, check, sha256: sha, equal: true });
  });
  ipcMain.handle('instrument-proof-finish', async (_, id, report) => {
    const job = await manager.finishExport(id);
    const probe = JSON.parse((await manager.run(media.ffprobePath, ['-v','error','-count_frames','-show_streams','-show_format','-of','json',job.outputPath])).stdout);
    const stream = probe.streams[0];
    if (stream.width !== config.width || stream.height !== config.height || Number(stream.nb_read_frames) !== config.frameCount) throw new Error('Native master dimensions/frame count failed.');
    if (stream.color_space !== 'bt709' || stream.color_transfer !== 'bt709' || stream.color_primaries !== 'bt709') throw new Error('Native master colour metadata failed.');
    const alphaPath = path.join(directory, 'alpha-samples.gray16');
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v','error','-y','-i',job.outputPath,'-vf',"select='eq(n,0)+eq(n,60)+eq(n,119)',alphaextract,format=gray16le",'-fps_mode','passthrough','-f','rawvideo',alphaPath]);
    const alpha = await fs.readFile(alphaPath); let zero = 0, soft = 0, solid = 0;
    if (alpha.length !== config.width*config.height*2*3) throw new Error('Decoded alpha sample count failed.');
    for(let i=0;i<alpha.length;i+=2) { const a=alpha.readUInt16LE(i); if(a===0)zero++; else if(a>=65520)solid++; else soft++; }
    const cutout = report.kind === 'sculpture' || (report.kind === 'fractal' && report.style === 2);
    if(cutout ? (!zero || !soft || !solid) : (zero || soft || solid !== config.width*config.height*3)) throw new Error('Decoded master alpha coverage failed.');
    await fs.rm(alphaPath);
    const frameMD5 = (await manager.run('/opt/homebrew/bin/ffmpeg', ['-v','error','-xerror','-i',job.outputPath,'-f','framemd5','-'])).stdout;
    await atomicWrite(path.join(directory,'decoded-frame-hashes.txt'),frameMD5);
    const decodedHashes = frameMD5.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
    if(decodedHashes.length !== config.frameCount || new Set(decodedHashes).size !== config.frameCount) throw new Error('Native master has missing or frozen frames.');
    const preview = path.join(directory, preset + '-v6-1080p-preview.mp4');
    // Composite straight alpha over black in linear light before the viewing
    // derivative. The bundled zimg build owns transfer/matrix/range conversion.
    const rawPreview=path.join(directory,'preview.yuv');
    const matteFilter="zscale=pin=709:tin=709:min=709:rin=limited:t=linear:m=gbr:r=full,format=gbrapf32le,geq=r='r(X,Y)*alpha(X,Y)':g='g(X,Y)*alpha(X,Y)':b='b(X,Y)*alpha(X,Y)':a=1,format=gbrpf32le,zscale=w=1920:h=1080:pin=709:tin=linear:min=gbr:rin=full:p=709:t=709:m=709:r=limited:d=error_diffusion,format=yuv420p";
    await manager.run(media.ffmpegPath,['-v','error','-y','-i',job.outputPath,'-vf',matteFilter,'-an','-c:v','rawvideo','-pix_fmt','yuv420p','-f','rawvideo',rawPreview]);
    await manager.run('/opt/homebrew/bin/ffmpeg',['-v','error','-y','-f','rawvideo','-pixel_format','yuv420p','-video_size','1920x1080','-framerate','30','-i',rawPreview,'-an','-c:v','libx264','-preset','medium','-crf','17','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',preview]);
    await fs.rm(rawPreview);
    await manager.run('/opt/homebrew/bin/ffmpeg', ['-v','error','-xerror','-i',preview,'-f','null','-']);
    for (const name of artifacts) if(name.endsWith('.png')) await manager.run(media.ffmpegPath,['-v','error','-xerror','-i',path.join(directory,name),'-f','null','-']);
    if (gpuErrors.length) throw new Error('GPU proof errors: ' + gpuErrors.join('\n'));
    const verification = { snapshot, config, fullMasterDecodeVerified:true, previewNote:'1080p viewing derivative: black alpha matte in linear light, explicit zimg BT.709 transfer/matrix/range conversion; master retains genuine straight alpha.', ffprobe:probe, decodedAlpha:{frames:[0,60,119],zero,soft,solid}, decodedUniqueFrames:new Set(decodedHashes).size, phaseChecks, browser:report, elapsedSeconds:(Date.now()-started)/1000 };
    await atomicWrite(path.join(directory,'verification.json'),JSON.stringify(verification,null,2));
    await fs.mkdir(destination,{recursive:true});
    for (const name of artifacts) await fs.copyFile(path.join(directory,name),path.join(destination,name));
    await fs.copyFile(job.outputPath,path.join(destination,preset+'-v6-4K-ProRes4444.mov'));
    await fs.copyFile(preview,path.join(destination,path.basename(preview)));
    await queue; finished=true; console.log('QUALITY_PROOF_COMPLETE '+JSON.stringify(verification));
    setTimeout(()=>app.quit(),100); return verification;
  });
  ipcMain.handle('instrument-proof-fail', (_,error)=>{ console.error(error);app.exit(1); });
  const window = new BrowserWindow({show:false,width:1280,height:800,webPreferences:{preload:path.join(__dirname,'instrument-quality-proof.preload.cjs'),backgroundThrottling:false,contextIsolation:true,sandbox:true,nodeIntegration:false}});
  window.webContents.on('console-message', event=>{ if(event.level==='error')gpuErrors.push(event.message); });
  await window.loadFile(path.join(directory,'proof.html'));
}).catch(async error=>{console.error(error);await atomicWrite(path.join(directory,'failure.txt'),error.stack||String(error));app.exit(1);});
app.on('before-quit',()=>{if(!finished)void manager?.interruptAll();});
