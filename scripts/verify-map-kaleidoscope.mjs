// A Kaleidoscope on a Map shape, in the real app with the wall window open: each
// input (motif, image, layer below, feedback) must play on the wall, inside the
// shape and nowhere else, and each must look different from the others.
// Run: npm run build && node scripts/verify-map-kaleidoscope.mjs
// Writes the wall's pictures to work/kaleidoscope-task7/.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/kaleidoscope-task7');
const userData = path.join(out, 'user-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(userData, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
// A bold yellow and green checkerboard; its green appears nowhere else on the wall.
function testImage(size = 128) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 3 + 1) + 1 + x * 3, on = ((x >> 4) + (y >> 4)) & 1;
    raw[i] = on ? 250 : 20; raw[i + 1] = on ? 230 : 200; raw[i + 2] = on ? 20 : 60;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const imageFile = path.join(out, 'checkerboard.png');
await fs.writeFile(imageFile, testImage());

const env = { ...process.env, STUDIO_LIVE_TEST_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], env });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const BLACK = [0, 0, 0], BOX = { x0: .25, y0: .25, x1: .6, y1: .6 };
const INSIDE = [[.3, .3], [.425, .425], [.55, .55], [.3, .55], [.55, .3]];
const OUTSIDE = [[.1, .1], [.15, .5], [.8, .8], [.425, .1], [.425, .85], [.9, .4]];

const sample = (page, fractions) => page.evaluate(async fractions => {
  const canvas = document.querySelector('canvas'), copy = new OffscreenCanvas(canvas.width, canvas.height), context = copy.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0);
  const at = ([fx, fy]) => Array.from(context.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data.slice(0, 3));
  const colours = fractions.map(at);
  // Every probe inside the shape, for telling pictures apart and for measuring how much colour they hold.
  const inside = []; for (let i = 0; i < 28; i++) for (let j = 0; j < 28; j++) inside.push(at([.26 + i * .33 / 28, .26 + j * .33 / 28]));
  const bytes = new Uint8Array(await (await copy.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { colours, inside, png: btoa(s) };
}, fractions);
const differ = (a, b) => a.inside.filter((c, i) => !near(c, b.inside[i], 6)).length / a.inside.length;
const distinctColours = s => new Set(s.inside.map(c => c.map(v => v >> 4).join(','))).size;

const pictures = {};
const results = [];
try {
  const studio = await app.firstWindow();
  studio.on('pageerror', e => errors.push(String(e)));
  studio.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await studio.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await studio.getByLabel('Project name', { exact: true }).waitFor();
  await sleep(1500);
  await studio.getByRole('button', { name: 'Map', exact: true }).click();
  await studio.getByRole('region', { name: 'Map' }).waitFor();
  const stage = studio.getByLabel('Stage', { exact: true });
  await stage.waitFor();
  await studio.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Open output'); return b && !b.disabled; });
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await studio.getByRole('button', { name: 'Open output' }).click();
  const output = await opened;
  await output.waitForURL(/#map-output/);
  await output.waitForSelector('canvas');
  output.on('pageerror', e => errors.push(String(e)));

  await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const rect = await stage.evaluate(c => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const at = (fx, fy) => [rect.left + fx * rect.width, rect.top + fy * rect.height];
  await studio.mouse.move(...at(BOX.x0, BOX.y0)); await studio.mouse.down();
  await studio.mouse.move(...at(.4, .4), { steps: 6 }); await studio.mouse.move(...at(BOX.x1, BOX.y1), { steps: 6 }); await studio.mouse.up();
  await studio.getByRole('button', { name: 'Select', exact: true }).click();
  // The layer below the Kaleidoscope: an ordinary instrument.
  await studio.getByRole('tablist', { name: 'Shape panels' }).getByRole('tab', { name: /^Effect$/ }).click();
  await studio.evaluate(() => { const d = document.querySelector('details[data-section="effect"]'); if (d && !d.open) d.open = true; });
  await studio.getByRole('button', { name: 'Change look' }).click();
  await studio.locator('[data-look="preset:porcelain-shutters"]').click();
  await sleep(150);
  await studio.keyboard.press('Escape');
  await studio.locator('.look-browser').waitFor({ state: 'detached', timeout: 2000 }).catch(async () => { await studio.getByRole('button', { name: 'Close looks' }).click(); });
  await sleep(1500);
  await studio.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
  await studio.locator('.shape-edit-bar').waitFor();
  await studio.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});

  // The instrument alone, as the reference for "layer below".
  await sleep(1200);
  pictures.instrument = await sample(output, [...INSIDE, ...OUTSIDE]);

  await studio.getByRole('button', { name: 'Open library', exact: true }).click().catch(() => {});
  await studio.getByLabel('Search library', { exact: true }).fill('kaleidoscope');
  await studio.getByRole('button', { name: 'Add Kaleidoscope', exact: true }).click();
  await studio.getByLabel('Source', { exact: true }).waitFor();

  const wallStats = () => output.evaluate(() => window.__mapStats);
  const settle = async () => { await sleep(1800); };
  const check = async (name, run) => {
    try { await run(); results.push(`ok    ${name}`); console.log('ok    ' + name); }
    catch (error) { results.push(`FAIL  ${name}: ${String(error.message).split('\n')[0]}`); console.log('FAIL  ' + name + ': ' + String(error.message).split('\n')[0]); process.exitCode = 1; }
  };
  const inShapeOnly = s => {
    s.colours.slice(INSIDE.length).forEach((c, i) => assert.ok(near(c, BLACK), `outside ${OUTSIDE[i]} is rgb(${c})`));
    assert.ok(distinctColours(s) >= 3, `only ${distinctColours(s)} colours inside the shape`);
  };
  const shoot = async (name, s) => { await fs.writeFile(path.join(out, `wall-${name}.png`), Buffer.from(s.png, 'base64')); await studio.screenshot({ path: path.join(out, `studio-${name}.png`) }); };

  await check('Motif input plays on the wall, inside the shape only', async () => {
    await settle();
    const s = pictures.motif = await sample(output, [...INSIDE, ...OUTSIDE]);
    inShapeOnly(s); await shoot('motif', s);
  });
  await check('Image input plays the chosen picture, folded, on the wall', async () => {
    await studio.getByLabel('Source', { exact: true }).selectOption({ label: 'Image' });
    await studio.getByLabel('Kaleidoscope image file', { exact: true }).setInputFiles(imageFile);
    await studio.getByRole('button', { name: 'Replace image', exact: true }).waitFor();
    await settle();
    const s = pictures.image = await sample(output, [...INSIDE, ...OUTSIDE]);
    inShapeOnly(s); await shoot('image', s);
    // The checkerboard's green is not in the motif or the instrument.
    const yellowGreen = s.inside.filter(([r, g, b]) => r < 60 && g > 170 && b < 100).length;
    assert.ok(yellowGreen > s.inside.length * .2, `${yellowGreen} of ${s.inside.length} probes are the picture's colours`);
    assert.ok(differ(s, pictures.motif) > .3, 'looks the same as the motif');
  });
  await check('Layer below input folds the instrument beneath it on the wall', async () => {
    await studio.getByLabel('Source', { exact: true }).selectOption({ label: 'Layer below' });
    await settle();
    const s = pictures.below = await sample(output, [...INSIDE, ...OUTSIDE]);
    inShapeOnly(s); await shoot('below', s);
    assert.ok(differ(s, pictures.image) > .3, 'looks the same as the image');
    assert.ok(differ(s, pictures.motif) > .3, 'looks the same as the motif');
    const yellowGreen = s.inside.filter(([r, g, b]) => r < 60 && g > 170 && b < 100).length;
    assert.ok(yellowGreen < s.inside.length * .02, 'still showing the image');
  });
  await check('Feedback input plays on the wall and keeps changing', async () => {
    await studio.getByLabel('Source', { exact: true }).selectOption({ label: 'Feedback' });
    await studio.getByLabel('Echo amount value', { exact: true }).fill('0.7');
    await studio.getByLabel('Echo amount value', { exact: true }).press('Enter');
    await settle();
    const s = pictures.feedback = await sample(output, [...INSIDE, ...OUTSIDE]);
    inShapeOnly(s); await shoot('feedback', s);
    await studio.getByRole('button', { name: 'Play', exact: true }).click().catch(() => {});
    await sleep(1500);
    const later = await sample(output, []);
    assert.ok(differ(later, s) > 0.02, 'the wall did not change while the feedback played');
    await fs.writeFile(path.join(out, 'wall-feedback-later.png'), Buffer.from(later.png, 'base64'));
  });
  await check('the wall reports no failing source', async () => {
    const stats = await wallStats();
    assert.deepEqual(stats.failing, []);
  });
  await studio.locator('.shape-edit-bar').getByRole('button', { name: 'Back to Map' }).click();
  await studio.getByRole('region', { name: 'Map' }).waitFor();
  await sleep(800);
  await studio.screenshot({ path: path.join(out, 'map-after.png') });
  assert.deepEqual(errors, []);
} finally { await app.close(); }
console.log(results.join('\n'));
