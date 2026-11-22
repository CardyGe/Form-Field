// Studio controls for the Kaleidoscope instrument, in the real desktop app: the
// library card, every Source and Symmetry option, the controls that belong to
// each, the image input and its failure message, and the renamed fractal style.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';

const root = process.cwd(), out = path.join(root, 'work/kaleidoscope-ui', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out, {recursive: true});
await build({stdin: {contents: `export {createLayer,createProject,validateProject} from './src/core/project';`, resolveDir: root, loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'model.cjs'), logLevel: 'silent'});
const model = createRequire(import.meta.url)(path.join(out, 'model.cjs'));

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
function png(width, height, pixel, corrupt = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 3 + 1) + 1 + x * 3, [r, g, b] = pixel(x, y); raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; }
  // A bit depth no decoder supports: the file's structure passes validation, the browser cannot decode it.
  if (corrupt) header[8] = 7;
  const body = [chunk('IDAT', zlib.deflateSync(raw))];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...body, chunk('IEND', Buffer.alloc(0))]);
}
const good = path.join(out, 'test-image.png');
await fs.writeFile(good, png(96, 64, (x, y) => [x * 2 + 40, y * 3 + 30, 255 - x * 2]));
const broken = png(32, 32, () => [0, 0, 0], true);

// A saved composition whose Kaleidoscope layer holds an image that cannot be decoded.
const brokenLayer = model.createLayer('kaleidoscope');
brokenLayer.params.input = 1;
brokenLayer.image = {name: 'broken.png', dataUrl: `data:image/png;base64,${broken.toString('base64')}`, width: 32, height: 32, fit: 'cover'};
const fixture = model.validateProject({...model.createProject(), layers: [brokenLayer]});
const profile = path.join(out, 'profile');
await fs.mkdir(profile, {recursive: true});
await fs.writeFile(path.join(profile, 'autosave.formfield'), JSON.stringify(fixture));
await fs.writeFile(path.join(out, 'main.cjs'), `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);

const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({args: [path.join(out, 'main.cjs')], env});
const page = await app.firstWindow(), errors = [], checks = [];
page.setDefaultTimeout(15000);
page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const state = () => page.evaluate(() => window.studio.loadAutosave());
async function saved(predicate) { for (let i = 0; i < 100; i++) { const p = await state(); if (p && predicate(p)) return p; await page.waitForTimeout(100); } throw Error('Autosave did not reach the expected state'); }
async function check(name, fn) { await fn(); assert.equal(await page.getByRole('alert').count(), 0, name); assert.deepEqual(errors, [], name); checks.push(name); console.log('PASS ' + name); }
const shot = name => page.screenshot({path: path.join(out, name + '.png')});
const field = name => page.getByLabel(name, {exact: true});
const count = async label => page.getByLabel(label, {exact: true}).count();
const SOURCES = ['Motif', 'Image', 'Layer below', 'Feedback'], SYMMETRIES = ['Rosette', 'Mirror', 'Triangle', 'Square', 'Hexagon'];

try {
  await page.getByText('Export engine ready', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Pause', exact: true}).click();

  await check('an image that cannot be decoded says so and shows the motif', async () => {
    await saved(p => p.layers.length === 1 && p.layers[0].kind === 'kaleidoscope');
    await page.getByText('This image could not be loaded. Showing the motif instead.', {exact: true}).waitFor();
    await shot('broken-image');
    await page.getByRole('button', {name: 'Remove image', exact: true}).click();
    await saved(p => !p.layers[0].image);
    await page.getByText('No image chosen. Showing the motif instead.', {exact: true}).waitFor();
  });

  await check('the Kaleidoscope card adds a Kaleidoscope layer', async () => {
    await page.getByRole('button', {name: 'Open library', exact: true}).click();
    await page.getByLabel('Search library', {exact: true}).fill('kaleidoscope');
    assert.equal(await page.getByRole('button', {name: 'Add Kaleidoscope', exact: true}).count(), 1);
    await page.getByRole('button', {name: 'Add Kaleidoscope', exact: true}).click();
    const p = await saved(x => x.layers.length === 2);
    assert.equal(p.layers[1].kind, 'kaleidoscope');
    assert.equal(p.layers[1].params.input, 0);
    await field('Source').waitFor();
    await shot('card-added');
  });

  await check('every Source can be picked, and only its controls show', async () => {
    for (const [index, name] of SOURCES.entries()) {
      await field('Source').selectOption({label: name});
      await saved(p => p.layers[1].params.input === index);
      assert.equal(await page.getByRole('button', {name: 'Choose image', exact: true}).count() + await page.getByRole('button', {name: 'Replace image', exact: true}).count(), index === 1 ? 1 : 0, `${name}: image picker`);
      const motif = index === 0 || index === 3;
      assert.equal(await count('Motif'), motif ? 1 : 0, `${name}: Motif`);
      for (const label of ['Motif scale', 'Line weight']) assert.equal(await count(label + ' value'), motif ? 1 : 0, `${name}: ${label}`);
      assert.equal(await count('Echo amount value'), index === 3 ? 1 : 0, `${name}: Echo amount`);
      assert.equal(await page.getByText('Echo does not apply to the layer below.', {exact: false}).count() > 0, index === 2, `${name}: Echo note`);
      await shot('source-' + name.toLowerCase().replace(/ /g, '-'));
    }
    await field('Source').selectOption({label: 'Motif'});
    for (const [index, name] of ['Lines', 'Squares', 'Circles'].entries()) { await field('Motif').selectOption({label: name}); await saved(p => p.layers[1].params.motif === index); }
  });

  await check('every Symmetry can be picked: Mirrors for Rosette, Repeat size for the rest', async () => {
    for (const [index, name] of SYMMETRIES.entries()) {
      await field('Symmetry').selectOption({label: name});
      await saved(p => p.layers[1].params.group === index);
      assert.equal(await count('Mirrors value'), index === 0 ? 1 : 0, `${name}: Mirrors`);
      assert.equal(await count('Repeat size value'), index === 0 ? 0 : 1, `${name}: Repeat size`);
      await shot('symmetry-' + name.toLowerCase());
    }
    const labels = await field('Symmetry').locator('option').allTextContents();
    assert.deepEqual(labels, SYMMETRIES);
    await field('Symmetry').selectOption({label: 'Rosette'});
  });

  await check('Spiral replaces the fold controls with its own', async () => {
    await field('Spiral').check();
    await saved(p => p.layers[1].params.spiral === 1);
    for (const label of ['Spiral arms', 'Spiral rings', 'Spiral step', 'Zoom per loop']) assert.equal(await count(label + ' value'), 1, label);
    for (const label of ['Mirrors value', 'Repeat size value', 'Symmetry']) assert.equal(await count(label), 0, label);
    await shot('spiral');
    await field('Spiral').uncheck();
    await saved(p => p.layers[1].params.spiral === 0);
    assert.equal(await count('Symmetry'), 1);
    assert.equal(await count('Spiral arms value'), 0);
  });

  await check('the generic Feedback finish is not offered for Feedback or Layer below, but still is for the Motif', async () => {
    await field('Source').selectOption({label: 'Feedback'});
    await field('Echo amount value').fill('0.5'); await field('Echo amount value').press('Enter');
    await saved(p => p.layers[1].params.echo === 0.5);
    await page.getByRole('button', {name: 'Finish', exact: true}).click();
    assert.equal(await count('Echo zoom value'), 0, 'Feedback source: Echo zoom hidden');
    await page.getByRole('button', {name: 'Shape', exact: true}).click();
    await field('Source').selectOption({label: 'Layer below'});
    await page.getByRole('button', {name: 'Finish', exact: true}).click();
    assert.equal(await count('Echo zoom value'), 0, 'Layer below: Echo zoom hidden');
    assert.ok(await page.getByText('Echo does not apply to the layer below.').count() > 0);
    await page.getByRole('button', {name: 'Shape', exact: true}).click();
    await field('Source').selectOption({label: 'Motif'});
    await page.getByRole('button', {name: 'Finish', exact: true}).click();
    assert.equal(await count('Echo zoom value'), 1, 'Motif with echo: generic Feedback finish works as for any layer');
    await shot('finish-motif-echo');
    await page.getByRole('button', {name: 'Shape', exact: true}).click();
    await field('Source').selectOption({label: 'Feedback'});
    await field('Echo amount value').fill('0'); await field('Echo amount value').press('Enter');
    await saved(p => p.layers[1].params.echo === 0);
    await field('Source').selectOption({label: 'Motif'});
  });

  await check('importing an image keeps the Kaleidoscope layer and its source; removing it falls back to the motif', async () => {
    await field('Source').selectOption({label: 'Image'});
    await page.getByRole('button', {name: 'Choose image', exact: true}).waitFor();
    await field('Kaleidoscope image file').setInputFiles(good);
    const p = await saved(x => !!x.layers[1].image);
    assert.equal(p.layers[1].kind, 'kaleidoscope');
    assert.equal(p.layers[1].params.input, 1);
    assert.equal(p.layers[1].image.width, 96);
    assert.equal(p.layers.length, 2);
    await page.getByRole('button', {name: 'Replace image', exact: true}).waitFor();
    assert.equal(await page.getByText('Showing the motif instead.', {exact: false}).count(), 0);
    await page.waitForTimeout(500);
    await shot('image-source');
    await page.getByRole('button', {name: 'Remove image', exact: true}).click();
    await saved(x => !x.layers[1].image);
    await page.getByText('No image chosen. Showing the motif instead.', {exact: true}).waitFor();
    await shot('image-removed');
  });

  await check('a file that is not a PNG or JPEG is refused without changing the layer', async () => {
    const before = await state();
    await field('Kaleidoscope image file').setInputFiles({name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text')});
    await page.getByRole('alert').getByText('Choose a PNG or JPEG image.', {exact: true}).waitFor();
    assert.deepEqual((await state()).layers[1], before.layers[1]);
    await page.getByLabel('Dismiss error', {exact: true}).click();
  });

  await check('the old Kaleidoscope fractal style reads Folded Lace', async () => {
    await page.getByRole('button', {name: 'Open library', exact: true}).click().catch(() => {});
    await page.getByLabel('Search library', {exact: true}).fill('fractal');
    assert.equal(await page.getByText('Folded Lace · Julia · Mandelbox · Portal', {exact: true}).count(), 1);
    await page.getByRole('button', {name: 'Add fractal', exact: true}).click();
    const fractal = await saved(x => x.layers.length === 3 && x.layers[2].kind === 'fractal');
    assert.equal(fractal.layers[2].params.style, 0);
    await page.getByRole('button', {name: 'Folded Lace', exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Kaleidoscope', exact: true}).count(), 0);
    await shot('folded-lace');
  });

  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({status: 'passed', checks, errors}, null, 2));
  console.log('Report: ' + out);
} catch (error) { await shot('failure').catch(() => {}); throw error; } finally { await app.close(); }
