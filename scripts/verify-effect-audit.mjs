import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/pro-audit');
await fs.mkdir(out,{recursive:true});
await build({stdin:{contents:`export {StudioRenderer} from './src/rendering/StudioRenderer';export {PRESETS,createLayer,createProject,applyPreset,parameterDefinitions,validateProject} from './src/core/project';export {FINISH_PARAMETERS} from './src/core/finishing';export {INSTRUMENT_KINDS,INSTRUMENT_UPGRADE_KEYS} from './src/core/instruments';export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:path.join(out,'renderer.js'),logLevel:'silent'});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><canvas id="new" width="480" height="270"></canvas><canvas id="old" width="480" height="270"></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'audit-profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const errors=[];
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow();page.setDefaultTimeout(240000);
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const report={status:'running',baseline:[],finishing:[],chemistry:[],errors};
try{
 await page.evaluate(async()=>{
  const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('#new')),loader=new m.EXRLoader().setDataType(m.FloatType);
  const exr=async(engine,p,phase=.7)=>{const b=await engine.exportEXR(p,phase,160,90);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
  const check=(v,label)=>{if(!v)throw Error(label);};const delta=(a,b)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/a.length;
  const alpha=(a,b,label)=>{for(let i=0;i<a.length;i+=4){check([a[i],a[i+1],a[i+2],a[i+3]].every(Number.isFinite),label+' nonfinite');check(a[i+3]===b[i+3],label+' changed alpha');if(a[i+3]===0)check(a[i]+a[i+1]+a[i+2]===0,label+' colour at zero alpha');}};
  window.audit={m,r,exr,check,delta,alpha};
 });
 if(await fs.stat(path.join(out,'baseline-renderer.js')).catch(()=>null)){
  await page.evaluate(async()=>{const old=await import('./baseline-renderer.js');window.audit.old=old;window.audit.before=new old.StudioRenderer(document.querySelector('#old'));});
  const presets=await page.evaluate(()=>window.audit.old.PRESETS.map(p=>p.id));
  for(const id of presets){
   const check=await page.evaluate(async id=>{
    const {m,r,old,before,exr,check,delta}=window.audit;
    const p={...old.createProject(),transparent:true,layers:[old.applyPreset(old.createLayer(old.PRESETS.find(p=>p.id===id).kind),id)]},q=m.validateProject(p);
    const a=await exr(before,p),b=await exr(r,q),mean=delta(a,b);check(mean<.00005,id+' neutral migration changed appearance: '+mean);
    return {id,meanDifference:mean};
   },id);report.baseline.push(check);
  }
  console.log('All '+presets.length+' existing looks match the captured 0.9 renderer');
 }
 const kinds=['surface','sculpture','fractal','oil','super8','graphic','image',...await page.evaluate(()=>window.audit.m.INSTRUMENT_KINDS)];
 for(const kind of kinds){
  const results=await page.evaluate(async kind=>{
   const {m,r,exr,check,delta,alpha}=window.audit,p={...m.createProject(),transparent:true,layers:[m.createLayer(kind)]},layer=p.layers[0],results=[];
   if(kind==='image'){
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,128,128);g.addColorStop(0,'rgba(210,55,95,.2)');g.addColorStop(1,'rgba(20,190,200,1)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);layer.image={name:'Grade fixture',dataUrl:c.toDataURL(),width:128,height:128,fit:'cover'};
   }
   if('backgroundOpacity' in layer.params)layer.params.backgroundOpacity=0;
   for(const d of m.FINISH_PARAMETERS){
    const a=structuredClone(p),b=structuredClone(p);if(d.key==='tonePivot')for(const q of [a,b])q.layers[0].params.toneContrast=1.5;
    a.layers[0].params[d.key]=d.min;b.layers[0].params[d.key]=d.max;
    const x=await exr(r,a),y=await exr(r,b);alpha(x,y,kind+' '+d.key);const difference=delta(x,y);check(difference>1e-7,kind+' inactive finish '+d.key);
    b.layers[0].modulations[d.key]={kind:'sine',cycles:3,amount:.2,phase:.1,points:[]};
    check(delta(await exr(r,b,.7),await exr(r,b,.7+Math.PI*2))<.00003,kind+' finish route loop');
    results.push({control:d.key,difference,alphaPreserved:true});
   }
   return results;
  },kind);report.finishing.push({kind,checks:results});console.log('Finishing '+kind);
 }
 report.chemistry=await page.evaluate(async()=>{
  const {m,r,exr,check}=window.audit,results=[];
  for(const pattern of [0,1,2,3])for(const seedCoverage of [.3,.85])for(const development of [.65,1.4])for(const branching of [0,1]){
   const p={...m.createProject(),transparent:true,layers:[m.createLayer('livingink')]};Object.assign(p.layers[0].params,{pattern,seedCoverage,development,branching,seed:4294967295,backgroundOpacity:0});
   const a=await exr(r,p);let lo=1,hi=0;for(let i=3;i<a.length;i+=4){lo=Math.min(lo,a[i]);hi=Math.max(hi,a[i]);}
   check(lo<1&&hi>0,'Unproductive chemical preparation '+JSON.stringify({pattern,seedCoverage,development,branching,lo,hi}));results.push({pattern,seedCoverage,development,branching,minAlpha:lo,maxAlpha:hi});
  }return results;
 });
 assert.deepEqual(errors,[]);report.status='passed';await fs.writeFile(path.join(out,'effect-audit.json'),JSON.stringify(report,null,2));console.log('Effect audit passed');
}finally{await page.evaluate(()=>{window.audit?.r.dispose();window.audit?.before?.dispose();}).catch(()=>{});await app.close();}
