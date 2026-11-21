// Usage: node run-flash-analysis.mjs <exported main source folder>
// Renders every Oscilloscope and Ember look at 1080p, 60 fps, and writes flash_results.json beside this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2]);
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { _electron: electron } = require('playwright');
const out = path.join(root, 'work/flash-analysis');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';
export {FlashAnalyzer,runControls} from ${JSON.stringify(path.join(here, 'flash-analyzer.mjs'))};`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="1920" height="1080"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('canvas'));
    const decode = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const c = i / 255; decode[i] = c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }
    window.flashQA = { m, renderer, decode };
  });
  const controls = await page.evaluate(() => window.flashQA.m.runControls());
  console.log('controls', JSON.stringify(controls));
  if (!controls.every(c => c.ok)) throw new Error('Control signal got the wrong verdict; results would not be trustworthy.');
  const ids = await page.evaluate(() => window.flashQA.m.PRESETS.filter(p => p.kind === 'scope').map(p => p.id));
  const extra = process.argv[3] === 'extra';
  const runs = extra ? [
    { id: null, label: 'plain-oscilloscope (default layer)', overrides: {} },
    // Every Ember look at the fastest phrase setting, with the deepest pulse.
    ...ids.filter(id => id.startsWith('ember-') && id !== 'ember-ring').flatMap(id => [
      { id, label: `${id} @ 16 phrases (384 BPM)`, overrides: { emberPhrases: 16 } },
      { id, label: `${id} @ 16 phrases, pulse depth 1`, overrides: { emberPhrases: 16, emberPulse: 1 } },
    ]),
    // Grid sensitivity: the worst default look on a grid three times finer.
    { id: 'ember-acid', label: 'ember-acid, 2 px grid', overrides: {}, block: 2 },
    { id: 'ember-acid', label: 'ember-acid @ 16 phrases, 2 px grid', overrides: { emberPhrases: 16 }, block: 2 },
  ] : ids.map(id => ({ id, label: id, overrides: {} }));
  // The Phrases control speeds up Ember's authored pulse, so its upper range is tested too.
  if (!extra) {
    for (const phrases of [8, 16]) runs.push({ id: 'ember-pulse', label: `ember-pulse @ ${phrases} phrases (${phrases * 24} BPM)`, overrides: { emberPhrases: phrases } });
    runs.push({ id: 'ember-pulse', label: 'ember-pulse @ 16 phrases, pulse depth 1', overrides: { emberPhrases: 16, emberPulse: 1 } });
  }

  const results = [];
  for (const run of runs) {
    const began = Date.now();
    const result = await page.evaluate(async ({ id, overrides, block = 6 }) => {
      const { m, renderer, decode } = window.flashQA;
      const W = 1920, H = 1080, cols = W / block, rows = H / block, cells = cols * rows, rate = 60, loop = 10;
      const project = m.createProject();
      const layer = id ? m.applyPreset(m.createLayer('scope'), id) : m.createLayer('scope');
      Object.assign(layer.params, overrides); layer.id = 'flash-proof';
      project.layers = [layer]; project.background = '#000000'; project.duration = loop;
      await renderer.prepare(project);
      const gl = renderer.renderer.getContext(), pixels = new Uint8Array(W * H * 4);
      const r = new Float32Array(cells), g = new Float32Array(cells), b = new Float32Array(cells);
      const analyzer = new m.FlashAnalyzer(cells, rate);
      // One extra second so flashes across the loop point are counted.
      for (let f = 0; f < rate * (loop + 1); f++) {
        renderer.render(project, Math.PI * 2 * (f % (rate * loop)) / (rate * loop), W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        r.fill(0); g.fill(0); b.fill(0);
        for (let y = 0, p = 0; y < H; y++) {
          const row = (y / block | 0) * cols;
          for (let x = 0; x < W; x++, p += 4) {
            const c = row + (x / block | 0);
            r[c] += decode[pixels[p]]; g[c] += decode[pixels[p + 1]]; b[c] += decode[pixels[p + 2]];
          }
        }
        const scale = 1 / (block * block);
        for (let i = 0; i < cells; i++) { r[i] *= scale; g[i] *= scale; b[i] *= scale; }
        analyzer.push(r, g, b);
        if (f % 30 === 0) await new Promise(done => setTimeout(done));
      }
      return { glError: gl.getError(), ...analyzer.result() };
    }, run);
    results.push({ label: run.label, id: run.id, overrides: run.overrides, gridPx: run.block ?? 6, ...result });
    console.log(run.label, `${((Date.now() - began) / 1000).toFixed(0)}s`, JSON.stringify({ g200: result.general['200nit'].maxAreaOverLimitPct, g1000: result.general['1000nit'].maxAreaOverLimitPct, g1500: result.general['1500nit'].maxAreaOverLimitPct, red: result.red.maxAreaOverLimitPct }));
  }
  await fs.writeFile(path.join(here, extra ? 'flash_results_extra.json' : 'flash_results.json'), JSON.stringify({
    commit: 'cd4830c', render: '1920x1080 at 60 fps, full 10 s loop plus 1 s wrap, no sound input', grid: '320x180 cells (6x6 px, averaged in linear light)',
    method: 'Engineering screen modelled on ITU-R BT.1702-3; not a certified analyser', controls, errors, results }, null, 1));
} finally { await app.close(); }
