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
        const { canvas, renderer } = window.live.current, copy = new OffscreenCanvas(canvas.width, canvas.height); renderer.frame(0); copy.getContext('2d').drawImage(canvas, 0, 0);
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

  if (performanceRun) {
    // Real display frames, Paint at defaults, 1920 × 1080, the synthetic source. Not a substitute for a real camera and projector.
    const measure = (seconds, relay) => page.evaluate(async ([seconds, relay]) => {
      const { source, renderer, canvas } = window.live.make(s => { s.quality = 1080; });
      let last = performance.now(), sent = 0, busy = false, running = true; const gaps = [];
      const small = new OffscreenCanvas(480, 270), context = small.getContext('2d');
      renderer.start();
      const tick = now => { if (!running) return; gaps.push(now - last); source.advance((now - last) / 1000); last = now;
        if (relay && !busy && now - sent >= 100) { sent = now; busy = true; context.drawImage(canvas, 0, 0, 480, 270); small.convertToBlob({ type: 'image/jpeg', quality: .7 }).then(b => b.arrayBuffer()).finally(() => { busy = false; }); }
        requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 2000)); gaps.length = 0; renderer.stats();
      await new Promise(r => setTimeout(r, seconds * 1000)); running = false;
      const stats = renderer.stats(); renderer.stop(); renderer.frame(0); const painted = window.live.painted(0).fraction; gaps.sort((a, b) => a - b);
      return { seconds, relay, fps: stats.fps, worstMs: stats.worstMs, medianMs: gaps[gaps.length >> 1], p99Ms: gaps[Math.floor(gaps.length * .99)], over25ms: gaps.filter(g => g > 25).length, frames: stats.frames, painted };
    }, [seconds, relay]);
    const runs = [await measure(120, false), await measure(60, true)];
    await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(runs, null, 2));
    console.log(JSON.stringify(runs, null, 2));
    await app.close();
    process.exit(0);
  }
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
  // --- Movement tracking ---
  // Mean of the flow field over rows [bottom, top) and columns [left, right), as uv fractions from the bottom-left.
  await page.evaluate(() => {
    window.live.flow = (bottom = 0, top = 1, left = 0, right = 1) => {
      const { data, width, height } = window.live.current.renderer.readFlow(); let r = 0, b = 0, max = 0, n = 0;
      for (let y = Math.floor(bottom * height); y < Math.floor(top * height); y++) for (let x = Math.floor(left * width); x < Math.floor(right * width); x++) {
        const i = (y * width + x) * 4; r += data[i]; b += data[i + 2]; if (data[i + 2] > max) max = data[i + 2]; n++;
      }
      return { r: r / n, strength: b / n, max };
    };
  });
  await check('tracking: movement is found where the discs move', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(30); return { upper: window.live.flow(.6, .8), lower: window.live.flow(.2, .4), edge: window.live.flow(.94, 1) }; });
    assert.ok(r.upper.max > .5 && r.lower.max > .5, `peak strength ${r.upper.max}, ${r.lower.max}`);
    assert.ok(r.upper.strength > .03 && r.lower.strength > .03, `mean strength ${r.upper.strength}, ${r.lower.strength}`);
    assert.ok(r.edge.max < .01, `strength ${r.edge.max} where nothing moves`);
  });
  await check('tracking: still input settles to nothing', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(30); window.live.current.source.moving = false; window.live.run(60); return window.live.flow(); });
    assert.ok(r.strength < .005 && r.max < .02, `strength ${r.strength}, peak ${r.max}`);
  });
  await check('tracking: outside the box is exactly zero', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.box.right = .5; }); window.live.run(30); return { out: window.live.flow(0, 1, .5, 1), inside: window.live.flow(0, 1, 0, .5) }; });
    assert.equal(r.out.max, 0); assert.ok(r.inside.max > .3, `inside peak ${r.inside.max}`);
  });
  await check('tracking: direction follows the movement and flips with mirror', async () => {
    const r = await page.evaluate(() => {
      const run = mirror => { window.live.make(s => { s.mirror = mirror; }); window.live.run(30); return { upper: window.live.flow(.6, .8).r, lower: window.live.flow(.2, .4).r, discs: window.live.current.source.discs() }; };
      return { plain: run(false), mirrored: run(true) };
    });
    assert.ok(r.plain.discs[0].vx > .2 && r.plain.discs[1].vx < -.2, 'test source is not moving as expected');
    assert.ok(r.plain.upper > 0 && r.plain.lower < 0, `plain ${r.plain.upper}, ${r.plain.lower}`);
    assert.ok(r.mirrored.upper < 0 && r.mirrored.lower > 0, `mirrored ${r.mirrored.upper}, ${r.mirrored.lower}`);
  });
  await check('tracking: a camera that goes away leaves no movement behind', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(30); const { source } = window.live.current; source.advance = () => {}; Object.defineProperty(source, 'element', { value: null }); window.live.run(2); return window.live.flow(); });
    assert.equal(r.max, 0);
  });
  await check('tracking view shows the camera', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.current.renderer.view = 'tracking'; window.live.run(30); return window.live.painted(0, 40); });
    assert.ok(r.fraction > .02, `only ${r.fraction} lit`);
    await save('tracking', await page.evaluate(() => window.live.png()));
  });
  // --- Paint ---
  // Rows are fractions from the top. The discs sweep along rows .3 and .7; the outer strips are never crossed.
  await check('paint: movement lays paint where it happens', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(180); return { all: window.live.painted(0), upper: window.live.painted(0, 8, .15, .45), lower: window.live.painted(0, 8, .55, .85), top: window.live.painted(0, 8, 0, .05), bottom: window.live.painted(0, 8, .95, 1) }; });
    assert.ok(r.all.fraction > .03, `only ${r.all.fraction} painted`);
    assert.ok(r.upper.fraction > .05 && r.lower.fraction > .05, `bands ${r.upper.fraction}, ${r.lower.fraction}`);
    assert.ok(r.top.fraction < .01 && r.bottom.fraction < .01, `strips ${r.top.fraction}, ${r.bottom.fraction}`);
    await save('paint', await page.evaluate(() => window.live.png()));
  });
  await check('paint: several colours are laid down', async () => {
    const hues = await page.evaluate(() => { window.live.make(s => { s.paint.colourChange = 1; }); window.live.run(360); const { data } = window.live.pixels(), seen = new Set();
      for (let i = 0; i < data.length; i += 4) { const r = data[i], g = data[i + 1], b = data[i + 2], max = Math.max(r, g, b), min = Math.min(r, g, b); if (max < 120 || max - min < 60) continue;
        const h = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4; seen.add(Math.floor(h * 2)); }
      return seen.size; });
    assert.ok(hues >= 3, `${hues} hue families`);
  });
  await check('paint: still input fades back to the ground', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.paint.fadeSeconds = 2; }); window.live.run(120); const before = window.live.painted(0).fraction; window.live.current.source.moving = false; window.live.run(300); return { before, after: window.live.painted(0, 0) }; });
    assert.ok(r.before > .02, `nothing painted first (${r.before})`); assert.ok(r.after.max <= 5, `left ${r.after.max}/255`);
  });
  await check('paint: clear returns exactly the ground', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(120); const { renderer, source } = window.live.current; source.moving = false; window.live.run(40); renderer.clear(); renderer.frame(0); return window.live.painted(0, 0); });
    assert.equal(r.max, 0);
  });
  await check('paint: white ground', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.paint.ground = 1; }); window.live.run(120); return { corner: window.live.painted(255, 0, 0, .04), all: window.live.painted(255) }; });
    assert.equal(r.corner.max, 0); assert.ok(r.all.fraction > .02, `only ${r.all.fraction} painted`);
  });
  await check('paint: a long stall does not fling or wipe the picture', async () => {
    const r = await page.evaluate(() => { window.live.make(); window.live.run(120); const before = window.live.painted(0); window.live.current.renderer.frame(5); window.live.current.renderer.frame(NaN);
      return { before, after: window.live.painted(0), top: window.live.painted(0, 8, 0, .05) }; });
    assert.ok(Math.abs(r.after.fraction - r.before.fraction) < .02, `${r.before.fraction} -> ${r.after.fraction}`); assert.ok(r.top.fraction < .01);
  });
  await check('paint: the camera image never reaches the artwork', async () => {
    const r = await page.evaluate(() => { window.live.make(s => { s.paint.response = 0; }); window.live.run(120); return window.live.painted(0, 0); });
    assert.equal(r.max, 0);
  });
  /* STAGES */
  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await app.close();
}
console.log(results.join('\n'));
