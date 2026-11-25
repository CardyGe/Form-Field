// Real GPU checks for Ember's fluid smoke.
// Run: node scripts/verify-ember-smoke.mjs [--range] [--perf] [--export] [--sheet]  (no flag runs all)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2), want = name => !flags.length || flags.includes(`--${name}`);
const out = path.join(root, 'work/ember-smoke');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';export {Fluid} from './src/live/fluid';export {createProject,createLayer,applyPreset,PRESETS,EMBER_PALETTES} from './src/core/project';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out, 'profile'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
page.setDefaultTimeout(0);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const savePng = async (name, base64) => fs.writeFile(path.join(out, name), Buffer.from(base64, 'base64'));
let code = 0;
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('canvas'));
    const W = 960, H = 540, TAU = Math.PI * 2;
    const projectFor = (over = {}, id = 'ember-pulse') => { const p = m.createProject(); const l = m.applyPreset(m.createLayer('scope'), id); Object.assign(l.params, over); l.id = 'ember-check'; p.layers = [l]; p.background = '#000000'; return p; };
    const shot = async (over, phase, id, w = W, h = H) => {
      const p = projectFor(over, id); await renderer.prepare(p);
      const bytes = await renderer.exportPNG(p, phase, w, h);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bitmap, 0, 0);
      return { bitmap, bytes, data: g.getImageData(0, 0, w, h).data };
    };
    const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if ((Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3 > 12) n++; return n / (a.length / 4) * 100; };
    const meanDifference = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return s / (a.length / 4); };
    const black = a => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] + a[i + 1] + a[i + 2] === 0) n++; return n / (a.length / 4) * 100; };
    const toBase64 = async canvas => { const b = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); };
    const sheet = async (cells, columns) => {
      const cw = 320, ch = 180, rows = Math.ceil(cells.length / columns), c = new OffscreenCanvas(columns * cw, rows * (ch + 24)), g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.font = '15px sans-serif';
      for (let i = 0; i < cells.length; i++) { const x = (i % columns) * cw, y = Math.floor(i / columns) * (ch + 24); g.drawImage((await shot(cells[i].over, cells[i].phase ?? .55 * TAU, cells[i].id)).bitmap, x, y + 24, cw, ch); g.fillStyle = '#fff'; g.fillText(cells[i].label, x + 6, y + 17); }
      return toBase64(c);
    };
    window.ember = { m, renderer, TAU, projectFor, shot, changed, meanDifference, black, toBase64, sheet };
  });

  if (want('range')) {
    const result = await page.evaluate(async () => {
      const { shot, changed, TAU, black } = window.ember, phases = [.3, .55, .8].map(x => x * TAU);
      const controls = [['Smoke', 'emberSmoke', 0, 1], ['Spread', 'emberSmokeSpread', 0, 1], ['Curl', 'emberSmokeCurl', 0, 1], ['Lift', 'emberSmokeLift', -1, 1], ['Persistence', 'emberSmokeLife', 0, 1], ['Thickness', 'emberSmokeBody', 0, 1], ['Detail', 'emberSmokeDetail', 0, 1], ['Lighting', 'emberSmokeLight', 0, 1]];
      const rows = [];
      for (const [label, key, low, high] of controls) {
        let total = 0;
        for (const phase of phases) total += changed((await shot({ [key]: low }, phase)).data, (await shot({ [key]: high }, phase)).data) / phases.length;
        rows.push({ label, changedPct: +total.toFixed(1) });
      }
      let darkest = 0;
      for (let x = 0; x < 1; x += .05) darkest = Math.max(darkest, black((await shot({}, x * TAU)).data));
      return { rows, blackInTroughPct: +darkest.toFixed(1) };
    });
    console.table(result.rows); console.log(`true black in the darkest sampled frame: ${result.blackInTroughPct}%`);
    const weak = result.rows.filter(r => r.changedPct < 10);
    if (weak.length) { code = 1; console.error(`FAIL range: ${weak.map(r => `${r.label} ${r.changedPct}%`).join(', ')}`); } else console.log('PASS range');
    if (result.blackInTroughPct < 50) { code = 1; console.error(`FAIL black: ${result.blackInTroughPct}% in the darkest frame, needs 50%`); } else console.log('PASS black');
  }

  if (want('haze')) {
    // Thin leftover smoke must fade away, not sit on black as a flat dim sheet.
    const rows = await page.evaluate(async () => {
      const { shot, TAU } = window.ember, out = [];
      for (const [label, emberSmokeOrigin] of [['Core', 0], ['Ring', 1], ['Filaments', 2], ['Rising', 3]]) {
        let worst = 0;
        for (const x of [.3, .55, .8]) {
          const off = (await shot({ emberSmokeOrigin, emberSmoke: 0 }, x * TAU)).data, on = (await shot({ emberSmokeOrigin }, x * TAU)).data;
          let dim = 0;
          for (let i = 0; i < on.length; i += 4) { const peak = Math.max(on[i], on[i + 1], on[i + 2]); if (Math.max(off[i], off[i + 1], off[i + 2]) <= 2 && peak >= 4 && peak <= 48) dim++; }
          worst = Math.max(worst, dim / (on.length / 4) * 100);
        }
        out.push({ label, dimSheetPct: +worst.toFixed(1) });
      }
      return out;
    });
    console.table(rows);
    const hazy = rows.filter(r => r.dimSheetPct > 10);
    if (hazy.length) { code = 1; console.error(`FAIL haze: ${hazy.map(r => `${r.label} ${r.dimSheetPct}%`).join(', ')}`); } else console.log('PASS haze');
  }

  if (want('perf')) {
    const r = await page.evaluate(async () => {
      const { renderer, projectFor, TAU } = window.ember, p = projectFor(); await renderer.prepare(p);
      const gl = renderer.renderer.getContext(), px = new Uint8Array(4), times = [];
      for (let i = 0; i < 120; i++) { renderer.render(p, i / 600 * TAU, 3840, 2160); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); await new Promise(requestAnimationFrame); }
      for (let i = 120; i < 720; i++) { const t = performance.now(); renderer.render(p, (i % 600) / 600 * TAU, 3840, 2160); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(performance.now() - t); await new Promise(requestAnimationFrame); }
      times.sort((a, b) => a - b); return { median: times[300], p99: times[594], worst: times[599] };
    });
    console.log(`4K frame ms: median ${r.median.toFixed(1)}, p99 ${r.p99.toFixed(1)}, worst ${r.worst.toFixed(1)}`);
    if (r.p99 > 11.7) { code = 1; console.error('FAIL perf: p99 above 11.7 ms'); } else console.log('PASS perf');
  }

  if (flags.includes('--profile')) {
    const r = await page.evaluate(async () => {
      const { renderer, projectFor, TAU } = window.ember, gl = renderer.renderer.getContext(), px = new Uint8Array(4);
      const run = async (over, moving) => {
        const p = projectFor(over); await renderer.prepare(p); const times = [];
        for (let i = 0; i < 300; i++) { const t = performance.now(); renderer.render(p, (moving ? i : 150) / 600 * TAU, 3840, 2160, undefined, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (i > 60) times.push(performance.now() - t); await new Promise(requestAnimationFrame); }
        times.sort((a, b) => a - b); return { median: +times[times.length >> 1].toFixed(1), p99: +times[Math.floor(times.length * .99)].toFixed(1) };
      };
      const { Fluid } = window.ember.m, step = Fluid.prototype.step, inject = Fluid.prototype.inject;
      const base = await run({ emberSmoke: 0 }, true), full = await run({}, true);
      Fluid.prototype.step = function () {}; const noStep = await run({}, true); Fluid.prototype.step = step;
      Fluid.prototype.inject = function () {}; const noInject = await run({}, true); Fluid.prototype.inject = inject;
      let cpu = 0, calls = 0; Fluid.prototype.step = function (...a) { const t = performance.now(); step.apply(this, a); cpu += performance.now() - t; calls++; }; await run({}, true); Fluid.prototype.step = step;
      return { base, full, noStep, noInject, stepCpuMs: +(cpu / calls).toFixed(2) };
    });
    console.log(JSON.stringify(r));
  }

  if (want('export')) {
    const r = await page.evaluate(async () => {
      const { shot, meanDifference, TAU } = window.ember;
      const a = await shot({}, 2.5 / 10 * TAU), b = await shot({}, 2.5 / 10 * TAU);
      const start = await shot({}, 0), end = await shot({}, 599 / 600 * TAU);
      const midA = await shot({}, 300 / 600 * TAU), midB = await shot({}, 301 / 600 * TAU);
      const s1 = await shot({}, .7 * TAU); await shot({}, .2 * TAU); const s2 = await shot({}, .7 * TAU);
      return { repeat: meanDifference(a.data, b.data), seam: meanDifference(start.data, end.data), step: meanDifference(midA.data, midB.data), seek: meanDifference(s1.data, s2.data) };
    });
    console.log(`export repeat ${r.repeat.toFixed(3)}, loop seam ${r.seam.toFixed(3)} (ordinary frame step ${r.step.toFixed(3)}), seek ${r.seek.toFixed(3)}`);
    if (r.repeat !== 0 || r.seek !== 0 || r.seam > Math.max(1, r.step * 2.5)) { code = 1; console.error('FAIL export'); } else console.log('PASS export');
  }

  if (flags.includes('--look')) {
    const looks = await page.evaluate(async () => {
      const { shot, toBase64, TAU } = window.ember, frame = async (x, w, h) => { const c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage((await shot({}, x * TAU, 'ember-pulse', w, h)).bitmap, 0, 0); return toBase64(c); };
      return { portrait: await frame(8.1 / 20, 720, 1280), landscape: await frame(8.1 / 20, 1600, 900), rest: await frame(8.92 / 20, 1600, 900) };
    });
    for (const [name, data] of Object.entries(looks)) await savePng(`look-${name}.png`, data);
    console.log('Looks written');
  }

  if (want('sheet')) {
    const sheets = await page.evaluate(async () => {
      const { sheet, m } = window.ember;
      const styles = ['Wisps', 'Rolling', 'Billow', 'Plume', 'Storm'].map((label, emberSmokeStyle) => ({ label, over: { emberSmokeStyle } }));
      const origins = ['Core', 'Ring', 'Filaments', 'Rising'].map((label, emberSmokeOrigin) => ({ label, over: { emberSmokeOrigin } }));
      const schemes = m.EMBER_PALETTES.map(look => ({ label: look.name, id: look.id, over: {} }));
      return { styles: await sheet(styles, 5), origins: await sheet(origins, 4), schemes: await sheet(schemes, 5) };
    });
    for (const [name, data] of Object.entries(sheets)) await savePng(`sheet-${name}.png`, data);
    console.log(`Sheets written to ${out}`);
  }
  assert.deepEqual(errors, []);
} catch (error) { code = 1; console.error(`FAIL ${error.message.split('\n')[0]}`); }
finally { await app.close(); }
process.exit(code);
