// Forces WebGL context loss on the Live preview and on Map's output window.
// Run: npm run build && node scripts/verify-context-recovery-outputs.mjs [cycles=20]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cycles = Number(process.argv[2] ?? 20), LIMIT_MS = 3000;
const out = path.join(root, 'work/context-recovery-outputs', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'main.cjs'), `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out, 'profile'))});app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
// Windows stay visible so they keep rendering, but real mouse and keyboard input must not reach them.
const isolate = () => app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.setIgnoreMouseEvents(true); w.setFocusable(false); w.blur(); } });
const studio = await app.firstWindow();
studio.setDefaultTimeout(15000);
await isolate();
const errors = [];
studio.on('pageerror', error => errors.push(String(error)));

const picture = async (page, target) => {
  const png = (await target.screenshot()).toString('base64');
  return page.evaluate(async png => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }));
    const surface = new OffscreenCanvas(160, 90), context = surface.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 160, 90);
    const { data } = context.getImageData(0, 0, 160, 90), values = [];
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; values.push(Math.round(v)); sum += v; }
    return { mean: sum / values.length, values };
  }, png);
};
const difference = (a, b) => a.values.reduce((sum, v, i) => sum + Math.abs(v - b.values[i]), 0) / a.values.length;

// A moving picture counts as back when its brightness returns and it is still changing; a still one must match.
async function exercise(label, page, target, moving) {
  await page.waitForTimeout(1500);
  const before = await picture(page, target);
  assert.ok(before.mean > .5, `${label}: no picture before the test (mean ${before.mean.toFixed(2)}).`);
  await target.evaluate(c => { window.contextQA = c.getContext('webgl2').getExtension('WEBGL_lose_context'); });
  const times = [];
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await target.evaluate(c => new Promise(done => { c.addEventListener('webglcontextlost', () => done(), { once: true }); window.contextQA.loseContext(); }));
    await target.evaluate(c => new Promise(done => { c.addEventListener('webglcontextrestored', () => done(), { once: true }); window.contextQA.restoreContext(); }));
    const began = Date.now();
    const back = async () => {
      const a = await picture(page, target);
      if (!moving) return difference(a, before) <= 2 ? a : null;
      if (a.mean < before.mean * .5) return null;
      await page.waitForTimeout(120);
      return difference(a, await picture(page, target)) > .01 ? a : null;
    };
    let result = await back();
    while (!result && Date.now() - began < LIMIT_MS) { await page.waitForTimeout(16); result = await back(); }
    if (!result) { await target.screenshot({ path: path.join(out, `${label}-failure-${cycle}.png`) }); throw new Error(`${label}, cycle ${cycle}: picture did not return within ${LIMIT_MS} ms.`); }
    times.push(Date.now() - began);
  }
  times.sort((a, b) => a - b);
  console.log(`PASS ${label}: ${cycles} of ${cycles}. Median ${times[times.length >> 1]} ms, worst ${times.at(-1)} ms.`);
}

let exit = 0;
const failures = [];
const attempt = async (label, run) => { try { await run(); } catch (error) { failures.push(label); console.error(`FAIL ${error.message.split('\n')[0]}`); } };
try {
  await studio.getByText('Export engine ready', { exact: true }).waitFor();
  await studio.getByRole('button', { name: 'Live', exact: true }).click();
  const liveRegion = studio.getByRole('region', { name: 'Live' });
  await liveRegion.waitFor();
  await liveRegion.locator('select', { has: studio.locator('option', { hasText: 'Test pattern' }) }).first().selectOption({ label: 'Test pattern' });
  await attempt('Live preview', () => exercise('Live preview', studio, studio.getByLabel('Live preview', { exact: true }), true));

  await liveRegion.getByRole('button', { name: 'Map', exact: true }).click();
  await studio.getByRole('region', { name: 'Map' }).waitFor();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open output' }).click();
  const output = await opened;
  await output.waitForURL(/#map-output/);
  await output.waitForSelector('canvas');
  await isolate();
  output.on('pageerror', error => errors.push(`output: ${error}`));
  await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const r = await stage.evaluate(c => { const b = c.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; });
  await studio.mouse.move(r.left + r.width * .2, r.top + r.height * .2); await studio.mouse.down();
  await studio.mouse.move(r.left + r.width * .5, r.top + r.height * .5, { steps: 6 });
  await studio.mouse.move(r.left + r.width * .8, r.top + r.height * .8, { steps: 6 }); await studio.mouse.up();
  await studio.getByRole('button', { name: 'Select', exact: true }).click();
  await attempt('Map output', () => exercise('Map output', output, output.locator('canvas').first(), false));
  assert.deepEqual(failures, [], `Did not recover: ${failures.join(', ')}.`);
  assert.deepEqual(errors, []);
  console.log('PASS Live and Map outputs');
} catch (error) {
  exit = 1;
  console.error(`FAIL ${error.message.split('\n')[0]}`);
} finally { await app.close(); }
process.exit(exit);
