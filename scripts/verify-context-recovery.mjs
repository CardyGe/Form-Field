// Forces WebGL context loss in the real Studio preview and checks the picture comes back,
// for the default composition and for one preset of every instrument plus Ember Pulse.
// Run: npm run build && node scripts/verify-context-recovery.mjs [cycles=100] [cyclesPerInstrument=5]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cycles = Number(process.argv[2] ?? 100), perInstrument = Number(process.argv[3] ?? 5);
const RECOVERY_LIMIT_MS = 3000;
const out = path.join(root, 'work/context-recovery', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {createProject,createLayer,applyPreset,PRESETS} from './src/core/project';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', outfile: path.join(out, 'model.cjs'), logLevel: 'silent' });
const model = createRequire(import.meta.url)(path.join(out, 'model.cjs'));
const fixture = path.join(out, 'fixture.formfield');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out, 'profile'))});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
// The window stays visible so it keeps rendering, but real mouse and keyboard input must not reach it.
await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.setIgnoreMouseEvents(true); w.setFocusable(false); w.blur(); } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
const consoleLines = [];
page.on('console', message => { consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 300)); if (consoleLines.length > 200) consoleLines.shift(); });
const canvas = page.getByLabel('Composition preview', { exact: true });

// Mean and peak brightness of what is actually on screen, 0..255.
const picture = async () => {
  const png = (await canvas.screenshot()).toString('base64');
  return page.evaluate(async png => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
    const surface = new OffscreenCanvas(160, 90), context = surface.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 160, 90);
    const { data } = context.getImageData(0, 0, 160, 90), values = [];
    let sum = 0, peak = 0;
    for (let i = 0; i < data.length; i += 4) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; values.push(Math.round(v)); sum += v; peak = Math.max(peak, v); }
    return { mean: sum / values.length, peak, values };
  }, png);
};
const difference = (a, b) => a.values.reduce((sum, v, i) => sum + Math.abs(v - b.values[i]), 0) / a.values.length;
const settled = async () => {
  let last = await picture();
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(150); const next = await picture(); if (difference(last, next) < .05) return next; last = next; }
  return last;
};

// Records the state of a failed recovery, then whether the picture returns on its own or after a nudge.
async function diagnose(label, cycle, before) {
  const state = () => canvas.evaluate(c => { const gl = c.getContext('webgl2'); return { lost: gl.isContextLost(), glError: gl.getError(), width: c.width, height: c.height, cssWidth: c.style.width, cssHeight: c.style.height, visibility: getComputedStyle(c).visibility }; });
  const report = { label, cycle, atFailure: await state(), toast: await page.locator('.toast').allInnerTexts(), errorToast: await page.locator('.error-toast').allInnerTexts(), console: consoleLines.slice(-25), pageErrors: [...pageErrors] };
  await canvas.screenshot({ path: path.join(out, `failure-${cycle}.png`) });
  report.later = [];
  for (const wait of [1000, 4000, 10000]) { await page.waitForTimeout(wait); const p = await picture(); report.later.push({ afterMs: wait, difference: +difference(p, before).toFixed(2), mean: +p.mean.toFixed(2), ...(await state()) }); }
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify(report, null, 1));
  console.error(`DIAGNOSIS ${path.join(out, 'failure.json')}\n${JSON.stringify(report)}`);
}

async function exercise(label, count) {
  const before = await settled();
  const times = [];
  let brightest = 0;
  for (let cycle = 1; cycle <= count; cycle++) {
    await canvas.evaluate(c => new Promise(done => { c.addEventListener('webglcontextlost', () => done(), { once: true }); window.contextQA.loseContext(); }));
    await canvas.evaluate(c => new Promise(done => { c.addEventListener('webglcontextrestored', () => done(), { once: true }); window.contextQA.restoreContext(); }));
    assert.equal(await page.locator('.map-shape-list').count(), 0, `${label}, cycle ${cycle}: the app left Studio for Map, so this cycle says nothing about recovery.`);
    const began = Date.now();
    let now = await picture();
    brightest = Math.max(brightest, now.mean);
    while (difference(now, before) > 2 && Date.now() - began < RECOVERY_LIMIT_MS) { await page.waitForTimeout(16); now = await picture(); brightest = Math.max(brightest, now.mean); }
    if (difference(now, before) > 2) await diagnose(label, cycle, before);
    assert.ok(difference(now, before) <= 2, `${label}, cycle ${cycle}: picture did not return within ${RECOVERY_LIMIT_MS} ms (difference ${difference(now, before).toFixed(2)}, mean ${now.mean.toFixed(2)} vs ${before.mean.toFixed(2)}).`);
    times.push(Date.now() - began);
    assert.equal(await page.locator('.error-toast').count(), 0, `${label}, cycle ${cycle}: an error is showing after recovery: ${await page.locator('.error-toast').first().innerText().catch(() => '')}`);
    if (count >= 50 && cycle % 25 === 0) console.log(`${label}: ${cycle}/${count} recovered`);
  }
  times.sort((a, b) => a - b);
  assert.ok(brightest <= before.mean * 1.25 + 1, `${label}: a sampled recovery frame was brighter than the picture (${brightest.toFixed(2)} vs ${before.mean.toFixed(2)}).`);
  console.log(`PASS ${label}: ${count} of ${count}. Median ${times[times.length >> 1]} ms, worst ${times.at(-1)} ms.`);
}

let exit = 0;
try {
  await page.getByText('Export engine ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await canvas.evaluate(c => { window.contextQA = c.getContext('webgl2').getExtension('WEBGL_lose_context'); });
  assert.ok((await settled()).mean > 1, 'The preview should show a picture before the test.');
  await exercise('default composition', cycles);

  const chosen = new Map();
  for (const preset of model.PRESETS) if (preset.kind !== 'image' && !chosen.has(preset.kind)) chosen.set(preset.kind, preset.id);
  const targets = [...chosen.entries(), ['scope', 'ember-pulse'], ['smokecloud', 'cloud-ultraviolet']];
  const failures = [];
  for (const [kind, id] of targets) {
    const layer = model.applyPreset(model.createLayer(kind), id);
    const project = { ...model.createProject(), name: `Recovery ${id}`, layers: [layer] };
    await fs.writeFile(fixture, JSON.stringify(project));
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(id => window.studio.loadAutosave().then(p => p?.id === id), project.id);
    try { await exercise(`${kind} / ${id}`, perInstrument); }
    catch (error) { failures.push(error.message); console.error(`FAIL ${error.message}`); await page.locator('.error-toast button').first().click().catch(() => {}); }
  }
  assert.deepEqual(failures, [], `${failures.length} instrument(s) did not recover.`);
  assert.deepEqual(pageErrors, []);
  console.log('PASS all instruments');
} catch (error) {
  exit = 1;
  console.error(`FAIL ${error.message.split('\n')[0]}`);
} finally { await app.close(); }
process.exit(exit);
