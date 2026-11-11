import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundle=process.argv[2]?path.resolve(process.argv[2]):null;
const out=path.join(root,'work/instruments/ui-'+(bundle?'packaged-':'')+Date.now()),profile=path.join(out,'profile'),fixture=path.join(out,'fixture.formfield'),destination=path.join(out,'exports');
await fs.mkdir(destination,{recursive:true});await fs.mkdir(profile,{recursive:true});
await build({stdin:{contents:`export {createProject,createLayer,applyPreset,PRESETS,parameterDefinitions} from './src/core/project';export {INSTRUMENTS} from './src/core/instruments';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'model.cjs'),logLevel:'silent'});
const m=createRequire(import.meta.url)(path.join(out,'model.cjs'));
await fs.writeFile(path.join(out,'main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
const launch=bundle?{executablePath:path.join(bundle,'Contents/MacOS/Form & Field'),args:['--user-data-dir='+profile],env}:{args:[path.join(out,'main.cjs')],env};
const app=await electron.launch(launch),page=await app.firstWindow(),errors=[],checks=[];page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(String(e)));page.on('console',x=>{if(x.type()==='error')errors.push(x.text());});
async function saved(predicate){for(let i=0;i<150;i++){const p=await page.evaluate(()=>window.studio.loadAutosave());if(p&&predicate(p))return p;await page.waitForTimeout(100);}throw Error('Autosave predicate timed out');}
const run=(bin,args)=>{const r=spawnSync(bin,args,{timeout:120000,maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;};
try{
 await app.evaluate(({dialog},f)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[f]});},fixture);
 await page.getByText('Export engine ready',{exact:true}).waitFor();
 const status=await page.evaluate(()=>window.studio.getStatus());assert.equal(status.version,JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
 const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,resources:process.resourcesPath}));
 const media=bundle?path.join(runtime.resources,'media'):path.join(root,'build/media'),ffmpeg=path.join(media,'ffmpeg'),ffprobe=path.join(media,'ffprobe');
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 for(const info of m.INSTRUMENTS){
  const base={...m.createProject(),name:'Instrument '+info.kind,duration:.2,width:960,height:540,transparent:true};base.layers[0].visible=false;
  await fs.writeFile(fixture,JSON.stringify(base));await page.getByRole('button',{name:'Open',exact:true}).click();await saved(p=>p.id===base.id);
  await page.getByRole('button',{name:'Instruments',exact:true}).click();
  await page.getByRole('button',{name:'Add '+info.name,exact:true}).click();
  const added=await saved(p=>p.layers.length===2&&p.layers[1].kind===info.kind);assert.ok(added.layers[1].name);
  if(info.kind==='currents')await page.getByLabel('Fibre motion',{exact:true}).selectOption('0');
  if(info.kind==='relief')await page.getByLabel('Relief construction',{exact:true}).selectOption('0');
  if(info.kind==='livingink')await page.getByLabel('Pigment motion',{exact:true}).selectOption('0');
  await page.getByRole('button',{name:'Shape',exact:true}).click();
  await page.getByLabel('Pattern scale value',{exact:true}).fill('2.1');await page.getByLabel('Pattern scale value',{exact:true}).press('Tab');
  await saved(p=>p.layers[1].params.scale===2.1);
  const advanced=page.locator('.advanced-controls').filter({has:page.locator('summary',{hasText:/^Advanced shape/})});
  if(await advanced.getAttribute('open')!==null)await advanced.locator('summary').click();
  const disclosure=advanced.locator('summary');await disclosure.focus();await disclosure.press('Space');
  assert.notEqual(await advanced.getAttribute('open'),null,'Space opens advanced controls');assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'Disclosure keyboard action must not start playback');
  await page.getByLabel('Domain warp value',{exact:true}).fill('.35');await page.getByLabel('Domain warp value',{exact:true}).press('Tab');await saved(p=>p.layers[1].params.warp===.35);
  await page.getByRole('button',{name:'Reset Domain warp',exact:true}).click();await saved(p=>p.layers[1].params.warp===0);
  if(info.kind==='livingink'){
   for(const name of ['Branching','Seed coverage','Development'])assert.equal(await page.getByTitle('Animate '+name,{exact:true}).count(),0);
   await page.getByLabel('Ink growth family',{exact:true}).selectOption('3');await saved(p=>p.layers[1].params.pattern===3);
  }
  if(info.kind==='relief'){await page.getByLabel('Relief hinge axis',{exact:true}).selectOption('2');await saved(p=>p.layers[1].params.axis===2);}
  if(info.kind==='veils'){await page.getByLabel('Veil render quality',{exact:true}).selectOption('2');await saved(p=>p.layers[1].params.quality===2);}
  await page.getByTitle('Animate Pattern scale',{exact:true}).click();await page.getByLabel('Motion source',{exact:true}).selectOption('sine');
  await saved(p=>p.layers[1].modulations.scale?.kind==='sine');
  assert.equal(await page.getByLabel('Motion parameter',{exact:true}).locator('option[value="branching"]').count(),0);
  await page.getByRole('button',{name:'Presets',exact:true}).click();await page.getByLabel('Preset library filter',{exact:true}).selectOption(info.kind);
  assert.equal(await page.locator('.preset-card').count(),info.looks.length);
  for(const look of info.looks){
   await page.locator('.preset-card').filter({has:page.locator('strong',{hasText:new RegExp('^'+look.name+'$')})}).click();
   const p=await saved(p=>p.layers[1].name===look.name),expected=m.PRESETS.find(x=>x.id===look.id);
   assert.deepEqual({...p.layers[1].params,seed:undefined},{...expected.params,seed:undefined});assert.deepEqual(p.layers[1].palette,expected.palette);assert.deepEqual(p.layers[1].modulations,{});
  }
  const source={...base,layers:[m.applyPreset(m.createLayer(info.kind),info.looks[3].id)]};Object.assign(source.layers[0].params,{backgroundOpacity:0,toneContrast:1.15,toneGamma:1.08,vibrance:.18});
  await fs.writeFile(fixture,JSON.stringify(source));await page.getByRole('button',{name:'Open',exact:true}).click();await saved(p=>p.id===source.id&&p.layers.length===1);
  const savedPath=path.join(out,info.kind+'.formfield'),stillPath=path.join(out,info.kind+'.png');
  await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async(_w,o)=>({canceled:false,filePath:o.title.includes('PNG')?p.still:p.saved});},{still:stillPath,saved:savedPath});
  await page.getByRole('button',{name:'Save',exact:true}).click();
  for(let i=0;i<100;i++){if(await fs.stat(savedPath).catch(()=>null))break;await page.waitForTimeout(100);}
  assert.deepEqual(JSON.parse(await fs.readFile(savedPath,'utf8')),source);
  await page.getByRole('button',{name:'Shape',exact:true}).click();await page.screenshot({path:path.join(out,info.kind+'-studio.png')});
  await page.getByRole('button',{name:/^Export/}).click();await page.getByLabel('Export resolution',{exact:true}).selectOption('960x540');
  await page.getByLabel('Export frame rate',{exact:true}).selectOption('30/1');await page.getByLabel('Delivery format',{exact:true}).selectOption('prores4444');
  await page.getByLabel('Transparent output',{exact:true}).check();await page.getByLabel('Export destination',{exact:true}).fill(destination);
  await page.getByRole('button',{name:'Save PNG still',exact:true}).click();await page.getByText('PNG saved.',{exact:true}).waitFor();
  const png=await fs.readFile(stillPath);assert.equal(png.readUInt32BE(16),960);assert.equal(png.readUInt32BE(20),540);
  const rgba=run(ffmpeg,['-v','error','-nostdin','-i',stillPath,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1']);
  let lo=255,hi=0;for(let i=3;i<rgba.length;i+=4){lo=Math.min(lo,rgba[i]);hi=Math.max(hi,rgba[i]);}assert.ok(lo<hi&&hi>0,info.kind+' native PNG alpha');
  await page.getByRole('button',{name:'Render loop',exact:true}).click();let job;
  for(let i=0;i<600;i++){job=(await page.evaluate(()=>window.studio.listJobs())).find(j=>j.request.project.id===source.id);if(job?.status==='complete')break;if(job&&['failed','cancelled','interrupted'].includes(job.status))throw Error(info.kind+' '+job.status+' '+job.error);await page.waitForTimeout(200);}
  assert.equal(job?.status,'complete');assert.equal(job.completedFrames.length,6);assert.deepEqual(job.request.project.layers,source.layers);
  const video=JSON.parse(run(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',job.outputPath])).streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,960);assert.equal(video.height,540);assert.equal(Number(video.nb_read_frames),6);assert.equal(video.profile,'4444');assert.match(video.pix_fmt,/^yuva/);assert.equal(video.color_transfer,'bt709');
  const hashes=run(ffmpeg,['-v','error','-nostdin','-i',job.outputPath,'-an','-f','framemd5','pipe:1']).toString().split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1).trim());assert.equal(hashes.length,6);assert.ok(new Set(hashes).size>1,info.kind+' exported motion');
  checks.push({kind:info.kind,presets:info.looks.length,controls:true,motionRoute:true,save:true,png:{width:960,height:540,alpha:[lo,hi]},movie:job.outputPath,frames:6});console.log('PASS native instrument '+info.kind);
  await page.getByRole('button',{name:'Close export',exact:true}).click();
 }
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'passed',version:status.version,packaged:runtime.packaged,checks,errors},null,2));console.log('All instrument UI and native exports passed: '+out);
}finally{await app.close();}
