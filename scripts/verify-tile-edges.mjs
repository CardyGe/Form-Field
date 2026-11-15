// Real Electron/WebGL checks for Tile edges.
// Run: node scripts/verify-tile-edges.mjs [--baseline=<checkout of an older commit>]
// Every pilot look is rendered with tile edges on and must meet itself cleanly left/right and top/bottom.
// With --baseline, the same looks with tile edges absent are also compared pixel for pixel against that checkout.
// Writes PNGs and a 2×2 montage of each tiled render to work/tile-edges/ for review by eye.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.find(a => a.startsWith('--baseline='))?.slice(11);
const out = path.join(root, 'work/tile-edges');
await fs.mkdir(out, { recursive: true });
const bundle = (dir, file) => build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer} from './src/core/project';`, resolveDir: dir, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, file), nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent' });
await bundle(root, 'renderer.js');
if (baseline) await bundle(path.resolve(baseline), 'baseline.js');
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="a" width="960" height="540"></canvas><canvas id="b" width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);

// The pilot: Chromatic Field styles that tile, at their default look, plus Flow with the settings most likely to break a seam.
const LOOKS = {
  'bands-flow': { style: 0, variant: 0 },
  'bands-braids': { style: 0, variant: 1 },
  'bands-ribbons': { style: 0, variant: 2 },
  'drips-beads': { style: 2, variant: 1 },
  'drips-strands': { style: 2, variant: 2 },
  'flow-scale-0.5': { style: 0, variant: 0, scale: .5 },
  'flow-direction-90': { style: 0, variant: 0, rotation: Math.PI / 2 },
  'flow-glow-outlines': { style: 0, variant: 0, glowMix: .8, toonMix: 1, toonOutline: 2 },
};
const SIZES = [[960, 540, 1], [1080, 1080, 1], [1080, 1920, 2]];
const PHASES = [0, 2.1];

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = { tiled: {}, untiledGuard: {}, againstBaseline: {}, captures: [], errors };
const save = async (name, base64) => {
  const file = path.join(out, `${name}.png`);
  await fs.writeFile(file, Buffer.from(base64, 'base64'));
  report.captures.push(path.relative(root, file));
};
try {
  await page.evaluate(async hasBaseline => {
    const m = await import('./renderer.js');
    const old = hasBaseline ? await import('./baseline.js') : null;
    const renderer = new m.StudioRenderer(document.querySelector('#a'));
    const before = old ? new old.StudioRenderer(document.querySelector('#b')) : null;
    const project = (mod, params, tileEdges) => {
      const p = mod.createProject(), l = mod.createLayer('surface');
      Object.assign(l.params, params); l.id = 'tile-proof'; p.layers = [l]; p.background = '#000000';
      if (tileEdges !== undefined) p.tileEdges = tileEdges;
      return p;
    };
    const bitmapOf = bytes => createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const pixelsOf = bitmap => {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const base64 = async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
    // Port of measureEdges in electron/seam-check.cjs, on 8-bit pixels / 255.
    const FLOOR = 1 / 255, JUMP_LIMIT = 1.5, SIDE = 6;
    const ratio = (seam, typical, floor) => seam <= floor ? Math.min(1, seam / Math.max(typical, 1e-9)) : seam / Math.max(typical, floor / 4);
    const line = (px, w, h, a, b, rows) => {
      let sum = 0; const count = rows ? w : h;
      for (let i = 0; i < count; i++) {
        const p = rows ? (a * w + i) * 4 : (i * w + a) * 4, q = rows ? (b * w + i) * 4 : (i * w + b) * 4;
        for (let c = 0; c < 3; c++) sum += Math.abs(px[p + c] - px[q + c]);
      }
      return sum / (count * 3) / 255;
    };
    const edge = (px, w, h, rows) => {
      const size = rows ? h : w, side = Math.min(SIDE, size - 1), steps = [];
      for (let k = 0; k < side; k++) steps.push(line(px, w, h, k, k + 1, rows));
      for (let k = size - 1 - side; k < size - 1; k++) steps.push(line(px, w, h, k, k + 1, rows));
      const seam = line(px, w, h, size - 1, 0, rows), typical = Math.max(0, ...steps), r = ratio(seam, typical, FLOOR);
      return { seam, typical, ratio: r, visible: seam > FLOOR && r > JUMP_LIMIT };
    };
    const measureEdges = (px, w, h) => { const horizontal = edge(px, w, h, false), vertical = edge(px, w, h, true); return { status: horizontal.visible || vertical.visible ? 'seam' : 'clean', horizontal, vertical }; };
    // Mean distance from the average colour, in 8-bit steps: a flat frame passes the edge check trivially.
    const spread = px => { const mean = [0, 0, 0], n = px.length / 4; for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += px[i + c] / n;
      let sum = 0; for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(px[i + c] - mean[c]); return sum / (n * 3); };
    const difference = (a, b) => { let sum = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; } return { mean: sum / a.length, max }; };
    const shot = async (r, mod, params, tileEdges, phase, w, h, ss) => { const p = project(mod, params, tileEdges); await r.prepare(p); return r.exportPNG(p, phase, w, h, ss); };
    window.tileQA = {
      // Renders one look and measures its edges; optionally returns the PNG and a 2×2 montage.
      async render(params, tileEdges, phase, w, h, ss, keep) {
        const bytes = await shot(renderer, m, params, tileEdges, phase, w, h, ss), bitmap = await bitmapOf(bytes);
        const px = pixelsOf(bitmap), result = { edges: { ...measureEdges(px, w, h), spread: spread(px) } };
        if (keep) {
          result.png = await base64(new Blob([bytes]));
          if (tileEdges) {
            const canvas = new OffscreenCanvas(w * 2, h * 2), context = canvas.getContext('2d');
            for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) context.drawImage(bitmap, x, y);
            result.montage = await base64(await canvas.convertToBlob({ type: 'image/png' }));
          }
        }
        return result;
      },
      // Mean and largest 8-bit difference between tiled and untiled, as a sense of how far the look moved.
      async moved(params, phase, w, h, ss) {
        return difference(pixelsOf(await bitmapOf(await shot(renderer, m, params, true, phase, w, h, ss))), pixelsOf(await bitmapOf(await shot(renderer, m, params, undefined, phase, w, h, ss))));
      },
      async againstBaseline(params, phase, w, h, ss) {
        const now = pixelsOf(await bitmapOf(await shot(renderer, m, params, undefined, phase, w, h, ss)));
        const then = pixelsOf(await bitmapOf(await shot(before, old, params, undefined, phase, w, h, ss)));
        return difference(now, then);
      },
    };
  }, !!baseline);

  for (const [look, params] of Object.entries(LOOKS)) for (const [w, h, ss] of SIZES) {
    const size = `${w}x${h}${ss > 1 ? `-ss${ss}` : ''}`;
    for (const phase of PHASES) {
      const tiled = await page.evaluate(a => window.tileQA.render(...a), [params, true, phase, w, h, ss, true]);
      await save(`${look}-${size}-phase${phase}-tiled`, tiled.png);
      await save(`${look}-${size}-phase${phase}-tiled-2x2`, tiled.montage);
      if (phase === PHASES[0]) await save(`${look}-${size}-phase${phase}-untiled`, (await page.evaluate(a => window.tileQA.render(...a), [params, undefined, phase, w, h, ss, true])).png);
      report.tiled[`${look} ${size} phase ${phase}`] = { ...tiled.edges, moved: await page.evaluate(a => window.tileQA.moved(...a), [params, phase, w, h, ss]) };
    }
  }
  for (const [w, h, ss] of SIZES)
    report.untiledGuard[`bands-flow ${w}x${h}`] = (await page.evaluate(a => window.tileQA.render(...a), [LOOKS['bands-flow'], false, PHASES[0], w, h, ss, false])).edges;
  if (baseline)
    for (const [look, params] of Object.entries(LOOKS)) for (const [w, h, ss] of SIZES) for (const phase of PHASES)
      report.againstBaseline[`${look} ${w}x${h} phase ${phase}`] = await page.evaluate(a => window.tileQA.againstBaseline(...a), [params, phase, w, h, ss]);

  const ratios = e => `left/right ${e.horizontal.ratio.toFixed(2)}× (seam ${(e.horizontal.seam * 255).toFixed(2)}), top/bottom ${e.vertical.ratio.toFixed(2)}× (seam ${(e.vertical.seam * 255).toFixed(2)})`;
  for (const [name, e] of Object.entries(report.tiled)) console.log(`${e.status === 'clean' ? 'clean' : 'SEAM '}  ${name}: ${ratios(e)}; spread ${e.spread.toFixed(1)}; tiled vs untiled mean ${e.moved.mean.toFixed(2)}`);
  for (const [name, e] of Object.entries(report.untiledGuard)) console.log(`guard  ${name} untiled: ${e.status}, ${ratios(e)}`);
  for (const [name, d] of Object.entries(report.againstBaseline)) console.log(`${d.max === 0 ? 'same ' : 'DIFF '}  ${name} against baseline: mean ${d.mean.toFixed(4)}, max ${d.max}`);
  for (const [name, e] of Object.entries(report.tiled)) assert.equal(e.status, 'clean', `${name}: visible tile seam, ${ratios(e)}.`);
  for (const [name, e] of Object.entries(report.tiled)) assert.ok(e.spread > 4, `${name}: the tiled render is a flat colour (spread ${e.spread.toFixed(2)} of 255), so its clean edges prove nothing.`);
  for (const [name, e] of Object.entries(report.untiledGuard)) assert.equal(e.status, 'seam', `${name}: the edge check does not see the seam of an untiled render.`);
  for (const [name, d] of Object.entries(report.againstBaseline)) assert.equal(d.max, 0, `${name}: tile edges absent changed the picture against the baseline.`);
  assert.deepEqual(errors, []);
  console.log(`${Object.keys(report.tiled).length} tiled renders clean; ${report.captures.length} PNGs in ${path.relative(root, out)}.`);
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app.close();
}
