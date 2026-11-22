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
export {MorphEngine} from './src/morphogen/engine';
export {defaultMorphParams} from './src/morphogen/params';
export {Passes} from './src/live/passes';
export {Gpu} from './src/map/gpu';
export {LiveRenderer} from './src/live/LiveRenderer';
export {defaultLiveSettings} from './src/live/settings';
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
  await check('three looks render as distinct, well-exposed pictures', async () => {
    const looks = [
      { palette: 0, formType: 1, fieldType: 0, wavelength: 13, asymmetry: .16, irid: .75 },
      { palette: 1, formType: 3, fieldType: 1, spiral: .22, wavelength: 18, asymmetry: .38, drive: .4, metal: .6, irid: .45, formSize: .34, formX: -.25 },
      { palette: 2, formType: 2, fieldType: 4, wavelength: 10, asymmetry: .08, metal: 1, roughness: .1, irid: .9, filmNm: 620, formSize: .55 },
    ];
    for (let n = 0; n < looks.length; n++) {
      const r = await page.evaluate(look => {
        const { m, renderer, passes } = window.t, engine = new m.MorphEngine(passes, 1920, 1080), params = { ...m.defaultMorphParams(), ...look };
        const input = { flow: null, people: null, impulse: 0, seedBurst: 0 };
        for (let i = 0; i < 900; i++) engine.step(1 / 60, i / 60, params, input);
        const copy = passes.material('uniform sampler2D uImage;void main(){vec3 c=clamp(texture2D(uImage,vUv).rgb,0.,1.);gl_FragColor=vec4(mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c)),1.);}', { uImage: { value: engine.output } });
        passes.draw(copy, null);
        const gl = renderer.getContext(), data = new Uint8Array(1920 * 1080 * 4); gl.readPixels(0, 0, 1920, 1080, gl.RGBA, gl.UNSIGNED_BYTE, data);
        let red = 0, green = 0, blue = 0, clipped = 0, black = 0;
        for (let i = 0; i < data.length; i += 4) { red += data[i]; green += data[i + 1]; blue += data[i + 2]; if (data[i] > 252 && data[i + 1] > 252 && data[i + 2] > 252) clipped++; if (data[i] + data[i + 1] + data[i + 2] < 12) black++; }
        const count = data.length / 4, image = renderer.domElement.toDataURL('image/png').split(',')[1];
        copy.dispose(); engine.dispose();
        return { mean: [red / count, green / count, blue / count], clipped: clipped / count, black: black / count, image };
      }, looks[n]);
      await fs.writeFile(path.join(out, `first-look-${n + 1}.png`), Buffer.from(r.image, 'base64'));
      console.log(`look ${n + 1}`, r.mean.map(v => v.toFixed(0)).join(','), 'clipped', r.clipped.toFixed(3), 'black', r.black.toFixed(3));
      assert.ok(r.clipped < .15, `look ${n + 1} clips ${r.clipped}`);
      assert.ok(r.black < .15, `look ${n + 1} is black over ${r.black}`);
      looks[n].mean = r.mean;
    }
    const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(apart(looks[0].mean, looks[1].mean) > 12 && apart(looks[1].mean, looks[2].mean) > 12 && apart(looks[0].mean, looks[2].mean) > 12, 'looks are too similar');
  });
  await check('the stripes themselves travel and reorganise', async () => {
    const r = await page.evaluate(() => {
      const { m, passes, field } = window.t, W = 1024, H = 576, solver = new m.MorphSolver(passes, W, H), params = { ...m.defaultMorphParams(), wavelength: 13, asymmetry: .16 };
      const input = { flow: null, people: null, impulse: 0, seedBurst: 0 };
      let frame = 0;
      const run = n => { for (let i = 0; i < n; i++) solver.step(1 / 60, frame++ / 60, params, input); };
      run(900); const a = field(solver, W, H); run(180); const b = field(solver, W, H); run(1620); const c = field(solver, W, H);
      solver.dispose();
      const correlate = (x, y) => { let xy = 0, xx = 0, yy = 0; for (let i = 0; i < x.length; i++) { xy += x[i] * y[i]; xx += x[i] * x[i]; yy += y[i] * y[i]; } return xy / Math.sqrt(xx * yy); };
      let peak = 0; for (const v of c) peak = Math.max(peak, Math.abs(v));
      return { after3s: correlate(a, b), after30s: correlate(a, c), peak };
    });
    console.log('motion', JSON.stringify(r));
    assert.ok(r.after3s < .8, `stripes barely moved in 3 s: correlation ${r.after3s.toFixed(3)}`);
    assert.ok(r.after30s < .35, `pattern did not reorganise in 30 s: correlation ${r.after30s.toFixed(3)}`);
    assert.ok(r.peak > .5, `motion dissolved the stripes: peak ${r.peak.toFixed(3)}`);
  });
  await check('the picture keeps moving, and frame cost is measured', async () => {
    await fs.rm(path.join(out, 'clip'), { recursive: true, force: true });
    await fs.mkdir(path.join(out, 'clip'), { recursive: true });
    await page.evaluate(() => {
      const { m, passes } = window.t, engine = new m.MorphEngine(passes, 1920, 1080);
      const params = { ...m.defaultMorphParams(), palette: 0, formType: 1, fieldType: 0, wavelength: 13, asymmetry: .16, irid: .75 };
      const input = { flow: null, people: null, impulse: 0, seedBurst: 0 };
      for (let i = 0; i < 900; i++) engine.step(1 / 60, i / 60, params, input);
      const copy = passes.material('uniform sampler2D uImage;void main(){vec3 c=clamp(texture2D(uImage,vUv).rgb,0.,1.);gl_FragColor=vec4(mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c)),1.);}', { uImage: { value: engine.output } });
      window.t.clip = { engine, params, input, copy, frame: 900 };
    });
    const timing = await page.evaluate(() => {
      const { renderer, passes, clip } = window.t, gl = renderer.getContext(), pixel = new Uint8Array(4), times = [];
      for (let i = 0; i < 180; i++) {
        const start = performance.now(); clip.engine.step(1 / 60, clip.frame++ / 60, clip.params, clip.input);
        clip.copy.uniforms.uImage.value = clip.engine.output; passes.draw(clip.copy, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return { median: times[90], p99: times[178] };
    });
    console.log(`frame ms at 1080p: median ${timing.median.toFixed(1)}, p99 ${timing.p99.toFixed(1)}`);
    let previous = null, change = 0;
    for (let n = 0; n < 150; n++) {
      const r = await page.evaluate(() => {
        const { renderer, passes, clip } = window.t;
        for (let i = 0; i < 2; i++) clip.engine.step(1 / 60, clip.frame++ / 60, clip.params, clip.input);
        clip.copy.uniforms.uImage.value = clip.engine.output; passes.draw(clip.copy, null);
        const gl = renderer.getContext(), small = new Uint8Array(1920 * 1080 * 4); gl.readPixels(0, 0, 1920, 1080, gl.RGBA, gl.UNSIGNED_BYTE, small);
        const sample = []; for (let i = 0; i < small.length; i += 4 * 97) sample.push(small[i + 1]);
        return { image: renderer.domElement.toDataURL('image/jpeg', .92).split(',')[1], sample };
      });
      await fs.writeFile(path.join(out, 'clip', `${String(n).padStart(4, '0')}.jpg`), Buffer.from(r.image, 'base64'));
      if (previous) { let sum = 0; for (let i = 0; i < r.sample.length; i++) sum += Math.abs(r.sample[i] - previous[i]); change += sum / r.sample.length; }
      previous = r.sample;
    }
    await page.evaluate(() => { const c = window.t.clip; c.copy.dispose(); c.engine.dispose(); });
    console.log(`mean change per clip frame: ${(change / 149).toFixed(2)} of 255`);
    assert.ok(change / 149 > 4, `the picture is too still: ${(change / 149).toFixed(2)}`);
  });
  await check('a fresh start forms stripes within two seconds', async () => {
    const variance = await page.evaluate(() => {
      const { m, passes, field } = window.t, W = 1024, H = 576, solver = new m.MorphSolver(passes, W, H), params = m.defaultMorphParams();
      for (let i = 0; i < 120; i++) solver.step(1 / 60, i / 60, params, { flow: null, people: null, impulse: 0, seedBurst: 0 });
      const u = field(solver, W, H); solver.dispose();
      let sum = 0, square = 0; for (const v of u) { sum += v; square += v * v; }
      return square / u.length - (sum / u.length) ** 2;
    });
    console.log('variance after 2 s', variance.toFixed(4));
    assert.ok(variance > .08, `stripes have not formed: ${variance}`);
  });
  await check('a pattern with every motion control off is stirred back to life', async () => {
    const r = await page.evaluate(async () => {
      const { m, passes } = window.t, engine = new m.MorphEngine(passes, 640, 360);
      const params = { ...m.defaultMorphParams(), flowSpeed: 0, surge: 0, shimmer: 0, breathing: 0, travel: 0, fieldDrift: 0, curlAmount: 0, forkRate: 0, orbit: 0 };
      const input = { flow: null, people: null, impulse: 0, seedBurst: 0 }; let best = 0;
      for (let i = 0; i < 3600; i++) { engine.step(1 / 60, i / 60, params, input); if (i % 30 === 0) await new Promise(done => setTimeout(done)); if (i > 1800) best = Math.max(best, engine.activity); }
      engine.dispose(); return { best };
    });
    console.log('rescued activity', r.best.toFixed(3));
    assert.ok(r.best > .1, `pattern stayed frozen: ${r.best}`);
  });
  await check('Hold keeps the pattern exactly still', async () => {
    const r = await page.evaluate(async () => {
      const { m, passes } = window.t, engine = new m.MorphEngine(passes, 640, 360), params = { ...m.defaultMorphParams(), speed: 1 };
      const input = { flow: null, people: null, impulse: 0, seedBurst: 0 };
      for (let i = 0; i < 180; i++) engine.step(1 / 60, i / 60, params, input);
      const held = { ...params, speed: 0, freezeFloor: 1 }, first = engine.readField();
      for (let i = 0; i < 300; i++) { engine.step(1 / 60, (180 + i) / 60, held, input); if (i % 30 === 0) await new Promise(done => setTimeout(done)); }
      const second = engine.readField(); engine.dispose(); let change = 0; for (let i = 0; i < first.length; i++) change = Math.max(change, Math.abs(first[i] - second[i]));
      return { change };
    });
    assert.equal(r.change, 0);
  });
  await check('the wall output applies the flash correction and probes the uncorrected picture', async () => {
    const r = await page.evaluate(async () => {
      const { m } = window.t, canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const gpu = new m.Gpu(canvas), source = document.createElement('canvas'); source.width = source.height = 8;
      const c2d = source.getContext('2d'); c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, 8, 8);
      const texture = gpu.upload(source, null), gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4);
      const draw = () => { gpu.begin(); gpu.layer(texture); gpu.finish(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(320, 180, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return pixel[0]; };
      const plain = draw(); gpu.setOutputCorrection(.25, 1); const dimmed = draw();
      gpu.requestFlashProbe(); let probe = null; for (let i = 0; i < 200 && !probe; i++) { await new Promise(done => setTimeout(done, 5)); probe = gpu.collectFlashProbe(); }
      gpu.setOutputCorrection(1, 1); const restored = draw();
      return { plain, dimmed, restored, probeSize: probe?.length, probeValue: probe?.[0] };
    });
    console.log('wall correction', JSON.stringify(r));
    assert.equal(r.plain, 255); assert.equal(r.restored, 255);
    assert.ok(Math.abs(r.dimmed - 136) <= 3, `dimmed to ${r.dimmed}`);
    assert.equal(r.probeSize, 64 * 36 * 4); assert.equal(r.probeValue, 255);
  });
  await check('changing simulation size keeps the pattern and its stripe width', async () => {
    const r = await page.evaluate(() => {
      const { m, passes } = window.t, solver = new m.MorphSolver(passes, 1024, 576), params = { ...m.defaultMorphParams(), flowSpeed: 0, surge: 0, breathing: 0, travel: 0, fieldDrift: 0, curlAmount: 0, forkRate: 0 };
      const input = { flow: null, people: null, impulse: 0, seedBurst: 0 };
      for (let i = 0; i < 600; i++) solver.step(1 / 60, i / 60, params, input);
      const read = (w, h) => { const d = new Float32Array(w * h * 4); passes.renderer.readRenderTargetPixels(solver.target, 0, 0, w, h, d); return d; };
      const before = read(1024, 576);
      solver.setQuality(12, 432);
      const after = read(768, 432);
      let xy = 0, xx = 0, yy = 0;
      for (let y = 8; y < 424; y++) for (let x = 8; x < 760; x++) { const a = after[(y * 768 + x) * 4], b = before[(Math.round((y + .5) * 4 / 3 - .5) * 1024 + Math.round((x + .5) * 4 / 3 - .5)) * 4]; xy += a * b; xx += a * a; yy += b * b; }
      for (let i = 0; i < 300; i++) solver.step(1 / 60, (600 + i) / 60, params, input);
      const settled = read(768, 432); let crossings = 0, rows = 0;
      for (let y = 40; y < 392; y += 8) { rows++; for (let x = 21; x < 748; x++) if (Math.sign(settled[(y * 768 + x) * 4]) !== Math.sign(settled[(y * 768 + x - 1) * 4])) crossings++; }
      solver.dispose();
      return { match: xy / Math.sqrt(xx * yy), crossingsPerRow: crossings / rows };
    });
    console.log('resample', JSON.stringify(r));
    assert.ok(r.match > .9, `pattern changed on resize: ${r.match}`);
  });
  await check('a lost graphics context brings the picture back within three seconds', async () => {
    const r = await page.evaluate(async () => {
      const { m } = window.t, canvas = document.createElement('canvas'), live = new m.LiveRenderer(canvas, { element: null, frameId: 0 });
      live.settings = { ...m.defaultLiveSettings(), look: 'morphogen' };
      for (let i = 0; i < 140; i++) live.frame(1 / 60);
      const gl = canvas.getContext('webgl2'), lose = gl.getExtension('WEBGL_lose_context');
      const mean = () => { const p = new Uint8Array(4 * 64); gl.readPixels(928, 508, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, p); let s = 0; for (let i = 0; i < p.length; i += 4) s += p[i] + p[i + 1] + p[i + 2]; return s / 64 / 3; };
      const before = mean(); lose.loseContext();
      await new Promise(done => setTimeout(done, 60));
      for (let i = 0; i < 5; i++) live.frame(1 / 60);
      lose.restoreContext();
      await new Promise(done => setTimeout(done, 100));
      const started = performance.now(); let after = 0;
      while (performance.now() - started < 3000 && after < 40) { live.frame(1 / 60); after = mean(); await new Promise(done => setTimeout(done)); }
      const result = { before, after, ms: performance.now() - started, ready: live.lookReady }; live.dispose(); return result;
    });
    console.log('recovery', JSON.stringify(r));
    assert.ok(r.before > 40, `no picture before: ${r.before}`);
    assert.ok(r.after >= 40 && r.ms < 3000, `picture did not return: ${r.after} after ${r.ms} ms`);
  });
  await check('camera movement pushes the stripes', async () => {
    const r = await page.evaluate(() => {
      const { m, passes, field } = window.t, W = 1024, H = 576, params = { ...m.defaultMorphParams(), flowSpeed: 0, surge: 0, breathing: 0, travel: 0, fieldDrift: 0, curlAmount: 0, fieldMix: 0, forkRate: 0 };
      const data = new Float32Array(16 * 9 * 4); for (let i = 0; i < 16 * 9; i++) { data[i * 4] = .004; data[i * 4 + 2] = 1; }
      const flow = new m.THREE.DataTexture(data, 16, 9, m.THREE.RGBAFormat, m.THREE.FloatType); flow.needsUpdate = true;
      const run = moving => { const solver = new m.MorphSolver(passes, W, H); let frame = 0; const go = (n, f) => { for (let i = 0; i < n; i++) solver.step(1 / 60, frame++ / 60, params, { flow: f, people: null, impulse: 0, seedBurst: 0 }); }; go(600, null); const a = field(solver, W, H); go(20, moving ? flow : null); const b = field(solver, W, H); solver.dispose(); let xy = 0, xx = 0, yy = 0; for (let i = 0; i < a.length; i++) { xy += a[i] * b[i]; xx += a[i] * a[i]; yy += b[i] * b[i]; } return xy / Math.sqrt(xx * yy); };
      const result = { still: run(false), moved: run(true) }; flow.dispose(); return result;
    });
    console.log('camera push', JSON.stringify(r));
    assert.ok(r.still > .95 && r.moved < r.still - .2, `still ${r.still}, moved ${r.moved}`);
  });
  await check('Live plays Morphogen with no camera at all', async () => {
    const r = await page.evaluate(() => {
      const { m } = window.t, canvas = document.createElement('canvas'), live = new m.LiveRenderer(canvas, { element: null, frameId: 0 });
      live.settings = { ...m.defaultLiveSettings(), look: 'morphogen' };
      for (let i = 0; i < 240; i++) live.frame(1 / 60);
      const gl = canvas.getContext('webgl2'), pixels = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      const result = { width: canvas.width, height: canvas.height, mean: sum / (pixels.length / 4) / 3 }; live.dispose(); return result;
    });
    console.log('live', JSON.stringify(r));
    assert.equal(r.height, 1080);
    assert.ok(r.mean > 40, `picture is dark: ${r.mean}`);
  });
  /* STAGES */
  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await app.close();
}
console.log(results.join('\n'));
