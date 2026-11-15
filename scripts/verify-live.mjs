// Real Electron/WebGL checks for Live mode.
// Run: node scripts/verify-live.mjs [--performance]
// Drives LiveRenderer frame by frame with the synthetic TestSource and reads the canvas back.
// Writes work/live/*.png for review by eye.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const performanceRun = process.argv.includes('--performance');
const out = path.join(root, 'work/live');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {LiveRenderer} from './src/live/LiveRenderer';
export {TestSource} from './src/live/test-source';
export {defaultLiveSettings} from './src/live/settings';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'live.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="a" style="width:100vw;height:100vh;display:block"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:${performanceRun},width:1920,height:1080,useContentSize:true,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const results = [];
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};
const save = async (name, base64) => fs.writeFile(path.join(out, `${name}.png`), Buffer.from(base64, 'base64'));

try {
  // In-page helpers. live.make() builds a fresh renderer on a fresh canvas with a TestSource.
  await page.evaluate(async () => {
    const m = await import('./live.js');
    const STEP = 1 / 60;
    window.live = {
      m, STEP,
      make(change) {
        window.live.current?.renderer.dispose();
        const old = document.querySelector('#a'), canvas = old.cloneNode(); old.replaceWith(canvas);
        const source = new m.TestSource(), renderer = new m.LiveRenderer(canvas, source);
        const settings = m.defaultLiveSettings(); settings.quality = 720; change?.(settings); renderer.settings = settings;
        return window.live.current = { source, renderer, canvas };
      },
      run(frames) { const { source, renderer } = window.live.current; for (let i = 0; i < frames; i++) { source.advance(STEP); renderer.frame(STEP); } },
      // The canvas as 8-bit RGBA, row 0 at the top. Must be called in the same task as the last frame.
      pixels() {
        const { canvas } = window.live.current, copy = new OffscreenCanvas(canvas.width, canvas.height), context = copy.getContext('2d', { willReadFrequently: true });
        context.drawImage(canvas, 0, 0);
        return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
      },
      async png() {
        const { canvas } = window.live.current, copy = new OffscreenCanvas(canvas.width, canvas.height); copy.getContext('2d').drawImage(canvas, 0, 0);
        const bytes = new Uint8Array(await (await copy.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s);
      },
      // Fraction of pixels whose colour differs from `ground` (0 or 255) by more than `tolerance` in any channel,
      // inside the band of rows [top, bottom) given as fractions of the height from the top.
      painted(ground, tolerance = 8, top = 0, bottom = 1) {
        const { data, width, height } = window.live.pixels(); let count = 0, total = 0, sx = 0, sy = 0, max = 0;
        for (let y = Math.floor(top * height); y < Math.floor(bottom * height); y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4, d = Math.max(Math.abs(data[i] - ground), Math.abs(data[i + 1] - ground), Math.abs(data[i + 2] - ground));
          total++; if (d > max) max = d; if (d > tolerance) { count++; sx += x / width; sy += y / height; }
        }
        return { fraction: count / total, x: count ? sx / count : 0, y: count ? sy / count : 0, max };
      },
    };
  });

  await check('bare pipeline: the picture is not uniform', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.current.renderer.view = 'tracking'; window.live.run(30); const p = window.live.painted(0); return { p, frames: window.live.current.renderer.stats().frames }; });
    assert.ok(r.p.fraction > .01, `only ${r.p.fraction} of pixels lit`); assert.ok(r.frames >= 30, `${r.frames} frames`);
  });
  await check('blackout is pure black', async () => {
    const r = await page.evaluate(() => { window.live.make(); const { renderer } = window.live.current; renderer.view = 'tracking'; renderer.blackout = true; window.live.run(5); return window.live.painted(0, 0); });
    assert.equal(r.max, 0);
  });
  await check('artwork size follows quality', async () => {
    const r = await page.evaluate(() => { const { canvas } = window.live.make(s => { s.quality = 1080; }); window.live.run(1); return [canvas.width, canvas.height]; });
    assert.deepEqual(r, [1920, 1080]);
  });
  /* STAGES */
  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await app.close();
}
console.log(results.join('\n'));
