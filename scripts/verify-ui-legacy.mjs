import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(base, 'work', 'ui-smoke');
const runDirectory = path.join(artifacts, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const outputDirectory = path.join(runDirectory, 'exports');
const runtimeBase = path.join(runDirectory, 'application');
const projectFile = path.join(runDirectory, 'verified.formfield');
const userData = path.join(runDirectory, 'user-data');
const fixtureFile = path.join(runDirectory, 'alpha-artwork.png');
const maskFile = path.join(runDirectory, 'image-mask.png');
const wrapper = path.join(runDirectory, 'wrapper.cjs');
let ffmpegPath, ffprobePath;
const errors = [], warnings = [], checks = [];
const fractalAddedFields = ['variant', 'quality', 'density', 'juliaReal', 'juliaImag', 'trap', 'boxScale', 'boxRadius', 'radial', 'roughness', 'lightAngle', 'exposure', 'lineWidth'];
let app, page;

await fs.access(path.join(base, 'dist', 'index.html')).catch(() => { throw new Error('Build the app before verification: npm run build'); });
// Keep concurrent builds from removing assets during reload/recovery checks.
await fs.mkdir(runtimeBase, { recursive: true });
await Promise.all(['dist', 'electron', 'package.json', 'build'].map(name => fs.cp(path.join(base, name), path.join(runtimeBase, name), { recursive: true })));
({ ffmpegPath, ffprobePath } = require(path.join(runtimeBase, 'electron/export-manager.cjs')).resolveMediaTools());
const fingerprint = crypto.createHash('sha256');
const distFiles = [];
async function fingerprintDirectory(directory, relative = '') {
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = path.posix.join(relative, entry.name), filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await fingerprintDirectory(filename, name);
    else if (entry.isFile()) {
      const sha256 = crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex');
      fingerprint.update(`${name}\0${sha256}\n`);
      distFiles.push({ name, sha256 });
    }
  }
}
await fingerprintDirectory(path.join(runtimeBase, 'dist'));
const distSha256 = fingerprint.digest('hex');
await fs.mkdir(runDirectory, { recursive: true });
await fs.mkdir(userData, { recursive: true });
await fs.mkdir(outputDirectory, { recursive: true });

function run(binary, args, input) {
  const result = spawnSync(binary, args, { input, maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr?.toString());
  return result.stdout;
}

function pngFixture(filename, mask = false) {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const offset = (y * 128 + x) * 4;
    if (mask) { const level = x < 64 ? 255 : 0; pixels[offset] = level; pixels[offset + 1] = level; pixels[offset + 2] = level; pixels[offset + 3] = 255; }
    else { pixels[offset] = 170; pixels[offset + 1] = Math.round(210 * x / 127); pixels[offset + 2] = 235; pixels[offset + 3] = Math.round(255 * Math.max(0, 1 - Math.hypot(x - 64, y - 64) / 64)); }
  }
  run(ffmpegPath, ['-v', 'error', '-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '128x128', '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'png', filename], pixels);
}
pngFixture(fixtureFile); pngFixture(maskFile, true);

// Only native file dialogs are replaced. Rendering, IPC, persistence, frame
// writes, FFmpeg encoding and output verification all use the actual app.
await fs.writeFile(wrapper, `const { app, dialog } = require('electron');
app.setPath('userData', ${JSON.stringify(userData)});
dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: options.title.includes('PNG') ? ${JSON.stringify(path.join(runDirectory, 'still.png'))} : ${JSON.stringify(projectFile)} });
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [${JSON.stringify(outputDirectory)}] : [${JSON.stringify(projectFile)}] });
dialog.showErrorBox = (title, message) => { console.error(title + ': ' + message); app.exit(1); };
require(${JSON.stringify(path.join(runtimeBase, 'electron', 'main.cjs'))});
`);

async function check(name, operation) {
  const start = Date.now();
  await operation();
  checks.push({ name, milliseconds: Date.now() - start });
  console.log(`PASS ${name}`);
  const alert = page.getByRole('alert');
  if (await alert.count()) throw new Error(`App error after ${name}: ${await alert.innerText()}`);
}

async function canvasDigest() {
  await page.locator('canvas[aria-label="Composition preview"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(200);
  const bytes = await page.locator('canvas[aria-label="Composition preview"]').screenshot();
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(path.join(runDirectory, 'canvases'), { recursive: true });
  await fs.writeFile(path.join(runDirectory, 'canvases', digest + '.png'), bytes);
  return digest;
}

function select(label, scope = page) {
  return scope.locator('label.stacked-label').filter({ hasText: new RegExp(`^${label}`, 'i') }).locator('select');
}

// Avoid eval inside the app's strict CSP: autosave polling is performed in Node.
async function saved(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const project = await page.evaluate(() => window.studio.loadAutosave());
    if (project && predicate(project)) return project;
    await page.waitForTimeout(100);
  }
  throw new Error('Autosave did not reach the expected project state.');
}

async function savedProjectFile(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const bytes = await fs.readFile(projectFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const project = bytes === null ? null : JSON.parse(bytes);
    if (project && predicate(project)) return project;
    await page.waitForTimeout(100);
  }
  throw new Error('The saved project file did not reach the expected state.');
}

async function launchStudio({ recovery = false } = {}) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.STUDIO_DEV_URL;
  app = await electron.launch({ args: [wrapper], cwd: runtimeBase, env: environment, timeout: 45000 });
  page = await app.firstWindow({ timeout: 45000 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('requestfailed', request => console.error(JSON.stringify({ type: 'requestfailed', url: request.url(), failure: request.failure() }))); 
  page.on('console', message => {
    if (message.type() === 'error') { const issue = { type: 'console', message: message.text(), location: message.location() }; errors.push(issue); console.error(JSON.stringify(issue)); }
    else if (message.type() === 'warning') warnings.push(message.text());
  });
  if (recovery) await page.getByRole('alert').waitFor({ timeout: 45000 });
  else await page.getByText('Export engine ready', { exact: true }).waitFor({ timeout: 45000 });
}

try {
  await launchStudio();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  await check('export dialog contains keyboard focus, restores its opener and exposes native failures', async () => {
    const unavailable = path.join(runDirectory, 'destination-is-a-file');
    await fs.writeFile(unavailable, 'fixture');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Export', exact: true });
    assert.equal(await modal.evaluate(element => element.contains(document.activeElement)), true);
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await modal.evaluate(element => element.contains(document.activeElement)), true);
    }
    const destination = modal.getByLabel('Export destination', { exact: true });
    const previousDestination = await destination.inputValue();
    await destination.fill(unavailable);
    await modal.getByRole('button', { name: 'Render loop', exact: true }).click();
    await modal.getByRole('alert').waitFor();
    assert.match(await modal.getByRole('alert').innerText(), /EEXIST|exist|directory/i);
    await modal.getByLabel('Dismiss error', { exact: true }).click();
    await destination.fill(previousDestination);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).evaluate(element => element === document.activeElement), true);
  });

  await check('keyframe values can be edited with a keyboard and removed without pointer gestures', async () => {
    await page.getByRole('button', { name: 'Motion', exact: true }).click();
    await page.getByLabel('Motion parameter', { exact: true }).selectOption('warp');
    await page.getByLabel('Motion source', { exact: true }).selectOption('keyframes');
    const key = page.getByRole('slider', { name: 'Keyframe 1', exact: true });
    await key.focus();
    await key.press('ArrowUp');
    assert.equal(await key.getAttribute('aria-valuenow'), '0.05');
    await saved(project => project.layers[0].modulations.warp?.points[0].value === .05);
    await page.getByRole('button', { name: 'Remove animation', exact: true }).click();
    await saved(project => !project.layers[0].modulations.warp);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
  });

  await check('paused parameter change changes actual GPU canvas', async () => {
    const before = await canvasDigest();
    await page.getByLabel('Flow value', { exact: true }).fill('0.9');
    await page.getByLabel('Flow value', { exact: true }).press('Tab');
    await saved(project => project.layers[0].params.warp === 0.9);
    assert.notEqual(await canvasDigest(), before);
  });

  await check('surface Roundness and Relief change the GPU image, undo and survive native save/open', async () => {
    await page.getByTitle('Return to start', { exact: true }).click();
    const roundness = page.getByLabel('Roundness value', { exact: true });
    const relief = page.getByLabel('Relief value', { exact: true });
    const previousRelief = Number(await relief.inputValue());
    const beforeRoundness = await canvasDigest();
    await roundness.fill('0.92'); await roundness.press('Tab');
    await saved(project => project.layers[0].params.roundness === 0.92);
    const beforeRelief = await canvasDigest();
    assert.notEqual(beforeRelief, beforeRoundness, 'Roundness must change the actual paused surface.');
    await relief.fill('0.18'); await relief.press('Tab');
    await saved(project => project.layers[0].params.relief === 0.18);
    const afterRelief = await canvasDigest();
    assert.notEqual(afterRelief, beforeRelief, 'Relief must change the actual paused surface.');
    await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
    await saved(project => project.layers[0].params.relief === previousRelief);
    assert.equal(await canvasDigest(), beforeRelief, 'Undo must restore the previous surface lighting.');
    await page.getByTitle('Redo · ⇧⌘Z', { exact: true }).click();
    await saved(project => project.layers[0].params.relief === 0.18);
    assert.equal(await canvasDigest(), afterRelief);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => project.layers[0].params.roundness === 0.92 && project.layers[0].params.relief === 0.18);
    await roundness.fill('0.12'); await roundness.press('Tab');
    await relief.fill('0.85'); await relief.press('Tab');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Roundness value"]')?.value === '0.92' && document.querySelector('[aria-label="Relief value"]')?.value === '0.18');
    await saved(project => project.layers[0].params.roundness === 0.92 && project.layers[0].params.relief === 0.18);
    assert.equal(Number(await roundness.inputValue()), 0.92);
    assert.equal(Number(await relief.inputValue()), 0.18);
    assert.equal(await canvasDigest(), afterRelief, 'Native reopening must reproduce the paused surface exactly.');
    await page.screenshot({ path: path.join(artifacts, 'surface-controls.png'), fullPage: true });
  });

  await check('legacy schema-1 surfaces acquire new defaults without losing existing parameters', async () => {
    const currentBytes = await fs.readFile(projectFile);
    const current = JSON.parse(currentBytes.toString());
    const legacy = structuredClone(current);
    legacy.name = 'Legacy surface migration verified';
    delete legacy.layers[0].params.roundness;
    delete legacy.layers[0].params.relief;
    assert.equal(legacy.schemaVersion, 1);
    await fs.writeFile(projectFile, JSON.stringify(legacy, null, 2));
    try {
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      const normalized = await saved(project => project.name === legacy.name);
      assert.deepEqual(normalized.layers, [{ ...legacy.layers[0], params: { ...legacy.layers[0].params, roundness: 0.6, relief: 0.55 } }]);
      assert.equal(Number(await page.getByLabel('Roundness value', { exact: true }).inputValue()), 0.6);
      assert.equal(Number(await page.getByLabel('Relief value', { exact: true }).inputValue()), 0.55);
      await canvasDigest();
    } finally {
      await fs.writeFile(projectFile, currentBytes);
    }
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await saved(project => project.name === current.name && project.layers[0].params.roundness === 0.92 && project.layers[0].params.relief === 0.18);
  });

  await check('last layer cannot be deleted and blank names restore their previous value', async () => {
    assert.equal(await page.getByTitle('Delete layer', { exact: true }).isDisabled(), true);
    const name = page.getByLabel('Layer name', { exact: true });
    const previous = await name.inputValue();
    await name.fill(''); await name.press('Tab');
    assert.equal(await name.inputValue(), previous);
    const title = page.getByLabel('Project name', { exact: true });
    const previousTitle = await title.inputValue();
    await title.fill(''); await title.press('Tab');
    assert.equal(await title.inputValue(), previousTitle);
    await title.fill('UI verification'); await title.press('Tab');
  });

  await check('Fractal families, controls, presets and native save/open reproduce actual paused GPU artwork', async () => {
    await page.getByRole('button', { name: 'Add fractal', exact: true }).click();
    await saved(project => project.layers.length === 2 && project.layers[1].kind === 'fractal');
    for (const name of ['Add surface', 'Add sculpture', 'Add fractal', 'Add oil slides', 'Add Super 8 Paint']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1);
    }
    await page.getByTitle('Return to start', { exact: true }).click();
    const familyImages = new Set();
    for (const [style, name] of ['Kaleidoscope', 'Julia Bloom', 'Mandelbox'].entries()) {
      const family = page.getByRole('button', { name, exact: true });
      await family.click();
      await saved(project => project.layers[1].params.style === style);
      assert.equal(await family.getAttribute('aria-pressed'), 'true');
      familyImages.add(await canvasDigest());
      const variantImages = new Set();
      for (const variant of ['0', '1', '2']) {
        await page.getByLabel('Fractal variant', { exact: true }).selectOption(variant);
        await saved(project => project.layers[1].params.variant === Number(variant));
        variantImages.add(await canvasDigest());
      }
      assert.equal(variantImages.size, 3, `${name} must render three distinct actual variants.`);
      if (style === 0) {
        assert.equal(await page.getByLabel('Julia real value', { exact: true }).count(), 0);
        assert.equal(await page.getByLabel('Box scale value', { exact: true }).count(), 0);
        assert.equal(await page.getByLabel('Line width value', { exact: true }).count(), 1);
      } else if (style === 1) {
        const real = page.getByLabel('Julia real value', { exact: true });
        assert.equal(await real.inputValue(), '-0.74543', 'Julia coordinates must retain their authored precision in the inspector.');
        await real.fill('');
        await real.pressSequentially('-0.74499');
        assert.equal(await real.inputValue(), '-0.74499', 'A negative five-decimal constant must be naturally typeable.');
        await real.press('Tab');
        await saved(project => project.layers[1].params.juliaReal === -0.74499);
        await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
        await saved(project => project.layers[1].params.juliaReal === -0.74543);
        assert.equal(await real.inputValue(), '-0.74543', 'One undo restores the complete typed number.');
        await page.getByTitle('Redo · ⇧⌘Z', { exact: true }).click();
        await saved(project => project.layers[1].params.juliaReal === -0.74499);
        await real.fill('-0.12345'); await real.press('Escape');
        assert.equal(await real.inputValue(), '-0.74499', 'Escape discards a pending numeric edit.');
        await real.fill(''); await real.press('Tab');
        assert.equal(await real.inputValue(), '-0.74499', 'An empty commit restores the authored finite value.');
        await real.fill('-3'); await real.press('Tab');
        await saved(project => project.layers[1].params.juliaReal === -1.2);
        await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
        await saved(project => project.layers[1].params.juliaReal === -0.74499);
        assert.equal(await page.getByLabel('Symmetry value', { exact: true }).count(), 0);
        await page.getByLabel('Fractal variant', { exact: true }).selectOption('1');
        assert.equal(await page.getByLabel('Symmetry value', { exact: true }).count(), 1);
        assert.equal(await page.getByTitle('Animate Symmetry', { exact: true }).count(), 0);
      } else {
        assert.equal(await page.getByLabel('Julia real value', { exact: true }).count(), 0);
        assert.equal(await page.getByLabel('Line width value', { exact: true }).count(), 0);
        assert.equal(await page.getByLabel('Box scale value', { exact: true }).count(), 1);
        assert.equal(await page.getByLabel('Symmetry value', { exact: true }).count(), 0);
        await page.getByLabel('Mandelbox radial fold', { exact: true }).selectOption('1');
        assert.equal(await page.getByLabel('Symmetry value', { exact: true }).count(), 1);
        await page.getByLabel('Mandelbox radial fold', { exact: true }).selectOption('0');
      }
    }
    assert.equal(familyImages.size, 3, 'Each family must render its own actual paused image.');
    await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
    await saved(project => project.layers[1].params.style === 0);
    await page.getByLabel('Fractal variant', { exact: true }).selectOption('0');
    await page.getByLabel('Fractal render quality', { exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Motion', exact: true }).click();
    const motionOptions = await page.getByLabel('Motion parameter', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value));
    for (const integer of ['style', 'variant', 'quality', 'symmetry', 'radial', 'cycles', 'colorMode', 'colorSteps']) assert.ok(!motionOptions.includes(integer), `${integer} cannot receive a discontinuous modulation route.`);
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const beforeFold = await canvasDigest();
    const fold = page.getByLabel('Fold value', { exact: true });
    const previousFold = Number(await fold.inputValue());
    await fold.fill('0.84'); await fold.press('Tab');
    await saved(project => project.layers[1].params.fold === 0.84);
    const afterFold = await canvasDigest();
    assert.notEqual(afterFold, beforeFold, 'Fold must change the paused GPU form.');
    await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
    await saved(project => project.layers[1].params.fold === previousFold);
    assert.equal(await canvasDigest(), beforeFold);
    await page.getByTitle('Redo · ⇧⌘Z', { exact: true }).click();
    await saved(project => project.layers[1].params.fold === 0.84);
    assert.equal(await canvasDigest(), afterFold);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => project.layers[1]?.kind === 'fractal' && project.layers[1].params.fold === 0.84);
    await fold.fill('0.1'); await fold.press('Tab');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Layer name"]')?.value === 'Acid Tide');
    await page.locator('.layer-row').filter({ hasText: 'Prismatic Fractal' }).click();
    await saved(project => project.layers[1].params.fold === 0.84);
    assert.equal(Number(await fold.inputValue()), 0.84);
    assert.equal(await page.getByLabel('Fractal render quality', { exact: true }).inputValue(), '1');
    const complete = await saved(project => project.layers[1].params.quality === 1 && project.layers[1].params.juliaReal === -0.74499);
    assert.equal(complete.layers[1].params.variant, 0);
    assert.equal(await canvasDigest(), afterFold, 'Native reopening must restore the exact paused Fractal image.');
    const currentBytes = await fs.readFile(projectFile);
    const precise = JSON.parse(currentBytes.toString());
    precise.name = 'Higher precision artwork verified';
    precise.layers[1].params.style = 1;
    precise.layers[1].params.juliaReal = -0.74499123;
    await fs.writeFile(projectFile, JSON.stringify(precise, null, 2));
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await saved(project => project.name === precise.name);
    await page.locator('.layer-row').filter({ hasText: 'Prismatic Fractal' }).click();
    const untouched = page.getByLabel('Julia real value', { exact: true });
    assert.equal(await untouched.inputValue(), '-0.74499');
    await untouched.focus(); await untouched.press('Tab');
    // The fixture already has the expected number. Remove it first so the
    // following assertion cannot mistake the fixture for a completed native save.
    await fs.unlink(projectFile);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => project.layers[1].params.juliaReal === -0.74499123);
    // Open a real v0.4-shaped native file, with only the thirteen additive
    // controls absent. Existing authored parameters and routes must remain exact.
    const legacy = JSON.parse(currentBytes.toString());
    legacy.name = 'Legacy Fractal migration verified';
    for (const key of fractalAddedFields) delete legacy.layers[1].params[key];
    legacy.layers[1].params.morph = 0.35;
    await fs.writeFile(projectFile, JSON.stringify(legacy, null, 2));
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const migrated = await saved(project => project.name === legacy.name);
    assert.equal(migrated.layers[1].params.quality, 2);
    assert.equal(migrated.layers[1].params.juliaReal, -0.74543);
    assert.equal(migrated.layers[1].params.juliaImag, 0.11301);
    assert.equal(migrated.layers[1].params.morph, 0.35);
    assert.deepEqual(migrated.layers[1].modulations, legacy.layers[1].modulations);
    await fs.writeFile(projectFile, currentBytes);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await saved(project => project.name === complete.name && project.layers[1].params.quality === 1);
    await page.locator('.layer-row').filter({ hasText: 'Prismatic Fractal' }).click();
    await page.getByRole('button', { name: 'Presets', exact: true }).click();
    assert.equal(await page.locator('.preset-card').count(), 5, 'Current selection shows the five relevant family looks.');
    await page.getByLabel('Preset library filter', { exact: true }).selectOption('fractal-1');
    assert.equal(await page.locator('.preset-card').count(), 5);
    assert.deepEqual(await page.locator('.preset-card strong').allTextContents(), ['Velvet Julia', 'Coral Mandala', 'Spiral Garden', 'Ember Julia', 'Amber Julia']);
    await page.getByLabel('Preset library filter', { exact: true }).selectOption('all');
    const looks = [['Prismatic Fold', 0, 0], ['Velvet Petals', 0, 1], ['Luminous Weave', 0, 2], ['Velvet Julia', 1, 0], ['Coral Mandala', 1, 1], ['Spiral Garden', 1, 2], ['Abyssal Cathedral', 2, 0], ['Ivory Vault', 2, 1], ['Chromatic Lattice', 2, 2], ['Ink Lace', 0, 0], ['Ember Julia', 1, 0], ['Porcelain Vault', 2, 1]];
    for (const [name, style, variant] of looks) {
      await page.locator('.preset-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }).click();
      await saved(project => project.layers.length === 2 && project.layers[1].kind === 'fractal' && project.layers[1].name === name && project.layers[1].params.style === style && project.layers[1].params.variant === variant);
    }
    await page.screenshot({ path: path.join(artifacts, 'fractal-controls.png'), fullPage: true });
    await page.getByTitle('Delete layer', { exact: true }).click();
    await saved(project => project.layers.length === 1 && project.layers[0].kind === 'surface');
    await page.getByRole('button', { name: 'Instruments', exact: true }).click();
  });

  await check('opacity animation routes correctly and fractional cycles are rounded', async () => {
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByLabel('Opacity value', { exact: true }).fill('0.55');
    await page.getByTitle('Animate Opacity', { exact: true }).click();
    assert.equal(await select('PARAMETER').inputValue(), 'opacity');
    await select('MOTION SOURCE').selectOption('sine');
    await page.getByLabel('Cycles per loop value', { exact: true }).fill('2.4');
    await page.getByLabel('Cycles per loop value', { exact: true }).press('Tab');
    assert.equal(await page.getByLabel('Cycles per loop value', { exact: true }).inputValue(), '2');
    const state = await saved(project => project.layers[0].modulations.opacity?.cycles === 2);
    assert.equal(state.layers[0].opacity, 0.55);
    assert.equal(state.layers[0].modulations.warp, undefined);
  });

  await check('transparent PNG imports and an image mask can become a clean geometric mask', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import image/ }).click();
    await (await chooser).setFiles(fixtureFile);
    await page.getByLabel('Layer name', { exact: true }).waitFor();
    await saved(project => project.layers.length === 2 && project.layers[1].image?.name === 'alpha-artwork.png');
    assert.equal(await page.locator('.layer-row').count(), 2);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    const maskChooser = page.waitForEvent('filechooser');
    await select('MASK SHAPE').selectOption('image');
    await (await maskChooser).setFiles(maskFile);
    await saved(project => project.layers[1].mask.kind === 'image' && !!project.layers[1].mask.dataUrl);
    const imageMask = await canvasDigest();
    await select('MASK SHAPE').selectOption('circle');
    await saved(project => project.layers[1].mask.kind === 'circle' && !('dataUrl' in project.layers[1].mask));
    assert.notEqual(await canvasDigest(), imageMask);
  });

  await check('four layers, order changes, blending and the layer limit work', async () => {
    await page.getByRole('button', { name: 'Add sculpture', exact: true }).click();
    await page.getByRole('button', { name: 'Add fractal', exact: true }).click();
    await saved(project => project.layers.length === 4);
    assert.equal(await page.getByTitle('Duplicate layer', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByTitle('Add a surface layer', { exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Add surface', exact: true }).click();
    assert.equal(await page.locator('.layer-row').count(), 4);
    const sculpture = page.locator('.layer-row').filter({ hasText: 'Pearl Sculpture' });
    await sculpture.getByTitle('Move layer forward', { exact: true }).click();
    assert.equal((await page.locator('.layer-name strong').allTextContents())[0], 'Pearl Sculpture');
    await sculpture.click();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    const before = await canvasDigest();
    await select('BLENDING').selectOption('screen');
    await saved(project => project.layers.at(-1).kind === 'sculpture' && project.layers.at(-1).blend === 'screen');
    assert.notEqual(await canvasDigest(), before);
    // Keep transparent regions in the complete four-layer movie below.
    await page.locator('.layer-row').filter({ hasText: 'Prismatic Fractal' }).click();
    await select('MASK SHAPE').selectOption('circle');
    await page.getByLabel('Transparent background', { exact: true }).check();
  });

  await check('native save/open restores imported assets and complete layer state', async () => {
    await saved(project => project.transparent && project.layers.some(layer => layer.kind === 'fractal' && layer.mask.kind === 'circle'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Project saved.', { exact: true }).waitFor();
    const original = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    assert.equal(original.layers.length, 4);
    assert.deepEqual(new Set(original.layers.map(layer => layer.kind)), new Set(['surface', 'sculpture', 'fractal', 'image']));
    assert.match(original.layers.find(layer => layer.kind === 'image').image.dataUrl, /^data:image\/png;base64,/);
    await page.getByLabel('Project name', { exact: true }).fill('Changed after saving');
    await page.getByLabel('Project name', { exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(name => document.querySelector('[aria-label="Project name"]')?.value === name, original.name);
    assert.equal(await page.getByLabel('Project name', { exact: true }).inputValue(), original.name);
    await saved(project => project.name === original.name);
  });

  await check('sculpture Opening and Twist change the GPU form, undo and survive native save/open', async () => {
    await page.locator('.layer-row').filter({ hasText: 'Pearl Sculpture' }).click();
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const opening = page.getByLabel('Opening value', { exact: true });
    const twist = page.getByLabel('Twist value', { exact: true });
    assert.equal(Number(await opening.inputValue()), 0.55);
    const previousTwist = Number(await twist.inputValue());
    const beforeOpening = await canvasDigest();
    await opening.fill('0.88'); await opening.press('Tab');
    await saved(project => project.layers.find(layer => layer.kind === 'sculpture').params.opening === 0.88);
    const beforeTwist = await canvasDigest();
    assert.notEqual(beforeTwist, beforeOpening, 'Opening must change actual rendered geometry while paused.');
    await twist.fill('-0.65'); await twist.press('Tab');
    await saved(project => project.layers.find(layer => layer.kind === 'sculpture').params.twist === -0.65);
    const afterTwist = await canvasDigest();
    assert.notEqual(afterTwist, beforeTwist, 'Twist must change actual rendered geometry while paused.');
    await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
    await saved(project => project.layers.find(layer => layer.kind === 'sculpture').params.twist === previousTwist);
    assert.equal(Number(await twist.inputValue()), previousTwist);
    assert.equal(await canvasDigest(), beforeTwist, 'Undo must restore the previous rendered sculpture.');
    await page.getByTitle('Redo · ⇧⌘Z', { exact: true }).click();
    await saved(project => project.layers.find(layer => layer.kind === 'sculpture').params.twist === -0.65);
    assert.equal(await canvasDigest(), afterTwist);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => {
      const sculpture = project.layers.find(layer => layer.kind === 'sculpture');
      return sculpture?.params.opening === 0.88 && sculpture.params.twist === -0.65;
    });
    await opening.fill('0.12'); await opening.press('Tab');
    await twist.fill('0.75'); await twist.press('Tab');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Layer name"]')?.value === 'Acid Tide');
    await page.locator('.layer-row').filter({ hasText: 'Pearl Sculpture' }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Opening value"]')?.value === '0.88' && document.querySelector('[aria-label="Twist value"]')?.value === '-0.65');
    await saved(project => {
      const sculpture = project.layers.find(layer => layer.kind === 'sculpture');
      return sculpture?.params.opening === 0.88 && sculpture.params.twist === -0.65;
    });
    assert.equal(Number(await opening.inputValue()), 0.88);
    assert.equal(Number(await twist.inputValue()), -0.65);
    assert.equal(await canvasDigest(), afterTwist, 'Reopening must restore the exact paused sculpture.');
    await page.screenshot({ path: path.join(artifacts, 'sculpture-controls.png'), fullPage: true });
  });

  await check('legacy schema-1 sculptures acquire new defaults without losing saved artwork', async () => {
    const currentBytes = await fs.readFile(projectFile);
    const current = JSON.parse(currentBytes.toString());
    const legacy = structuredClone(current);
    legacy.name = 'Legacy sculpture migration verified';
    const legacySculpture = legacy.layers.find(layer => layer.kind === 'sculpture');
    delete legacySculpture.params.opening;
    delete legacySculpture.params.twist;
    assert.equal(legacy.schemaVersion, 1);
    await fs.writeFile(projectFile, JSON.stringify(legacy, null, 2));
    try {
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      const normalized = await saved(project => project.name === legacy.name);
      const sculpture = normalized.layers.find(layer => layer.kind === 'sculpture');
      assert.deepEqual(sculpture.params, { ...legacySculpture.params, opening: 0.55, twist: 0.3 });
      assert.deepEqual(normalized.layers.filter(layer => layer.kind !== 'sculpture'), legacy.layers.filter(layer => layer.kind !== 'sculpture'));
      assert.equal(normalized.layers.length, 4);
      await page.locator('.layer-row').filter({ hasText: 'Pearl Sculpture' }).click();
      await page.getByRole('button', { name: 'Shape', exact: true }).click();
      assert.equal(Number(await page.getByLabel('Opening value', { exact: true }).inputValue()), 0.55);
      assert.equal(Number(await page.getByLabel('Twist value', { exact: true }).inputValue()), 0.3);
      await canvasDigest();
    } finally {
      await fs.writeFile(projectFile, currentBytes);
    }
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await saved(project => project.name === current.name && project.layers.find(layer => layer.kind === 'sculpture').params.opening === 0.88);
  });

  await check('expanded instrument options render distinct forms and preserve precise color edits through undo', async () => {
    const original = await page.evaluate(() => window.studio.loadAutosave());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => JSON.stringify(project) === JSON.stringify(original));
    const originalBytes = await fs.readFile(projectFile);
    try {
      for (const kind of ['surface', 'sculpture', 'fractal', 'image']) {
        for (const layer of original.layers) {
          const row = page.locator('.layer-row').filter({ has: page.locator('strong', { hasText: new RegExp(`^${layer.name}$`) }) });
          const visible = row.getByTitle('Hide layer', { exact: true });
          if (layer.kind === kind && !(await visible.count())) await row.getByTitle('Show layer', { exact: true }).click();
          else if (layer.kind !== kind && await visible.count()) await visible.click();
        }
        const layer = original.layers.find(layer => layer.kind === kind);
        await page.locator('.layer-row').filter({ has: page.locator('strong', { hasText: new RegExp(`^${layer.name}$`) }) }).click();
        await saved(project => project.layers.every(layer => layer.visible === (layer.kind === kind)));
        await page.getByRole('button', { name: 'Shape', exact: true }).click();
        if (kind === 'surface') {
          const images = new Set();
          for (const name of ['Bands', 'Contours', 'Drips', 'Fusion']) {
            await page.getByRole('button', { name, exact: true }).click();
            for (const variant of ['0', '1', '2']) {
              await page.getByLabel('Surface variant', { exact: true }).selectOption(variant);
              images.add(await canvasDigest());
            }
          }
          assert.equal(images.size, 12, 'All twelve Surface variants must render distinct actual GPU images.');
          assert.equal(await page.getByLabel('Pattern density value', { exact: true }).count(), 1);
          assert.equal(await page.getByLabel('Turbulence value', { exact: true }).count(), 1);
        } else if (kind === 'sculpture') {
          const images = new Set();
          for (const form of ['0', '1', '2', '3']) {
            await page.getByLabel('Sculpture form', { exact: true }).selectOption(form);
            images.add(await canvasDigest());
          }
          assert.equal(images.size, 4, 'Shell, Bloom, Ribbon and Knot must render distinct actual geometry.');
          for (const label of ['Thickness', 'Curl', 'Fold frequency', 'Asymmetry', 'Ridge scale', 'Metal finish', 'Clear coat', 'Sheen', 'Film thickness', 'Light power', 'Shadow strength', 'Shadow softness']) assert.equal(await page.getByLabel(`${label} value`, { exact: true }).count(), 1);
          assert.equal(await page.getByTitle('Animate Lobes', { exact: true }).count(), 0);
        } else if (kind === 'fractal') {
          for (const name of ['Kaleidoscope', 'Julia Bloom', 'Mandelbox']) {
            await page.getByRole('button', { name, exact: true }).click();
            const images = new Set();
            for (const mode of ['0', '1', '2']) {
              await page.getByLabel('Fractal coloring', { exact: true }).selectOption(mode);
              images.add(await canvasDigest());
              assert.equal(await page.getByLabel('Contour colors value', { exact: true }).count(), mode === '2' ? 1 : 0);
              assert.equal(await page.getByLabel('Coloring amount value', { exact: true }).count(), mode === '0' ? 0 : 1);
            }
            assert.equal(images.size, 3, `${name} must render three distinct coloring modes.`);
          }
          assert.equal(await page.getByTitle('Animate Contour colors', { exact: true }).count(), 0);
        } else {
          const images = new Set();
          for (const mirror of ['0', '1', '2', '3']) {
            await page.getByLabel('Image mirror', { exact: true }).selectOption(mirror);
            images.add(await canvasDigest());
          }
          assert.ok(images.size >= 2, 'Image flips must alter the asymmetric imported artwork.');
          const before = await canvasDigest();
          await page.getByLabel('Repeat value', { exact: true }).fill('3');
          await page.getByLabel('Repeat value', { exact: true }).press('Tab');
          await saved(project => project.layers.find(layer => layer.kind === 'image').params.repeat === 3);
          assert.notEqual(await canvasDigest(), before, 'Repeating must tile actual image content.');
          assert.equal(await page.getByTitle('Animate Repeat', { exact: true }).count(), 0);
        }
        await page.getByRole('button', { name: 'Finish', exact: true }).click();
        for (const [key, label, next] of [['saturation', 'Saturation', 0.15], ['hue', 'Hue shift', 0.73], ['exposure', 'Exposure', 0.41]]) {
          const input = page.getByLabel(`${label} value`, { exact: true });
          const previous = (await page.evaluate(() => window.studio.loadAutosave())).layers.find(layer => layer.kind === kind).params[key];
          const before = await canvasDigest();
          await input.fill(String(next)); await input.press('Tab');
          await saved(project => project.layers.find(layer => layer.kind === kind).params[key] === next);
          assert.notEqual(await canvasDigest(), before, `${kind} ${key} must affect actual rendered color.`);
          await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
          await saved(project => project.layers.find(layer => layer.kind === kind).params[key] === previous);
          // Input changes can resize the inspector while the GPU frame is in flight.
          // Confirm the restored canvas after layout and rendering have settled.
          let restored = await canvasDigest();
          if (restored !== before) {
            await page.waitForTimeout(500);
            restored = await canvasDigest();
          }
          assert.equal(restored, before, `${kind} ${key} undo must reproduce the same paused artwork.`);
        }
        await page.getByRole('button', { name: 'Motion', exact: true }).click();
        const options = await page.getByLabel('Motion parameter', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value));
        for (const key of ['saturation', 'hue', 'exposure']) assert.ok(options.includes(key));
        for (const key of ['form', 'lobes', 'variant', 'colorMode', 'colorSteps', 'mirror', 'repeat', 'quality']) assert.ok(!options.includes(key), `${kind} ${key} cannot be offered for animation.`);
      }
    } finally {
      await fs.writeFile(projectFile, originalBytes);
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await page.waitForFunction(name => document.querySelector('[aria-label="Layer name"]')?.value === name, original.layers[0].name);
      await saved(project => JSON.stringify(project) === JSON.stringify(original));
    }
  });

  await check('all instrument libraries expose their new looks and native reopening restores the complete composition', async () => {
    const original = await page.evaluate(() => window.studio.loadAutosave());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => JSON.stringify(project) === JSON.stringify(original));
    const originalBytes = await fs.readFile(projectFile);
    try {
      await page.getByRole('button', { name: 'Presets', exact: true }).click();
      for (const [filter, count] of [['signature', 20], ['all', 139], ['graphic', 32], ['super8', 6], ['oil', 9], ['surface', 17], ['surface-0', 5], ['surface-1', 4], ['surface-2', 4], ['surface-3', 4], ['sculpture', 11], ['sculpture-0', 3], ['sculpture-1', 3], ['sculpture-2', 3], ['sculpture-3', 2], ['fractal', 15]]) {
        await page.getByLabel('Preset library filter', { exact: true }).selectOption(filter);
        assert.equal(await page.locator('.preset-card').count(), count, `Library ${filter} must show ${count} matching looks.`);
      }
      for (const [kind, names] of [
        ['surface', ['Citrine Braids', 'Velvet Ribbons', 'Ripple Glass', 'Vortex Pool', 'Coral Beads', 'Satin Strands', 'Twin Suns', 'Chromatic Lens']],
        ['sculpture', ['Pearl Bloom', 'Chrome Dahlia', 'Satin Orbit', 'Aurora Ribbon', 'Liquid Trefoil']],
      ]) {
        const name = original.layers.find(layer => layer.kind === kind).name;
        await page.locator('.layer-row').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }).click();
        await page.getByLabel('Preset library filter', { exact: true }).selectOption(kind);
        for (const name of names) {
          await page.locator('.preset-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }).click();
          await saved(project => project.layers.length === 4 && project.layers.some(layer => layer.kind === kind && layer.name === name));
        }
      }
    } finally {
      await fs.writeFile(projectFile, originalBytes);
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await page.waitForFunction(name => document.querySelector('[aria-label="Layer name"]')?.value === name, original.layers[0].name);
      await saved(project => JSON.stringify(project) === JSON.stringify(original));
      await page.getByRole('button', { name: 'Instruments', exact: true }).click();
    }
  });

  await check('Oil Slides controls, palettes, saved projects and interrupted native movie export work in the editor', async () => {
    const original = await page.evaluate(() => window.studio.loadAutosave());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => JSON.stringify(project) === JSON.stringify(original));
    const originalBytes = await fs.readFile(projectFile);
    try {
      await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
      await page.locator('.oil-card').click();
      await saved(project => project.layers.length === 4 && project.layers.some(layer => layer.kind === 'oil'));
      for (const layer of original.layers.slice(1)) {
        const row = page.locator('.layer-row').filter({ has: page.locator('strong', { hasText: new RegExp(`^${layer.name}$`) }) });
        await row.getByTitle('Hide layer', { exact: true }).click();
      }
      const before = await canvasDigest();
      await page.getByLabel('Refraction value', { exact: true }).fill('0');
      await page.getByLabel('Refraction value', { exact: true }).press('Tab');
      await saved(project => project.layers.find(layer => layer.kind === 'oil').params.refraction === 0);
      assert.notEqual(await canvasDigest(), before, 'Oil refraction must change the actual preview.');
      await page.getByRole('button', { name: 'Show fine tuning', exact: true }).click();
      await page.getByLabel('Lens lift value', { exact: true }).fill('1');
      await page.getByLabel('Lens lift value', { exact: true }).press('Tab');
      for (const role of ['Paint', 'Secondary paint', 'Ink', 'Substrate', 'Shadow tint', 'Rim tint']) assert.equal(await page.getByLabel(role, { exact: true }).count(), 1);
      await page.getByRole('button', { name: 'Presets', exact: true }).click();
      await page.getByLabel('Preset library filter', { exact: true }).selectOption('selected');
      assert.equal(await page.locator('.preset-card').count(), 9);
      for (const name of ['Cobalt Tide', 'Ember Glass', 'Pearl Ink', 'Cellular Lift', 'Ink Drag', 'Chromatic Slides', 'Acid Slide']) {
        await page.locator('.preset-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }).click();
        await saved(project => project.layers.some(layer => layer.kind === 'oil' && layer.name === name));
      }
      for (const [label, value] of [['Organic shape', '0.82'], ['Lens depth', '0.76'], ['Cell complexity', '0.91'], ['Color separation', '0.28']]) {
        await page.getByLabel(`${label} value`, { exact: true }).fill(value);
        await page.getByLabel(`${label} value`, { exact: true }).press('Tab');
      }
      await saved(project => {
        const params = project.layers.find(layer => layer.kind === 'oil').params;
        return params.deformation === .82 && params.lensDepth === .76 && params.cellComplexity === .91 && params.dispersion === .28;
      });
      await page.getByLabel('Oil substrate', { exact: true }).selectOption('0');
      await page.getByLabel('Oil render quality', { exact: true }).selectOption('2');
      await page.getByRole('button', { name: 'Motion', exact: true }).click();
      await page.getByLabel('Motion parameter', { exact: true }).selectOption('travel');
      await page.getByLabel('Motion source', { exact: true }).selectOption('noise');
      const authored = await saved(project => project.layers.find(layer => layer.kind === 'oil')?.modulations.travel?.kind === 'noise');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await savedProjectFile(project => JSON.stringify(project) === JSON.stringify(authored));
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await saved(project => JSON.stringify(project) === JSON.stringify(authored));
      await page.locator('.layer-row').filter({ hasText: 'Acid Slide' }).click();
      await page.getByRole('button', { name: 'Shape', exact: true }).click();
      assert.equal(await page.getByLabel('Oil render quality', { exact: true }).inputValue(), '2');
      assert.equal(await page.getByLabel('Oil substrate', { exact: true }).inputValue(), '0');
      for (const [label, value] of [['Organic shape', '0.82'], ['Lens depth', '0.76'], ['Cell complexity', '0.91'], ['Color separation', '0.28']]) {
        assert.equal(await page.getByLabel(`${label} value`, { exact: true }).inputValue(), value);
      }
      await page.getByLabel('Oil render quality', { exact: true }).selectOption('1');
      await page.screenshot({ path: path.join(artifacts, 'oil-slides.png'), fullPage: true });
      await page.getByLabel('Loop duration', { exact: true }).fill('1');
      await page.getByLabel('Loop duration', { exact: true }).press('Tab');
      const priorIds = new Set((await page.evaluate(() => window.studio.listJobs())).map(job => job.id));
      await page.getByRole('button', { name: 'Export', exact: false }).click();
      const modal = page.getByRole('dialog');
      await select('RESOLUTION', modal).selectOption('960x540');
      await select('FRAME RATE', modal).selectOption('30/1');
      await select('DELIVERY FORMAT', modal).selectOption('prores4444');
      await modal.getByLabel('Transparent output', { exact: true }).check();
      await modal.getByLabel('Export destination', { exact: true }).fill(outputDirectory);
      await modal.getByRole('button', { name: 'Render loop', exact: true }).click();
      let partial;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        partial = (await page.evaluate(() => window.studio.listJobs())).find(job => !priorIds.has(job.id));
        if (partial?.completedFrames.length >= 2) break;
        await page.waitForTimeout(30);
      }
      assert.ok(partial && partial.completedFrames.length >= 2 && partial.completedFrames.length < 30, 'Oil export should have resumable rendered frames.');
      await modal.getByRole('button', { name: 'Stop safely', exact: true }).click();
      const resume = modal.getByRole('button', { name: 'Resume', exact: true });
      await resume.waitFor();
      const cached = path.join(partial.directory, 'cache', 'frame-000000.exr');
      const retained = crypto.createHash('sha256').update(await fs.readFile(cached)).digest('hex');
      await resume.click();
      await modal.getByText('Export complete', { exact: true }).waitFor({ timeout: 120000 });
      const completed = (await page.evaluate(() => window.studio.listJobs())).find(job => job.id === partial.id);
      assert.equal(completed.status, 'complete');assert.equal(completed.completedFrames.length, 30);
      assert.equal(crypto.createHash('sha256').update(await fs.readFile(cached)).digest('hex'), retained, 'Resume must reuse the original cached Oil frame.');
      const stream = JSON.parse(run(ffprobePath, ['-v','error','-count_frames','-show_streams','-of','json',completed.outputPath]).toString()).streams[0];
      assert.equal(Number(stream.nb_read_frames),30);assert.equal(stream.width,960);assert.match(stream.pix_fmt,/^yuva/);
      await fs.writeFile(path.join(artifacts,'oil-export-verification.json'),JSON.stringify({jobId:completed.id,outputPath:completed.outputPath,resumed:true,reusedFrameSHA256:retained,stream},null,2));
      await modal.getByRole('button', { name: 'Close export', exact: true }).click();
    } finally {
      await fs.writeFile(projectFile, originalBytes);
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await page.waitForFunction(name => document.querySelector('[aria-label="Layer name"]')?.value === name, original.layers[0].name);
      await saved(project => JSON.stringify(project) === JSON.stringify(original));
      await page.getByRole('button', { name: 'Instruments', exact: true }).click();
    }
  });

  await check('Super 8 Paint modes, controls, presets and saved animation work in the editor', async () => {
    const original = await page.evaluate(() => window.studio.loadAutosave());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await savedProjectFile(project => JSON.stringify(project) === JSON.stringify(original));
    const originalBytes = await fs.readFile(projectFile);
    try {
      await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
      await page.getByRole('button', { name: 'Add Super 8 Paint', exact: true }).click();
      await saved(project => project.layers.length === 4 && project.layers.some(layer => layer.kind === 'super8'));
      const modes = ['Chromatic Staircase', 'Paint Destruction', 'Scratched Negative', 'Cut-out Collage'];
      for (let mode = 0; mode < modes.length; mode++) {
        await page.getByLabel('Super 8 mode', { exact: true }).selectOption(String(mode));
        await saved(project => project.layers.find(layer => layer.kind === 'super8').params.mode === mode);
      }
      for (const [label, value] of [['Paint texture', '0.91'], ['Geometry steps', '9'], ['Film frame rate', '12'], ['Scratches', '0.78'], ['Flicker', '0.42'], ['Feedback', '0.68']]) {
        await page.getByLabel(`${label} value`, { exact: true }).fill(value);
        await page.getByLabel(`${label} value`, { exact: true }).press('Tab');
      }
      await page.getByLabel('Super 8 substrate', { exact: true }).selectOption('0');
      await saved(project => {
        const p = project.layers.find(layer => layer.kind === 'super8').params;
        return p.mode === 3 && p.texture === .91 && p.steps === 9 && p.filmFps === 12 && p.scratches === .78 && p.flicker === .42 && p.feedback === .68 && p.substrate === 0;
      });
      for (const view of ['0','1','2']) {
        await page.getByLabel('Super 8 projector view', { exact: true }).selectOption(view);
        await saved(project => project.layers.find(layer => layer.kind === 'super8').params.gateMode === Number(view));
        assert.equal(await page.getByLabel('Gate inset value', { exact: true }).count(), view === '0' ? 0 : 1);
        assert.equal(await page.getByLabel('Sprocket holes value', { exact: true }).count(), view === '2' ? 1 : 0);
      }
      for (const [label,value] of [['Emulsion movement','.85'],['Frame advance','.9'],['Projector shutter','.4'],
        ['Shutter blades','3'],['Reel turns per loop','2'],['Gate inset','.05'],['Gate corners','.65'],
        ['Sprocket holes','.9'],['Frame lines','.7'],['Dust','.6'],['Gate hair','.4'],
        ['Lens softness','.35'],['Halation','.6'],['Projector vignette','.4'],['Light leaks','.55'],['Color fading','.3']]) {
        await page.getByLabel(label+' value',{exact:true}).fill(value);
        await page.getByLabel(label+' value',{exact:true}).press('Tab');
      }
      await saved(project => {
        const p = project.layers.find(layer=>layer.kind==='super8').params;
        return p.gateMode===2 && p.emulsion===.85 && p.pullDown===.9 && p.shutter===.4 && p.shutterBlades===3
          && p.reelLoops===2 && p.sprockets===.9 && p.lightLeak===.55 && p.halation===.6 && p.colorFade===.3;
      });
      const before = await canvasDigest();
      await page.getByLabel('Super 8 mode', { exact: true }).selectOption('0');
      await saved(project => project.layers.find(layer => layer.kind === 'super8').params.mode === 0);
      assert.notEqual(await canvasDigest(), before, 'The selected mode must change the real preview.');
      assert.equal(await page.getByLabel('Paint texture value', { exact: true }).inputValue(), '0.91');
      for (const role of ['Paint 1', 'Paint 2', 'Paint 3', 'Paint 4', 'Ink', 'Paper']) assert.equal(await page.getByLabel(role, { exact: true }).count(), 1);
      await page.getByRole('button', { name: 'Presets', exact: true }).click();
      await page.getByLabel('Preset library filter', { exact: true }).selectOption('selected');
      assert.equal(await page.locator('.preset-card').count(), 6);
      for (const name of modes) {
        await page.locator('.preset-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }).click();
        await saved(project => project.layers.length === 4 && project.layers.some(layer => layer.kind === 'super8' && layer.name === name));
      }
      await page.getByRole('button', { name: 'Motion', exact: true }).click();
      await page.getByLabel('Motion parameter', { exact: true }).selectOption('lightLeak');
      await page.getByLabel('Motion source', { exact: true }).selectOption('noise');
      await page.getByLabel('Motion parameter', { exact: true }).selectOption('feedback');
      await page.getByLabel('Motion source', { exact: true }).selectOption('sine');
      const authored = await saved(project => project.layers.find(layer => layer.kind === 'super8').modulations.feedback?.kind === 'sine' && project.layers.find(layer => layer.kind === 'super8').modulations.lightLeak?.kind === 'noise');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await savedProjectFile(project => JSON.stringify(project) === JSON.stringify(authored));
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await saved(project => JSON.stringify(project) === JSON.stringify(authored));
      await page.locator('.layer-row').filter({ has: page.locator('strong', { hasText: /^Cut-out Collage$/ }) }).click();
      await page.getByRole('button', { name: 'Motion', exact: true }).click();
      await page.getByLabel('Motion parameter', { exact: true }).selectOption('feedback');
      assert.equal(await page.getByLabel('Motion source', { exact: true }).inputValue(), 'sine');
      await page.getByRole('button', { name: 'Shape', exact: true }).click();
      assert.equal(await page.getByLabel('Super 8 mode', { exact: true }).inputValue(), '3');
      await page.screenshot({ path: path.join(artifacts, 'super8-paint.png'), fullPage: true });
    } finally {
      await fs.writeFile(projectFile, originalBytes);
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await page.waitForFunction(name => document.querySelector('[aria-label="Layer name"]')?.value === name, original.layers[0].name);
      await saved(project => JSON.stringify(project) === JSON.stringify(original));
      await page.getByRole('button', { name: 'Instruments', exact: true }).click();
    }
  });

  await check('autosave survives an actual renderer reload', async () => {
    await page.getByLabel('Project name', { exact: true }).fill('Autosave recovery verified');
    await page.getByLabel('Project name', { exact: true }).press('Tab');
    await saved(project => project.name === 'Autosave recovery verified');
    await page.reload();
    await page.getByText('Export engine ready', { exact: true }).waitFor({ timeout: 45000 });
    await page.waitForFunction(() => document.querySelector('[aria-label="Project name"]')?.value === 'Autosave recovery verified');
    assert.equal(await page.locator('.layer-row').count(), 4);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  });

  await check('full UI renders and verifies a 30-frame transparent ProRes 4444 movie', async () => {
    await page.getByLabel('Loop duration', { exact: true }).fill('1');
    await page.getByLabel('Loop duration', { exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Export', exact: false }).click();
    const modal = page.getByRole('dialog');
    await select('RESOLUTION', modal).selectOption('960x540');
    await select('FRAME RATE', modal).selectOption('30/1');
    await select('DELIVERY FORMAT', modal).selectOption('prores4444');
    await modal.getByLabel('Transparent output', { exact: true }).check();
    await modal.getByLabel('Export destination', { exact: true }).fill(outputDirectory);
    await modal.getByRole('button', { name: 'Render loop', exact: true }).click();
    await modal.getByText('Export complete', { exact: true }).waitFor({ timeout: 120000 });
    const jobs = await page.evaluate(() => window.studio.listJobs());
    const job = jobs.find(job => job.status === 'complete');
    assert.ok(job?.outputPath, 'The actual native export job must finish.');
    assert.equal(job.completedFrames.length, 30);
    const stream = JSON.parse(run(ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-of', 'json', job.outputPath]).toString()).streams[0];
    assert.equal(stream.width, 960); assert.equal(stream.height, 540);
    assert.equal(Number(stream.nb_read_frames), 30);
    assert.equal(stream.avg_frame_rate, '30/1');
    assert.match(stream.pix_fmt, /^yuva/);
    assert.equal(stream.color_transfer, 'bt709');
    const alpha = run(ffmpegPath, ['-v', 'error', '-nostdin', '-i', job.outputPath, '-frames:v', '1', '-vf', 'alphaextract', '-pix_fmt', 'gray16le', '-f', 'rawvideo', 'pipe:1']);
    let minimum = 65535, maximum = 0;
    for (let index = 0; index < alpha.length; index += 2) { const sample = alpha.readUInt16LE(index); minimum = Math.min(minimum, sample); maximum = Math.max(maximum, sample); }
    assert.ok(minimum < 60000 && maximum > minimum + 500, `Expected genuine varying coverage, got alpha ${minimum}..${maximum}`);
    const frameHashes = run(ffmpegPath, ['-v', 'error', '-nostdin', '-i', job.outputPath, '-an', '-f', 'framemd5', 'pipe:1']).toString().split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
    assert.ok(new Set(frameHashes).size > 1, 'The movie must contain actual animation.');
    await fs.writeFile(path.join(artifacts, 'export-verification.json'), JSON.stringify({ outputPath: job.outputPath, stream, alpha: { minimum, maximum }, distinctFrames: new Set(frameHashes).size }, null, 2));
    await modal.getByRole('button', { name: 'Close export', exact: true }).click();
  });

  await page.screenshot({ path: path.join(artifacts, 'studio.png'), fullPage: true });
  await check('immediate native close flushes an unblurred name and survives app restart', async () => {
    const title = 'Immediate close recovery verified';
    await page.getByLabel('Project name', { exact: true }).fill(title);
    // Deliberately do not blur or wait for the 700 ms autosave debounce.
    const closed = page.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    const flushed = JSON.parse(await fs.readFile(path.join(userData, 'autosave.formfield'), 'utf8'));
    assert.equal(flushed.name, title);
    await app.close(); app = null;
    await launchStudio();
    await page.waitForFunction(name => document.querySelector('[aria-label="Project name"]')?.value === name, title);
    assert.equal(await page.locator('.layer-row').count(), 4);
    await page.getByText('Autosaved', { exact: true }).waitFor();
    const backups = (await fs.readdir(path.join(userData, 'recovery'))).filter(name => name.endsWith('.formfield'));
    assert.ok(backups.length >= 1, 'The previous session autosave should be backed up before replacement.');
    const backup = JSON.parse(await fs.readFile(path.join(userData, 'recovery', backups.at(-1)), 'utf8'));
    assert.equal(backup.name, title);
  });
  await check('native close commits a pending signed Julia number before serializing artwork', async () => {
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('.layer-row').filter({ hasText: 'Prismatic Fractal' }).click();
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    await page.getByRole('button', { name: 'Julia Bloom', exact: true }).click();
    await saved(project => project.layers.some(layer => layer.kind === 'fractal' && layer.params.style === 1));
    const real = page.getByLabel('Julia real value', { exact: true });
    await real.fill(''); await real.pressSequentially('-0.74491');
    // Leave the numeric input focused and bypass the autosave debounce.
    const closed = page.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    const flushed = JSON.parse(await fs.readFile(path.join(userData, 'autosave.formfield'), 'utf8'));
    assert.equal(flushed.layers.find(layer => layer.kind === 'fractal').params.juliaReal, -0.74491);
    await app.close(); app = null;
    await launchStudio();
    await saved(project => project.layers.some(layer => layer.kind === 'fractal' && layer.params.juliaReal === -0.74491));
    await page.locator('.layer-row').filter({ hasText: 'Prismatic Fractal' }).click();
    assert.equal(await page.getByLabel('Julia real value', { exact: true }).inputValue(), '-0.74491');
  });
  await check('a malformed prior autosave is preserved byte-for-byte before replacement', async () => {
    await app.close(); app = null;
    const previous = JSON.parse(await fs.readFile(path.join(userData, 'autosave.formfield'), 'utf8'));
    const damaged = Buffer.from('{"schemaVersion":1,"recoverable-note":"original artwork bytes",BROKEN');
    await fs.writeFile(path.join(userData, 'autosave.formfield'), damaged);
    await launchStudio({ recovery: true });
    await page.getByRole('alert').waitFor();
    await page.evaluate(snapshot => window.studio.saveAutosave(snapshot), previous);
    const backups = (await fs.readdir(path.join(userData, 'recovery'))).filter(name => name.endsWith('.formfield'));
    let preserved = false;
    for (const backup of backups) if ((await fs.readFile(path.join(userData, 'recovery', backup))).equals(damaged)) preserved = true;
    assert.ok(preserved, 'A malformed document must survive in recovery without parsing or normalization.');
    await page.getByLabel('Dismiss error', { exact: true }).click();
  });
  assert.deepEqual(errors, [], 'Renderer console/page errors were captured.');
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ status: 'passed', runDirectory, distSha256, distFiles, checks, errors, warnings }, null, 2));
  console.log(`UI verification passed. Screenshot: ${path.join(artifacts, 'studio.png')}`);
} catch (error) {
  errors.push({ type: 'verification', message: error.stack || error.message });
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(artifacts, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => {});
  }
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ status: 'failed', runDirectory, distSha256, distFiles, checks, errors, warnings }, null, 2));
  throw error;
} finally {
  if (app) {
    // A broken native validation/close handshake must not leave a failed
    // verification instance running indefinitely against its isolated profile.
    const force = setTimeout(() => app.process().kill('SIGKILL'), 10000);
    try { await app.close(); } catch { app.process().kill('SIGKILL'); }
    finally { clearTimeout(force); }
  }
}
