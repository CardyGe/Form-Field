// Renders the library thumbnail for the Kaleidoscope instrument through the real
// app: a default Kaleidoscope layer, saved as a PNG still by the Studio's own
// export, then scaled to the size and format of the other instrument thumbnails.
// Run: npm run build && node scripts/render-kaleidoscope-thumbnail.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';

const root = process.cwd(), out = path.join(root, 'work/kaleidoscope-thumbnail');
await fs.mkdir(out, {recursive: true});
await build({stdin: {contents: `export {createLayer,createProject,validateProject} from './src/core/project';`, resolveDir: root, loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'model.cjs'), logLevel: 'silent'});
const model = createRequire(import.meta.url)(path.join(out, 'model.cjs'));
const project = model.validateProject({...model.createProject(), transparent: false, background: '#050507', layers: [model.createLayer('kaleidoscope')]});
const profile = path.join(out, 'profile');
await fs.rm(profile, {recursive: true, force: true});
await fs.mkdir(profile, {recursive: true});
await fs.writeFile(path.join(profile, 'autosave.formfield'), JSON.stringify(project));
await fs.writeFile(path.join(out, 'main.cjs'), `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.STUDIO_DEV_URL;
const app = await electron.launch({args: [path.join(out, 'main.cjs')], env});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
const still = path.join(out, 'still.png');
try {
  await page.getByText('Export engine ready', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await page.getByTitle('Return to start', {exact: true}).click();
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  await page.getByLabel('Export resolution', {exact: true}).selectOption('960x540');
  await app.evaluate(({dialog}, filePath) => { dialog.showSaveDialog = async () => ({canceled: false, filePath}); }, still);
  await page.getByRole('button', {name: 'Save PNG still', exact: true}).click();
  await page.getByText('PNG saved.', {exact: true}).waitFor({timeout: 60000});
} finally { await app.close(); }
const target = path.join(root, 'src/ui/assets/kaleidoscope.png');
const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', still, '-vf', 'scale=480:270:flags=lanczos', '-pix_fmt', 'rgba', '-frames:v', '1', target]);
if (run.status !== 0) throw Error(String(run.stderr));
console.log('Wrote ' + target);
