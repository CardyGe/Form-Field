// Actual Electron/WebGL output, followed by the application's native encoder.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/super8-integration');
const require = createRequire(import.meta.url);
const { ExportManager, resolveMediaTools } = require('../electron/export-manager.cjs');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS,parameterDefinitions,validateProject} from './src/core/project';
export {EXRLoader} from 'three/addons/loaders/EXRLoader.js'; export {FloatType} from 'three';`,
  resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outfile: path.join(out, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = { errors, modes: [], checks: [], exports: [] };
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('canvas'));
    const loader = new m.EXRLoader().setDataType(m.FloatType);
    const projectFor = id => { const p = m.createProject(); p.transparent = true;
      p.layers = [m.applyPreset(m.createLayer('super8'), id)]; return p; };
    const exr = async (p, phase, w = 320, h = 180) => {
      const bytes = await renderer.exportEXR(p, phase, w, h);
      return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data;
    };
    const delta = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    const check = (condition, label) => { if (!condition) throw new Error(label); };
    const stats = data => {
      let zero = 0, soft = 0, one = 0;
      for (let i = 0; i < data.length; i += 4) {
        for (let j = 0; j < 4; j++) check(Number.isFinite(data[i + j]), 'nonfinite pixel');
        const a = data[i + 3]; check(a >= 0 && a <= 1, 'invalid alpha');
        if (a === 0) { zero++; check(data[i] === 0 && data[i+1] === 0 && data[i+2] === 0, 'RGB in transparent pixel'); }
        else if (a === 1) one++; else soft++;
      }
      return { zero, soft, one };
    };
    window.super8QA = { m, renderer, projectFor, exr, delta, check, stats };
  });
  const ids = ['chromatic-staircase', 'paint-destruction', 'scratched-negative', 'cut-out-collage'];
  for (const id of ids) {
    const result = await page.evaluate(async id => {
      const { m, renderer, projectFor, exr, delta, check, stats } = window.super8QA;
      const p = projectFor(id), a = await exr(p, .7);
      check(stats(a).one === 320*180, id + ': opaque substrate');
      const heldProject = structuredClone(p);
      Object.assign(heldProject.layers[0].params, { pullDown: 0, shutter: 0, reelLoops: 0, lightLeak: 0 });
      check(delta(await exr(heldProject, .7), await exr(heldProject, .701)) === 0, id + ': paint frame hold');
      check(delta(a, await exr(p, .7 + Math.PI * 2)) === 0, id + ': periodic wrap');
      await exr(p, 4.8); check(delta(a, await exr(p, .7)) === 0, id + ': seeking');
      const fresh = new m.StudioRenderer(document.createElement('canvas'));
      const bytes = await fresh.exportEXR(p, .7, 320, 180); fresh.dispose();
      const b = new m.EXRLoader().setDataType(m.FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data;
      check(delta(a, b) === 0, id + ': fresh renderer/resume');
      check(delta(a, await exr(p, 2.3)) > .005, id + ': visible animation');
      p.layers[0].params.substrate = 0;
      const cutout = stats(await exr(p, .7)); check(cutout.zero > 0 && cutout.soft > 0, id + ': cutout');
      p.layers[0].mask = { kind: 'circle', size: .65, softness: .15, invert: false };
      p.layers[0].opacity = .37;
      const masked = stats(await exr(p, .7)); check(masked.zero > 0 && masked.soft > 0 && !masked.one, id + ': mask/opacity');
      return { id, cutout, masked, repeatable: true };
    }, id);
    report.modes.push(result);
    for (const phase of [.7, 2.3]) {
      const bytes = await page.evaluate(async ({ id, phase }) => Array.from(await window.super8QA.renderer.exportPNG(window.super8QA.projectFor(id), phase, 960, 540)), { id, phase });
      await fs.writeFile(path.join(out, `${id}-${phase}.png`), Buffer.from(bytes));
    }
    console.log('Verified ' + id);
  }
  report.checks = await page.evaluate(async () => {
    const { m, renderer, projectFor, exr, delta, check, stats } = window.super8QA;
    const p = projectFor('chromatic-staircase'); Object.assign(p.layers[0].params, {pullDown:0, shutter:0, reelLoops:0, lightLeak:0}); const reference = await exr(p, .7);
    const results = [];
    for (const [key, value] of Object.entries({ scale: 2.1, steps: 5, coverage: .3, erosion: .95, rotation: 1.4,
      texture: 0, textureScale: 2.8, roughness: 0, bleed: 1, travel: 1, cycles: 3, filmFps: 5,
      feedback: .85, feedbackSpacing: 12, feedbackZoom: -.15, feedbackRotation: -.3,
      scratches: 1, grain: 1, flicker: 1, weave: 1, substrate: 0 })) {
      const altered = structuredClone(p); altered.layers[0].params[key] = value;
      const d = delta(reference, await exr(altered, .7));
      check(d > .000001, 'inactive control: ' + key); results.push({ control: key, difference: d });
    }
    // Isolate every new control, including conditional gate/perforation options.
    for (const [key, value] of Object.entries({ emulsion: 1, gateMode: 1, gateInset: .2, gateRoundness: 1,
      sprockets: 1, pullDown: 1, shutter: 1, shutterBlades: 3, reelLoops: 3, frameLines: 1,
      dust: 1, hair: 1, lightLeak: 1, halation: 1, vignette: 1, lensSoftness: 1, colorFade: 1 })) {
      const baseline = structuredClone(p);
      if (['gateInset','gateRoundness'].includes(key)) baseline.layers[0].params.gateMode = 1;
      if (key === 'sprockets') baseline.layers[0].params.gateMode = 2;
      if (key === 'shutterBlades') baseline.layers[0].params.shutter = .8;
      const changed = structuredClone(baseline); changed.layers[0].params[key] = value;
      const d = delta(await exr(baseline, .7),await exr(changed, .7));
      check(d > .000001, 'inactive projector control: '+key); results.push({projectorControl:key,difference:d});
    }
    const projector = projectFor('scratched-negative');
    Object.assign(projector.layers[0].params, {pullDown:1,shutter:.8,reelLoops:3,lightLeak:.7});
    const snapshot = structuredClone(projector), image = await exr(projector,.7);
    check(delta(image, await exr(projector,.701)) > .0001, 'projector moves between held paint frames');
    for (const phase of [0,.1,.7,2.3,6.2]) {
      check(delta(await exr(projector,phase),await exr(projector,phase+Math.PI*2)) === 0,'projector exact loop '+phase);
    }
    await exr(projector,4.8); check(delta(image,await exr(projector,.7)) === 0,'projector seek');
    const fresh = new m.StudioRenderer(document.createElement('canvas'));
    const bytes = await fresh.exportEXR(projector,.7,320,180); fresh.dispose();
    const decoded = new m.EXRLoader().setDataType(m.FloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).data;
    check(delta(image,decoded) === 0,'projector resume');
    check(JSON.stringify(projector) === JSON.stringify(snapshot),'projector mutated authored settings');
    for (const seed of [0,4294967295]) {
      const seeded=structuredClone(projector); seeded.layers[0].params.seed=seed;
      const a=await exr(seeded,.7);stats(a);
      check(delta(a,await exr(seeded,.7+Math.PI*2))===0,'projector seed range must remain periodic');
    }
    results.push({continuousProjector:true,exactLoop:true,seekAndResume:true,fullSeedRange:true});
    for (const [w,h] of [[320,180],[180,320],[240,240]]) for (const scale of [.5,1,3]) {
      const fullCanvas = projectFor('chromatic-staircase'); fullCanvas.layers[0].params.scale = scale;
      const pixels = await exr(fullCanvas,.7,w,h);
      check(stats(pixels).one === w*h,'full canvas must retain coverage at any paint scale');
      for (let x=0;x<w;x++) for (const y of [0,h-1]) {
        const i=(y*w+x)*4;
        check(pixels[i]+pixels[i+1]+pixels[i+2] > .005,'paint scale introduced a black canvas border');
      }
    }
    results.push({fullCanvasSizing:true,portraitLandscapeSquare:true});
    const animated = structuredClone(p);
    animated.layers[0].modulations.texture = { kind: 'noise', cycles: 3, phase: .2, amount: .8, points: [] };
    animated.layers[0].modulations['transform.x'] = { kind: 'sine', cycles: 1, phase: 0, amount: .1, points: [] };
    const held = await exr(animated, .7);
    check(delta(held, await exr(animated, .701)) === 0, 'animated params/transform must hold at film rate');
    check(delta(held, await exr(animated, .7 + Math.PI*2)) === 0, 'animated periodic history');
    results.push({ animatedHistory: true });
    for (let mode = 0; mode < 4; mode++) {
      const still = structuredClone(p);
      Object.assign(still.layers[0].params, { mode, travel: 0, grain: 0, scratches: 0, flicker: 0, weave: 0, emulsion: 0, dust: 0, hair: 0 });
      check(delta(await exr(still, 0), await exr(still, 2.3)) === 0, 'intrinsic motion must stop: mode ' + mode);
      Object.assign(still.layers[0].params, { coverage: 0, substrate: 0 });
      check(stats(await exr(still, .7)).zero === 320*180, 'zero paint coverage: mode ' + mode);
    }
    results.push({ zeroMotion: true, zeroCoverage: true });
    const noFeedback = structuredClone(p); noFeedback.layers[0].params.feedback = 0;
    check(delta(reference, await exr(noFeedback, .7)) > .0001, 'feedback must change paint');
    for (let mode = 0; mode < 4; mode++) {
      const extreme = projectFor('chromatic-staircase');
      for (const side of ['min', 'max']) {
        for (const d of m.parameterDefinitions('super8')) extreme.layers[0].params[d.key] = d[side];
        Object.assign(extreme.layers[0].params, { mode, substrate: 0 });
        stats(await exr(extreme, 1.7, 180, 320));
      }
    }
    results.push({ extremesAllModes: true });
    const mixed = structuredClone(p);
    for (const kind of ['surface', 'oil', 'fractal']) mixed.layers.push(m.createLayer(kind));
    mixed.layers[1].blend = 'screen'; mixed.layers[1].opacity = .3;
    mixed.layers[2].mask = { kind: 'rectangle', size: .45, softness: .1, invert: false };
    mixed.layers[3].opacity = .3;
    m.validateProject(mixed); stats(await exr(mixed, .7));
    const duplicate = structuredClone(p); const second = m.createLayer('super8'); second.params.mode = 3;
    duplicate.layers.push(second); const two = await exr(duplicate, .7);
    await exr(projectFor('scratched-negative'), 3.8);
    check(delta(two, await exr(duplicate, .7)) === 0, 'feedback must not leak between layers/projects');
    results.push({ mixedComposition: true, layerIsolation: true });
    await renderer.prepare(m.createProject());
    check(renderer.super8Source === null,'projector target must release when no film layer is visible');
    results.push({projectorResourceRelease:true});
    const started = performance.now(); const full = stats(await exr(p, .7, 3840, 2160));
    results.push({ fullResolution: '3840x2160', milliseconds: performance.now()-started, ...full });
    const fence = () => renderer.renderer.readRenderTargetPixelsAsync(renderer.linearOutput, 0, 0, 1, 1, new Uint16Array(4));
    renderer.render(p, .7, 960, 540);
    await fence();
    const previewStart = performance.now();
    for (let i = 0; i < 10; i++) { renderer.render(p, .7+i*.07, 960, 540); await fence(); }
    results.push({ previewResolution: '960x540', millisecondsPerFrame: (performance.now()-previewStart)/10 });
    return results;
  });
  const thumbnail = await page.evaluate(async () => Array.from(await window.super8QA.renderer.exportPNG(window.super8QA.projectFor('scratched-negative'), .7, 480, 270)));
  await fs.writeFile(path.join(out, 'super8-thumbnail.png'), Buffer.from(thumbnail));

  if (process.env.SUPER8_CAPTURE_MOTION === '1') {
    const directory = path.join(out,'motion'); await fs.mkdir(directory,{recursive:true});
    for (let index=0;index<60;index++) {
      const bytes = await page.evaluate(async index => {
        const p = window.super8QA.projectFor('scratched-negative');
        Object.assign(p.layers[0].params,{reelLoops:5,shutter:.3,lightLeak:.4,filmFps:18});
        return Array.from(await window.super8QA.renderer.exportPNG(p,index/30/10*Math.PI*2,640,360));
      },index);
      await fs.writeFile(path.join(directory,String(index).padStart(3,'0')+'.png'),Buffer.from(bytes));
    }
    const encoded = spawnSync(resolveMediaTools().ffmpegPath,['-v','error','-y','-framerate','30','-i',path.join(directory,'%03d.png'),
      '-c:v','prores_ks','-profile:v','3','-pix_fmt','yuv422p10le',path.join(out,'projector-preview.mov')],{timeout:60000});
    assert.equal(encoded.status,0,encoded.stderr.toString());
    report.checks.push({motionPreview:path.join(out,'projector-preview.mov'),frames:60});
  }
  const project = await page.evaluate(() => { const p = window.super8QA.projectFor('cut-out-collage'); p.duration = .2;
    p.width = 192; p.height = 108; p.layers[0].params.substrate = 0; return p; });
  const tools = resolveMediaTools();
  const jobsDirectory = await fs.mkdtemp(path.join(out, 'export-jobs-'));
  const options = { ...tools, jobsDirectory, defaultExportDir: out, rendererFingerprint: 'super8-integration-proof' };
  const manager = new ExportManager(options);
  for (const format of ['png', 'prores4444']) {
    let job = await manager.beginExport({ project, format, width: 192, height: 108,
      fps: project.fps, frameCount: 6, transparent: true, background: project.background });
    for (let index = 0; index < 6; index++) {
      const bytes = await page.evaluate(async ({ project, index }) => Array.from(await window.super8QA.renderer.exportEXR(project, index*Math.PI*2/6, 192, 108)), { project, index });
      await manager.writeFrame(job.id, index, Buffer.from(bytes));
      if (index === 1) { await manager.cancelExport(job.id); job = await manager.resumeExport(job.id); }
    }
    const completed = await manager.finishExport(job.id);
    assert.equal(completed.status, 'complete');
    report.exports.push({ format, path: completed.outputPath, frames: completed.completedFrames.length, resumed: true });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (errors.length) console.error(errors.join('\n'));
  await page.evaluate(() => window.super8QA?.renderer.dispose()).catch(() => {});
  await app.close();
}
