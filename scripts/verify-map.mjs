// Real Electron check of the Map section: draw, project, blackout, refusal, Escape.
// Run: npm run test:map   (builds first). Uses a throwaway user-data folder under work/map/.
// Writes work/map/output-rectangle.png and work/map/output-blackout.png for review by eye.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/map');
const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
const results = [];
const check = async (name, run) => {
  try { await run(); results.push(`ok    ${name}`); }
  catch (error) { results.push(`FAIL  ${name}\n      ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// Sample the output canvas (same task as the copy). Returns rgb at fractions, plus the whole picture as a PNG.
const sample = (page, fractions) => page.evaluate(async fractions => {
  const canvas = document.querySelector('canvas'), copy = new OffscreenCanvas(canvas.width, canvas.height), context = copy.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0);
  const at = ([fx, fy]) => Array.from(context.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data.slice(0, 3));
  const colours = fractions.map(at);
  const grid = []; for (let i = 0; i < 24; i++) for (let j = 0; j < 14; j++) grid.push(at([(i + .5) / 24, (j + .5) / 14]));
  const bytes = new Uint8Array(await (await copy.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { colours, grid, png: btoa(s), size: [canvas.width, canvas.height] };
}, fractions);
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const RED = [0xff, 0x3b, 0x30], BLACK = [0, 0, 0];
const BOX = { x0: .25, y0: .25, x1: .6, y1: .6 };
const INSIDE = [[.3, .3], [.425, .425], [.55, .55], [.3, .55], [.55, .3]];
const OUTSIDE = [[.1, .1], [.15, .5], [.8, .8], [.425, .1], [.425, .85], [.9, .4], [.425, .7]];

try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(String(e)));
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  await studio.getByRole('region', { name: 'Map' }).waitFor();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.getByRole('button', { name: 'Open output' }).waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });

  let output;
  await check('Open output shows a second window at #map-output', async () => {
    const opened = app.waitForEvent('window', { timeout: 15000 });
    await studio.getByRole('button', { name: 'Open output' }).click();
    output = await opened;
    await output.waitForURL(/#map-output/);
    await output.waitForSelector('canvas');
    await studio.getByRole('button', { name: 'Close output' }).waitFor({ timeout: 10000 });
    output.on('pageerror', e => errors.push(String(e)));
  });

  await check('a drawn rectangle projects its colour inside the box and black outside', async () => {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    assert.ok(rect.width > 200 && rect.height > 100, `stage canvas is ${rect.width} x ${rect.height}`);
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    await studio.mouse.move(...at(BOX.x0, BOX.y0)); await studio.mouse.down();
    await studio.mouse.move(...at(.4, .4), { steps: 6 }); await studio.mouse.move(...at(BOX.x1, BOX.y1), { steps: 6 }); await studio.mouse.up();
    await studio.getByRole('button', { name: 'Select', exact: true }).click();
    let s;
    for (let i = 0; i < 30; i++) { s = await sample(output, [...INSIDE, ...OUTSIDE]); if (near(s.colours[0], RED)) break; await sleep(100); }
    assert.deepEqual(s.size, [1920, 1080]);
    s.colours.slice(0, INSIDE.length).forEach((c, i) => assert.ok(near(c, RED), `inside ${INSIDE[i]} is rgb(${c})`));
    s.colours.slice(INSIDE.length).forEach((c, i) => assert.ok(near(c, BLACK), `outside ${OUTSIDE[i]} is rgb(${c})`));
    // Not vacuous: the inside colour differs from the black background by a wide margin.
    assert.ok(!near(s.colours[0], BLACK, 100));
    await fs.writeFile(path.join(out, 'output-rectangle.png'), Buffer.from(s.png, 'base64'));
  });

  await check('a crossing outline is refused: output keeps the last valid rectangle, operator says why', async () => {
    const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
    // Top-left corner dragged past the bottom-left edge's far side: the outline becomes a bowtie.
    await studio.mouse.move(...at(BOX.x0, BOX.y0)); await studio.mouse.down();
    await studio.mouse.move(...at(.4, .3), { steps: 6 }); await studio.mouse.move(...at(.7, .4), { steps: 6 });
    await studio.getByText(/Outline crosses itself/).first().waitFor({ timeout: 5000 });
    await studio.mouse.up();
    await studio.getByText(/Outline crosses itself/).first().waitFor({ timeout: 5000 });
    await sleep(400);
    const s = await sample(output, [...INSIDE, ...OUTSIDE]);
    s.colours.slice(0, INSIDE.length).forEach((c, i) => assert.ok(near(c, RED), `inside ${INSIDE[i]} is rgb(${c}) after refusal`));
    s.colours.slice(INSIDE.length).forEach((c, i) => assert.ok(near(c, BLACK), `outside ${OUTSIDE[i]} is rgb(${c}) after refusal`));
    // The refused spot (top right of the old box, where the bowtie would have painted) stays black.
    assert.ok(near((await sample(output, [[.68, .42]])).colours[0], BLACK));
  });

  await check('Blackout turns the whole output black', async () => {
    await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    let s;
    for (let i = 0; i < 30; i++) { s = await sample(output, []); if (s.grid.every(c => near(c, BLACK, 4))) break; await sleep(100); }
    assert.equal(s.grid.length, 24 * 14);
    const bad = s.grid.filter(c => !near(c, BLACK, 4));
    assert.equal(bad.length, 0, `${bad.length} grid pixels are not black, e.g. rgb(${bad[0]})`);
    await fs.writeFile(path.join(out, 'output-blackout.png'), Buffer.from(s.png, 'base64'));
    // Not vacuous: switching blackout off brings the red back.
    await studio.getByRole('button', { name: 'Blackout', exact: true }).click();
    let back;
    for (let i = 0; i < 30; i++) { back = await sample(output, [[.425, .425]]); if (near(back.colours[0], RED)) break; await sleep(100); }
    assert.ok(near(back.colours[0], RED), `after Blackout off the inside is rgb(${back.colours[0]})`);
  });

  await check('Escape in the output window closes it', async () => {
    const closed = output.waitForEvent('close', { timeout: 10000 });
    // The operator would click the projector window; here the window is focused directly.
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('map-output')); w?.show(); w?.focus(); w?.webContents.focus(); });
    await sleep(300);
    // The window may go away while the key press is still being acknowledged.
    await output.keyboard.press('Escape').catch(() => {});
    await closed;
    await studio.getByRole('button', { name: 'Open output' }).waitFor({ timeout: 10000 });
    assert.ok(!app.windows().some(w => /#map-output/.test(w.url())));
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} catch (error) {
  results.push(`FAIL  setup\n      ${String(error.stack || error).split('\n').slice(0, 3).join(' | ')}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  console.log(results.join('\n'));
  console.log(process.exitCode ? 'MAP CHECK FAILED' : 'MAP CHECK PASSED');
  console.log(`PNGs: ${path.join(out, 'output-rectangle.png')}, ${path.join(out, 'output-blackout.png')}`);
}
