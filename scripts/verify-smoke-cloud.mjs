// Real GPU checks for Smoke Cloud. Run: node scripts/verify-smoke-cloud.mjs [--look] [--range] [--export] [--perf] [--schemes]  (no flag runs all but --schemes)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2), want = name => flags.includes(`--${name}`) || (!flags.length && name !== 'schemes');
const out = path.join(root, 'work/smoke-cloud');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer,applyPreset} from './src/core/project';export {SMOKE_CLOUD_SCHEMES} from './src/rendering/smoke-cloud-model';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), logLevel: 'silent', loader: { '.png': 'dataurl' } });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out, 'profile'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow(); page.setDefaultTimeout(0);
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const save = (name, data) => fs.writeFile(path.join(out, name), Buffer.from(data, 'base64'));
let code = 0;
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('canvas'));
    const TAU = Math.PI * 2;
    const projectFor = (over = {}, id = 'cloud-ultraviolet') => { const p = m.createProject(); const l = m.applyPreset(m.createLayer('smokecloud'), id); Object.assign(l.params, over); l.id = 'cloud-check'; p.layers = [l]; p.background = '#000000'; return p; };
    const shot = async (over, phase, id, w = 960, h = 540) => {
      const p = projectFor(over, id); await renderer.prepare(p);
      const bytes = await renderer.exportPNG(p, phase, w, h);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bitmap, 0, 0);
      return { bytes, bitmap, data: g.getImageData(0, 0, w, h).data };
    };
    const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if ((Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3 > 12) n++; return n / (a.length / 4) * 100; };
    const mean = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return s / (a.length / 4); };
    const b64 = async c => { const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); };
    window.cloud = { m, renderer, TAU, projectFor, shot, changed, mean, b64 };
  });
  if (want('look')) {
    const looks = await page.evaluate(async () => {
      const { shot, b64, TAU } = window.cloud, png = async (x, w, h) => { const r = await shot({}, x * TAU, undefined, w, h), c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(r.bitmap, 0, 0); return b64(c); };
      return { wide: await png(8.05 / 20, 1920, 1080), portrait: await png(8.05 / 20, 720, 1280), rest: await png(8.9 / 20, 1920, 1080) };
    });
    for (const [name, data] of Object.entries(looks)) await save(`look-${name}.png`, data);
    console.log('Looks written');
  }
  if (want('range')) {
    const rows = await page.evaluate(async () => {
      const { shot, changed, TAU } = window.cloud, out = [];
      for (const [label, key, low, high] of [['Smoke','cloudSmoke',0,1],['Turbulence','cloudTurbulence',0,1],['Shear','cloudShear',0,1],['Plumes','cloudPlumes',0,1],['Beat punch','cloudPunch',0,1],['Persistence','cloudLife',0,1],['Dark centre','cloudCore',0,1],['Ring','cloudRing',0,1],['Channels','cloudChannels',0,1],['Outer smoke','cloudOuter',0,1],['Softness','cloudSoftness',0,1],['Lighting','cloudLighting',0,1],['Sparkle','cloudSparkle',0,1]]) {
        const a = await shot({ [key]: low }, .42 * TAU), b = await shot({ [key]: high }, .42 * TAU);
        out.push({ label, changedPct: +changed(a.data, b.data).toFixed(1) });
      }
      return out;
    });
    console.table(rows);
    const weak = rows.filter(r => r.changedPct < 5);
    if (weak.length) { code = 1; console.error(`FAIL range: ${weak.map(r => `${r.label} ${r.changedPct}%`).join(', ')}`); } else console.log('PASS range');
  }
  if (want('export')) {
    const r = await page.evaluate(async () => {
      const { shot, mean, TAU } = window.cloud;
      const a = await shot({}, .25 * TAU), b = await shot({}, .25 * TAU);
      const start = await shot({}, 0), end = await shot({}, 299 / 300 * TAU);
      const midA = await shot({}, 150 / 300 * TAU), midB = await shot({}, 151 / 300 * TAU);
      const s1 = await shot({}, .7 * TAU); await shot({}, .2 * TAU); const s2 = await shot({}, .7 * TAU);
      return { repeat: mean(a.data, b.data), seam: mean(start.data, end.data), step: mean(midA.data, midB.data), seek: mean(s1.data, s2.data) };
    });
    console.log(`export repeat ${r.repeat.toFixed(3)}, loop seam ${r.seam.toFixed(3)} (ordinary frame step ${r.step.toFixed(3)}), seek ${r.seek.toFixed(3)}`);
    if (r.repeat > .001 || r.seek > .001 || r.seam > Math.max(1, r.step * 2.5)) { code = 1; console.error('FAIL export'); } else console.log('PASS export');
  }
  if (want('perf')) for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
    const r = await page.evaluate(async ([w, h]) => {
      const { renderer, projectFor, TAU } = window.cloud, p = projectFor(); await renderer.prepare(p);
      const gl = renderer.renderer.getContext(), px = new Uint8Array(4), times = [];
      for (let i = 0; i < 360; i++) { const t = performance.now(); renderer.render(p, (i % 600) / 600 * TAU, w, h, undefined, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (i > 60) times.push(performance.now() - t); await new Promise(requestAnimationFrame); }
      times.sort((a, b) => a - b); return { median: times[times.length >> 1], p99: times[Math.floor(times.length * .99)] };
    }, [w, h]);
    console.log(`${w}x${h} frame ms: median ${r.median.toFixed(1)}, p99 ${r.p99.toFixed(1)}`);
  }
  if (flags.includes('--profile')) {
    const rows = await page.evaluate(async () => {
      const { renderer, projectFor, TAU, m } = window.cloud, gl = renderer.renderer.getContext(), px = new Uint8Array(4), out = [];
      const run = async (label, p, w, h) => { await renderer.prepare(p); const times = []; for (let i = 0; i < 200; i++) { const t = performance.now(); renderer.render(p, (i % 600) / 600 * TAU, w, h, undefined, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (i > 40) times.push(performance.now() - t); await new Promise(requestAnimationFrame); } times.sort((a, b) => a - b); out.push({ label, res: h, median: +times[times.length >> 1].toFixed(1), p99: +times[Math.floor(times.length * .99)].toFixed(1) }); };
      const plain = m.createProject(); plain.layers = [m.createLayer('surface')];
      for (const [w, h] of [[1920, 1080], [3840, 2160]]) { await run('plain surface', plain, w, h); await run('cloud', projectFor(), w, h); await run('cloud, no points', projectFor({ cloudSparkle: 0 }), w, h); }
      return out;
    });
    console.table(rows);
  }
  if (want('fastpath')) {
    const r = await page.evaluate(async () => {
      const { renderer, projectFor, TAU } = window.cloud, p = projectFor(), gl = renderer.renderer.getContext(), W = 960, H = 540; await renderer.prepare(p);
      for (let i = 0; i < 120; i++) renderer.render(p, i / 600 * TAU, W, H, undefined, true);
      const read = full => { renderer.fullCompositorOnly = full; renderer.render(p, 119 / 600 * TAU, W, H, undefined, false); const a = new Uint8Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      const fast = read(false), full = read(true); renderer.fullCompositorOnly = false;
      let worst = 0, lit = 0; for (let i = 0; i < fast.length; i++) { worst = Math.max(worst, Math.abs(fast[i] - full[i])); if (i % 4 === 0 && full[i] + full[i + 1] + full[i + 2] > 30) lit++; }
      return { worst, litPct: lit / (W * H) * 100 };
    });
    console.log(`fast compositor differs by at most ${r.worst}/255 (${r.litPct.toFixed(0)}% of frame lit)`);
    if (r.worst > 1 || r.litPct < 5) { code = 1; console.error('FAIL fast compositor'); } else console.log('PASS fast compositor');
  }
  if (flags.includes('--passes')) {
    const rows = await page.evaluate(async () => {
      const { renderer, projectFor, TAU } = window.cloud, three = renderer.renderer, gl = three.getContext(), p = projectFor(), original = three.render.bind(three), totals = new Map();
      await renderer.prepare(p);
      for (let i = 0; i < 90; i++) renderer.render(p, i / 600 * TAU, 3840, 2160, undefined, true);
      // readPixels makes the GPU finish; gl.finish does not wait in Chromium.
      const sync = () => { const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE), format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT), buffer = type === gl.UNSIGNED_BYTE ? new Uint8Array(16) : type === gl.FLOAT ? new Float32Array(16) : new Uint16Array(16); gl.readPixels(0, 0, 1, 1, format, type, buffer); };
      const frames = 90; sync(); let idle = 0; for (let i = 0; i < 50; i++) { const t = performance.now(); sync(); idle += performance.now() - t; } idle /= 50;
      three.render = (scene, camera) => {
        const mesh = scene.children[0], material = mesh?.material, target = three.getRenderTarget(), size = target ? `${target.width}x${target.height}` : 'screen';
        const names = Object.keys(material?.uniforms ?? {}).slice(0, 3).join(','), key = `${mesh?.isPoints ? 'POINTS ' : ''}${names} @ ${size}`, t = performance.now();
        original(scene, camera); sync();
        const e = totals.get(key) ?? { ms: 0, calls: 0 }; e.ms += performance.now() - t; e.calls++; totals.set(key, e);
      };
            for (let i = 90; i < 90 + frames; i++) { renderer.render(p, i / 600 * TAU, 3840, 2160, undefined, true); await new Promise(requestAnimationFrame); }
      three.render = original; delete three.render;
      return [...totals].map(([pass, e]) => ({ pass: pass.slice(0, 58), msPerFrame: +(Math.max(0, e.ms - idle * e.calls) / frames).toFixed(2), calls: +(e.calls / frames).toFixed(1) })).sort((a, b) => b.msPerFrame - a.msPerFrame).slice(0, 22);
    });
    console.table(rows);
  }
  if (want('schemes')) {
    const data = await page.evaluate(async () => {
      const { shot, b64, m, TAU } = window.cloud, cw = 320, ch = 180, c = new OffscreenCanvas(cw * 5, (ch + 24) * 3), g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.font = '15px sans-serif';
      for (let i = 0; i < m.SMOKE_CLOUD_SCHEMES.length; i++) { const s = m.SMOKE_CLOUD_SCHEMES[i], x = (i % 5) * cw, y = Math.floor(i / 5) * (ch + 24); g.drawImage((await shot({}, 8.05 / 20 * TAU, s.id)).bitmap, x, y + 24, cw, ch); g.fillStyle = '#fff'; g.fillText(s.name, x + 6, y + 17); }
      return b64(c);
    });
    await save('schemes.png', data); console.log('Schemes written');
  }
  if (errors.length) { code = 1; console.error(errors.slice(0, 5).join('\n')); }
} catch (error) { code = 1; console.error(`FAIL ${String(error.message).split('\n')[0]}`); }
finally { await app.close(); }
process.exit(code);
