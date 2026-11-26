// Real Electron/WebGL checks for the Print screen finish.
// Run: node scripts/verify-print.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/print-build');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';
export {encodePNG} from './src/rendering/png';
export {RETRO_PALETTES} from './src/rendering/tiles';
export {retroColours} from './src/rendering/print-screen';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), nodePaths: [path.join(root, 'node_modules')] });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="a" width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = { captures: [], checks: {}, errors };
const TAU = Math.PI * 2;
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('#a'));
    const layer = (kind, preset, params = {}) => { const l = preset ? m.applyPreset(m.createLayer(kind), preset) : m.createLayer(kind); Object.assign(l.params, params); l.id = `${kind}-${Math.random()}`; return l; };
    const project = (layers, transparent = false) => { const p = m.createProject(); p.layers = layers; p.background = '#000000'; p.transparent = transparent; return p; };
    const pixels = async bytes => {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const shot = async (p, phase = .9, width = 960, height = 540, supersample = 1) => { await renderer.prepare(p); return renderer.exportPNG(p, phase, width, height, supersample); };
    const difference = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    const mean = a => { let sum = 0; for (let i = 0; i < a.length; i += 4) sum += a[i] + a[i + 1] + a[i + 2]; return sum / (a.length / 4 * 3); };
    // Mean in linear light: how a screen reads from a distance.
    const toLinear = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    const linearMean = a => { let sum = 0; for (let i = 0; i < a.length; i += 4) sum += toLinear(a[i]) + toLinear(a[i + 1]) + toLinear(a[i + 2]); return sum / (a.length / 4 * 3); };
    // Box-downscale an RGBA image by a whole factor in linear light (×255), to compare render sizes.
    const lin = v => { v /= 255; return 255 * (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); };
    const shrink = (a, width, height, factor) => {
      const w = width / factor, h = height / factor, result = new Float32Array(w * h * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++)
        result[(Math.floor(y / factor) * w + Math.floor(x / factor)) * 4 + c] += (c === 3 ? a[(y * width + x) * 4 + c] : lin(a[(y * width + x) * 4 + c])) / (factor * factor);
      return result;
    };
    // Still image sources, so any change between frames comes from the screen.
    const urlOf = bytes => { const parts = []; for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192))); return `data:image/png;base64,${btoa(parts.join(''))}`; };
    const dataUrl = async (w, h, pixel) => { const bytes = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes.set(pixel(x / (w - 1), y / (h - 1)), (y * w + x) * 4); return urlOf(await m.encodePNG(bytes, w, h)); };
    const greyUrl = await dataUrl(96, 54, () => [128, 128, 128, 255]), rampUrl = await dataUrl(960, 540, x => { const v = Math.round(255 * x); return [v, v, v, 255]; });
    const image = (url, params) => { const l = m.createLayer('image'); l.id = `image-${Math.random()}`; Object.assign(l.params, params); l.image = { name: 'proof.png', dataUrl: url, width: url === greyUrl ? 96 : 960, height: url === greyUrl ? 54 : 540, fit: 'contain' }; return l; };
    const grey = params => image(greyUrl, params), ramp = params => image(rampUrl, params);
    const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    // The renderer wraps phase, so 0 against TAU alone proves nothing: the seam catches motion that does not close.
    const loop = async p => {
      const start = await shot(p, 0), wrapped = await shot(p, Math.PI * 2), before = await shot(p, Math.PI * 2 - 1e-4);
      return { literal: same(start, wrapped), seam: difference(await pixels(start), await pixels(before)) };
    };
    const frames = p => Math.max(1, Math.round(p.duration * p.fps.num / p.fps.den));
    window.printQA = { m, renderer, layer, project, pixels, shot, difference, mean, linearMean, shrink, grey, ramp, same, loop, frames };
  });
  const capture = async (name, body, arg) => {
    const bytes = await page.evaluate(body, arg);
    const file = path.join(out, `${name}.png`);
    await fs.writeFile(file, Buffer.from(bytes));
    report.captures.push(path.relative(root, file));
  };
  const on = { printMix: 1 };
  const looks = {
    'dots-round': { ...on }, 'dots-classic': { ...on, printDot: 1 }, 'dots-diamond': { ...on, printDot: 2 }, 'dots-square': { ...on, printDot: 3 },
    'dots-fine': { ...on, printDot: 1, printSize: 4 }, 'dots-ink-paper': { ...on, printColour: 1, printInk: 2, printPaper: 6, printInvert: 1 },
    lines: { ...on, printType: 1, printSize: 6, printAngle: 30 }, dither: { ...on, printType: 2, printSize: 3, printAngle: 0 },
    'dither-2x2': { ...on, printType: 2, printSize: 4, printAngle: 0, printMatrix: 0 },
    'blue-noise': { ...on, printType: 3, printSize: 6, printAngle: 0 },
    cmyk: { ...on, printColour: 3, printSize: 7 }, rgb: { ...on, printColour: 2, printSize: 9 },
    'cmyk-lines': { ...on, printColour: 3, printType: 1, printSize: 6 },
    edges: { ...on, printArea: 1, printEdgeWidth: 16 }, 'away-from-edges': { ...on, printArea: 2, printEdgeWidth: 16 },
    soft: { ...on, printSoft: .6, printSize: 12 }, 'tone-range': { ...on, printFloor: .3, printCeiling: .7 },
  };
  await capture('liquid-off', async () => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour')]))); });
  for (const [name, params] of Object.entries(looks))
    await capture(`liquid-${name}`, async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour', params)]))); }, params);
  for (const name of ['dots-round', 'edges', 'cmyk', 'lines'])
    await capture(`sculpture-${name}`, async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('sculpture', 'pearl-organism', params)], true))); }, looks[name]);
  await capture('surface-dots', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('surface', null, params)]))); }, looks['dots-classic']);
  await capture('surface-flat-colour-dots', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('surface', null, params)]))); }, { ...on, toonMix: 1 });
  await capture('scope-dots', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('scope', 'ember-ring', params)]))); }, { ...on, printSize: 5 });
  for (const [name, params] of Object.entries({ 'retro-gameboy': { ...on, printType: 3, printSize: 6, printAngle: 0, printColour: 4, printRetro: 0 },
    'retro-teletext': { ...on, printType: 2, printSize: 6, printAngle: 0, printColour: 4, printRetro: 2 }, 'retro-green-dots': { ...on, printColour: 4, printRetro: 3, printSize: 6 } }))
    await capture(`liquid-${name}`, async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour', params)]))); }, params);
  await capture('grey-blue-noise', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.grey(params)]), .9, 1920, 1080)); }, { ...on, printType: 3, printSize: 4, printAngle: 0 });
  await capture('grey-bayer', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.grey(params)]), .9, 1920, 1080)); }, { ...on, printType: 2, printSize: 4, printAngle: 0 });
  // The same frame at 4K: a crop of this is the detail check.
  await capture('liquid-dots-4k', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour', params)]), .9, 3840, 2160)); }, looks['dots-round']);
  await capture('liquid-dither-4k', async params => { const q = window.printQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour', params)]), .9, 3840, 2160)); }, looks.dither);

  report.checks = await page.evaluate(async ([looks, TAU]) => {
    const q = window.printQA, px = async (...args) => q.pixels(await q.shot(...args));
    const liquid = params => q.project([q.layer('liquid', 'blue-hour', params)]), on = { printMix: 1 };
    const plain = liquid({}), off = await px(plain);
    // Every control moved, amount 0: must be exactly the plain picture.
    const zero = await px(liquid({ printMix: 0, printType: 1, printSize: 3, printColour: 3, printPaper: 2, printArea: 1, printInvert: 1, printScroll: 2 }));
    const means = {}, changed = {};
    for (const [name, params] of Object.entries(looks)) { const a = await px(liquid(params)); means[name] = q.linearMean(a); changed[name] = q.difference(a, off); }
    // Loop closure and seeking, with screen travel.
    const moving = liquid({ ...looks.lines, printScroll: 2 });
    const start = await px(moving, 0), end = await px(moving, TAU), again = await px(moving, 0), elsewhere = await px(moving, 1.7);
    // The pattern must be the same picture at every render size: shrink the
    // big render to the small one and compare.
    const sizes = {};
    for (const name of ['dots-round', 'lines', 'dither', 'cmyk']) {
      const p = liquid({ ...looks[name], printSize: 16 });
      const base = q.shrink(await px(p, .9, 960, 540), 960, 540, 1), big = q.shrink(await px(p, .9, 1920, 1080), 1920, 1080, 2), uhd = q.shrink(await px(p, .9, 3840, 2160), 3840, 2160, 4);
      const reference = q.shrink(await px(plain, .9, 1920, 1080), 1920, 1080, 2), small = q.shrink(await px(plain, .9, 960, 540), 960, 540, 1);
      sizes[name] = { big: q.difference(base, big), uhd: q.difference(base, uhd), withoutScreen: q.difference(small, reference) };
    }
    const one = await px(liquid(looks['dots-round']), .9, 960, 540, 1), two = await px(liquid(looks['dots-round']), .9, 960, 540, 2);
    // A screen finer than the output becomes flat tone: nearly no pixel-to-pixel noise.
    const roughness = a => { let sum = 0, n = 0; for (let y = 0; y < 540; y++) for (let x = 0; x < 959; x++) { const i = (y * 960 + x) * 4; sum += Math.abs(a[i] - a[i + 4]) + Math.abs(a[i + 1] - a[i + 5]) + Math.abs(a[i + 2] - a[i + 6]); n++; } return sum / n; };
    const fine = roughness(await px(liquid({ printMix: 1, printSize: 1 }), .9, 960, 540)), coarse = roughness(await px(liquid({ printMix: 1, printSize: 8 }), .9, 960, 540)), smooth = roughness(off);
    // Transparent export: dots carry alpha, and no dark fringe around them.
    const clear = await px(q.project([q.layer('sculpture', 'pearl-organism')], true)), dotted = await px(q.project([q.layer('sculpture', 'pearl-organism', looks['dots-round'])], true));
    let opaqueOff = 0, holes = 0, partial = 0, darkFringe = 0, outside = 0, partialOff = 0, darkFringeOff = 0;
    for (let i = 0; i < clear.length; i += 4) if (clear[i + 3] > 8 && clear[i + 3] < 247) { partialOff++; if (Math.max(clear[i], clear[i + 1], clear[i + 2]) * 255 / clear[i + 3] < 12) darkFringeOff++; }
    for (let i = 0; i < dotted.length; i += 4) {
      if (clear[i + 3] > 247) { opaqueOff++; if (dotted[i + 3] < 8) holes++; }
      if (clear[i + 3] === 0 && dotted[i + 3] > 8) outside++;
      if (dotted[i + 3] > 8 && dotted[i + 3] < 247) { partial++; const straight = Math.max(dotted[i], dotted[i + 1], dotted[i + 2]) * 255 / dotted[i + 3]; if (straight < 12) darkFringe++; }
    }
    // Edge areas: both change less of the picture than the whole screen, and together about as much.
    const sculpture = params => q.project([q.layer('sculpture', 'pearl-organism', params)], true);
    const whole = q.difference(await px(sculpture(looks['dots-round'])), clear), edge = q.difference(await px(sculpture(looks.edges)), clear), away = q.difference(await px(sculpture(looks['away-from-edges'])), clear);
    // Graphic Patterns ignore saved print values.
    const graphic = params => q.project([q.layer('graphic', null, params)]);
    const graphicIgnores = q.difference(await px(graphic({})), await px(graphic({ printMix: 1 })));
    // Glow stays soft over the dots: the glow is the same light with or without the screen.
    const gl = q.renderer.renderer.getContext(), pixel = new Uint8Array(4), frames = 30;
    const time = async project => { await q.renderer.prepare(project); q.renderer.render(project, 0, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); const began = performance.now();
      for (let i = 0; i < frames; i++) { q.renderer.render(project, i * .05, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); } return (performance.now() - began) / frames; };
    const frameMs = { plain: await time(plain) };
    for (const name of ['dots-round', 'dots-classic', 'lines', 'dither', 'blue-noise', 'rgb', 'cmyk', 'edges']) frameMs[name] = await time(liquid(looks[name]));
    frameMs['retro-shimmer'] = await time(liquid({ ...looks['blue-noise'], printColour: 4, printRetro: 2, printShimmer: 1 }));
    frameMs['cmyk-edges-flat'] = await time(liquid({ ...looks.cmyk, printArea: 1, toonMix: 1 }));
    // print-blue: mid-grey through 4-pixel cells at 1080 lines, one sample per cell, 128 x 128 cells.
    // Energy above a quarter cycle per cell against the single strongest frequency: a repeating
    // grid puts its energy in a few spikes, blue noise spreads it over the whole high band.
    const spectrum = async params => {
      const a = await px(q.project([q.grey({ ...on, printSize: 4, printAngle: 0, ...params })]), .9, 1920, 1080), M = 128, g = new Float64Array(M * M);
      let lit = 0;
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) { const i = ((16 + y) * 4 * 1920 + (16 + x) * 4 + 2 * 1920 + 2) * 4; g[y * M + x] = a[i] > 64 ? 1 : 0; lit += g[y * M + x]; }
      for (let i = 0; i < M * M; i++) g[i] -= lit / (M * M);
      const cos = new Float64Array(M), sin = new Float64Array(M); for (let k = 0; k < M; k++) { cos[k] = Math.cos(-2 * Math.PI * k / M); sin[k] = Math.sin(-2 * Math.PI * k / M); }
      const rr = new Float64Array(M * M), ri = new Float64Array(M * M);
      for (let y = 0; y < M; y++) for (let u = 0; u < M; u++) { let re = 0, im = 0; for (let x = 0; x < M; x++) { const k = (u * x) % M; re += g[y * M + x] * cos[k]; im += g[y * M + x] * sin[k]; } rr[y * M + u] = re; ri[y * M + u] = im; }
      let total = 0, high = 0, low = 0, peak = 0;
      for (let v = 0; v < M; v++) for (let u = 0; u < M; u++) {
        if (!u && !v) continue;
        let re = 0, im = 0; for (let y = 0; y < M; y++) { const k = (v * y) % M; re += rr[y * M + u] * cos[k] - ri[y * M + u] * sin[k]; im += rr[y * M + u] * sin[k] + ri[y * M + u] * cos[k]; }
        const e = re * re + im * im, f = Math.hypot(Math.min(u, M - u), Math.min(v, M - v)) / M;
        total += e; if (f > .25) high += e; if (f < .0625) low += e; peak = Math.max(peak, e);
      }
      return { lit: lit / (M * M), spread: high / peak, peakShare: peak / total, lowShare: low / total };
    };
    const blue = { noise: await spectrum({ printType: 3 }), bayer: await spectrum({ printType: 2, printMatrix: 2 }) };
    // print-retro: every pixel of an opaque ramp is one of the palette's colours. Cells
    // are kept above two output pixels, so the screen itself is drawn, not its flat tone.
    const retro = [];
    for (let palette = 0; palette < q.m.RETRO_PALETTES.length; palette++) {
      const colours = q.m.RETRO_PALETTES[palette].colours.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
      for (const params of [{ printType: 3, printSize: 8 }, { printType: 2, printSize: 10 }, { printType: 0, printSize: 12 }, { printType: 1, printSize: 10 }]) {
        const p = q.project([q.ramp({ ...on, printAngle: 0, printColour: 4, printRetro: palette, ...params })]); p.highlights = 'exact';
        const a = await px(p);
        let worst = 0, opaque = true; const used = new Array(colours.length).fill(0);
        for (let i = 0; i < a.length; i += 4) {
          let best = 1e9, which = 0;
          for (let c = 0; c < colours.length; c++) { const d = Math.max(Math.abs(a[i] - colours[c][0]), Math.abs(a[i + 1] - colours[c][1]), Math.abs(a[i + 2] - colours[c][2])); if (d < best) { best = d; which = c; } }
          worst = Math.max(worst, best); used[which]++; if (a[i + 3] !== 255) opaque = false;
        }
        retro.push({ palette, type: params.printType, worst, opaque, used: used.map(n => n / (a.length / 4)) });
      }
    }
    // print-retro-levels: on a smooth ramp, each pixel prints one of the two palette levels either
    // side of the tone its own cell (or line) was screened from, never a level further out. The
    // single retro screen runs at the K angle (Screen angle + 45°); the cell geometry is rebuilt here.
    const toLin = v => { v = Math.min(Math.max(v, 0), 255) / 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    const levelOf = (byte, n) => { const l = toLin(byte); return Math.min(1.35 * l / (.35 + l), 1) * (n - 1); };
    const levels = [];
    for (const palette of [2, 1]) {
      const colours = q.m.retroColours(palette).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))), n = colours.length;
      for (const params of [{ printType: 3, printSize: 8 }, { printType: 2, printSize: 10 }, { printType: 0, printSize: 12 }, { printType: 0, printSize: 12, printDot: 3 }, { printType: 1, printSize: 10 }])
        for (const printAngle of [-45, 0]) {
          const p = q.project([q.ramp({ ...on, printColour: 4, printRetro: palette, printAngle, ...params })]); p.highlights = 'exact';
          const a = await px(p), cells = 1080 / params.printSize, aspect = 960 / 540, angle = (printAngle + 45) * Math.PI / 180, c = Math.cos(angle), sn = Math.sin(angle);
          const byteAt = t => { const u = (c * t[0] + sn * t[1]) / (cells * aspect) + .5; return 255 * Math.min(Math.max(u * 960 - .5, 0), 959) / 959; };
          const bracket = (s0, s1) => {
            const cx = Math.floor(s0) + .5, cy = Math.floor(s1) + .5;
            const taps = params.printType === 1 ? [[s0, cy]] : params.printType === 0 ? [[cx, cy], [cx + .25, cy], [cx - .25, cy], [cx, cy + .25], [cx, cy - .25]] : [[cx, cy]];
            const bytes = taps.map(byteAt);
            return [Math.floor(levelOf(Math.min(...bytes) - 1, n)), Math.ceil(levelOf(Math.max(...bytes) + 1, n))];
          };
          // A pixel centre within 1e-3 cell of a cell edge may land in either cell on the GPU (float32).
          const near = [[1e-3, 0], [-1e-3, 0], [0, 1e-3], [0, -1e-3], [1e-3, 1e-3], [-1e-3, -1e-3], [1e-3, -1e-3], [-1e-3, 1e-3]];
          let bad = 0, sample = null;
          for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) {
            const ux = ((x + .5) / 960 - .5) * aspect * cells, vy = (.5 - (y + .5) / 540) * cells, s0 = c * ux - sn * vy, s1 = sn * ux + c * vy;
            const i = (y * 960 + x) * 4; let best = 1e9, index = 0;
            for (let k = 0; k < n; k++) { const d = Math.max(Math.abs(a[i] - colours[k][0]), Math.abs(a[i + 1] - colours[k][1]), Math.abs(a[i + 2] - colours[k][2])); if (d < best) { best = d; index = k; } }
            const fits = ([lo, hi]) => index >= lo && index <= hi, own = bracket(s0, s1);
            if (!fits(own) && !near.some(([e0, e1]) => fits(bracket(s0 + e0, s1 + e1)))) { bad++; sample ??= { x, y, index, lo: own[0], hi: own[1] }; }
          }
          levels.push({ palette, type: params.printType, dot: params.printDot ?? 0, printAngle, bad, sample });
        }
    }
    // print-shimmer: consecutive loop frames differ, seeks repeat, the loop closes, and it is off by default.
    // Cells of 8 (4 output pixels) so the screen is drawn rather than flattened to its tone.
    const shimmer = { frames: {}, loops: {}, seek: {} };
    for (const [name, type] of [['dither', 2], ['blue-noise', 3]]) {
      const p = q.project([q.grey({ ...on, printType: type, printSize: 8, printAngle: 0, printShimmer: 1 })]), n = q.frames(p), at = k => k / n * TAU;
      const steps = []; let previous = await px(p, at(0));
      for (let k = 1; k <= 6; k++) { const next = await px(p, at(k)); steps.push(q.difference(previous, next)); previous = next; }
      steps.push(q.difference(await px(p, at(n - 1)), await px(p, at(0))));
      shimmer.frames[name] = steps;
      shimmer.seek[name] = q.same(await q.shot(p, at(5)), await q.shot(p, at(5)));
      shimmer.loops[name] = { still: await q.loop(p), moving: await q.loop(liquid({ ...on, printType: type, printSize: 8, printShimmer: 1 })) };
    }
    const held = q.project([q.grey({ ...on, printType: 3, printSize: 8 })]), heldFrames = q.frames(held);
    shimmer.offByDefault = q.m.createLayer('liquid').params.printShimmer === 0 && q.same(await q.shot(held, 0), await q.shot(held, TAU / heldFrames));
    // Shimmer on a dot or line screen does nothing.
    shimmer.dotsIgnore = q.difference(await px(liquid({ ...looks['dots-round'], printShimmer: 1 }), 1 / 300 * TAU), await px(liquid(looks['dots-round']), 1 / 300 * TAU));
    return { blue, retro, levels, shimmer, zeroIsNeutral: q.difference(off, zero), plainMean: q.linearMean(off), means, changed,
      wrap: q.difference(start, end), seek: q.difference(start, again), move: q.difference(start, elsewhere),
      sizes, supersample: q.difference(one, two), roughness: { fine, coarse, smooth },
      alpha: { opaqueOff, holes, partial, darkFringe, outside, partialOff, darkFringeOff }, area: { whole, edge, away }, graphicIgnores, frameMs };
  }, [looks, TAU]);
  const c = report.checks;
  assert.equal(c.zeroIsNeutral, 0, 'Print screen 0 changes the picture.');
  for (const [name, d] of Object.entries(c.changed)) assert.ok(d > 1, `${name} does not change the picture (${d}).`);
  for (const name of ['dots-round', 'dots-classic', 'dots-diamond', 'dots-square', 'lines', 'dither', 'blue-noise'])
    assert.ok(Math.abs(c.means[name] / c.plainMean - 1) < .2, `${name} does not keep the layer's brightness: ${c.means[name]} against ${c.plainMean}.`);
  assert.equal(c.wrap, 0, 'A travelling screen does not close its loop.');
  assert.equal(c.seek, 0, 'Seeking back gives a different screened frame.');
  assert.ok(c.move > .5, 'Phase stills are too alike.');
  for (const [name, s] of Object.entries(c.sizes)) assert.ok(s.big < s.withoutScreen + 4 && s.uhd < s.withoutScreen + 4, `${name} changes with render size: ${JSON.stringify(s)}`);
  assert.ok(c.roughness.fine < c.roughness.smooth * 2 + 1 && c.roughness.coarse > c.roughness.fine * 3, `A screen finer than the output is noisy: ${JSON.stringify(c.roughness)}`);
  assert.ok(c.alpha.holes > c.alpha.opaqueOff * .02, `Dots leave no transparent gaps: ${JSON.stringify(c.alpha)}`);
  // The unscreened layer has some genuinely dark soft edges; dots must not add more than that share.
  assert.ok(c.alpha.darkFringe / c.alpha.partial < c.alpha.darkFringeOff / Math.max(c.alpha.partialOff, 1) + .01, `Dark fringe around dots: ${JSON.stringify(c.alpha)}`);
  assert.equal(c.alpha.outside, 0, 'Dots spill outside the layer.');
  assert.ok(c.area.edge < c.area.whole * .9 && c.area.away < c.area.whole * .98 && c.area.edge > .05 && c.area.away > .05, `Print area does not limit the screen: ${JSON.stringify(c.area)}`);
  assert.equal(c.graphicIgnores, 0, 'Graphic Patterns respond to print values.');
  // print-blue
  assert.ok(Math.abs(c.blue.noise.lit - c.blue.bayer.lit) < .03, `Blue noise and Bayer print different tone at mid-grey: ${JSON.stringify(c.blue)}`);
  assert.ok(c.blue.noise.spread > c.blue.bayer.spread * 20 && c.blue.noise.peakShare < .02 && c.blue.noise.lowShare < .02, `Blue noise shows a repeating grid or clumps: ${JSON.stringify(c.blue)}`);
  // print-retro
  for (const r of c.retro) {
    assert.ok(r.worst <= 2 && r.opaque, `Retro palette ${r.palette} (type ${r.type}) prints a colour outside the palette: ${JSON.stringify(r)}`);
    assert.ok(r.used.every(share => share > .01), `Retro palette ${r.palette} (type ${r.type}) leaves a colour out of the ramp: ${JSON.stringify(r)}`);
  }
  for (const r of c.levels) assert.equal(r.bad, 0, `Retro palette ${r.palette} (type ${r.type}, dot ${r.dot}, angle ${r.printAngle}) prints a level outside its cell's bracket: ${JSON.stringify(r)}`);
  // print-shimmer
  for (const [name, steps] of Object.entries(c.shimmer.frames)) assert.ok(steps.every(d => d > 1), `${name} shimmer holds a frame: ${JSON.stringify(steps)}`);
  for (const [name, l] of Object.entries(c.shimmer.loops)) for (const [source, r] of Object.entries(l))
    assert.ok(r.literal && r.seam < .1, `${name} shimmer on a ${source} source does not close its loop: ${JSON.stringify(r)}`);
  for (const [name, ok] of Object.entries(c.shimmer.seek)) assert.ok(ok, `${name} shimmer gives a different frame on a second seek.`);
  assert.ok(c.shimmer.offByDefault, 'Shimmer is on by default, or blue noise moves without it.');
  assert.equal(c.shimmer.dotsIgnore, 0, 'Shimmer changes a dot screen.');
  for (const [name, ms] of Object.entries(c.frameMs)) assert.ok(ms < 16.7, `${name}: ${ms.toFixed(1)} ms per 1080p frame.`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report.checks, null, 2));
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app.close();
}
