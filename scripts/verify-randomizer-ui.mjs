import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/quality-pass/randomizer-ui');
await fs.mkdir(out,{recursive:true});
await build({stdin:{contents:`export {createProject,createLayer,applyPreset,PRESETS,parameterDefinitions} from './src/core/project';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'model.cjs'),logLevel:'silent'});
const m=createRequire(import.meta.url)(path.join(out,'model.cjs'));
const fixture=path.join(out,'fixture.formfield');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'profile-'+Date.now()))});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',x=>{if(x.type()==='error')errors.push(x.text());});
page.setDefaultTimeout(20000);
async function saved(predicate){for(let i=0;i<100;i++){const p=await page.evaluate(()=>window.studio.loadAutosave());if(p&&predicate(p))return p;await page.waitForTimeout(100);}throw Error('Autosave predicate timed out');}
try {
 await page.getByText('Export engine ready',{exact:true}).waitFor();
 const status=await page.evaluate(()=>window.studio.getStatus());
 assert.equal(status.version,JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
 for(const kind of ['surface','sculpture','fractal','oil','super8','graphic','image','caustic','livingink','magnetic','currents','relief','loom','reef','prism','resonance','veils']) {
  const layer=m.createLayer(kind);layer.name='Randomizer '+kind;
  layer.transform={x:.2,y:-.1,scale:.7,rotation:.2};layer.opacity=.8;
  layer.modulations[kind==='image'?'hue':'exposure']={kind:'noise',cycles:2,amount:.15,phase:.2,points:[]};
  const project={...m.createProject(),name:'Randomizer '+kind,layers:[layer]};
  await fs.writeFile(fixture,JSON.stringify(project));await page.getByRole('button',{name:'Open',exact:true}).click();
  await saved(p=>p.id===project.id);
  for(const level of ['0.35','0.65','1']) {
   await page.getByLabel('Variation amount',{exact:true}).selectOption(level);
   const before=await page.evaluate(()=>window.studio.loadAutosave());
   await page.getByRole('button',{name:'Randomize effect',exact:true}).click();
   const after=await saved(p=>JSON.stringify(p.layers[0].params)!==JSON.stringify(before.layers[0].params));
   assert.deepEqual(after.layers[0].palette,before.layers[0].palette);
   assert.equal(after.layers[0].params.seed,before.layers[0].params.seed);
   for(const d of m.parameterDefinitions(kind).filter(d=>d.section==='Motion'))assert.equal(after.layers[0].params[d.key],before.layers[0].params[d.key]);
   assert.deepEqual(after.layers[0].transform,layer.transform);assert.deepEqual(after.layers[0].modulations,layer.modulations);if(kind!=='image')assert.equal(after.layers[0].params.exposure,1);
   assert.deepEqual(after.layers[0].mask,layer.mask);assert.equal(after.layers[0].opacity,.8);
   await page.getByTitle('Undo · ⌘Z',{exact:true}).click();
   await saved(p=>JSON.stringify(p)===JSON.stringify(before));
   await page.getByTitle('Redo · ⇧⌘Z',{exact:true}).click();
   await saved(p=>JSON.stringify(p)===JSON.stringify(after));
  }
  const a=await page.evaluate(()=>window.studio.loadAutosave());
  await page.getByRole('button',{name:'Randomize '+layer.name,exact:true}).click();
  const b=await saved(p=>JSON.stringify(p.layers[0].params)!==JSON.stringify(a.layers[0].params));
  assert.equal(b.layers.length,1);assert.equal(b.layers[0].kind,kind);
  console.log('Verified randomizer '+kind);
  await page.getByRole('button',{name:'Finish',exact:true}).click();
  const beforeFinish=await page.evaluate(()=>window.studio.loadAutosave());
  await page.getByLabel('Midtone gamma value',{exact:true}).fill('1.27');await page.getByLabel('Midtone gamma value',{exact:true}).press('Tab');
  await saved(p=>p.layers[0].params.toneGamma===1.27);
  await page.getByRole('button',{name:'Reset Midtone gamma',exact:true}).click();await saved(p=>p.layers[0].params.toneGamma===1);
  await page.getByTitle('Undo · ⌘Z',{exact:true}).click();await saved(p=>p.layers[0].params.toneGamma===1.27);
  await page.getByTitle('Undo · ⌘Z',{exact:true}).click();await saved(p=>JSON.stringify(p)===JSON.stringify(beforeFinish));
  await page.getByRole('button',{name:'Shape',exact:true}).click();
  checks.push({kind,amounts:3,locks:true,routes:true,undo:true,redo:true,perLayer:true,tonalFinish:true,parameterReset:true});
 }
 await page.getByTitle('Lock structure',{exact:true}).click();
 await page.getByTitle('Lock material',{exact:true}).click();
 const fullyLocked=await page.evaluate(()=>window.studio.loadAutosave());
 await page.getByRole('button',{name:'Randomize effect',exact:true}).click();
 await page.getByText('Available controls are locked or animated. Unlock a Keep category to vary this effect.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.studio.loadAutosave()),fullyLocked);
 await page.getByTitle('Unlock structure',{exact:true}).click();
 await page.getByTitle('Unlock material',{exact:true}).click();
 await page.getByRole('button',{name:'Presets',exact:true}).click();
 await page.getByLabel('Preset library filter',{exact:true}).selectOption('signature');
 assert.equal(await page.locator('.preset-card').count(),20);
 await page.locator('.signature-thumbnail').evaluateAll(images=>images.forEach(im=>im.loading='eager'));
 await page.waitForFunction(()=>[...document.querySelectorAll('.signature-thumbnail')].every(im=>im.complete&&im.naturalWidth===480));
 for(const preset of m.PRESETS.filter(p=>p.signature)) {
  // Keep room for a cross-instrument preset, and exercise native persistence.
  const project={...m.createProject(),name:'Signature '+preset.id,layers:[m.createLayer(preset.kind)]};
  await fs.writeFile(fixture,JSON.stringify(project));await page.getByRole('button',{name:'Open',exact:true}).click();await saved(p=>p.id===project.id);
  await page.locator('.preset-card').filter({has:page.locator('strong',{hasText:new RegExp('^'+preset.name+'$')})}).click();
  const result=await saved(p=>p.layers[0].name===preset.name);
  assert.deepEqual(result.layers[0].palette,preset.palette);
  assert.deepEqual({...result.layers[0].params,seed:undefined},{...preset.params,seed:undefined});
 }
 await page.screenshot({path:path.join(out,'signature-library.png')});
 assert.deepEqual(errors,[]);const report={status:'passed',checks,signatureLooks:20,errors};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
