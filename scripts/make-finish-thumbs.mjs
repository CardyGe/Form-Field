// Renders the Add effect thumbnails with the real effects on one shared source.
// Run: node scripts/make-finish-thumbs.mjs [--only=id,id]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/finish-thumbs');
const assets = path.join(root, 'src/ui/assets/finish');
const RECIPES = {
  colour: { saturation: 1.8, hue: 1.1 }, tone: { toneContrast: 1.8, toneGamma: .72 }, balance: { gradeTemperature: .85, gradeTint: .3 },
  gradient: { gradMix: 1, gradPalette: 1 }, key: { keyMix: 1, keyLow: .42, keySoftness: .05 }, glow: { glowMix: 1.7, glowThreshold: .32, glowSize: .62 },
  split: { splitAmount: 34, splitSamples: 9 }, print: { printMix: 1, printSize: 15 }, flat: { toonMix: 1, toonBands: 4, toonOutline: 2.5 },
  time: { slitShift: 1, slitSpan: 70, slitShape: 4, slitBlocks: 5, slitSlices: 8 }, feedback: { echo: .95, echoZoom: .88, echoRotate: 2, echoFrame: .55 },
  warp: { bendAmount: .09, bendField: 0, bendScale: 4, bendAngle: 20 }, liquid: { liquidAmount: .3, liquidStyle: 0, liquidScale: 1.6 },
  led: { ledAmount: 1, ledSize: 30, ledShape: 0 }, chars: { charAmount: 1, charSize: 40, charContrast: 1.6, charSet: 0 }, tiles: { tileAmount: 1, tileStyle: 0, tileSize: 40 },
  lumaWarp: { lumaWarpAmount: .16, lumaWarpMode: 0, lumaWarpAngle: 60 }, polar: { polarAmount: 1, polarMode: 0 }, mirror: { mirrorAmount: 1, mirrorMode: 3, mirrorSegments: 6 },
};
// --only=warp,liquid renders just those, so the thumbnails already in the app stay byte for byte.
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);
for (const id of only ?? []) if (!(id in RECIPES)) throw new Error('No recipe for ' + id);
const chosen = Object.fromEntries(Object.entries(RECIPES).filter(([id]) => !only || only.includes(id)));
await fs.mkdir(out, { recursive: true }); await fs.mkdir(assets, { recursive: true });
await build({ stdin: { contents: "export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer} from './src/core/project';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), loader: { '.png': 'dataurl', '.jpg': 'dataurl' }, logLevel: 'error' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="a" width="480" height="240"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:640,height:400,webPreferences:{backgroundThrottling:false,contextIsolation:true}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState();
  const images = await page.evaluate(async recipes => {
    const m = await import('./renderer.js'), renderer = new m.StudioRenderer(document.querySelector('#a')), result = {};
    for (const [id, params] of Object.entries(recipes)) {
      const layer = m.createLayer('surface'); layer.params.seed = 1729; Object.assign(layer.params, params);
      const project = { ...m.createProject(), background: '#111114', transparent: false, layers: [layer] };
      await renderer.prepare(project);
      const bytes = await renderer.exportPNG(project, 2.2, 480, 240, 1);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(240, 120); canvas.getContext('2d').drawImage(bitmap, 0, 0, 240, 120);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .82 });
      result[id] = [...new Uint8Array(await blob.arrayBuffer())];
    }
    return result;
  }, chosen);
  for (const [id, bytes] of Object.entries(images)) await fs.writeFile(path.join(assets, `${id}.jpg`), Buffer.from(bytes));
  console.log(`Wrote ${Object.keys(images).length} thumbnails`);
} finally { await app.close(); }
