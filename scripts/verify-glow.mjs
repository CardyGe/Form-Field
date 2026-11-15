// Real Electron/WebGL checks for the Glow finish.
// Run: node scripts/verify-glow.mjs [--baseline=<checkout of an older commit>]
// With --baseline, Oscilloscope looks are also compared pixel for pixel against that checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.find(a => a.startsWith('--baseline='))?.slice(11);
const out = path.join(root, 'work/glow-build');
await fs.mkdir(out, { recursive: true });
const bundle = (dir, file) => build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';`, resolveDir: dir, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, file), nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent' });
await bundle(root, 'renderer.js');
if (baseline) await bundle(path.resolve(baseline), 'baseline.js');
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="a" width="960" height="540"></canvas><canvas id="b" width="960" height="540"></canvas>');
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
  await page.evaluate(async hasBaseline => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('#a'));
    const old = hasBaseline ? await import('./baseline.js') : null;
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
    window.glowQA = { m, old, renderer, layer, project, pixels, shot, difference, mean };
  }, !!baseline);
  const capture = async (name, body, arg) => {
    const bytes = await page.evaluate(body, arg);
    const file = path.join(out, `${name}.png`);
    await fs.writeFile(file, Buffer.from(bytes));
    report.captures.push(path.relative(root, file));
  };
  const G = { soft: { glowMix: .8, glowThreshold: .6, glowSize: .4 }, haze: { glowMix: 1.2, glowThreshold: .15, glowSize: .9 }, hot: { glowMix: 1.5, glowThreshold: .8, glowSize: .2 } };
  await capture('liquid-off', async () => { const q = window.glowQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour')]))); });
  for (const [name, params] of Object.entries(G))
    await capture(`liquid-${name}`, async params => { const q = window.glowQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour', params)]))); }, params);
  await capture('liquid-tint', async params => { const q = window.glowQA; return Array.from(await q.shot(q.project([q.layer('liquid', 'blue-hour', params)]))); }, { ...G.haze, glowTint: 4 });
  await capture('sculpture-alpha', async params => { const q = window.glowQA; return Array.from(await q.shot(q.project([q.layer('sculpture', 'pearl-organism', params)], true))); }, G.haze);
  await capture('two-layers', async params => {
    const q = window.glowQA, top = q.layer('sculpture', 'pearl-organism'); top.transform.scale = .5; top.transform.x = .25;
    const under = q.layer('sculpture', 'pearl-organism', params); under.transform.scale = .5; under.transform.x = -.25;
    return Array.from(await q.shot(q.project([under, top], true)));
  }, { ...G.haze, glowMix: 2 });
  await capture('masked', async params => { const q = window.glowQA, l = q.layer('liquid', 'blue-hour', params); l.mask = { ...l.mask, kind: 'circle', size: .6, softness: .05 }; return Array.from(await q.shot(q.project([l]))); }, G.haze);
  await capture('tunnel-glow', async params => { const q = window.glowQA; return Array.from(await q.shot(q.project([q.layer('surface', null, params)]))); },
    { echo: .95, echoZoom: .9, echoRotate: 1.5, echoHue: 6, echoFrame: .62, echoBlend: 1, ...G.soft });

  report.checks = await page.evaluate(async ([G, TAU]) => {
    const q = window.glowQA, px = async (...args) => q.pixels(await q.shot(...args));
    const liquid = params => q.project([q.layer('liquid', 'blue-hour', params)]);
    const off = await px(liquid({})), soft = await px(liquid(G.soft)), haze = await px(liquid(G.haze));
    const zero = await px(liquid({ glowMix: 0, glowThreshold: 0, glowSize: 1, glowTint: 3 }));
    const whole = await px(liquid({ ...G.soft, glowThreshold: 0 })), hottest = await px(liquid({ ...G.soft, glowThreshold: .95 }));
    const p = liquid(G.haze);
    const start = await px(p, 0), end = await px(p, TAU), elsewhere = await px(p, 1.7), again = await px(p, 0);
    // The same frame at 1× and supersampled 2×: the glow must be the same width.
    const one = await px(p, .9, 960, 540, 1), two = await px(p, .9, 960, 540, 2), plain = liquid({});
    const sampling = q.difference(await px(plain, .9, 960, 540, 1), await px(plain, .9, 960, 540, 2));
    // What the glow adds must be the same share of the picture at every render size.
    const gain = async (width, height) => q.mean(await px(p, .9, width, height)) - q.mean(await px(plain, .9, width, height));
    const gains = { small: await gain(480, 270), base: await gain(960, 540), big: await gain(1920, 1080), uhd: await gain(3840, 2160) };
    // Feedback with glow: loop closes and seeking repeats.
    const tunnel = q.project([q.layer('surface', null, { echo: .95, echoZoom: .9, echoRotate: 1.5, echoHue: 6, echoFrame: .62, echoBlend: 1, ...G.soft })]);
    const t0 = await px(tunnel, 0), t1 = await px(tunnel, TAU);
    const tunnelOff = q.project([q.layer('surface', null, { echo: .95, echoZoom: .9, echoRotate: 1.5, echoHue: 6, echoFrame: .62, echoBlend: 1 })]);
    // Transparent export: the glow outside the shape carries partial alpha.
    const clear = await px(q.project([q.layer('sculpture', 'pearl-organism')], true)), lit = await px(q.project([q.layer('sculpture', 'pearl-organism', G.haze)], true));
    let partialOff = 0, partialOn = 0, gained = 0, darkFringe = 0;
    for (let i = 0; i < lit.length; i += 4) {
      if (clear[i + 3] > 8 && clear[i + 3] < 247) partialOff++;
      if (lit[i + 3] > 8 && lit[i + 3] < 247) partialOn++;
      if (clear[i + 3] === 0 && lit[i + 3] > 8) { gained++; if (Math.max(lit[i], lit[i + 1], lit[i + 2]) < 40) darkFringe++; }
    }
    // Glow is light: over a lower layer it may only add, whatever the grade.
    const over = (params, exposure) => { const top = q.layer('sculpture', 'pearl-organism', { ...params, exposure }); top.transform.scale = .5;
      const p = q.project([q.layer('liquid', 'blue-hour'), top]); p.highlights = 'exact'; return p; };
    const darkened = async exposure => { const without = await px(over({}, exposure)), withGlow = await px(over({ ...G.haze, glowMix: 2 }, exposure)); let n = 0;
      for (let i = 0; i < without.length; i += 4) if (withGlow[i] < without[i] - 6 || withGlow[i + 1] < without[i + 1] - 6 || withGlow[i + 2] < without[i + 2] - 6) n++;
      return n / (without.length / 4); };
    const darkens = { plain: await darkened(1), dimmed: await darkened(.25) };
    // A glow colour must not make the glow of a saturated source vanish.
    const tinted = q.mean(await px(liquid({ ...G.haze, glowTint: 4 }))) - q.mean(off);
    // Unsupported kinds ignore saved glow values.
    const scope = params => q.project([q.layer('scope', 'ember-ring', params)]);
    const gl = q.renderer.renderer.getContext(), pixel = new Uint8Array(4), frames = 40;
    const time = project => { q.renderer.render(project, 0, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); const began = performance.now();
      for (let i = 0; i < frames; i++) { q.renderer.render(project, i * .05, 1920, 1080); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); } return (performance.now() - began) / frames; };
    await q.renderer.prepare(plain); const plainMs = time(plain); await q.renderer.prepare(p); const glowMs = time(p);
    return {
      zeroIsNeutral: q.difference(off, zero), means: { off: q.mean(off), soft: q.mean(soft), haze: q.mean(haze), whole: q.mean(whole), hottest: q.mean(hottest) },
      wrap: q.difference(start, end), seek: q.difference(start, again), move: q.difference(start, elsewhere),
      supersample: q.difference(one, two), supersampleWithoutGlow: sampling, gains,
      tunnelWrap: q.difference(t0, t1), tunnelGain: q.mean(t0) - q.mean(await px(tunnelOff, 0)),
      alpha: { partialOff, partialOn, gained, darkFringe }, darkens, tint: { tinted, untinted: q.mean(haze) - q.mean(off) },
      scopeIgnoresGlow: q.difference(await px(scope({})), await px(scope({ glowMix: 2, glowThreshold: 0 }))),
      frameMs: { plain: plainMs, glow: glowMs },
    };
  }, [G, TAU]);
  const c = report.checks;
  assert.equal(c.zeroIsNeutral, 0, 'Glow amount 0 changes the picture.');
  assert.ok(c.means.soft > c.means.off + .5 && c.means.haze > c.means.soft, `Glow adds no light: ${JSON.stringify(c.means)}`);
  assert.ok(c.means.whole > c.means.soft && c.means.soft > c.means.hottest && c.means.hottest >= c.means.off, `Threshold is not ordered: ${JSON.stringify(c.means)}`);
  assert.equal(c.wrap, 0, 'A glowing loop does not close.');
  assert.equal(c.seek, 0, 'Seeking back gives a different glowing frame.');
  assert.ok(c.move > .5, 'Phase stills are too alike.');
  assert.ok(c.supersample < c.supersampleWithoutGlow + 1, `Supersampling changes the glow: ${c.supersample} against ${c.supersampleWithoutGlow} without glow.`);
  for (const [size, gain] of Object.entries(c.gains)) assert.ok(Math.abs(gain / c.gains.base - 1) < .05, `Glow changes with render size (${size}): ${JSON.stringify(c.gains)}`);
  assert.equal(c.tunnelWrap, 0, 'A glowing feedback loop does not close.');
  assert.ok(c.tunnelGain > 0 && c.tunnelGain < 60, `Glow builds up through feedback: ${c.tunnelGain}`);
  assert.ok(c.alpha.gained > 2000 && c.alpha.partialOn > c.alpha.partialOff * 2, `Glow carries no alpha: ${JSON.stringify(c.alpha)}`);
  assert.ok(c.alpha.darkFringe < c.alpha.gained * .02, `Dark fringe in the glow: ${JSON.stringify(c.alpha)}`);
  assert.ok(c.darkens.plain < .001 && c.darkens.dimmed < .001, `Glow darkens the layer below: ${JSON.stringify(c.darkens)}`);
  assert.ok(c.tint.tinted > c.tint.untinted * .5, `A glow colour dims the glow: ${JSON.stringify(c.tint)}`);
  assert.equal(c.scopeIgnoresGlow, 0, 'The Oscilloscope responds to glow values.');
  assert.ok(c.frameMs.glow < 16.7, `${c.frameMs.glow.toFixed(1)} ms per glowing 1080p frame.`);

  if (baseline) {
    c.scopeAgainstBaseline = await page.evaluate(async () => {
      const q = window.glowQA, before = new q.old.StudioRenderer(document.querySelector('#b')), result = {};
      for (const preset of q.old.PRESETS.filter(p => p.kind === 'scope')) {
        const make = m => { const p = m.createProject(); p.layers = [m.applyPreset(m.createLayer('scope'), preset.id)]; p.layers[0].id = 'scope-proof'; p.background = '#000000'; return p; };
        const now = make(q.m), then = make(q.old);
        await q.renderer.prepare(now); await before.prepare(then);
        result[preset.id] = q.difference(await q.pixels(await q.renderer.exportPNG(now, .3, 960, 540)), await q.pixels(await before.exportPNG(then, .3, 960, 540)));
      }
      before.dispose();
      return result;
    });
    for (const [id, d] of Object.entries(c.scopeAgainstBaseline)) assert.equal(d, 0, `${id}: the Oscilloscope changed against the baseline.`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app.close();
}
