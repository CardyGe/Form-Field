// Real Electron/WebGL checks for the Colour and Time finishes.
// Run: node scripts/verify-colour-time.mjs --baseline=<checkout of the commit before them> [--only=neutral,split]
// --only takes comma-separated name prefixes. Each check prints one PASS or FAIL
// line, and any failure makes the exit code non-zero. Output goes to work/colour-time.
//
// To add a check, add an entry to CHECKS: `run` receives the helpers below and
// returns { ok, detail }. Code passed to `page.evaluate` runs in the renderer
// and reaches the page helpers through `window.ct`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = option('baseline');
const only = option('only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, 'work/colour-time');
const TAU = Math.PI * 2;
const SHAPES = ['Straight', 'Lens', 'Edges', 'Wave'];

/** Fails a check that needs the older checkout, rather than letting it pass unseen. */
const needsBaseline = () => baseline ? null : { ok: false, detail: 'needs --baseline=<checkout>' };

const CHECKS = [
  {
    name: 'neutral',
    // Every control at its default: one preset of every kind against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const result = await page.evaluate(async () => {
        const q = window.ct, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [];
        const kinds = [...new Set(q.old.PRESETS.map(p => p.kind))];
        const make = (m, kind) => {
          const preset = m.PRESETS.find(p => p.kind === kind), l = m.applyPreset(m.createLayer(kind), preset.id);
          l.id = 'neutral-proof';
          const p = m.createProject(); p.id = 'neutral-proof'; p.layers = [l]; p.background = '#000000';
          return p;
        };
        for (const kind of kinds) {
          const now = make(q.m, kind), then = make(q.old, kind);
          await q.renderer.prepare(now); await before.prepare(then);
          const a = await q.renderer.exportPNG(now, .9, 960, 540), b = await before.exportPNG(then, .9, 960, 540);
          if (!q.same(a, b)) changed.push(kind);
        }
        before.dispose();
        return { kinds: kinds.length, changed };
      });
      return { ok: result.changed.length === 0, detail: result.changed.length ? `changed: ${result.changed.join(', ')}` : `${result.kinds} kinds byte-identical` };
    },
  },
  {
    name: 'split-grey',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, px = await q.px(q.project([q.grey({ splitAmount: 12, splitSamples: 9 })]));
        let rg = 0, gb = 0;
        for (let i = 0; i < px.length; i += 4) { rg += Math.abs(px[i] - px[i + 1]); gb += Math.abs(px[i + 1] - px[i + 2]); }
        return { rg: rg / (px.length / 4), gb: gb / (px.length / 4) };
      });
      return { ok: r.rg < 1 && r.gb < 1, detail: `mean |R-G| ${r.rg.toFixed(3)}, |G-B| ${r.gb.toFixed(3)} (limit 1)` };
    },
  },
  {
    name: 'split-alpha',
    // Gated with exact highlights, which show what the pass wrote. The default soft
    // highlight curve is measured and printed too: it lifts a channel when another
    // channel of the same pixel drops, so it is not a measure of the pass alone.
    run: async ({ page }) => {
      const measure = highlights => page.evaluate(async ([shapes, highlights]) => {
        const q = window.ct, W = 960, H = 540;
        const scene = params => { const p = q.project([q.soft(params)], true); p.highlights = highlights; return p; };
        const plain = await q.px(scene({}));
        // Half the split distance at this size, plus one pixel for filtering.
        const reach = Math.ceil(32 / 1080 * H / 2) + 1;
        const area = new Uint32Array((W + 1) * (H + 1));
        let brightest = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, covered = plain[i + 3] > 0 ? 1 : 0;
          if (covered) brightest = Math.max(brightest, plain[i], plain[i + 1], plain[i + 2]);
          area[(y + 1) * (W + 1) + x + 1] = covered + area[y * (W + 1) + x + 1] + area[(y + 1) * (W + 1) + x] - area[y * (W + 1) + x];
        }
        const anyNear = (x, y) => {
          const x0 = Math.max(0, x - reach), x1 = Math.min(W, x + reach + 1), y0 = Math.max(0, y - reach), y1 = Math.min(H, y + reach + 1);
          return area[y1 * (W + 1) + x1] - area[y0 * (W + 1) + x1] - area[y1 * (W + 1) + x0] + area[y0 * (W + 1) + x0] > 0;
        };
        const rows = [];
        for (let shape = 0; shape < shapes.length; shape++) {
          const px = await q.px(scene({ splitAmount: 32, splitShape: shape, splitSamples: 9, splitThreshold: 0 }));
          let leaked = 0, over = 0, worst = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, a = px[i + 3];
            if (a > 0 && !anyNear(x, y)) leaked++;
            if (a > 0 && a < 255) { const excess = Math.max(px[i], px[i + 1], px[i + 2]) - brightest; worst = Math.max(worst, excess); if (excess > 2) over++; }
          }
          rows.push({ shape: shapes[shape], moved: q.difference(plain, px), leaked, over, worst });
        }
        return { brightest, rows };
      }, [SHAPES, highlights]);
      const exact = await measure('exact'), soft = await measure('soft');
      const bad = exact.rows.filter(r => r.moved === 0 || r.leaked || r.over);
      const text = exact.rows.map(r => `${r.shape} moved ${r.moved.toFixed(3)} leaked ${r.leaked} over ${r.over} worst +${r.worst}`).join('; ');
      const curve = soft.rows.map(r => `${r.shape} leaked ${r.leaked} worst +${r.worst}`).join(', ');
      const none = exact.rows.some(r => r.moved === 0) ? 'Split has no effect on the render. ' : '';
      return { ok: bad.length === 0 && soft.rows.every(r => r.leaked === 0), detail: `${none}exact: peak ${exact.brightest}; ${text} | soft curve (not gated on brightness): peak ${soft.brightest}; ${curve}` };
    },
  },
  {
    name: 'split-scale',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct, plain = await q.px(q.project([q.soft()], true)), rows = [];
        for (let shape = 0; shape < 4; shape++) {
          const p = () => q.project([q.soft({ splitAmount: 32, splitSamples: 9, splitShape: shape, splitThreshold: .05 })], true);
          const small = await q.px(p()), big = await q.px(p(), .9, 1920, 1080);
          const reduced = new Uint8ClampedArray(small.length);
          for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) for (let c = 0; c < 4; c++) {
            const at = (X, Y) => big[(Y * 1920 + X) * 4 + c];
            reduced[(y * 960 + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
          }
          rows.push({ difference: q.difference(small, reduced), moved: q.difference(plain, small) });
        }
        return rows;
      });
      const none = r.some(row => row.moved === 0) ? 'Split has no effect on the render. ' : '';
      const text = r.map((row, i) => `${SHAPES[i]} ${row.difference.toFixed(3)}`).join(', ');
      return { ok: r.every(row => row.moved > 0 && row.difference < 2), detail: `${none}mean difference ${text} (limit 2)` };
    },
  },
  {
    name: 'split-tile',
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.ct;
        const tiled = params => { const p = q.project([q.layer('surface', null, params)]); p.tileEdges = true; return p; };
        const plain = await q.px(tiled({})), W = 960, H = 540, rows = [];
        for (let shape = 0; shape < 4; shape++) {
          const px = await q.px(tiled({ splitAmount: 12, splitSamples: 9, splitShape: shape, splitThreshold: .02 }));
          const columns = (a, b) => { let sum = 0; for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) sum += Math.abs(px[(y * W + a) * 4 + c] - px[(y * W + b) * 4 + c]); return sum / (H * 3); };
          // Eight interior pairs, so one busy column cannot set the limit.
          let interior = 0; for (let k = 1; k <= 8; k++) { const x = Math.round(k * W / 9); interior += columns(x, x + 1); }
          rows.push({ seam: columns(W - 1, 0), interior: interior / 8, moved: q.difference(plain, px) });
        }
        return rows;
      });
      const none = r.some(row => row.moved === 0) ? 'Split has no effect on the render. ' : '';
      const text = r.map((row, i) => `${SHAPES[i]} seam ${row.seam.toFixed(3)} interior ${row.interior.toFixed(3)} moved ${row.moved.toFixed(3)}`).join('; ');
      return { ok: r.every(row => row.moved > 0 && row.seam <= row.interior * 1.25), detail: `${none}${text} (limit 1.25x)` };
    },
  },
  {
    name: 'split-loop',
    run: async ({ page }) => {
      const r = await page.evaluate(async TAU => {
        const q = window.ct, p = q.project([q.soft({ splitAmount: 32, splitShape: 3, splitSamples: 9, splitTravel: 2 })], true);
        const a = await q.shot(p, 0), b = await q.shot(p, TAU), plain = await q.shot(q.project([q.soft()], true), 0);
        return { same: q.same(a, b), moved: !q.same(a, plain) };
      }, TAU);
      const none = r.moved ? '' : 'Split has no effect on the render. ';
      return { ok: r.same && r.moved, detail: `${none}phase 0 and TAU ${r.same ? 'match byte for byte' : 'differ'}` };
    },
  },
];

const selected = only ? CHECKS.filter(c => only.some(prefix => c.name.startsWith(prefix))) : CHECKS;
if (!selected.length) { console.error(`No check matches --only=${only.join(',')}. Checks: ${CHECKS.map(c => c.name).join(', ')}`); process.exit(2); }

await fs.mkdir(out, { recursive: true });
const bundle = (dir, file) => build({
  stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';
export {encodePNG} from './src/rendering/png';`, resolveDir: dir, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, file),
  nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent',
});
await bundle(root, 'renderer.js');
if (baseline) await bundle(path.resolve(baseline), 'baseline.js');
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="a" width="960" height="540"></canvas><canvas id="b" width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const results = [];
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluate(async hasBaseline => {
    const m = await import('./renderer.js');
    const old = hasBaseline ? await import('./baseline.js') : null;
    const renderer = new m.StudioRenderer(document.querySelector('#a'));
    const dataUrl = async (w, h, pixel) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(pixel((x + .5) / h - w / h / 2, (y + .5) / h - .5), (y * w + x) * 4);
      const png = await m.encodePNG(bytes, w, h); let text = '';
      for (let i = 0; i < png.length; i += 8192) text += String.fromCharCode(...png.subarray(i, i + 8192));
      return `data:image/png;base64,${btoa(text)}`;
    };
    const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // One colour, below full brightness, so any brightening at the edge shows.
    // A soft halo around a hard-edged block, which gives the Edges shape something to find.
    const softUrl = await dataUrl(960, 540, (x, y) => {
      const halo = .6 * (1 - ramp(.2, .34, Math.hypot(x, y))), block = Math.abs(x) < .1 && Math.abs(y) < .1 ? 1 : 0;
      return [176, 96, 48, Math.round(255 * Math.max(halo, block))];
    });
    const greyUrl = await dataUrl(64, 36, () => [128, 128, 128, 255]);
    const image = (url, params, name) => {
      const l = m.createLayer('image'); l.id = `${name}-proof`; Object.assign(l.params, params);
      l.image = { name: `${name}.png`, dataUrl: url, width: 960, height: 540, fit: 'contain' };
      return l;
    };
    const soft = (params = {}) => { const l = image(softUrl, params, 'soft'); l.mask = { ...l.mask, kind: 'circle', size: .9, softness: .2 }; return l; };
    const grey = (params = {}) => image(greyUrl, params, 'grey');
    const layer = (kind, preset, params = {}) => { const l = preset ? m.applyPreset(m.createLayer(kind), preset) : m.createLayer(kind); Object.assign(l.params, params); l.id = `${kind}-proof`; return l; };
    const project = (layers, transparent = false) => { const p = m.createProject(); p.id = 'colour-proof'; p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
    const pixels = async bytes => {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('webgl2', { premultipliedAlpha: false });
      const texture = context.createTexture(), frame = context.createFramebuffer();
      context.bindTexture(context.TEXTURE_2D, texture);
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, bitmap);
      context.bindFramebuffer(context.FRAMEBUFFER, frame);
      context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, texture, 0);
      const data = new Uint8Array(bitmap.width * bitmap.height * 4);
      context.readPixels(0, 0, bitmap.width, bitmap.height, context.RGBA, context.UNSIGNED_BYTE, data);
      context.getExtension('WEBGL_lose_context')?.loseContext();
      return data;
    };
    const shot = async (p, phase = .9, width = 960, height = 540) => { await renderer.prepare(p); return renderer.exportPNG(p, phase, width, height); };
    const px = async (...args) => pixels(await shot(...args));
    const difference = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    window.ct = { m, old, renderer, layer, soft, grey, project, pixels, shot, px, difference, same };
  }, !!baseline);

  for (const check of selected) {
    errors.length = 0;
    let result;
    try { result = await check.run({ page, baseline, out }); }
    catch (error) { result = { ok: false, detail: String(error?.message ?? error).split('\n')[0] }; }
    if (errors.length) result = { ok: false, detail: `${result.detail}; page error: ${errors[0].slice(0, 300)}` };
    results.push({ name: check.name, ...result });
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${check.name}: ${result.detail}`);
  }
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
  await app.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
if (failed || results.length !== selected.length) process.exitCode = 1;
