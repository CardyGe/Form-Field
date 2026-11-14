// Real Electron/WebGL checks for the Liquid Light instrument. --quick captures art only.
// Run: node scripts/verify-liquid.mjs [--quick]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const out = path.join(root, 'work/liquid-build', quick ? 'art' : 'verification');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = { captures: [], checks: [], timings: [], errors };
const TAU = Math.PI * 2;
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('canvas'));
    const projectFor = id => { const p = m.createProject(); p.layers = [m.applyPreset(m.createLayer('liquid'), id)]; p.layers[0].id = 'liquid-proof'; p.background = '#000000'; return p; };
    const pixels = async bytes => {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    window.liquidQA = { m, renderer, projectFor, pixels };
  });
  const ids = await page.evaluate(() => window.liquidQA.m.PRESETS.filter(p => p.kind === 'liquid').map(p => p.id));
  assert.ok(ids.length >= 1, 'No liquid presets.');
  for (const id of ids) {
    // Three phase stills in 16:9 and one square, the shape of the reference recording.
    for (const [name, phase, width, height] of [['a', .3, 1920, 1080], ['b', .3 + TAU / 3, 1920, 1080], ['c', .3 + 2 * TAU / 3, 1920, 1080], ['square', .3, 1080, 1080]]) {
      const bytes = await page.evaluate(async ([id, phase, width, height]) => {
        const { renderer, projectFor } = window.liquidQA, project = projectFor(id);
        await renderer.prepare(project);
        return Array.from(await renderer.exportPNG(project, phase, width, height));
      }, [id, phase, width, height]);
      const file = path.join(out, `${id}-${name}.png`);
      await fs.writeFile(file, Buffer.from(bytes));
      report.captures.push(path.relative(root, file));
    }
    if (quick) continue;
    const result = await page.evaluate(async ([id, TAU]) => {
      const { renderer, projectFor, pixels } = window.liquidQA, project = projectFor(id);
      await renderer.prepare(project);
      const at = async phase => pixels(await renderer.exportPNG(project, phase, 640, 360));
      const start = await at(0), end = await at(TAU), third = await at(TAU / 3), twoThirds = await at(2 * TAU / 3), again = await at(0);
      const difference = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
      let lit = 0;
      for (let i = 0; i < start.length; i += 4) if (start[i] + start[i + 1] + start[i + 2] > 60) lit++;
      // Frame time at 1080p. readPixels forces the GPU to finish each frame.
      const gl = renderer.renderer.getContext(), pixel = new Uint8Array(4), frames = 40;
      renderer.render(project, 0, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const began = performance.now();
      for (let i = 0; i < frames; i++) { renderer.render(project, i * .05, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); }
      const frameMs = (performance.now() - began) / frames;
      // The same with time displacement on: the preview draws twelve slices a frame.
      project.layers[0].params.slitShift = .6;
      renderer.render(project, 0, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const slicedBegan = performance.now();
      for (let i = 0; i < 20; i++) { renderer.render(project, i * .02, 1920, 1080); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); }
      const slicedMs = (performance.now() - slicedBegan) / 20;
      return { slicedMs, wrap: difference(start, end), seek: difference(start, again), move: Math.min(difference(start, third), difference(third, twoThirds), difference(twoThirds, start)),
        coverage: lit / (start.length / 4), frameMs };
    }, [id, TAU]);
    report.checks.push({ id, ...result });
    assert.equal(result.wrap, 0, `${id}: the loop does not close (difference ${result.wrap}).`);
    assert.equal(result.seek, 0, `${id}: seeking back gives a different frame.`);
    assert.ok(result.move > 4, `${id}: phase stills are too alike (${result.move.toFixed(2)}).`);
    assert.ok(result.coverage >= .6, `${id}: covers ${(result.coverage * 100).toFixed(0)}% of the frame, under 60%.`);
    assert.ok(result.frameMs < 16.7, `${id}: ${result.frameMs.toFixed(1)} ms per 1080p frame.`);
    assert.ok(result.slicedMs < 40, `${id}: ${result.slicedMs.toFixed(1)} ms per 1080p frame with time displacement.`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app.close();
}
