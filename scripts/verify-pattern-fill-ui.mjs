// Real controls and native alpha readback from the packaged application.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/pattern-fill');
const bundle = path.resolve(process.argv[2] || path.join(root, 'work/release/mac-arm64/Form & Field.app'));
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {createProject,createLayer,applyPreset} from './src/core/project';`,
  loader: 'ts', resolveDir: root }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(out, 'core.mjs'), logLevel: 'silent' });
const { createProject, createLayer, applyPreset } = await import('../work/pattern-fill/core.mjs');
const profile = await fs.mkdtemp(path.join(out, 'fill-ui-profile-'));
const project = createProject(); project.transparent = true;
project.layers = [applyPreset(createLayer('graphic'), 'packed-mosaic')];
Object.assign(project.layers[0].params, { tileGap: 0, roundness: 0, sweep: 0, motion: 0, backgroundOpacity: 0 });
project.layers[0].palette = ['#f5b333', '#f5b333', '#f5b333', '#f5b333', '#f5b333', '#000000'];
await fs.writeFile(path.join(profile, 'autosave.formfield'), JSON.stringify(project));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({ executablePath: path.join(bundle, 'Contents/MacOS/Form & Field'), args: [`--user-data-dir=${profile}`], env });
const page = await app.firstWindow(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.setDefaultTimeout(20000);
try {
  await page.getByText('Export engine ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const [label, value] of [['Pattern size', '.25'], ['Pattern stretch', '.4'], ['Pattern angle', '.75'], ['Pattern horizontal', '.7'], ['Pattern vertical', '-.6']]) {
    await page.getByLabel(label + ' value', { exact: true }).fill(value);
    await page.getByLabel(label + ' value', { exact: true }).press('Enter');
  }
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  for (const [label, value] of [['Size', '.3'], ['Rotation', '.45'], ['Horizontal', '.25'], ['Vertical', '-.18']]) {
    await page.getByLabel(label + ' value', { exact: true }).fill(value);
    await page.getByLabel(label + ' value', { exact: true }).press('Enter');
  }
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.studio.loadAutosave());
  assert.equal(saved.layers[0].params.size, .25); assert.equal(saved.layers[0].params.stretch, .4);
  assert.equal(saved.layers[0].transform.scale, .3); assert.equal(saved.layers[0].transform.rotation, .45);
  await page.screenshot({ path: path.join(out, 'packaged-pattern-fill.png'), fullPage: true });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption('960x540');
  await page.getByLabel('Delivery format', { exact: true }).selectOption('prores4444');
  await page.getByLabel('Transparent output', { exact: true }).check();
  const still = path.join(out, 'packaged-fill-alpha.png');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, still);
  await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  await page.getByText('PNG saved.', { exact: true }).waitFor({ timeout: 45000 });
  const png = await fs.readFile(still); assert.equal(png.readUInt32BE(16), 960); assert.equal(png.readUInt32BE(20), 540);
  const raw = spawnSync(path.join(bundle, 'Contents/Resources/media/ffmpeg'), ['-v', 'error', '-nostdin', '-i', still, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  assert.equal(raw.status, 0, raw.stderr.toString());
  let minimum = 255, mean = 0, edgeMean = 0, edges = 0;
  for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) {
    const a = raw.stdout[(y * 960 + x) * 4 + 3]; minimum = Math.min(minimum, a); mean += a;
    if (x < 4 || y < 4 || x >= 956 || y >= 536) { edgeMean += a; edges++; }
  }
  mean /= 960 * 540; edgeMean /= edges;
  assert.ok(minimum === 255 && mean === 255 && edgeMean === 255, 'Native alpha must cover the canvas, including all edges, after the actual size/stretch/rotation controls change.');
  assert.deepEqual(errors, []);
  const result = { status: 'passed', bundle, patternSize: .25, stretch: .4, layerSize: .3, minimum, mean, edgeMean, errors };
  await fs.writeFile(path.join(out, 'packaged-fill.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  const timer = setTimeout(() => app.process().kill('SIGKILL'), 10000);
  try { await app.close(); } finally { clearTimeout(timer); }
}
