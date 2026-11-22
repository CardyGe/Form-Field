import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=process.cwd(),out=path.join(root,'work/workspace-ui',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(out,{recursive:true});
await build({stdin:{contents:`export {createLayer,createProject,parameterDefinitions} from './src/core/project';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'model.cjs'),logLevel:'silent'});
const model=createRequire(import.meta.url)(path.join(out,'model.cjs'));
const fixture=path.join(out,'fixture.formfield'),projectFile=path.join(out,'saved.formfield');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'profile'))});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]});dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(projectFile)}});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
const bundle=process.argv[2]?path.resolve(process.argv[2]):null;
const app=await electron.launch(bundle?{executablePath:path.join(bundle,'Contents/MacOS/Form & Field'),args:[`--user-data-dir=${path.join(out,'profile')}`],env}:{args:[path.join(out,'main.cjs')],env});
if(bundle)await app.evaluate(({dialog},{fixture,projectFile})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});dialog.showSaveDialog=async()=>({canceled:false,filePath:projectFile});},{fixture,projectFile});
const page=await app.firstWindow(),errors=[],checks=[];
page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const canvas=page.getByLabel('Composition preview',{exact:true}),library=page.getByRole('complementary',{name:'Library',exact:true});
const state=()=>page.evaluate(()=>window.studio.loadAutosave());
async function saved(predicate){for(let i=0;i<100;i++){const p=await state();if(p&&predicate(p))return p;await page.waitForTimeout(100);}throw Error('Autosave did not reach expected state');}
async function check(name,fn){await fn();assert.equal(await page.getByRole('alert').count(),0);checks.push(name);console.log('PASS '+name);}
async function libraryShow(){if(!await library.isVisible())await page.getByRole('button',{name:'Open library',exact:true}).click();}
async function bodyFocus(){await page.getByRole('button',{name:'Toggle layer list',exact:true}).focus();}
async function waitAttribute(locator,name,value){
 for(let i=0;i<100;i++){if(await locator.getAttribute(name)===value)return;await page.waitForTimeout(25);}
 assert.equal(await locator.getAttribute(name),value);
}
async function snapshot(name){await page.screenshot({path:path.join(out,name+'.png')});}
try {
 await page.getByText('Export engine ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await saved(p=>!!p.layers.length);
 const original=await state();
 const metrics=[];
 await check('default workspace gives the canvas more area without page overflow',async()=>{
  const before=await fs.readFile(path.join(root,'work/workspace-ui/before.json'),'utf8').then(JSON.parse).catch(()=>null);
  for(const [i,size] of [[1180,760],[1440,900],[1920,1080]].entries()){
   await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),size);
   await page.waitForTimeout(300);
   const m=await canvas.evaluate(c=>{const b=c.getBoundingClientRect();return {width:innerWidth,height:innerHeight,area:b.width*b.height,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(m.overflow,false);assert.ok(m.area/(m.width*m.height)>.35);
   const baseline=before?.[i];
   const comparable=baseline?.viewport.width===m.width&&baseline?.viewport.height===m.height;
   if(comparable)assert.ok(m.area>baseline.canvas.area*1.5);
   metrics.push({...m,gain:comparable?m.area/baseline.canvas.area:null});
   await snapshot('studio-'+size[0]);
  }
 });
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
 await check('Library opens on demand, searches instruments, and dismisses with Escape',async()=>{
  assert.equal(await library.isVisible(),false);
  await bodyFocus();await page.keyboard.press('b');await library.waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Search library');
  await page.getByLabel('Search library',{exact:true}).fill('resonant');
  assert.equal(await library.locator('.instrument-card').count(),1);
  await snapshot('search');
  await page.keyboard.press('Escape');await library.waitFor({state:'hidden'});
  await waitAttribute(page.getByRole('button',{name:'Open library',exact:true}),'aria-expanded','false');
  assert.deepEqual(await state(),original);
 });
 await check('instrument insertion, rail selection and expanded layer actions remain available',async()=>{
  await libraryShow();await page.getByLabel('Search library',{exact:true}).fill('sculpture');
  await page.getByRole('button',{name:'Add sculpture',exact:true}).click();
  await library.waitFor({state:'hidden'});
  await saved(p=>p.layers.length===2);
  const surface=page.getByRole('button',{name:'Select '+original.layers[0].name,exact:true});
  await surface.click();
  await page.waitForFunction(name=>document.querySelector('[aria-label="Layer name"]')?.value===name,original.layers[0].name);
  await page.getByRole('button',{name:'Toggle layer list',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Toggle layer list',exact:true}).getAttribute('aria-expanded'),'true');
  assert.equal(await page.getByTitle('Hide layer',{exact:true}).count(),2);
  await snapshot('layers');
  await page.getByRole('button',{name:'Toggle layer list',exact:true}).click();
 });
 await check('compact parameter edits, resets and disclosure preserve exact undo',async()=>{
  const before=await state();
  const flow=page.getByLabel('Flow value',{exact:true});
  const row=await flow.evaluate(e=>e.closest('.parameter').getBoundingClientRect().height);
  assert.ok(row<=36);
  await flow.fill('0.71');await flow.press('Enter');
  await saved(p=>p.layers[0].params.warp===.71);
  await page.getByTitle('Undo · ⌘Z',{exact:true}).click();await saved(p=>JSON.stringify(p)===JSON.stringify(before));
  const advanced=page.locator('details.advanced-controls').filter({has:page.locator('summary',{hasText:'Advanced shape'})});
  await advanced.locator('summary').click();
  assert.equal(await page.getByLabel('Center horizontal value',{exact:true}).isVisible(),true);
  await page.getByLabel('Center horizontal value',{exact:true}).fill('0.15');await page.getByLabel('Center horizontal value',{exact:true}).press('Tab');
  await saved(p=>p.layers[0].params.centerX===.15);
  await page.getByRole('button',{name:'Reset Center horizontal',exact:true}).click();
  await saved(p=>p.layers[0].params.centerX===0);
  await advanced.locator('summary').click();
  await page.locator('.inspector-section').filter({has:page.locator(':scope > summary',{hasText:'Material'})}).locator(':scope > summary').click();
  assert.equal(await page.getByLabel('Relief value',{exact:true}).isVisible(),true);
 });
 await check('variation settings are contextual and keep their settings when dismissed',async()=>{
  const settings=page.locator('#variation-settings');assert.equal(await settings.isVisible(),false);
  await page.getByRole('button',{name:'Variation settings',exact:true}).click();
  await settings.waitFor();
  await page.getByLabel('Variation amount',{exact:true}).selectOption('0.65');
  await page.getByTitle('Lock structure',{exact:true}).click();
  await snapshot('variation');
  await page.getByRole('button',{name:'Close variation settings',exact:true}).click();
  await settings.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Variation settings',exact:true}).click();
  assert.equal(await page.getByLabel('Variation amount',{exact:true}).inputValue(),'0.65');
  await page.getByTitle('Unlock structure',{exact:true}).click();
  await page.getByRole('button',{name:'Close variation settings',exact:true}).click();
  const before=await state();await page.getByRole('button',{name:'Randomize effect',exact:true}).click();
  await saved(p=>JSON.stringify(p.layers[0].params)!==JSON.stringify(before.layers[0].params));
 });
 await check('focus mode restores panels, Escape and shortcuts do not interfere with text editing',async()=>{
  const before=await state();
  await page.getByRole('button',{name:'Toggle inspector',exact:true}).click();
  await page.getByRole('complementary',{name:'Layer inspector',exact:true}).waitFor({state:'hidden'});
  await bodyFocus();await page.keyboard.press('f');
  await page.getByRole('button',{name:'Exit focus mode',exact:true}).waitFor();
  assert.equal(await page.locator('.app-header').isVisible(),false);
  assert.equal(await page.getByRole('complementary',{name:'Composition layers',exact:true}).isVisible(),false);
  await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="Composition preview"]').getBoundingClientRect(),h=document.querySelector('.preview-host'),fit=Math.min(h.clientWidth,h.clientHeight*16/9);return Math.abs(c.width-fit)<3&&c.width>innerWidth*.5;});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await snapshot('focus');
  await page.keyboard.press('b');await library.waitFor();
  await page.keyboard.press('Escape');await library.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Exit focus mode',exact:true}).isVisible(),true);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Focus preview',exact:true}).waitFor();
  assert.equal(await page.getByRole('complementary',{name:'Layer inspector',exact:true}).isVisible(),false);
  await bodyFocus();await page.keyboard.press('i');
  await page.getByRole('complementary',{name:'Layer inspector',exact:true}).waitFor();
  const name=page.getByLabel('Project name',{exact:true});await name.focus();
  const text=await name.inputValue();await name.fill('f bil');
  assert.equal(await page.getByRole('button',{name:'Focus preview',exact:true}).isVisible(),true);
  assert.equal(await library.isVisible(),false);await name.fill(text);await name.press('Tab');
  assert.deepEqual(await state(),before);
 });
 await check('animation keys and Finish edits remain fully functional in compact rows',async()=>{
  await page.getByTitle('Animate Flow',{exact:true}).click();
  await page.getByLabel('Motion source',{exact:true}).selectOption('keyframes');
  const key=page.getByRole('slider',{name:'Keyframe 1',exact:true});
  await key.focus();await key.press('ArrowUp');
  await saved(p=>p.layers[0].modulations.warp?.points[0].value===.05);
  await page.getByRole('button',{name:'Remove animation',exact:true}).click();
  await saved(p=>!p.layers[0].modulations.warp);
  await page.getByRole('button',{name:'Finish',exact:true}).click();
  const gamma=page.getByLabel('Midtone gamma value',{exact:true});
  const before=await state();await gamma.fill('1.17');await gamma.press('Enter');
  await saved(p=>p.layers[0].params.toneGamma===1.17);
  await page.getByTitle('Undo · ⌘Z',{exact:true}).click();await saved(p=>JSON.stringify(p)===JSON.stringify(before));
  await page.getByRole('button',{name:'Shape',exact:true}).click();
 });
 await check('colour sections show on a Surface layer and not on a Graphic layer',async()=>{
  const titles=['Colour split','Gradient map','Colour balance','Key'];
  for(const [kind,expected] of [['surface',true],['graphic',false]]){
   const p={...model.createProject(),layers:[model.createLayer(kind)]};
   await fs.writeFile(fixture,JSON.stringify(p));await page.getByRole('button',{name:'Open',exact:true}).click();await saved(x=>x.id===p.id);
   await page.getByRole('button',{name:'Finish',exact:true}).click();
   for(const title of titles)assert.equal(await page.locator('.inspector-content h3',{hasText:new RegExp('^'+title+'$')}).count(),expected?1:0,kind+': '+title);
   if(expected){
    assert.equal(await page.getByLabel('Split angle value',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Gradient colours',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Key by',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Split shape',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Channel order',{exact:true}).count(),1);
    await snapshot('colour-sections');
   }
   await page.getByRole('button',{name:'Shape',exact:true}).click();
  }
  await fs.writeFile(fixture,JSON.stringify(original));await page.getByRole('button',{name:'Open',exact:true}).click();await saved(x=>x.id===original.id);
 });
 await check('preset browsing preserves the family filter and applies normal saved looks',async()=>{
  await libraryShow();await page.getByLabel('Search library',{exact:true}).fill('');
  await library.getByRole('button',{name:'Presets',exact:true}).click();
  await page.getByLabel('Preset library filter',{exact:true}).selectOption('finish');
  assert.equal(await library.locator('.finish-card').count(),27);
  await snapshot('finish-library');
  await page.getByLabel('Search library',{exact:true}).fill('tunnel');
  assert.ok(await library.locator('.preset-card').count()>0);
  await page.getByLabel('Search library',{exact:true}).fill('');
  await page.getByLabel('Preset library filter',{exact:true}).selectOption('surface');
  const card=library.locator('.preset-card').first(),name=await card.locator('strong').innerText();
  await card.click();await saved(p=>p.layers[0].name===name);
  await page.keyboard.press('Escape');await library.waitFor({state:'hidden'});
 });
 await check('workspace preferences survive reload without changing the project',async()=>{
  const before=await state();
  await page.getByRole('button',{name:'Toggle layer list',exact:true}).click();
  await page.getByRole('button',{name:'Toggle inspector',exact:true}).click();
  await page.reload();await page.getByText('Export engine ready',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Toggle layer list',exact:true}).getAttribute('aria-expanded'),'true');
  assert.equal(await page.getByRole('button',{name:'Toggle inspector',exact:true}).getAttribute('aria-expanded'),'false');
  assert.deepEqual(await state(),before);
  await page.getByRole('button',{name:'Toggle layer list',exact:true}).click();
  await page.getByRole('button',{name:'Toggle inspector',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
 });
 await check('minimum window size retains usable controls and compact layout',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));await page.waitForTimeout(300);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false);
  assert.ok((await canvas.boundingBox()).width>550);
  await snapshot('small-window');
 });
 await check('all source inspectors retain valid editable control rows',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));
  for(const kind of ['surface','sculpture','fractal','graphic','oil','liquid','scope','super8','livingink','relief','resonance','texturecuts','glitchtunnel']){
   const layer=model.createLayer(kind),p={...model.createProject(),layers:[layer]};
   await fs.writeFile(fixture,JSON.stringify(p));await page.getByRole('button',{name:'Open',exact:true}).click();await saved(x=>x.id===p.id);
   await page.getByRole('button',{name:'Shape',exact:true}).click();
   const sections=page.locator('.inspector-content details');
   for(let i=0;i<await sections.count();i++){const section=sections.nth(i);if(!await section.getAttribute('open')&&await section.getAttribute('open')!=='')await section.locator(':scope > summary').click();}
   if(kind==='oil')await page.getByRole('button',{name:'Show fine tuning',exact:true}).click();
   const fields=page.locator('.inspector-content .parameter input[type=number]');
   assert.ok(await fields.count()>2,kind);
   const bad=await fields.evaluateAll(fields=>fields.filter(e=>!Number.isFinite(Number(e.value))||e.getBoundingClientRect().width<40).map(e=>e.getAttribute('aria-label')));
   assert.deepEqual(bad,[],kind);
   const field=fields.first(),label=(await field.getAttribute('aria-label')).replace(/ value$/,'');
   const definition=model.parameterDefinitions(kind).find(d=>d.label===label);
   assert.ok(definition,kind+': '+label);
   const current=Number(await field.inputValue());
   const value=Number((current+(current+definition.step<=definition.max?definition.step:-definition.step)).toFixed(6));
   await field.fill(String(value));await field.press('Enter');
   await saved(x=>x.layers[0].params[definition.key]===value);
   await page.getByTitle('Undo · ⌘Z',{exact:true}).click();await saved(x=>JSON.stringify(x)===JSON.stringify(p));
  }
 });
 await check('export dialog traps focus and restores the compact header action',async()=>{
  const before=await state();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Export',exact:true});await dialog.waitFor();
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true);}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Export',exact:true}).evaluate(e=>e===document.activeElement),true);
  assert.deepEqual(await state(),before);
 });
 assert.deepEqual(errors,[]);
 const result={status:'passed',packaged:!!bundle,checks,metrics,errors};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log('Report: '+out);
}catch(error){await snapshot('failure');throw error;}finally{await app.close();}
