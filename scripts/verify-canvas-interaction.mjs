import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/canvas-interaction', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {createProject,createLayer,applyPreset,validateProject} from './src/core/project'; export {canvasAxes} from './src/core/canvas-interaction';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'model.cjs'), logLevel: 'silent' });
const model = createRequire(import.meta.url)(path.join(out, 'model.cjs'));
const fixture = path.join(out, 'fixture.formfield');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,dialog}=require('electron'); app.setPath('userData',${JSON.stringify(path.join(out, 'profile'))}); dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]}); require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const bundle = process.argv[2] ? path.resolve(process.argv[2]) : null;
const app = await electron.launch(bundle
  ? { executablePath: path.join(bundle, 'Contents/MacOS/Form & Field'), args: [`--user-data-dir=${path.join(out, 'profile')}`], env }
  : { args: [path.join(out, 'main.cjs')], env });
if (bundle) await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
const page = await app.firstWindow(), errors = [], checks = [];
page.setDefaultTimeout(15000);
page.on('pageerror', e => errors.push(String(e)));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const canvas = page.getByLabel('Composition preview', { exact: true });
const state = () => page.evaluate(() => window.studio.loadAutosave());
async function saved(predicate) {
  for (let i = 0; i < 100; i++) { const p = await state(); if (p && predicate(p)) return p; await page.waitForTimeout(100); }
  throw Error('Autosave did not reach expected state');
}
async function load(layers, name = 'Interactive surface') {
  const p = { ...model.createProject(), name, layers };
  await fs.writeFile(fixture, JSON.stringify(p));
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await saved(x => x.id === p.id); return p;
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function clickLock(title) {
  const control=page.getByTitle(title,{exact:true});
  if(!await control.isVisible())await page.getByRole('button',{name:'Variation settings',exact:true}).click();
  await control.click();
}
async function undoTo(p) { await page.getByTitle('Undo · ⌘Z', { exact: true }).click(); await saved(x => JSON.stringify(x) === JSON.stringify(p)); }
async function drag(dx, dy, keys = [], outside = false) {
  const b = await canvas.boundingBox(), x = b.x + b.width * .45, y = b.y + b.height * .5;
  await page.mouse.move(x, y);
  for (const key of keys) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.move(outside ? b.x + b.width + 20 : x + b.width * dx, y + b.height * dy, { steps: 12 });
  await page.mouse.up();
  for (const key of keys.toReversed()) await page.keyboard.up(key);
}
const defaultLocks = { palette: true, structure: false, motion: true, material: false };
try {
  await page.getByText('Export engine ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await check('preview renders at native display density within its pixel budget', async () => {
    await page.waitForFunction(() => document.querySelector('canvas[aria-label="Composition preview"]').width > 2);
    const sizes = await canvas.evaluate(c => {
      const rect=c.getBoundingClientRect();
      return {width:c.width,height:c.height,cssWidth:rect.width,cssHeight:rect.height,dpr:window.devicePixelRatio};
    });
    const density=Math.min(Math.max(1,sizes.dpr),3840/Math.max(sizes.cssWidth,sizes.cssHeight),Math.sqrt(8_294_400/(sizes.cssWidth*sizes.cssHeight)));
    assert.ok(Math.abs(sizes.width-sizes.cssWidth*density)<3);
    assert.ok(Math.abs(sizes.height-sizes.cssHeight*density)<3);
  });
  let original = await load([model.createLayer('surface')]);
  await check('click varies selected layer, preserves locks, and undo/redo restores exact state', async () => {
    await canvas.click();
    const after = await saved(p => JSON.stringify(p.layers[0].params) !== JSON.stringify(original.layers[0].params));
    assert.deepEqual(after.layers[0].palette, original.layers[0].palette);
    assert.deepEqual(after.layers[0].transform, original.layers[0].transform);
    assert.equal(after.layers[0].params.seed, original.layers[0].params.seed);
    await undoTo(original);
    await page.getByTitle('Redo · ⇧⌘Z', { exact: true }).click();
    await saved(p => JSON.stringify(p) === JSON.stringify(after));
    await undoTo(original);
  });
  await check('shape drag changes only its two axes and is one undo step', async () => {
    const before = await canvas.screenshot();
    const b = await canvas.boundingBox(), x = b.x + b.width * .45, y = b.y + b.height * .5;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + b.width * .18, y - b.height * .16, { steps: 12 });
    await page.locator('.canvas-readout').waitFor();
    const reticle = await page.locator('.canvas-reticle').boundingBox();
    assert.ok(Math.abs(reticle.x + reticle.width / 2 - x - b.width * .18) < 3);
    assert.ok(Math.abs(reticle.y + reticle.height / 2 - y + b.height * .16) < 3);
    await page.screenshot({ path: path.join(out, 'shaping.png') });
    await page.mouse.up();
    const after = await saved(p => p.layers[0].params.warp !== original.layers[0].params.warp);
    assert.notEqual(after.layers[0].params.detail, original.layers[0].params.detail);
    assert.deepEqual(after.layers[0].transform, original.layers[0].transform);
    for (const key of Object.keys(original.layers[0].params)) if (!['warp', 'detail'].includes(key)) assert.equal(after.layers[0].params[key], original.layers[0].params[key], key);
    assert.notDeepEqual(await canvas.screenshot(), before);
    await undoTo(original);
  });
  await check('Ctrl drag pans in canvas coordinates with no randomization', async () => {
    await drag(.12, .1, ['Control']);
    const after = await saved(p => p.layers[0].transform.x > .1);
    assert.ok(Math.abs(after.layers[0].transform.x - .12) < .004);
    assert.ok(Math.abs(after.layers[0].transform.y - .1) < .004);
    assert.deepEqual(after.layers[0].params, original.layers[0].params);
    await undoTo(original);
  });
  await check('Ctrl click never varies; normal wheel never zooms', async () => {
    await canvas.click({ modifiers: ['Control'] });
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(850);
    assert.deepEqual(await state(), original);
  });
  await check('wheel burst zooms around cursor and undoes atomically', async () => {
    const b = await canvas.boundingBox(), px = .2, py = -.1;
    await page.mouse.move(b.x + b.width * (.5 + px), b.y + b.height * (.5 + py));
    await page.keyboard.down('Control');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -40);
    await page.keyboard.up('Control');
    const after = await saved(p => p.layers[0].transform.scale > 1.4);
    const t = after.layers[0].transform;
    assert.ok(Math.abs(t.x - px * (1 - t.scale)) < .005);
    assert.ok(Math.abs(t.y - py * (1 - t.scale)) < .005);
    assert.deepEqual(after.layers[0].params, original.layers[0].params);
    assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
    await page.screenshot({ path: path.join(out, 'zoom.png') });
    await undoTo(original);
  });
  await check('capture keeps dragging beyond canvas and releases correctly', async () => {
    await drag(0, .05, ['Control'], true);
    const moved = await saved(p => p.layers[0].transform.x > .5);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(850);
    assert.deepEqual(await state(), moved);
    await undoTo(original);
  });
  await check('Shift fine movement and keyboard controls work', async () => {
    await drag(.2, .1, ['Control', 'Shift']);
    const moved = await saved(p => p.layers[0].transform.x > .02);
    assert.ok(Math.abs(moved.layers[0].transform.x - .04) < .004);
    await undoTo(original);
    await canvas.focus(); await page.keyboard.press('ArrowRight');
    await saved(p => p.layers[0].params.warp > original.layers[0].params.warp);
    await page.keyboard.press('Meta+z');
    await saved(p => JSON.stringify(p) === JSON.stringify(original));
    await canvas.focus(); await page.keyboard.press('Control+=');
    await saved(p => p.layers[0].transform.scale > 1);
    await page.getByRole('button', { name: 'Reset layer framing' }).click();
    await saved(p => JSON.stringify(p) === JSON.stringify(original));
  });
  await check('pointer cancellation and blur do not produce a click or a stuck gesture', async () => {
    const b = await canvas.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up(); await page.waitForTimeout(850);
    assert.deepEqual(await state(), original);
    await page.mouse.down(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
    await page.waitForTimeout(850); assert.deepEqual(await state(), original);
  });
  await check('layout shortcuts end a captured gesture before the canvas changes size', async () => {
    const b=await canvas.boundingBox(),x=b.x+b.width*.4,y=b.y+b.height*.4;
    await page.mouse.move(x,y);await page.keyboard.down('Control');await page.mouse.down();
    await page.mouse.move(x+b.width*.1,y+b.height*.08,{steps:8});
    const moved=await saved(p=>p.layers[0].transform.x>.08);
    await page.keyboard.up('Control');await page.keyboard.press('f');
    await page.getByRole('button',{name:'Exit focus mode',exact:true}).waitFor();
    await page.mouse.move(x+b.width*.3,y+b.height*.2,{steps:8});await page.mouse.up();
    await page.waitForTimeout(850);assert.deepEqual(await state(),moved);
    await page.getByRole('button',{name:'Exit focus mode',exact:true}).click();
    await undoTo(original);
  });
  await check('locks prevent shape edits and hidden layers cannot be changed', async () => {
    await clickLock('Lock structure');
    await clickLock('Lock material');
    await drag(.2, -.2); await canvas.click(); await page.waitForTimeout(850);
    assert.deepEqual(await state(), original);
    await clickLock('Unlock structure');
    await clickLock('Unlock material');
    const hidden = model.createLayer('surface'); hidden.visible = false;
    const p = await load([hidden]);
    assert.equal(await canvas.getAttribute('aria-disabled'), 'true');
    await canvas.click({ force: true }); await drag(.1, .1, ['Control']); await page.waitForTimeout(850);
    assert.deepEqual(await state(), p);
  });
  await check('animated transforms and shape routes remain authored', async () => {
    const layer = model.createLayer('surface');
    const mod = { kind: 'sine', cycles: 1, phase: 0, amount: .2, points: [] };
    layer.modulations = { 'transform.x': mod, warp: mod, detail: mod };
    const p = await load([layer]);
    await drag(.2, -.2, ['Control']); await page.waitForTimeout(850);
    assert.deepEqual(await state(), p);
    await drag(.1, -.1);
    const after = await saved(x => JSON.stringify(x) !== JSON.stringify(p));
    assert.deepEqual(after.layers[0].modulations, layer.modulations);
    assert.equal(after.layers[0].params.warp, layer.params.warp);
    assert.equal(after.layers[0].params.detail, layer.params.detail);
  });
  await check('all 16 procedural instruments support valid shape edits and exact undo', async () => {
    for (const kind of ['surface','sculpture','fractal','oil','super8','graphic','livingink','relief','resonance']) {
      const layer = model.createLayer(kind), p = await load([layer], 'Interactive ' + kind);
      const axes = model.canvasAxes(layer, defaultLocks);
      await drag(.15, -.12);
      const after = await saved(x => axes.some(d => x.layers[0].params[d.key] !== layer.params[d.key]));
      model.validateProject(after);
      await undoTo(p);
      console.log('  Verified ' + kind);
    }
  });
  await check('multi-layer gestures edit only the selected layer and use letterboxed canvas bounds', async () => {
    const a = model.createLayer('surface'), b = model.createLayer('fractal');
    original = await load([a, b]);
    await drag(.1, .1, ['Control']);
    const after = await saved(p => p.layers[0].transform.x > .08);
    assert.deepEqual(after.layers[1], b);
    await undoTo(original);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 900));
    await page.waitForTimeout(500);
    await drag(.1, .1, ['Control']);
    const narrow = await saved(p => p.layers[0].transform.x > .08);
    assert.ok(Math.abs(narrow.layers[0].transform.x - .1) < .006);
    assert.ok(Math.abs(narrow.layers[0].transform.y - .1) < .006);
    await page.screenshot({ path: path.join(out, 'narrow.png') });
    await undoTo(original);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 980));
  });
  await check('native save/open and actual PNG/movie export retain the interactive edits', async () => {
    original = await load([model.createLayer('surface')]);
    await drag(.12, -.08);
    await saved(p => p.layers[0].params.warp !== original.layers[0].params.warp);
    await drag(.1, .07, ['Control']);
    const edited = await saved(p => p.layers[0].transform.x > .08);
    const projectFile = path.join(out, 'interactive.formfield'), stillFile = path.join(out, 'interactive.png');
    await app.evaluate(({ dialog }, { projectFile, stillFile }) => {
      dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: options.title.includes('PNG') ? stillFile : projectFile });
    }, { projectFile, stillFile });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Project saved.', { exact: true }).waitFor();
    assert.deepEqual(JSON.parse(await fs.readFile(projectFile, 'utf8')), edited);
    await page.getByTitle('Undo · ⌘Z', { exact: true }).click();
    await saved(p => p.layers[0].transform.x === 0);
    await app.evaluate(({ dialog }, projectFile) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectFile] }); }, projectFile);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await saved(p => JSON.stringify(p) === JSON.stringify(edited));
    await page.getByLabel('Loop duration', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByLabel('Export resolution', { exact: true }).selectOption('960x540');
    await page.getByLabel('Export frame rate', { exact: true }).selectOption('24/1');
    await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
    await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 30000 });
    const png = await fs.readFile(stillFile);
    assert.equal(png.readUInt32BE(16), 960); assert.equal(png.readUInt32BE(20), 540);
    assert.ok(png.length > 10000);
    const destination = path.join(out, 'exports'); await fs.mkdir(destination, { recursive: true });
    await page.getByLabel('Export destination', { exact: true }).fill(destination);
    await page.getByRole('button', { name: 'Render loop', exact: true }).click();
    await page.getByText('Export complete', { exact: true }).waitFor({ timeout: 60000 });
    const jobs = await page.evaluate(() => window.studio.listJobs());
    const job = jobs.find(j => j.status === 'complete' && j.request.project.id === edited.id);
    assert.ok(job); assert.equal(job.totalFrames, 24);
    assert.deepEqual(job.request.project.layers, edited.layers);
    assert.ok((await fs.stat(job.outputPath)).size > 10000);
    await page.getByRole('button', { name: 'Close export', exact: true }).click();
  });
  await page.screenshot({ path: path.join(out, 'studio.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ status: 'passed', packaged: !!bundle, checks, errors }, null, 2));
  console.log('Report: ' + out);
} finally { await app.close(); }
