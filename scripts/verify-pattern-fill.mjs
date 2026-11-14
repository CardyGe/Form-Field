// Regression checks for repeatable pattern zoom, not a shrunken source rectangle.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/pattern-fill');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';
export {EXRLoader} from 'three/addons/loaders/EXRLoader.js'; export {FloatType} from 'three';`,
  resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outfile: path.join(out, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js'), r = new m.StudioRenderer(document.querySelector('canvas'));
    const loader = new m.EXRLoader().setDataType(m.FloatType);
    const project = id => ({ ...m.createProject(), transparent: true, layers: [m.applyPreset(m.createLayer('graphic'), id)] });
    const exr = async (p, phase, width = 256, height = 144) => {
      const bytes = await r.exportEXR(p, phase, width, height);
      return loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).data;
    };
    const check = (value, label) => { if (!value) throw new Error(label); };
    const delta = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
    window.fillQA = { m, r, project, exr, check, delta };
  });
  const report = await page.evaluate(async () => {
    const { m, r, project, exr, check, delta } = window.fillQA, checks = [];
    for (const preset of m.PRESETS.filter(p => p.kind === 'graphic')) {
      const p = project(preset.id);
      Object.assign(p.layers[0].params, { size: .25, stretch: 1, centerX: 0, centerY: 0, orientation: 0, turns: 0, backgroundOpacity: 0 });
      const data = await exr(p, .7);
      let error = 0, samples = 0;
      // Four cells must repeat across both dimensions, including outside the
      // old centred rectangle. Check associated colour and genuine alpha.
      const radial = p.layers[0].params.style === 1 || p.layers[0].params.style === 3;
      const singleCore = p.layers[0].params.style === 4 && p.layers[0].params.variant === 3;
      for (let y = 0; y < 108; y++) for (let x = 0; x < 192; x++) for (let c = 0; c < 4; c++) {
        const value = data[(y * 256 + x) * 4 + c];
        check(Number.isFinite(value), preset.id + ': finite frame');
        if (!radial && !singleCore) {
          error += Math.abs(value - data[(y * 256 + x + 64) * 4 + c]);
          error += Math.abs(value - data[((y + 36) * 256 + x) * 4 + c]); samples += 2;
        }
      }
      if (!radial && !singleCore) check(error / samples < .00015, preset.id + ': shrinking must repeat the pattern through the frame (' + error / samples + ')');
      Object.assign(p.layers[0].params, { stretch: .4, centerX: .7, centerY: -.6, orientation: .75 });
      p.layers[0].transform = { x: .25, y: -.18, scale: .3, rotation: .45 };
      const moved = await exr(p, .7);
      check(delta(moved, await exr(p, .7 + Math.PI * 2)) < .00001, preset.id + ': periodic transformed field');
      check(moved.every(Number.isFinite), preset.id + ': finite transformed frame');
      checks.push({ preset: preset.id, field: radial ? 'extended radial geometry' : singleCore ? 'seamless grid with one radial core' : 'seamless grid', repeatError: radial || singleCore ? null : error / samples });
    }

    const solid = project('packed-mosaic');
    Object.assign(solid.layers[0].params, { size: .25, stretch: .4, centerX: .7, centerY: -.6, orientation: .75,
      tileGap: 0, roundness: 0, fill: 0, sweep: 0, motion: 0, backgroundOpacity: 0 });
    solid.layers[0].palette = ['#f5b333', '#f5b333', '#f5b333', '#f5b333', '#f5b333', '#000000'];
    solid.layers[0].transform = { x: .25, y: -.18, scale: .3, rotation: .45 };
    for (const [width, height] of [[256, 144], [144, 256], [192, 192]]) {
      const data = await exr(solid, 1.3, width, height);
      let alphaMin = 1, alphaMean = 0, edgeMean = 0, edges = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3]; alphaMin = Math.min(alphaMin, a); alphaMean += a;
        if (x < 4 || y < 4 || x >= width - 4 || y >= height - 4) { edgeMean += a; edges++; }
      }
      alphaMean /= width * height; edgeMean /= edges;
      check(alphaMin > .995 && alphaMean > .999 && edgeMean > .999, 'No rectangular border in ' + width + 'x' + height + ': ' + JSON.stringify({ alphaMin, alphaMean, edgeMean }));
      checks.push({ width, height, alphaMin, alphaMean, edgeMean });
    }
    // Animation and intentional masks retain their shared behavior.
    solid.layers[0].modulations.size = { kind: 'sine', cycles: 2, phase: 0, amount: .4, points: [] };
    check((await exr(solid, 2)).every((v, i) => i % 4 !== 3 || v > .995), 'Animated pattern size still fills the canvas');
    solid.layers[0].mask = { kind: 'circle', size: .8, softness: .2, invert: false };
    const masked = await exr(solid, .7);
    check(masked.some((v, i) => i % 4 === 3 && v === 0), 'Intentional masks still cut out the pattern');

    const source = m.createProject(); await r.prepare(source); r.render(source, .7, 256, 144);
    const ordinary = await exr(source, .7);
    await exr(project('nested-tiles'), 1.3);
    check(delta(ordinary, await exr(source, .7)) === 0, 'Repeating sampler must not leak into another instrument');
    const before = r.getStats().textures;
    await exr(project('nested-tiles'), .7); const allocated = r.getStats().textures;
    await r.prepare(source); r.render(source, .7, 256, 144);
    check(r.getStats().textures === before && allocated > before, 'Pattern mip target is released when the instrument is removed');
    checks.push({ animatedSize: true, intentionalMask: true, samplerIsolation: true, targetRelease: true });
    return { status: 'passed', checks };
  });
  for (const id of ['lava-columns', 'nested-tiles', 'circle-fans', 'web-rosette', 'maze-carpet']) {
    const bytes = await page.evaluate(async id => {
      const q = window.fillQA, p = q.project(id); Object.assign(p.layers[0].params, { size: .35, stretch: .65, orientation: .4 });
      return Array.from(await q.r.exportPNG(p, 1.3, 960, 540));
    }, id);
    await fs.writeFile(path.join(out, id + '.png'), Buffer.from(bytes));
  }
  const full = await page.evaluate(async () => {
    const q = window.fillQA, p = q.project('nested-tiles'); p.layers[0].params.size = .25;
    return Array.from(await q.r.exportPNG(p, 1.3, 3840, 2160));
  });
  await fs.writeFile(path.join(out, 'pattern-fill-4k.png'), Buffer.from(full));
  assert.deepEqual(errors, []); report.errors = errors;
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (errors.length) console.error(errors.join('\n'));
  await page.evaluate(() => window.fillQA?.r.dispose()).catch(() => {}); await app.close();
}
