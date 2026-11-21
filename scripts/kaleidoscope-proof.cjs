// Renders Kaleidoscope stills for review: every symmetry with every input, and the library thumbnail.
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/kaleidoscope-proof.cjs [--software-gl] [--thumbnail]
// Output: work/kaleidoscope-proof/*.png and contact-sheet.png. --thumbnail also writes src/ui/assets/kaleidoscope.png.
// On Linux as root add --no-sandbox; with no display run under xvfb-run.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const output = path.join(root, 'work', 'kaleidoscope-proof');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-kproof-'));
app.setPath('userData', profile);
if (args.includes('--software-gl')) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('disable-gpu-watchdog');
}

const page = /* js */`
const { StudioRenderer, createProject, createLayer, applyPreset, SYMMETRY_LABELS } = await import('./proof-renderer.js');
const TAU = Math.PI * 2;
async function testImage() {
  // An asymmetric picture: a gradient, rings, bars and a letter, so a wrong fold is obvious.
  const c = document.createElement('canvas'); c.width = 640; c.height = 400;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 640, 400); grad.addColorStop(0, '#ff2e93'); grad.addColorStop(.5, '#ffcc00'); grad.addColorStop(1, '#00b8ff');
  g.fillStyle = grad; g.fillRect(0, 0, 640, 400);
  for (let i = 0; i < 9; i++) { g.strokeStyle = i % 2 ? '#14020c' : '#ffffff'; g.lineWidth = 6; g.beginPath(); g.arc(200, 180, 20 + i * 22, 0, TAU); g.stroke(); }
  g.fillStyle = '#1a1aff'; for (let i = 0; i < 6; i++) g.fillRect(420 + i * 30, 40, 14, 320);
  g.fillStyle = '#ffffff'; g.font = 'bold 220px sans-serif'; g.fillText('F', 470, 300);
  const dataUrl = c.toDataURL('image/png');
  return { name: 'test.png', dataUrl, width: 640, height: 400, fit: 'contain' };
}
const image = await testImage();
const renderer = new StudioRenderer(document.querySelector('canvas'));
const cases = [];
const inputs = ['lines', 'image', 'below'];
for (const [input, inputName] of inputs.entries()) for (let group = 0; group < 5; group++) {
  const project = createProject();
  project.background = '#05040c';
  const k = createLayer('kaleidoscope');
  Object.assign(k.params, { input, group, segments: 6, cell: .22, insideScale: 1.2, drift: .2 });
  if (input === 1) k.image = image;
  project.layers = input === 2 ? [applyPreset(createLayer('surface'), 'acid-tide'), k] : [k];
  cases.push({ name: inputName + '-' + group, title: inputName + ' · ' + SYMMETRY_LABELS[group], project });
}
const results = [];
for (const c of cases) {
  await renderer.prepare(c.project);
  const bytes = await renderer.exportPNG(c.project, .9, 512, 288);
  await window.proof.write(c.name + '.png', Array.from(bytes));
  results.push({ ...c, bytes });
}
// Contact sheet.
const sheet = document.createElement('canvas'); sheet.width = 5 * 512; sheet.height = 3 * (288 + 28);
const g = sheet.getContext('2d'); g.fillStyle = '#100d1c'; g.fillRect(0, 0, sheet.width, sheet.height);
for (const [i, r] of results.entries()) {
  const bitmap = await createImageBitmap(new Blob([r.bytes], { type: 'image/png' }));
  const x = (i % 5) * 512, y = Math.floor(i / 5) * (288 + 28);
  g.drawImage(bitmap, x, y); g.fillStyle = '#eee8f6'; g.font = '15px sans-serif'; g.fillText(r.title, x + 10, y + 288 + 20);
}
const blob = await new Promise(resolve => sheet.toBlob(resolve, 'image/png'));
await window.proof.write('contact-sheet.png', Array.from(new Uint8Array(await blob.arrayBuffer())));
if (${args.includes('--thumbnail')}) {
  const project = createProject(); project.background = '#05040c';
  const k = createLayer('kaleidoscope');
  Object.assign(k.params, { input: 2, group: 0, segments: 8, insideScale: 1.6, zoom: 1.1 });
  project.layers = [applyPreset(createLayer('surface'), 'acid-tide'), k];
  await renderer.prepare(project);
  await window.proof.thumbnail(Array.from(await renderer.exportPNG(project, .9, 512, 288, 2)));
}
await window.proof.done();
`;

app.whenReady().then(async () => {
  await build({
    stdin: { contents: [
      "export {StudioRenderer} from './src/rendering/StudioRenderer';",
      "export {createProject,createLayer,applyPreset} from './src/core/project';",
      "export {SYMMETRY_LABELS} from './src/core/symmetry';",
    ].join('\n'), resolveDir: root, sourcefile: 'proof-entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(output, 'proof-renderer.js'), logLevel: 'silent',
  });
  fs.writeFileSync(path.join(output, 'proof.mjs'), `try {${page}} catch (error) { await window.proof.fail(error?.stack || String(error)); }`);
  fs.writeFileSync(path.join(output, 'proof.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><canvas width="512" height="288"></canvas><script type="module" src="./proof.mjs"></script></body></html>');
  fs.writeFileSync(path.join(output, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('proof', { write: (n, b) => ipcRenderer.invoke('write', n, b), thumbnail: b => ipcRenderer.invoke('thumbnail', b), done: () => ipcRenderer.invoke('done'), fail: e => ipcRenderer.invoke('fail', e) });`);
  ipcMain.handle('write', (_, name, bytes) => { if (!/^[a-z0-9-]+\.png$/.test(name)) throw new Error('bad name'); fs.writeFileSync(path.join(output, name), Buffer.from(bytes)); });
  ipcMain.handle('thumbnail', (_, bytes) => fs.writeFileSync(path.join(root, 'src', 'ui', 'assets', 'kaleidoscope.png'), Buffer.from(bytes)));
  ipcMain.handle('done', () => { console.log('Proof written to work/kaleidoscope-proof'); setTimeout(() => app.quit(), 100); });
  ipcMain.handle('fail', (_, error) => { console.error('PROOF_FAILED ' + error); app.exit(1); });
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(output, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error' || /shader|webgl/i.test(event.message)) console.error('GPU ' + event.message); });
  await window.loadFile(path.join(output, 'proof.html'));
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
