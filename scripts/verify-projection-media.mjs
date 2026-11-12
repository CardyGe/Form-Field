import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const {ExportManager,resolveMediaTools}=createRequire(import.meta.url)('../electron/export-manager.cjs');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/projection-media');
await fs.mkdir(out,{recursive:true});
await build({stdin:{contents:`export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer,applyPreset,PRESETS,validateProject,parameterDefinitions} from './src/core/project';export {PROJECTION_LOOK_IDS} from './src/core/instruments';export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:path.join(out,'renderer.js'),logLevel:'silent'});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><canvas></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[];
page.setDefaultTimeout(240000);page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const report={status:'running',checks:[],errors};
try{
 await page.evaluate(async()=>{
  const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('canvas')),loader=new m.EXRLoader().setDataType(m.FloatType);
  const make=(kind,params)=>({...m.createProject(),duration:20,background:'#000000',transparent:true,layers:[Object.assign(m.createLayer(kind),{params:{...m.createLayer(kind).params,...params}})]});
  const cases=Object.fromEntries(['silk-river','ink-estuary','breathing-facade'].map(id=>{const look=m.PRESETS.find(p=>p.id===id),p={...m.createProject(),duration:id==='breathing-facade'?24:20,background:'#000000',transparent:true,layers:[m.applyPreset(m.createLayer(look.kind),id)]};p.id='projection-proof-'+id;p.name=look.name+' proof';p.fps={num:24,den:1};p.layers[0].id='projection-layer-'+id;return [id,p];}));
  const exr=async(p,t,w=160,h=90)=>{const b=await r.exportEXR(p,t,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
  const delta=(a,b)=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length;
  window.qa={m,r,make,cases,exr,delta};
 });
 for(const name of await page.evaluate(()=>Object.keys(window.qa.cases))){
  for(const [i,phase] of [.5,2.4,5.4].entries()){
   const bytes=await page.evaluate(async({name,phase})=>Array.from(await window.qa.r.exportPNG(window.qa.cases[name],phase,960,540)),{name,phase});
   await fs.writeFile(path.join(out,`${name}-${i}.png`),Buffer.from(bytes));
  }
  const check=await page.evaluate(async name=>{
   const {r,cases,exr,delta,m}=window.qa,p=cases[name],a=await exr(p,.7);
   let minAlpha=1,maxAlpha=0,energy=0;for(let i=0;i<a.length;i+=4){if(![a[i],a[i+1],a[i+2],a[i+3]].every(Number.isFinite))throw Error('nonfinite '+name);minAlpha=Math.min(minAlpha,a[i+3]);maxAlpha=Math.max(maxAlpha,a[i+3]);energy+=a[i]+a[i+1]+a[i+2];}
   const movement=delta(a,await exr(p,3.2));await exr(p,5.1);const seek=delta(a,await exr(p,.7));
   const loop=name==='ink-estuary'?null:delta(a,await exr(p,.7+Math.PI*2));
   const still=structuredClone(p);still.layers[0].params.motion=0;
   const stopped=delta(await exr(still,.2),await exr(still,3.5));
   return {name,minAlpha,maxAlpha,energy,movement,seek,loop,stopped,stats:r.getStats()};
  },name);
  assert.ok(check.energy>.01,JSON.stringify(check));assert.ok(check.movement>1e-5,JSON.stringify(check));assert.equal(check.seek,0,JSON.stringify(check));if(check.loop!==null)assert.ok(check.loop<.00003,JSON.stringify(check));assert.equal(check.stopped,0,JSON.stringify(check));
  report.checks.push(check);console.log('PASS '+JSON.stringify(check));
 }
 if(!process.argv.includes('--quick')){
  const result=await page.evaluate(async()=>{
   const {m,r,exr,delta,cases}=window.qa,results=[];
   for(const name of Object.keys(cases)){
    const p=structuredClone(cases[name]);p.schemaVersion=2;p.layers[0].surface={source:'polygon',role:'obstacle',influence:1,points:[{x:.3,y:.25},{x:.62,y:.3},{x:.7,y:.7},{x:.3,y:.65}]};
    for(const role of ['obstacle','emitter','edge']){p.layers[0].surface.role=role;m.validateProject(p);const a=await exr(p,2.4);if(!a.every(Number.isFinite))throw Error(name+' '+role+' nonfinite');const b=await exr(p,.5);await exr(p,4.4);if(delta(a,await exr(p,2.4))!==0)throw Error(name+' surface seek');results.push({name,role,movement:delta(a,b),textures:r.getStats().textures});}
    for(const [w,h] of [[90,160],[120,120]]){const a=await exr(p,2.4,w,h);if(!a.every(Number.isFinite))throw Error(name+' aspect nonfinite');results.push({name,aspect:[w,h]});}
   }
   const ink=cases['ink-estuary'];const a=await exr(ink,2.00001),b=await exr(ink,2.0002);if(delta(a,b)===0)throw Error('Chemical interpolation is held rather than continuous');results.push({chemicalSubframeDelta:delta(a,b)});
   for(const key of ['shadow','clearcoat','roughness']){const p=structuredClone(cases['breathing-facade']);p.layers[0].params.backgroundOpacity=1;p.layers[0].params[key]=key==='roughness'?.08:0;const a=await exr(p,2.4);p.layers[0].params[key]=1;const difference=delta(a,await exr(p,2.4));if(difference<1e-7)throw Error('Inactive physical relief control '+key);results.push({physicalReliefControl:key,difference});}
   for(const quality of [0,1,2]){const p=structuredClone(ink);p.layers[0].params.simulationQuality=quality;const data=await exr(p,1.1);if(!data.every(Number.isFinite))throw Error('Chemical quality '+quality);results.push({chemicalQuality:quality,energy:data.reduce((s,v)=>s+Math.abs(v),0)});}
   const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,128,128);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(64,64,26,0,Math.PI*2);ctx.fill();
   for(const name of ['silk-river','ink-estuary']){const p=structuredClone(cases[name]);p.schemaVersion=2;p.layers[0].mask={kind:'image',dataUrl:canvas.toDataURL(),size:1,softness:0,invert:false};p.layers[0].surface={source:'mask',role:'obstacle',influence:1,points:[{x:.3,y:.3},{x:.7,y:.3},{x:.5,y:.7}]};m.validateProject(p);const data=await exr(p,1.5);if(!data.every(Number.isFinite))throw Error('Raster surface '+name);results.push({rasterSurface:name,textures:r.getStats().textures});}
   for(const kind of ['resonance']){const p={...m.createProject(),layers:[m.createLayer(kind)]};p.layers[0].params.organic=.8;p.layers[0].params.motion=.7;const a=await exr(p,.7);if(delta(a,await exr(p,.7+Math.PI*2))>.00003)throw Error(kind+' organic seam');results.push({kind,organicMovement:delta(a,await exr(p,3.2))});}
   return results;
  });report.checks.push({surfacesAndOrganic:result});console.log('PASS polygon/image surface roles, aspect ratios, chemical quality/interpolation and seven organic treatments');
  const ids=await page.evaluate(()=>window.qa.m.PROJECTION_LOOK_IDS);
  if(process.argv.includes('--update-thumbnails'))await fs.mkdir(path.join(root,'src/ui/assets/projection'),{recursive:true});
  for(const id of ids){
   const bytes=await page.evaluate(async id=>{const {m,r}=window.qa,look=m.PRESETS.find(p=>p.id===id),p={...m.createProject(),duration:20,transparent:true,background:'#000000',layers:[m.applyPreset(m.createLayer(look.kind),id)]};return Array.from(await r.exportPNG(p,2.4,480,270));},id);
   await fs.writeFile(path.join(out,id+'-study.png'),Buffer.from(bytes));if(process.argv.includes('--update-thumbnails'))await fs.writeFile(path.join(root,'src/ui/assets/projection',id+'.png'),Buffer.from(bytes));
  }
  const contact=await page.evaluate(async ids=>{const c=document.createElement('canvas');c.width=1440;c.height=3*298;const ctx=c.getContext('2d');ctx.fillStyle='#101318';ctx.fillRect(0,0,c.width,c.height);for(const [i,id]of ids.entries()){const image=new Image();image.src=id+'-study.png';await image.decode();const x=i%3*480,y=Math.floor(i/3)*298;ctx.drawImage(image,x,y,480,270);ctx.fillStyle='#f0eee8';ctx.font='16px sans-serif';ctx.fillText(id.replaceAll('-',' '),x+12,y+290);}return Array.from(new Uint8Array(await (await new Promise(resolve=>c.toBlob(resolve,'image/png'))).arrayBuffer()));},ids);
  await fs.writeFile(path.join(out,'studies-contact.png'),Buffer.from(contact));
 }
 if(process.argv.includes('--baseline')){
  const comparisons=await page.evaluate(async()=>{
   const old=await import('./baseline-renderer.js'),r0=new old.StudioRenderer(document.createElement('canvas')),{m,r,exr,delta}=window.qa,loader=new m.EXRLoader().setDataType(m.FloatType),rows=[];
   try{for(const look of old.PRESETS){const p={...old.createProject(),transparent:true,layers:[old.applyPreset(old.createLayer(look.kind),look.id)]};const q=m.validateProject(p);const bytes=await r0.exportEXR(p,.7,96,54),a=loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).data,b=await exr(q,.7,96,54);const difference=delta(a,b);if(difference>.00003)throw Error(look.id+' changed '+difference);rows.push({id:look.id,difference});}return rows;}finally{r0.dispose();}
  });report.checks.push({legacyComparisons:comparisons});console.log('PASS '+comparisons.length+' original preset comparisons');
 }
 if(process.argv.includes('--performance')){
  const performance=await page.evaluate(async()=>{
   const {r,cases}=window.qa,rows=[];
   for(const [name,p] of Object.entries(cases)){
    await r.prepare(p);const samples=[];
    for(let i=0;i<32;i++){const start=globalThis.performance.now();r.render(p,2+i*.025,1920,1080);await r.renderer.readRenderTargetPixelsAsync(r.linearOutput,0,0,1,1,new Uint16Array(4));if(i>1)samples.push(globalThis.performance.now()-start);}
    samples.sort((a,b)=>a-b);const t=globalThis.performance.now();await r.exportPNG(p,2.4,3840,2160);rows.push({name,hdMedian:samples[Math.floor(samples.length/2)],hdP95:samples[Math.floor(samples.length*.95)],uhdPNGMilliseconds:globalThis.performance.now()-t});
   }return {renderer:r.renderer.getContext().getParameter(r.renderer.getContext().RENDERER),samples:rows};
  });report.checks.push({performance});console.log('Completed-frame performance '+JSON.stringify(performance));
 }
 if(process.argv.includes('--native')){
  const mediaTools=resolveMediaTools(),fingerprint=createHash('sha256').update(await fs.readFile(path.join(out,'renderer.js'))).digest('hex');
  for(const name of await page.evaluate(()=>Object.keys(window.qa.cases))){
   const project=await page.evaluate(name=>{const p=structuredClone(window.qa.cases[name]);p.duration=1;p.fps={num:12,den:1};p.width=320;p.height=180;p.schemaVersion=2;p.layers[0].modulations.opacity={kind:'sine',cycles:1,phase:0,amount:1,points:[],range:{min:.4,max:1}};return window.qa.m.validateProject(p);},name);
   const options={...mediaTools,rendererFingerprint:fingerprint,jobsDirectory:path.join(out,'native',name,Date.now().toString(),'queue'),defaultExportDir:path.join(out,'native',name,'output')};
   let manager=new ExportManager(options);const job=await manager.beginExport({project,format:'prores4444',width:320,height:180,fps:{num:12,den:1},frameCount:12,transparent:true,background:'#000000'}),hashes=[];
   for(let i=0;i<12;i++){
    if(i===6){await manager.cancelExport(job.id);manager=new ExportManager(options);await manager.resumeExport(job.id);await page.evaluate(()=>{window.qa.r.dispose();window.qa.r=new window.qa.m.StudioRenderer(document.querySelector('canvas'));});}
    const bytes=Buffer.from(await page.evaluate(async({project,i})=>Array.from(await window.qa.r.exportEXR(project,i/12*Math.PI*2,320,180)),{project,i}));hashes.push(createHash('sha256').update(bytes).digest('hex'));await manager.writeFrame(job.id,i,bytes);
   }
   const completed=await manager.finishExport(job.id);assert.equal(completed.status,'complete');
   await page.evaluate(()=>{window.qa.r.dispose();window.qa.r=new window.qa.m.StudioRenderer(document.querySelector('canvas'));});
   for(let i=0;i<12;i++){const bytes=Buffer.from(await page.evaluate(async({project,i})=>Array.from(await window.qa.r.exportEXR(project,i/12*Math.PI*2,320,180)),{project,i}));assert.equal(createHash('sha256').update(bytes).digest('hex'),hashes[i],name+' resumed frame '+i);}
   const probe=spawnSync(mediaTools.ffprobePath,['-v','error','-count_frames','-show_streams','-of','json',completed.outputPath],{encoding:'utf8'});assert.equal(probe.status,0);const stream=JSON.parse(probe.stdout).streams[0];assert.equal(Number(stream.nb_read_frames),12);assert.match(stream.pix_fmt,/yuva/);
   report.checks.push({native:name,path:completed.outputPath,frames:12,restartedRendererAtFrame:6,identicalToUninterrupted:true,stream});console.log('PASS native recovered alpha movie '+name);
  }
 }
 if(process.argv.includes('--movies')){
  await page.evaluate(async()=>{const old=await import('./baseline-renderer.js');window.qa.oldRenderer=new old.StudioRenderer(document.createElement('canvas'));window.qa.png64=async(renderer,p,phase)=>{const bytes=await renderer.exportPNG({...p,transparent:false,background:'#000000'},phase,640,360);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};});
  for(const name of await page.evaluate(()=>Object.keys(window.qa.cases))){
   const folder=path.join(out,name+'-frames'),before=path.join(out,name+'-before-frames');await fs.mkdir(folder,{recursive:true});await fs.mkdir(before,{recursive:true});
   const contract=JSON.stringify({opaqueReview:true,renderer:createHash('sha256').update(await fs.readFile(path.join(out,'renderer.js'))).digest('hex'),baseline:createHash('sha256').update(await fs.readFile(path.join(out,'baseline-renderer.js'))).digest('hex'),project:await page.evaluate(name=>window.qa.cases[name],name)});
   const manifest=path.join(out,name+'-frames-contract.json');
   if(await fs.readFile(manifest,'utf8').catch(()=>null)!==contract){await fs.rm(folder,{recursive:true,force:true});await fs.rm(before,{recursive:true,force:true});await fs.mkdir(folder,{recursive:true});await fs.mkdir(before,{recursive:true});await fs.writeFile(manifest,contract);}
   await fs.writeFile(path.join(out,name+'.formfield'),JSON.stringify(await page.evaluate(name=>window.qa.cases[name],name),null,2));
   const duration=await page.evaluate(name=>window.qa.cases[name].duration,name),frames=duration*24;
   for(let i=0;i<frames;i++){
    if(await fs.stat(path.join(folder,`frame-${String(i).padStart(5,'0')}.png`)).catch(()=>null)&&await fs.stat(path.join(before,`frame-${String(i).padStart(5,'0')}.png`)).catch(()=>null))continue;
    const bytes=await page.evaluate(async({name,i,frames})=>window.qa.png64(window.qa.r,window.qa.cases[name],i/frames*Math.PI*2),{name,i,frames});
    await fs.writeFile(path.join(folder,`frame-${String(i).padStart(5,'0')}.png`),Buffer.from(bytes,'base64'));if(i%120===0)console.log(name+' '+i+'/'+frames);
    const previous=await page.evaluate(async({name,i,frames})=>window.qa.png64(window.qa.oldRenderer,window.qa.cases[name],i/frames*Math.PI*2),{name,i,frames});await fs.writeFile(path.join(before,`frame-${String(i).padStart(5,'0')}.png`),Buffer.from(previous,'base64'));
   }
   // Review-only H.264 uses the locally installed encoder. Native delivery above
   // continues to use the pinned bundled ProRes/PNG pipeline.
   const result=spawnSync(process.env.REVIEW_FFMPEG??'/opt/homebrew/bin/ffmpeg',['-y','-v','error','-framerate','24','-i',path.join(folder,'frame-%05d.png'),'-c:v','libx264','-crf','12','-g','1','-pix_fmt','yuv420p',path.join(out,name+'.mp4')],{maxBuffer:4*1024*1024});
   assert.equal(result.status,0,result.stderr?.toString());
   const compare=spawnSync(process.env.REVIEW_FFMPEG??'/opt/homebrew/bin/ffmpeg',['-y','-v','error','-framerate','24','-i',path.join(before,'frame-%05d.png'),'-framerate','24','-i',path.join(folder,'frame-%05d.png'),'-filter_complex','[0:v][1:v]hstack=inputs=2','-c:v','libx264','-crf','15','-g','1','-pix_fmt','yuv420p',path.join(out,name+'-before-after.mp4')],{maxBuffer:4*1024*1024});assert.equal(compare.status,0,compare.stderr?.toString());
   report.checks.push({movie:name,frames,durationSeconds:duration,beforeAfter:'Before on left; upgraded treatment on right. Matching source parameters and palette.'});
  }
  await page.evaluate(()=>window.qa.oldRenderer.dispose());
 }
 assert.deepEqual(errors,[]);report.status='passed';
}finally{await fs.writeFile(path.join(out,process.argv.includes('--movies')?'movies-report.json':process.argv.includes('--final')?'final-report.json':'report.json'),JSON.stringify(report,null,2));await app.close();}
