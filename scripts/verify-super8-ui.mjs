// Super 8 projector controls, schema-1 migration and native still from a packaged app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/super8-projector');
const bundle = path.resolve(process.argv[2] || path.join(root, 'work/release/mac-arm64/Form & Field.app'));
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {createProject,createLayer,applyPreset,SUPER8_PROJECTOR_KEYS} from './src/core/project';`,
  loader: 'ts', resolveDir: root }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(out, 'core.mjs'), logLevel: 'silent' });
const { createProject, createLayer, applyPreset, SUPER8_PROJECTOR_KEYS } = await import('../work/super8-projector/core.mjs');
const profile = await fs.mkdtemp(path.join(out, 'packaged-profile-'));
const project = createProject(); project.transparent = true;
project.layers = [applyPreset(createLayer('super8'), 'scratched-negative')];
for (const key of SUPER8_PROJECTOR_KEYS) delete project.layers[0].params[key];
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
  assert.equal(await page.getByLabel('Super 8 projector view',{exact:true}).inputValue(),'0');
  for (const label of ['Emulsion movement','Frame advance','Projector shutter','Dust','Light leaks','Lens softness']) {
    assert.equal(Number(await page.getByLabel(label+' value',{exact:true}).inputValue()),0,'legacy finish must migrate to neutral: '+label);
  }
  for (const mode of ['0','1','2']) {
    await page.getByLabel('Super 8 projector view',{exact:true}).selectOption(mode);
    assert.equal(await page.getByLabel('Gate inset value',{exact:true}).count(),mode==='0'?0:1);
    assert.equal(await page.getByLabel('Sprocket holes value',{exact:true}).count(),mode==='2'?1:0);
  }
  for (const [label,value] of [['Emulsion movement','.8'],['Frame advance','.9'],['Projector shutter','.35'],
    ['Shutter blades','3'],['Reel turns per loop','4'],['Gate inset','.04'],['Gate corners','.7'],
    ['Sprocket holes','.9'],['Frame lines','.65'],['Dust','.5'],['Gate hair','.4'],
    ['Lens softness','.3'],['Halation','.6'],['Projector vignette','.4'],['Light leaks','.5'],['Color fading','.25']]) {
    await page.getByLabel(label+' value',{exact:true}).fill(value);
    await page.getByLabel(label+' value',{exact:true}).press('Enter');
  }
  await page.getByLabel('Super 8 substrate',{exact:true}).selectOption('0');
  await page.getByRole('button',{name:'Motion',exact:true}).click();
  await page.getByLabel('Motion parameter',{exact:true}).selectOption('lightLeak');
  await page.getByLabel('Motion source',{exact:true}).selectOption('sine');
  const savedFile = path.join(out,'projector-ui.formfield');
  await app.evaluate(({dialog},filePath)=>{
    dialog.showSaveDialog=async()=>({canceled:false,filePath});
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});
  },savedFile);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(async () => (await window.studio.loadAutosave())?.layers[0].params.colorFade===.25);
  let saved;
  for (let attempt=0;attempt<40;attempt++) {
    try { saved=JSON.parse(await fs.readFile(savedFile,'utf8')); if(saved.layers[0].modulations.lightLeak?.kind==='sine') break; } catch {}
    await page.waitForTimeout(100);
  }
  assert.equal(saved.layers[0].params.gateMode,2); assert.equal(saved.layers[0].params.reelLoops,4);
  assert.equal(saved.layers[0].params.halation,.6); assert.equal(saved.layers[0].modulations.lightLeak.kind,'sine');
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('button',{name:'Shape',exact:true}).click();
  assert.equal(await page.getByLabel('Super 8 projector view',{exact:true}).inputValue(),'2');
  assert.equal(await page.getByLabel('Reel turns per loop value',{exact:true}).inputValue(),'4');
  await page.getByRole('button',{name:'Presets',exact:true}).click();
  await page.getByLabel('Preset library filter',{exact:true}).selectOption('all');
  assert.equal(await page.locator('.preset-card').count(),139);
  await page.screenshot({path:path.join(out,'packaged-projector.png'),fullPage:true});
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.getByLabel('Export resolution',{exact:true}).selectOption('960x540');
  await page.getByLabel('Delivery format',{exact:true}).selectOption('prores4444');
  await page.getByLabel('Transparent output',{exact:true}).check();
  const still = path.join(out,'packaged-projector-alpha.png');
  await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},still);
  await page.getByRole('button',{name:'Save PNG still',exact:true}).click();
  await page.getByText('PNG saved.',{exact:true}).waitFor({timeout:45000});
  const raw=spawnSync(path.join(bundle,'Contents/Resources/media/ffmpeg'),['-v','error','-nostdin','-i',still,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:8*1024*1024,timeout:30000});
  assert.equal(raw.status,0,raw.stderr.toString());
  let zero=0,soft=0,paint=0;
  for(let i=0;i<raw.stdout.length;i+=4) {
    const a=raw.stdout[i+3]; if(a===0) {zero++;assert.equal(raw.stdout[i]+raw.stdout[i+1]+raw.stdout[i+2],0);}
    else {paint++;if(a<255)soft++;}
  }
  assert.ok(zero>0&&soft>0&&paint>0,'Projector cutout must preserve gate, paint alpha and clean transparent RGB.');
  assert.deepEqual(errors,[]);
  const report={status:'passed',bundle,legacyMigration:true,projectorViews:3,authoredControls:16,saveOpen:true,animatedLightLeak:true,presets:139,alpha:{zero,soft,paint},errors};
  await fs.writeFile(path.join(out,'packaged-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {
  const timer=setTimeout(()=>app.process().kill('SIGKILL'),10000);
  try{await app.close();}finally{clearTimeout(timer);}
}
