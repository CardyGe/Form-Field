// Show proof for Morphogen. Run: npm run test:morphogen:show -- --fuzz --flash --recover [--soak=8h]
// Results go to work/morphogen/show-proof.json, and the soak's minute-by-minute log to work/morphogen/soak.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'work/morphogen');
const has = name => process.argv.includes(`--${name}`);
const soakArg = process.argv.find(a => a.startsWith('--soak='))?.slice(7);
const soakMinutes = soakArg ? (soakArg.endsWith('h') ? parseFloat(soakArg) * 60 : parseFloat(soakArg)) : 0;
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {MorphEngine} from './src/morphogen/engine';
export {MorphPerformer} from './src/morphogen/performer';
export {MORPH_CONTROLS, defaultMorphParams, validateMorphParams} from './src/morphogen/params';
export {MORPH_LOOKS} from './src/morphogen/looks';
export {macrosFrom} from './src/morphogen/macros';
export {FlashLimiter} from './src/map/flash-limiter';
export {Passes} from './src/live/passes';
export {LiveRenderer} from './src/live/LiveRenderer';
export {defaultLiveSettings} from './src/live/settings';
export * as THREE from 'three';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'show.js'), logLevel: 'error' });
await fs.writeFile(path.join(out, 'show.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="a" width="640" height="360"></canvas>');
await fs.writeFile(path.join(out, 'show-main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data-show'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-background-timer-throttling');app.commandLine.appendSwitch('js-flags','--expose-gc');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:640,height:360,useContentSize:true,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'show.html'))});});`);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'show-main.cjs')], env });
const page = await app.firstWindow();
page.setDefaultTimeout(0);
const errors = [], results = {}, lines = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = async (name, run) => {
  try { results[name] = await run(); lines.push(`ok    ${name}  ${JSON.stringify(results[name])}`); }
  catch (error) { results[name] = { failed: String(error.message).split('\n')[0] }; lines.push(`FAIL  ${name}\n      ${results[name].failed}`); process.exitCode = 1; }
};

try {
  await page.evaluate(async () => {
    const m = await import('./show.js');
    const renderer = new m.THREE.WebGLRenderer({ canvas: document.querySelector('#a'), antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputColorSpace = m.THREE.LinearSRGBColorSpace; renderer.toneMapping = m.THREE.NoToneMapping; renderer.autoClear = false;
    const passes = new m.Passes(renderer);
    const copy = passes.material('uniform sampler2D uImage;void main(){vec3 c=clamp(texture2D(uImage,vUv).rgb,0.,1.);gl_FragColor=vec4(mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c)),1.);}', { uImage: { value: null } });
    const read = texture => {
      copy.uniforms.uImage.value = texture; passes.draw(copy, null);
      const gl = renderer.getContext(), data = new Uint8Array(640 * 360 * 4); gl.readPixels(0, 0, 640, 360, gl.RGBA, gl.UNSIGNED_BYTE, data); return data;
    };
    const describe = data => { let sum = 0, square = 0, n = 0; for (let i = 0; i < data.length; i += 16) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; sum += v; square += v * v; n++; } const mean = sum / n; return { mean, deviation: Math.sqrt(Math.max(0, square / n - mean * mean)) }; };
    let state = 123456789;
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    window.t = { m, renderer, passes, read, describe, random, input: () => ({ flow: null, people: null, impulse: 0, seedBurst: 0 }) };
  });

  if (has('fuzz')) await check('fuzz: 10,000 random valid changes', () => page.evaluate(async () => {
    const { m, passes, read, describe, random, input } = window.t, engine = new m.MorphEngine(passes, 640, 360), controls = m.MORPH_CONTROLS.filter(c => c.key !== 'seed');
    let params = m.defaultMorphParams(), bad = 0, worst = null, checks = 0, nonFinite = 0, lowest = 255, highest = 0, flattest = 255;
    for (let i = 0; i < 100; i++) engine.step(1 / 60, i / 60, params, input());
    for (let change = 0; change < 10000; change++) {
      // Most changes move one control, as a performer does. Every 250th throws every control somewhere new.
      const moved = change % 250 === 249 ? controls : [controls[Math.floor(random() * controls.length)]], next = { ...params };
      for (const c of moved) next[c.key] = c.min + random() * (c.max - c.min);
      params = m.validateMorphParams(next);
      engine.step(1 / 60, (100 + change) / 60, params, input());
      if (change % 20 === 19) {
        const d = describe(read(engine.output)); checks++;
        lowest = Math.min(lowest, d.mean); highest = Math.max(highest, d.mean); flattest = Math.min(flattest, d.deviation);
        if (d.mean < 3 || d.mean > 252 || d.deviation < .5) { bad++; worst ??= { change, ...d, params: { ...params } }; }
      }
      if (change % 200 === 199) { const f = engine.readField(); for (let i = 0; i < f.length; i += 4) if (!Number.isFinite(f[i]) || !Number.isFinite(f[i + 1]) || Math.abs(f[i]) > 1.5001) { nonFinite++; break; } await new Promise(done => setTimeout(done)); }
    }
    engine.dispose();
    if (bad || nonFinite) throw new Error(`${bad} bad pictures, ${nonFinite} bad fields. First: ${JSON.stringify(worst)}`);
    return { checks, lowestMean: +lowest.toFixed(1), highestMean: +highest.toFixed(1), lowestDeviation: +flattest.toFixed(2) };
  }));

  if (has('flash')) await check('flash: 10 Hz brightness on every look, through the limiter', () => page.evaluate(async () => {
    const { m, passes, read, input } = window.t, report = {};
    const toLinear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const worst = samples => { const times = (values, size) => { const t = []; let extreme = values[0], direction = 0; values.forEach((v, n) => { if ((direction > 0 && v > extreme) || (direction < 0 && v < extreme)) extreme = v; if (Math.abs(v - extreme) >= size) { const d = Math.sign(v - extreme); if (d !== direction) { t.push(n); direction = d; } extreme = v; } }); return t; }; const most = t => { let top = 0; for (let i = 0; i < t.length; i++) { let n = 0; while (i + n < t.length && t[i + n] - t[i] < 60) n++; top = Math.max(top, Math.floor(n / 2)); } return top; }; return Math.max(most(times(samples.map(c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2]), .1)), most(times(samples.map(c => { const s = c[0] + c[1] + c[2]; return s > 0 && c[0] / s >= .8 ? Math.max(0, (c[0] - c[1] - c[2]) * 320) : 0; }), 20))); };
    for (const look of m.MORPH_LOOKS) {
      const engine = new m.MorphEngine(passes, 640, 360), limiter = new m.FlashLimiter(), base = { ...m.defaultMorphParams(), ...look.params }, corrections = [], before = [], after = [];
      for (let i = 0; i < 180; i++) engine.step(1 / 60, i / 60, base, input());
      for (let n = 0; n < 240; n++) {
        const on = Math.floor(n / 3) % 2 === 0, data = read((engine.step(1 / 60, (180 + n) / 60, { ...base, exposure: on ? 2 : .25 }, input()), engine.output));
        const probe = new Uint8Array(64 * 36 * 4);
        for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) { const a = (Math.floor(y * 10) * 640 + x * 10) * 4, b = (y * 64 + x) * 4; probe[b] = data[a]; probe[b + 1] = data[a + 1]; probe[b + 2] = data[a + 2]; probe[b + 3] = 255; }
        const c = limiter.push(probe, 64, 36, n / 60); corrections.push(c);
        const applied = corrections[n - 2] ?? { gain: 1, redScale: 1 };
        let r = 0, g = 0, b = 0; for (let i = 0; i < probe.length; i += 4) { r += toLinear(probe[i]); g += toLinear(probe[i + 1]); b += toLinear(probe[i + 2]); }
        const count = probe.length / 4, mean = [r / count, g / count, b / count], l = .2126 * mean[0] + .7152 * mean[1] + .0722 * mean[2];
        before.push(mean); after.push(mean.map(v => (l + (v - l) * applied.redScale) * applied.gain));
      }
      engine.dispose();
      report[look.id] = { before: worst(before), after: worst(after) };
      await new Promise(done => setTimeout(done));
    }
    for (const [id, r] of Object.entries(report)) { if (r.before < 4) throw new Error(`${id}: the test did not produce a flash (${r.before})`); if (r.after > 3) throw new Error(`${id}: ${r.after} flashes in a second`); }
    return report;
  }));

  if (has('recover')) await check('recover: five forced graphics losses', () => page.evaluate(async () => {
    const { m } = window.t, canvas = document.createElement('canvas'), live = new m.LiveRenderer(canvas, { element: null, frameId: 0 }), times = [];
    live.settings = { ...m.defaultLiveSettings(), look: 'morphogen', quality: 720 };
    for (let i = 0; i < 140; i++) live.frame(1 / 60);
    const gl = canvas.getContext('webgl2'), lose = gl.getExtension('WEBGL_lose_context');
    const mean = () => { const p = new Uint8Array(4 * 64); gl.readPixels(canvas.width >> 1, canvas.height >> 1, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, p); let s = 0; for (let i = 0; i < p.length; i += 4) s += p[i] + p[i + 1] + p[i + 2]; return s / 64 / 3; };
    for (let round = 0; round < 5; round++) {
      lose.loseContext(); await new Promise(done => setTimeout(done, 60));
      for (let i = 0; i < 5; i++) live.frame(1 / 60);
      lose.restoreContext(); await new Promise(done => setTimeout(done, 60));
      const started = performance.now(); let shown = 0;
      while (performance.now() - started < 3000 && (shown < 40 || !live.lookReady)) { live.frame(1 / 60); shown = mean(); await new Promise(done => setTimeout(done)); }
      if (shown < 40 || !live.lookReady) throw new Error(`round ${round + 1}: no picture within 3 s`);
      times.push(Math.round(performance.now() - started));
    }
    live.dispose();
    return { recoveryMs: times };
  }));

  if (soakMinutes) await check(`soak: ${soakMinutes} minutes`, async () => {
    const log = await page.evaluate(async minutes => {
      const { m, passes, input } = window.t, engine = new m.MorphEngine(passes, 1920, 1080), performer = new m.MorphPerformer(), rows = [], started = performance.now(), gl = passes.renderer.getContext(), pixel = new Uint8Array(4);
      let frames = 0, last = performance.now(), times = [], nextMinute = 60000, look = 0, lowActivity = 0, nextLook = 20000;
      while (performance.now() - started < minutes * 60000) {
        const now = performance.now(), elapsed = now - started, seconds = Math.min(.1, (now - last) / 1000); last = now;
        if (elapsed > nextLook) { look = (look + 1) % m.MORPH_LOOKS.length; performer.morphTo(look, 6); nextLook += 20000; }
        const base = m.defaultMorphParams(), beat = Math.floor(elapsed / 500) % 2 === 0, played = performer.frame(seconds, base, m.macrosFrom({ ...base, impact: beat ? .62 : .5 }));
        const before = performance.now(); engine.step(seconds, elapsed / 1000, played.params, { ...input(), ...played.input });
        passes.draw(window.t.passes.soakCopy ??= passes.material('uniform sampler2D uImage;void main(){gl_FragColor=texture2D(uImage,vUv);}', { uImage: { value: null } }), null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); times.push(performance.now() - before); frames++;
        if (elapsed > nextMinute) {
          nextMinute += 60000; times.sort((a, b) => a - b);
          const f = engine.readField(); let finite = true; for (let i = 0; i < f.length; i += 64) if (!Number.isFinite(f[i])) { finite = false; break; }
          globalThis.gc?.();
          if (engine.activity < .05) lowActivity++; else lowActivity = 0;
          rows.push({ minute: rows.length + 1, frames, medianMs: +times[times.length >> 1].toFixed(2), p99Ms: +times[Math.floor(times.length * .99)].toFixed(2), heapMb: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), activity: +engine.activity.toFixed(3), finite, quality: engine.qualityState, lowActivity });
          times = [];
        }
        await new Promise(done => setTimeout(done, Math.max(0, 16 - (performance.now() - now))));
      }
      engine.dispose();
      return rows;
    }, soakMinutes);
    await fs.writeFile(path.join(out, 'soak.json'), JSON.stringify(log, null, 1));
    assert.ok(log.length >= Math.floor(soakMinutes) - 1, 'soak ended early');
    assert.ok(log.every(r => r.finite), 'field went non-finite');
    assert.ok(log.every(r => r.lowActivity < 2), 'activity stayed below the floor');
    const settled = log.find(r => r.minute >= Math.min(30, Math.ceil(log.length / 2))), final = log[log.length - 1];
    assert.ok(final.heapMb <= settled.heapMb * 1.1 + 2, `heap grew from ${settled.heapMb} to ${final.heapMb} MB`);
    const medians = log.map(r => r.medianMs).sort((a, b) => a - b), p99s = log.map(r => r.p99Ms).sort((a, b) => a - b);
    return { minutes: log.length, medianMs: medians[medians.length >> 1], worstP99Ms: p99s[p99s.length - 1], heapMb: [settled.heapMb, final.heapMb], lowestQuality: log.reduce((n, r) => Math.min(n, r.quality.steps), 12) };
  });
  await check('no page errors', async () => { assert.deepEqual(errors, []); return {}; });
} finally {
  await app.close();
}
await fs.writeFile(path.join(out, 'show-proof.json'), JSON.stringify(results, null, 1));
console.log(lines.join('\n'));
