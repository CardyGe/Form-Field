// Real Electron/WebGL checks for the Morphogen engine.
// Run: npm run test:morphogen. Writes work/morphogen/*.png for review by eye.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/morphogen');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {MorphSolver} from './src/morphogen/solver';
export {defaultMorphParams} from './src/morphogen/params';
export {Passes} from './src/live/passes';
export * as THREE from 'three';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'morphogen.js'), logLevel: 'error' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="a" width="1920" height="1080" style="width:100vw;height:100vh;display:block"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1920,height:1080,useContentSize:true,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [], results = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};

try {
  await page.evaluate(async () => {
    const m = await import('./morphogen.js');
    const renderer = new m.THREE.WebGLRenderer({ canvas: document.querySelector('#a'), antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputColorSpace = m.THREE.LinearSRGBColorSpace; renderer.toneMapping = m.THREE.NoToneMapping; renderer.autoClear = false;
    const passes = new m.Passes(renderer);
    window.t = { m, renderer, passes };
    window.t.field = (solver, width, height) => {
      const data = new Float32Array(width * height * 4);
      renderer.readRenderTargetPixels(solver.target, 0, 0, width, height, data);
      const u = new Float32Array(width * height);
      for (let i = 0; i < u.length; i++) u[i] = data[i * 4];
      return u;
    };
  });

  await check('radial flow grows aligned stripes that fork to keep their spacing', async () => {
    const r = await page.evaluate(() => {
      const { m, passes, field } = window.t, W = 1024, H = 576;
      const solver = new m.MorphSolver(passes, W, H), params = { ...m.defaultMorphParams(), fieldType: 0, fieldMix: 0, curlAmount: 0, breathing: 0, travel: 0, fieldDrift: 0, formType: 0 };
      const input = { flow: null, people: null, impulse: 0, seedBurst: 0 };
      for (let i = 0; i < 2400; i++) solver.step(1 / 60, i / 60, params, input);
      const u = field(solver, W, H);
      solver.dispose();
      let finite = true, sum = 0, square = 0;
      for (const v of u) { if (!Number.isFinite(v)) finite = false; sum += v; square += v * v; }
      const variance = square / u.length - (sum / u.length) ** 2, at = (x, y) => u[Math.round(y) * W + Math.round(x)];
      const crossings = radius => { let n = 0, samples = Math.ceil(2 * Math.PI * radius * 4), last = 0; for (let i = 0; i <= samples; i++) { const a = i / samples * 2 * Math.PI, s = Math.sign(at(W / 2 + radius * Math.cos(a), H / 2 + radius * Math.sin(a))); if (last && s && s !== last) n++; if (s) last = s; } return n; };
      const inner = crossings(70), outer = crossings(250);
      let along = 0, total = 0;
      for (let y = 20; y < H - 20; y += 3) for (let x = 20; x < W - 20; x += 3) {
        const dx = x - W / 2, dy = y - H / 2, d = Math.hypot(dx, dy); if (d < 40) continue;
        const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1), g = Math.hypot(gx, gy); if (g < .05) continue;
        along += Math.abs(gx * dx + gy * dy) / (g * d); total++;
      }
      return { finite, variance, inner, outer, alignment: along / total, spacing: 2 * Math.PI * 250 / outer * 2 };
    });
    console.log('radial', JSON.stringify(r));
    assert.ok(r.finite, 'values are not finite');
    assert.ok(r.variance > .05, `variance ${r.variance}`);
    // A fan stretches stripes until the next fork relieves them, so its average runs wider than the unstretched width.
    assert.ok(r.spacing >= 12 * .8 && r.spacing <= 12 * 1.5, `spacing ${r.spacing}`);
    assert.ok(r.alignment < .5, `stripes are not aligned: ${r.alignment}`);
    assert.ok(r.outer > r.inner * 2, `stripes did not multiply outward: ${r.inner} to ${r.outer}`);
  });
  await check('straight flow holds the requested stripe width', async () => {
    const spacing = await page.evaluate(() => {
      const { m, passes, field } = window.t, W = 1024, H = 576;
      const solver = new m.MorphSolver(passes, W, H), params = { ...m.defaultMorphParams(), fieldType: 3, fieldMix: 0, curlAmount: 0, breathing: 0, travel: 0, fieldDrift: 0, formType: 0 };
      for (let i = 0; i < 2400; i++) solver.step(1 / 60, i / 60, params, { flow: null, people: null, impulse: 0, seedBurst: 0 });
      const u = field(solver, W, H); solver.dispose();
      let crossings = 0, rows = 0;
      for (let y = 40; y < H - 40; y += 8) { rows++; for (let x = 21; x < W - 20; x++) if (Math.sign(u[y * W + x]) !== Math.sign(u[y * W + x - 1])) crossings++; }
      return 2 * (W - 41) * rows / crossings;
    });
    console.log('straight spacing', spacing.toFixed(2));
    assert.ok(Math.abs(spacing - 12) <= 12 * .2, `spacing ${spacing}`);
  });
  /* STAGES */
  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await app.close();
}
console.log(results.join('\n'));
