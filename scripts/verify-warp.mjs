// Real Electron/WebGL checks for the Warp finishes.
// Run: node scripts/verify-warp.mjs --baseline=<checkout of the commit before them> [--only=neutral,warp]
// --only takes comma-separated name prefixes. Each check prints one PASS or FAIL
// line, and any failure makes the exit code non-zero. Output goes to work/warp.
//
// To add a check, add an entry to CHECKS: `run` receives the helpers below and
// returns { ok, detail }. Code passed to `page.evaluate` runs in the renderer
// and reaches the page helpers through `window.wq`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = option('baseline');
const only = option('only')?.split(',').map(s => s.trim()).filter(Boolean);
const out = path.join(root, 'work/warp');
const FIELDS = ['Waves', 'Noise', 'Ripple', 'Magnetic', 'Plasma'];
// A clamped edge repeats one source pixel along the push. The test picture never holds still this long.
const STREAK_LIMIT = 48;
// Measured on mirrored reads: at most .91x the unwarped edge colour. Clamped reads reach 1.47x on the mildest field.
const RIM_AREA_LIMIT = 1.25;

const needsBaseline = () => baseline ? null : { ok: false, detail: 'needs --baseline=<checkout>' };
const loopVerdict = (r, limit = .1) => ({
  ok: r.literal && r.seam < limit,
  detail: `0/TAU ${r.literal ? 'match' : 'differ'}, seam ${r.seam.toFixed(4)} (limit ${limit})`,
});
const NO_EFFECT = 'Warp does not change the render. ';

const CHECKS = [
  {
    name: 'neutral',
    // Every control at its default: one preset of every kind, plus an Image layer, against the older checkout.
    run: async ({ page }) => {
      const missing = needsBaseline(); if (missing) return missing;
      const r = await page.evaluate(async () => {
        const q = window.wq, before = new q.old.StudioRenderer(document.querySelector('#b')), changed = [];
        const kinds = [...new Set(q.old.PRESETS.map(p => p.kind)), 'image'];
        const make = (m, kind) => {
          const l = kind === 'image' ? m.createLayer('image') : m.applyPreset(m.createLayer(kind), m.PRESETS.find(p => p.kind === kind).id);
          if (kind === 'image') l.image = { name: 'tiny.png', dataUrl: q.tinyUrl, width: 64, height: 36, fit: 'contain' };
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
      return { ok: r.changed.length === 0, detail: r.changed.length ? `changed: ${r.changed.join(', ')}` : `${r.kinds} kinds byte-identical` };
    },
  },
  {
    name: 'warp-types',
    run: async ({ page }) => {
      const r = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), shots = [];
        for (let f = 0; f < count; f++) shots.push(await q.px(q.project([q.rich({ bendAmount: .25, bendField: f })])));
        const moved = shots.map(s => q.difference(plain, s));
        let closest = Infinity;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) closest = Math.min(closest, q.difference(shots[a], shots[b]));
        return { moved, closest };
      }, FIELDS.length);
      const ok = r.moved.every(v => v > 3) && r.closest > 3;
      return { ok, detail: `${r.moved.some(v => v <= 3) ? NO_EFFECT : ''}moved ${r.moved.map((v, i) => `${FIELDS[i]} ${v.toFixed(2)}`).join(', ')}; closest pair ${r.closest.toFixed(2)} (limits 3)` };
    },
  },
  {
    name: 'warp-engage',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.smooth()])), rows = [];
        for (let f = 0; f < count; f++) {
          const tiny = await q.px(q.project([q.smooth({ bendAmount: .0001, bendField: f, bendChroma: .5 })]));
          const full = await q.px(q.project([q.smooth({ bendAmount: .5, bendField: f })]));
          rows.push({ mean: q.difference(plain, tiny), moved: q.difference(plain, full) });
        }
        return rows;
      }, FIELDS.length);
      const ok = rows.every(r => r.mean < 1 && r.moved > 1);
      return { ok, detail: `${rows.some(r => r.moved <= 1) ? NO_EFFECT : ''}${rows.map((r, i) => `${FIELDS[i]} ${r.mean.toFixed(4)} (full ${r.moved.toFixed(2)})`).join(', ')} (limit 1)` };
    },
  },
  {
    name: 'warp-loop',
    // Cycles 1.5 is deliberately not whole: the renderer must round it, or the seam opens.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.shot(q.project([q.smooth()]), 0), rows = [];
        for (let f = 0; f < count; f++) {
          const p = q.project([q.smooth({ bendAmount: .3, bendField: f, bendCycles: 1.5, bendChroma: .3 })]);
          rows.push({ ...await q.loop(p), moved: !q.same(await q.shot(p, 0), plain) });
        }
        return rows;
      }, FIELDS.length);
      const verdicts = rows.map(r => loopVerdict(r));
      return { ok: rows.every((r, i) => r.moved && verdicts[i].ok), detail: `${rows.some(r => !r.moved) ? NO_EFFECT : ''}${verdicts.map((v, i) => `${FIELDS[i]} ${v.detail}`).join('; ')}` };
    },
  },
  {
    name: 'warp-scale',
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, plain = await q.px(q.project([q.rich()])), rows = [];
        for (let f = 0; f < count; f++) {
          // A busy picture, so a warp that moves by the wrong distance shows on every field.
          const p = () => q.project([q.rich({ bendAmount: .3, bendField: f, bendChroma: .3 })]);
          const small = await q.px(p()), big = await q.px(p(), .9, 1920, 1080);
          const reduced = new Uint8ClampedArray(small.length);
          for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) for (let c = 0; c < 4; c++) {
            const at = (X, Y) => big[(Y * 1920 + X) * 4 + c];
            reduced[(y * 960 + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
          }
          rows.push({ difference: q.difference(small, reduced), moved: q.difference(plain, small) });
        }
        return rows;
      }, FIELDS.length);
      return { ok: rows.every(r => r.moved > 1 && r.difference < 2), detail: `${rows.some(r => r.moved <= 1) ? NO_EFFECT : ''}${rows.map((r, i) => `${FIELDS[i]} ${r.difference.toFixed(3)}`).join(', ')} (limit 2)` };
    },
  },
  {
    name: 'warp-edge',
    // Amount 1 pushes far past the frame. The picture's outer two pixels are a colour found nowhere else, so
    // clamped reads show up as a spread of that colour; mirrored reads keep it to thin lines.
    run: async ({ page }) => {
      const rows = await page.evaluate(async ([count, limit]) => {
        const q = window.wq, W = 960, H = 540, scene = params => { const p = q.project([q.rimmed(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), rows = [];
        const rim = (px, i) => px[i] > 200 && px[i + 1] < 40 && px[i + 2] > 200;
        const measure = px => {
          let area = 0, line = 0, longest = 0;
          const walk = (outer, inner, at) => {
            for (let a = 0; a < outer; a++) {
              let hits = 0, run = 1, last = -1;
              for (let b = 0; b < inner; b++) {
                const i = at(a, b) * 4;
                if (rim(px, i)) { hits++; run = 1; last = -1; continue; }
                const key = px[i] | px[i + 1] << 8 | px[i + 2] << 16;
                run = key === last ? run + 1 : 1; last = key; longest = Math.max(longest, run);
              }
              line = Math.max(line, hits / inner);
            }
          };
          for (let i = 0; i < px.length; i += 4) if (rim(px, i)) area++;
          walk(H, W, (y, x) => y * W + x); walk(W, H, (x, y) => y * W + x);
          return { area: area / (W * H), line, longest };
        };
        const base = measure(plain);
        for (let f = 0; f < count; f++) {
          const px = await q.px(scene({ bendAmount: 1, bendField: f }));
          let gaps = 0; for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) gaps++;
          rows.push({ gaps, ...measure(px), moved: q.difference(plain, px), baseArea: base.area });
        }
        return rows;
      }, [FIELDS.length, STREAK_LIMIT]);
      const ok = rows.every(r => r.moved > 3 && r.gaps === 0 && r.longest < STREAK_LIMIT && r.area < r.baseArea * RIM_AREA_LIMIT && r.line < .5);
      return { ok, detail: `${rows.some(r => r.moved <= 3) ? NO_EFFECT : ''}edge colour covers ${(rows[0].baseArea * 100).toFixed(2)}% unwarped; ${rows.map((r, i) => `${FIELDS[i]} gaps ${r.gaps} edge ${(r.area * 100).toFixed(2)}% line ${(r.line * 100).toFixed(0)}% run ${r.longest}`).join(', ')} (limits ${RIM_AREA_LIMIT}x area, 50% of a line, run < ${STREAK_LIMIT})` };
    },
  },
  {
    name: 'warp-alpha',
    // Exact highlights show what the pass wrote; the soft curve lifts channels on its own.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, scene = params => { const p = q.project([q.soft(params)], true); p.highlights = 'exact'; return p; };
        const plain = await q.px(scene({})), rows = [];
        let brightest = 0;
        for (let i = 0; i < plain.length; i += 4) if (plain[i + 3] > 0) brightest = Math.max(brightest, plain[i], plain[i + 1], plain[i + 2]);
        for (let f = 0; f < count; f++) {
          const px = await q.px(scene({ bendAmount: .35, bendField: f, bendChroma: 1 }));
          let over = 0, worst = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { const excess = Math.max(px[i], px[i + 1], px[i + 2]) - brightest; worst = Math.max(worst, excess); if (excess > 2) over++; }
          rows.push({ over, worst, moved: q.difference(plain, px), brightest });
        }
        return rows;
      }, FIELDS.length);
      return { ok: rows.every(r => r.moved > 1 && r.over === 0), detail: `${rows.some(r => r.moved <= 1) ? NO_EFFECT : ''}peak ${rows[0].brightest}; ${rows.map((r, i) => `${FIELDS[i]} over ${r.over} worst +${r.worst}`).join(', ')} (limit +2)` };
    },
  },
  {
    name: 'warp-sparkle',
    // The single-tap render swaps one shader constant on the live material, so no test path ships.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, W = 3840, H = 2160, url = await q.checkerUrl(W, H);
        const scene = phase => q.project([q.image(url, { bendAmount: .22, bendField: 1, bendScale: 7, bendDetail: 4, bendCycles: 1 }, 'checker', W, H)]);
        const plain = await q.shot(q.project([q.image(url, {}, 'checker', W, H)]), .9, W, H);
        const first = await q.shot(scene(), .9, W, H);
        if (q.same(plain, first)) return { moved: false };
        const energy = async () => {
          const phases = [.9, .92, .94, .96];
          let sum = 0, previous = await q.px(scene(), phases[0], W, H);
          for (const phase of phases.slice(1)) { const next = await q.px(scene(), phase, W, H); sum += q.highFrequency(previous, next, W, H); previous = next; }
          return sum / (phases.length - 1);
        };
        const filtered = await energy();
        const mat = q.renderer.warp, source = mat.fragmentShader, single = source.replace('const int WARP_TAPS = 4;', 'const int WARP_TAPS = 1;');
        if (single === source) throw new Error('WARP_TAPS constant not found');
        mat.fragmentShader = single; mat.needsUpdate = true;
        let tap;
        try { tap = await energy(); } finally { mat.fragmentShader = source; mat.needsUpdate = true; }
        return { moved: true, filtered, tap };
      });
      if (!r.moved) return { ok: false, detail: NO_EFFECT };
      return { ok: r.filtered < r.tap / 2, detail: `high-frequency change ${r.filtered.toFixed(3)} against single tap ${r.tap.toFixed(3)}, ratio ${(r.filtered / r.tap).toFixed(3)} (limit .5)` };
    },
  },
  {
    name: 'warp-fringe',
    // A fold is not fringe movement. The live shader gets a temporary whole mirror period added to the read
    // position: the picture lands in the same place, so any change means the fringe grew with the fold.
    run: async ({ page }) => {
      const rows = await page.evaluate(async count => {
        const q = window.wq, mat = q.renderer.warp, rows = [];
        const scene = (f, chroma) => q.project([q.rich({ bendAmount: .2, bendField: f, bendChroma: chroma })]);
        const shots = [];
        for (let f = 0; f < count; f++) shots.push({ none: await q.px(scene(f, 0)), fringe: await q.px(scene(f, 1)) });
        const source = mat.fragmentShader, folded = source.replace('  return warped;\n}', '  return warped + vec2(2.);\n}');
        if (folded === source) throw new Error('warpedUv return not found');
        mat.fragmentShader = folded; mat.needsUpdate = true;
        try {
          for (let f = 0; f < count; f++) rows.push({ shift: q.difference(shots[f].fringe, await q.px(scene(f, 1))), fringe: q.difference(shots[f].none, shots[f].fringe) });
        } finally { mat.fragmentShader = source; mat.needsUpdate = true; }
        return rows;
      }, FIELDS.length);
      return { ok: rows.every(r => r.fringe > 1 && r.shift < 1), detail: `${rows.some(r => r.fringe <= 1) ? 'Colour fringe has no effect. ' : ''}${rows.map((r, i) => `${FIELDS[i]} fold changes ${r.shift.toFixed(3)} (fringe ${r.fringe.toFixed(2)})`).join(', ')} (limit 1)` };
    },
  },
  {
    name: 'warp-history',
    // The warp reads the echo's result once. If it entered the history, each echo would be bent again.
    run: async ({ page }) => {
      const r = await page.evaluate(async () => {
        const q = window.wq, total = Math.round(q.m.createProject().duration * q.m.createProject().fps.num / q.m.createProject().fps.den);
        const phase = frame => frame * Math.PI * 2 / total;
        const bend = { bendAmount: .12, bendField: 0, bendScale: 2, bendCycles: 0 };
        // Exact highlights, so reading a saved frame back as a picture does not apply the highlight curve twice.
        const exact = p => { p.highlights = 'exact'; return p; };
        const scene = params => exact(q.project([q.smooth({ echo: .9, echoZoom: .96, echoDriftX: .01, ...params })]));
        const direct = await q.shot(scene(bend), phase(60));
        await q.shot(scene(bend), phase(90)); await q.shot(scene(bend), phase(10));
        const sought = await q.shot(scene(bend), phase(60));
        const echoOnly = await q.shot(scene({}), phase(60));
        // The correct picture is the plain echo bent once; the defect is that picture bent again.
        const once = await q.shot(exact(q.project([q.image(q.urlOf(echoOnly), bend, 'echo-once')])), phase(60));
        const twice = await q.shot(exact(q.project([q.image(q.urlOf(once), bend, 'echo-twice')])), phase(60));
        const [a, b, c, d] = await Promise.all([direct, once, twice, echoOnly].map(q.pixels));
        return { same: q.same(direct, sought), toOnce: q.difference(a, b), toTwice: q.difference(a, c), moved: q.difference(a, d) };
      });
      const ok = r.same && r.moved > 1 && r.toOnce < 2 && r.toOnce < r.toTwice / 2;
      return { ok, detail: `${r.moved <= 1 ? NO_EFFECT : ''}seek ${r.same ? 'byte-identical' : 'differs'}; against echo bent once ${r.toOnce.toFixed(3)} (limit 2), bent twice ${r.toTwice.toFixed(3)}, moved ${r.moved.toFixed(2)}` };
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
    const urlOf = bytes => { const parts = []; for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192))); return `data:image/png;base64,${btoa(parts.join(''))}`; };
    const dataUrl = async (w, h, pixel) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(pixel((x + .5) / h - w / h / 2, (y + .5) / h - .5), (y * w + x) * 4);
      return urlOf(await m.encodePNG(bytes, w, h));
    };
    const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const softUrl = await dataUrl(960, 540, (x, y) => {
      const halo = .6 * (1 - ramp(.2, .34, Math.hypot(x, y))), block = Math.abs(x) < .1 && Math.abs(y) < .1 ? 1 : 0;
      return [176, 96, 48, Math.round(255 * Math.max(halo, block))];
    });
    const tinyUrl = await dataUrl(64, 36, (x, y) => [Math.round(255 * (x + .9) / 1.8), Math.round(255 * (y + .5)), 90, Math.round(255 * (1 - ramp(.25, .48, Math.hypot(x, y))))]);
    // Gentle everywhere, so a tiny warp cannot move a value far.
    const smoothUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 90 * Math.sin(3.1 * x + .4)), Math.round(128 + 90 * Math.cos(4.3 * y - .7)), Math.round(128 + 70 * Math.sin(2.2 * x + 3.7 * y)), 255,
    ]);
    // Busy in both directions, so a repeated edge pixel stands out as a flat run.
    const richUrl = await dataUrl(960, 540, (x, y) => [
      Math.round(128 + 120 * Math.sin(83 * x + 31 * y)), Math.round(128 + 120 * Math.sin(67 * y - 29 * x + 1)), Math.round(128 + 120 * Math.sin(53 * (x + y) + 2)), 255,
    ]);
    // Busy, with green kept high inside, and a two-pixel magenta rim that nothing else can be mistaken for.
    const rimmedUrl = await dataUrl(960, 540, (x, y) => Math.abs(x) > 480 / 540 - 2 / 540 || Math.abs(y) > .5 - 2 / 540 ? [255, 0, 255, 255] : [
      Math.round(128 + 120 * Math.sin(83 * x + 31 * y)), Math.round(150 + 80 * Math.sin(67 * y - 29 * x + 1)), Math.round(128 + 120 * Math.sin(53 * (x + y) + 2)), 255,
    ]);
    const checkerUrl = async (w, h) => {
      const bytes = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = ((x >> 1) + (y >> 1)) & 1 ? 255 : 0, i = (y * w + x) * 4;
        bytes[i] = bytes[i + 1] = bytes[i + 2] = v; bytes[i + 3] = 255;
      }
      return urlOf(await m.encodePNG(bytes, w, h));
    };
    const image = (url, params, name, width = 960, height = 540) => {
      const l = m.createLayer('image'); l.id = `${name}-proof`; Object.assign(l.params, params);
      l.image = { name: `${name}.png`, dataUrl: url, width, height, fit: 'contain' };
      return l;
    };
    const soft = (params = {}) => { const l = image(softUrl, params, 'soft'); l.mask = { ...l.mask, kind: 'circle', size: .9, softness: .2 }; return l; };
    const smooth = (params = {}) => image(smoothUrl, params, 'smooth');
    const rich = (params = {}) => image(richUrl, params, 'rich');
    const rimmed = (params = {}) => image(rimmedUrl, params, 'rimmed');
    const project = (layers, transparent = false) => { const p = m.createProject(); p.id = 'warp-proof'; p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
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
    // Laplacian of the frame-to-frame change on the green channel, over a central crop.
    const highFrequency = (a, b, W, H) => {
      const x0 = W >> 3, x1 = W - x0, y0 = H >> 3, y1 = H - y0, d = (x, y) => a[(y * W + x) * 4 + 1] - b[(y * W + x) * 4 + 1];
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += Math.abs(4 * d(x, y) - d(x - 1, y) - d(x + 1, y) - d(x, y - 1) - d(x, y + 1)); n++; }
      return sum / n;
    };
    // The renderer wraps phase, so 0 against TAU alone proves nothing: the seam catches motion that does not close.
    const loop = async p => {
      const start = await shot(p, 0), wrapped = await shot(p, Math.PI * 2), before = await shot(p, Math.PI * 2 - 1e-4);
      return { literal: same(start, wrapped), seam: difference(await pixels(start), await pixels(before)) };
    };
    window.wq = { m, old, tinyUrl, renderer, image, soft, smooth, rich, rimmed, checkerUrl, urlOf, project, pixels, shot, px, difference, same, highFrequency, loop };
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
