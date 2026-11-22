// Real Electron/WebGL checks for the Meridian renderer. Saves stills and a contact sheet to work/meridian/.
// Run: node scripts/verify-meridian.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/meridian');
const stage = path.join(out, 'stage');
await fs.mkdir(stage, { recursive: true });
await build({ stdin: { contents: `export * as THREE from 'three';
export {StudioRenderer} from './src/rendering/StudioRenderer';
export {MeridianRenderer} from './src/rendering/MeridianRenderer';
export {createProject,createLayer} from './src/core/project';
export {compose} from './src/meridian/composer';
export {DisplayList} from './src/meridian/display-list';
export {MERIDIAN_DEFAULTS} from './src/meridian/parameters';
export {PRIMITIVE} from './src/meridian/types';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(stage, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(stage, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(stage, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(stage, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(stage, 'index.html'))});});`);

const SEEDS = [1, 2, 3, 4, 5, 6];
// State index and how far through it the still is taken.
const STATES = { seed: [0, .6], draw: [1, .75], build: [2, .85], charge: [3, .6], peak: [4, .4], collapse: [5, .5], rest: [6, .5] };
const SHEET = ['draw', 'build', 'peak', 'collapse'];
const CHECKED = ['seed', 'build', 'peak', 'rest'];

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(stage, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const { THREE } = m;
    const studio = new m.StudioRenderer(document.querySelector('canvas'));
    const gl = studio.renderer;
    const meridian = new m.MeridianRenderer();
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false; scene.add(quad);
    const draw = (material, target) => { quad.material = material; gl.setRenderTarget(target); gl.render(scene, camera); };
    const floatTarget = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const layerFor = seed => { const layer = m.createLayer('meridian'); layer.id = `meridian-${seed}`; layer.params.seed = seed; return layer; };
    const phaseOf = (seed, index, share) => {
      const ends = m.compose(seed, m.MERIDIAN_DEFAULTS).stateEnds, start = index ? ends[index - 1] : 0;
      return Math.PI * 2 * (start + (ends[index] - start) * share);
    };
    const read = (target, w, h) => { const data = new Float32Array(w * h * 4); gl.readRenderTargetPixels(target, 0, 0, w, h, data); gl.setRenderTarget(null); return data; };
    const measure = (seed, index, share) => {
      const w = 960, h = 540, target = floatTarget(w, h);
      meridian.draw(gl, layerFor(seed), phaseOf(seed, index, share), w, h, target, draw);
      const data = read(target, w, h); target.dispose();
      let sum = 0, nan = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (!Number.isFinite(data[i]) || !Number.isFinite(data[i + 1]) || !Number.isFinite(data[i + 2]) || !Number.isFinite(data[i + 3])) nan++;
        else sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      }
      return { luma: sum / (w * h), nan };
    };
    // Light along a line through a ring, as a width: total light divided by the light of a solid line.
    const ringWidth = (lineWidth, w, h) => {
      const params = { ...m.MERIDIAN_DEFAULTS, lightBloomAmount: 0, lightLineGlow: 0, lightVignette: 0, colourFringe: 0, lightExposure: .25, lightCore: 0, outputMinLineWidth: .5 };
      const palette = ['#404040', '#404040', '#404040', '#404040', '#404040', '#000000'];
      const profile = width => {
        const list = new m.DisplayList(4), target = floatTarget(w, h);
        list.push(m.PRIMITIVE.ring, 0, 0, .31, 0, 0, width, 0, 0, 1, 0, 0);
        meridian.drawList(gl, list, params, palette, w, h, target, draw);
        const data = read(target, w, h); target.dispose();
        const row = Math.floor(h / 2) * w * 4;
        let total = 0, peak = 0;
        for (let x = Math.floor(w / 2); x < w; x++) { const v = data[row + x * 4 + 1]; total += v; peak = Math.max(peak, v); }
        return { total, peak };
      };
      const solid = profile(16);
      return profile(lineWidth).total / solid.peak;
    };
    window.meridianQA = { m, studio, layerFor, phaseOf, measure, ringWidth };
  });

  const report = { luma: {}, widths: {}, errors };
  // Collected so a failing run still saves the pictures that show why.
  const failures = [];
  await page.evaluate(([seed, index, share]) => window.meridianQA.measure(seed, index, share), [1, ...STATES.peak]);
  assert.deepEqual(errors, [], 'the shaders must compile');
  const STILL = [640, 360];
  for (const seed of SEEDS) {
    report.luma[seed] = {};
    for (const name of CHECKED) {
      const [index, share] = STATES[name];
      const { luma, nan } = await page.evaluate(([seed, index, share]) => window.meridianQA.measure(seed, index, share), [seed, index, share]);
      report.luma[seed][name] = luma;
      assert.equal(nan, 0, `seed ${seed} ${name}: ${nan} NaN pixels`);
    }
    const l = report.luma[seed];
    if (!(l.rest < .02)) failures.push(`seed ${seed}: Rest mean luma ${l.rest.toFixed(4)}`);
    if (!(l.peak > 2 * l.build)) failures.push(`seed ${seed}: Peak ${l.peak.toFixed(4)} is not twice Build ${l.build.toFixed(4)}`);
  }
  for (const [name, w, h] of [['1080p', 1920, 1080], ['4K', 3840, 2160]]) {
    const width = await page.evaluate(([w, h]) => window.meridianQA.ringWidth(1.5, w, h), [w, h]);
    report.widths[name] = width;
    if (!(Math.abs(width - 1.5) <= .5)) failures.push(`${name}: a 1.5 px ring measures ${width.toFixed(2)} px`);
  }

  // The shared layer controls still act on a Meridian layer.
  const shared = await page.evaluate(async () => {
    const { m, studio, layerFor, phaseOf } = window.meridianQA, phase = phaseOf(4, 4, .4);
    const frame = async (change, under) => {
      const project = m.createProject(), layer = layerFor(4); change(layer);
      project.layers = under ? [layerFor(2), layer] : [layer]; project.background = '#000000';
      const bitmap = await createImageBitmap(new Blob([await studio.exportPNG(project, phase, 320, 180)], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, 320, 180).data;
    };
    const apart = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    const plain = await frame(() => {}), over = await frame(() => {}, true);
    return {
      mask: apart(plain, await frame(l => { l.mask.kind = 'circle'; l.mask.size = .25; })),
      transform: apart(plain, await frame(l => { l.transform.x = .2; l.transform.scale = .7; })),
      opacity: apart(plain, await frame(l => { l.opacity = .4; })),
      blend: apart(over, await frame(l => { l.blend = 'add'; }, true)),
    };
  });
  report.shared = shared;
  for (const [name, change] of Object.entries(shared)) if (!(change > .3)) failures.push(`${name} has no effect on a Meridian layer (${change.toFixed(3)})`);

  // Stills go through the whole Studio path, so masks, blend and transform stay in the proof.
  const tiles = [];
  for (const name of SHEET) for (const seed of SEEDS) {
    const [index, share] = STATES[name];
    const bytes = await page.evaluate(async ([seed, index, share, w, h]) => {
      const { m, studio, layerFor, phaseOf } = window.meridianQA, project = m.createProject();
      project.layers = [layerFor(seed)]; project.background = '#000000';
      return Array.from(await studio.exportPNG(project, phaseOf(seed, index, share), w, h));
    }, [seed, index, share, ...STILL]);
    await fs.writeFile(path.join(out, `seed${seed}-${name}.png`), Buffer.from(bytes));
    tiles.push(bytes);
  }
  // Full-size frames, for judging line quality and the smoothness of a collapsing ring.
  for (const name of ['build', 'peak', 'collapse']) {
    const [index, share] = STATES[name];
    const bytes = await page.evaluate(async ([index, share]) => {
      const { m, studio, layerFor, phaseOf } = window.meridianQA, project = m.createProject();
      project.layers = [layerFor(4)]; project.background = '#000000';
      return Array.from(await studio.exportPNG(project, phaseOf(4, index, share), 1920, 1080));
    }, [index, share]);
    await fs.writeFile(path.join(out, `full-${name}.png`), Buffer.from(bytes));
  }
  const sheet = await page.evaluate(async ([tiles, across, w, h]) => {
    const canvas = new OffscreenCanvas(across * w, Math.ceil(tiles.length / across) * h), context = canvas.getContext('2d');
    for (let i = 0; i < tiles.length; i++) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(tiles[i])], { type: 'image/png' }));
      context.drawImage(bitmap, (i % across) * w, Math.floor(i / across) * h, w, h);
    }
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, [tiles, SEEDS.length, 400, 225]);
  await fs.writeFile(path.join(out, 'first-look.png'), Buffer.from(sheet));

  console.log(JSON.stringify(report.widths), JSON.stringify(report.shared), Object.entries(report.luma).map(([seed, l]) => `${seed}: build ${l.build.toFixed(3)} peak ${l.peak.toFixed(3)} rest ${l.rest.toFixed(4)}`).join(' | '));
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log('verify-meridian: PASS');
} finally {
  await app.close();
}
