// Real renderer audit and reference generation. References are only replaced
// with --update-references; ordinary runs compare every signature PNG to them.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'work/quality-pass'),refs=path.join(root,'src/ui/assets/signatures');
const update=process.argv.includes('--update-references'), referencesOnly=process.argv.includes('--references-only');
await fs.mkdir(out,{recursive:true});await fs.mkdir(refs,{recursive:true});
await build({stdin:{contents:`export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer,applyPreset,PRESETS,parameterDefinitions,varyLayer} from './src/core/project';export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:path.join(out,'renderer.js'),logLevel:'silent'});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><canvas width="480" height="270"></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'audit-profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.setDefaultTimeout(120000);
const report={status:'running',captures:[],checks:[],errors};
try {
 await page.evaluate(async()=>{
  const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('canvas')),loader=new m.EXRLoader().setDataType(m.FloatType);
  const project=id=>({...m.createProject(),layers:[m.applyPreset(m.createLayer(m.PRESETS.find(p=>p.id===id).kind),id)]});
  const exr=async(p,phase=.7,w=160,h=90)=>{const b=await r.exportEXR(p,phase,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
  const check=(v,label)=>{if(!v)throw Error(label);};
  const stats=(a,label)=>{let energy=0,visible=0;for(let i=0;i<a.length;i+=4){check([a[i],a[i+1],a[i+2],a[i+3]].every(Number.isFinite),label+': nonfinite');check(a[i+3]>=0&&a[i+3]<=1,label+': invalid alpha');if(a[i+3]===0)check(a[i]+a[i+1]+a[i+2]===0,label+': RGB at zero alpha');else visible++;energy+=a[i]+a[i+1]+a[i+2];}return {energy:energy/(a.length/4),visible};};
  window.qa={m,r,project,exr,check,stats};
 });
 const presets=await page.evaluate(()=>window.qa.m.PRESETS);
 for(const preset of presets.filter(p=>!referencesOnly||p.signature)) {
  const phases=referencesOnly?[.7]:preset.signature?[0,.7,2.8]:[.7,2.8];
  for(const phase of phases) {
   const bytes=Buffer.from(await page.evaluate(async({id,phase})=>Array.from(await window.qa.r.exportPNG(window.qa.project(id),phase,480,270)),{id:preset.id,phase}));
   const name=`${preset.id}-${phase}.png`;await fs.writeFile(path.join(out,name),bytes);
   report.captures.push({id:preset.id,kind:preset.kind,signature:!!preset.signature,phase,file:name});
   if(preset.signature&&phase===.7) {
    const reference=path.join(refs,preset.id+'.png');
    if(update)await fs.writeFile(reference,bytes);
    else {
     const previous=await fs.readFile(reference);
     const difference=await page.evaluate(async({a,b})=>{
      const decode=async data=>{const img=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);img.close();return ctx.getImageData(0,0,c.width,c.height).data;};
      const x=await decode(a),y=await decode(b);if(x.length!==y.length)throw Error('Reference dimensions changed');let sum=0,changed=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);sum+=d;if(d>8)changed++;}return {mean:sum/x.length,large:changed/x.length};
     },{a:Array.from(bytes),b:Array.from(previous)});
     assert.ok(difference.mean<1&&difference.large<.01,preset.id+': reference render changed '+JSON.stringify(difference));
     report.checks.push({reference:preset.id,...difference});
    }
   }
  }
  if(referencesOnly)continue;
  if(preset.signature)for(const strength of [.35,.65,1]) {
   const bytes=await page.evaluate(async({id,strength})=>{const {m,r,project}=window.qa,p=project(id);p.layers[0]=m.varyLayer(p.layers[0],strength,{palette:false,structure:false,motion:false,material:false},Math.round(strength*1e6));return Array.from(await r.exportPNG(p,.7,480,270));},{id:preset.id,strength});
   await fs.writeFile(path.join(out,`${preset.id}-random-${strength}.png`),Buffer.from(bytes));
  }
  // Size and motion extremes for every authored look, plus three independently
  // randomized looks; preserve genuine cutouts and single-centre designs.
  const checks=await page.evaluate(async id=>{
   const {m,project,exr,stats,check}=window.qa,p=project(id),base=p.layers[0],results=[];
   for(const strength of [.35,.65,1]) {
    const q=structuredClone(p);q.layers[0]=m.varyLayer(base,strength,{palette:false,structure:false,motion:false,material:false},Math.round(strength*1e6));q.transparent=true;
    const s=stats(await exr(q),id+' random '+strength);check(s.energy>.0001&&s.visible>0,id+': empty random variation');results.push({random:strength,...s});
   }
   const defs=m.parameterDefinitions(base.kind),sizeKeys=['size','scale','stretch','poolSize','cellSize','lensSize','zoom'],motionKeys=['motion','travel','breath','morph','feedback','weave','flicker'];
   for(const extreme of ['min','max']) {
    const q=structuredClone(p);q.transparent=true;q.layers[0].transform={x:.2,y:-.15,scale:.3,rotation:.45};
    for(const d of defs)if(sizeKeys.includes(d.key)||motionKeys.includes(d.key))q.layers[0].params[d.key]=d[extreme];
    results.push({extreme,...stats(await exr(q),id+' '+extreme)});
   }
   return results;
  },preset.id);
  report.checks.push({preset:preset.id,checks});
  console.log('Audited '+preset.id);
 }
 // Every slider is exercised independently on a representative from each
 // algorithm family, so zero-coverage controls are allowed to be intentionally empty.
 const families=[];for(const p of referencesOnly?[]:presets){const key=`${p.kind}:${p.params.style??p.params.form??p.params.mode??0}`;if(!families.some(f=>f.key===key))families.push({key,id:p.id});}
 for(const family of families) {
  const checks=await page.evaluate(async id=>{
   const {m,project,exr,stats}=window.qa,p=project(id),out=[];
   for(const d of m.parameterDefinitions(p.layers[0].kind))for(const edge of ['min','max']) {
    const q=structuredClone(p);q.transparent=true;q.layers[0].params[d.key]=d[edge];
    out.push({key:d.key,edge,...stats(await exr(q,.7,96,54),id+' '+d.key+' '+edge)});
   }
   return out;
  },family.id);report.checks.push({family:family.key,controls:checks});console.log('Stressed '+family.key);
 }
 // Signature aspect ratios, exact seek and loop contract.
 for(const preset of presets.filter(p=>p.signature&&!referencesOnly)) {
  const result=await page.evaluate(async id=>{
   const {project,exr,stats,check}=window.qa,p=project(id);p.transparent=true;
   const a=await exr(p),b=await exr(p,.7+Math.PI*2);check(a.every((v,i)=>Math.abs(v-b[i])<.0001),id+': loop');
   await exr(p,4.9);const c=await exr(p);check(a.every((v,i)=>v===c[i]),id+': seek');
   return [stats(await exr(p,.7,90,160),id+' portrait'),stats(await exr(p,.7,120,120),id+' square')];
  },preset.id);report.checks.push({signature:preset.id,aspects:result,loop:true,seek:true});
 }
 if(process.argv.includes('--production'))for(const id of ['signature-tidal-silk','signature-opal-corolla','signature-amber-julia','signature-verdigris-slide','signature-painted-leader','signature-signal-garden']) {
  const bytes=await page.evaluate(async id=>Array.from(await window.qa.r.exportPNG(window.qa.project(id),.7,3840,2160)),id);
  await fs.writeFile(path.join(out,id+'-4k.png'),Buffer.from(bytes));report.checks.push({production:id,width:3840,height:2160});
 }
 if(!referencesOnly)for(const kind of ['surface','sculpture','fractal','oil','super8','graphic','signature']) {
  const captures=report.captures.filter(c=>c.phase===.7&&(kind==='signature'?c.signature:c.kind===kind));
  const data=await page.evaluate(async entries=>{
   const c=document.createElement('canvas');c.width=1200;c.height=Math.ceil(entries.length/5)*162;const ctx=c.getContext('2d');ctx.fillStyle='#151515';ctx.fillRect(0,0,c.width,c.height);
   for(let i=0;i<entries.length;i++){const im=new Image();im.src=entries[i].file;await im.decode();const x=i%5*240,y=Math.floor(i/5)*162;ctx.drawImage(im,x,y,240,135);ctx.fillStyle='#eee';ctx.font='12px sans-serif';ctx.fillText(entries[i].id.replace('signature-',''),x+6,y+153);}
   return c.toDataURL().split(',')[1];
  },captures);await fs.writeFile(path.join(out,kind+'-contact.png'),Buffer.from(data,'base64'));
 }
 if(!referencesOnly) {
  const data=await page.evaluate(async presets=>{
   const c=document.createElement('canvas');c.width=1200;c.height=presets.length*192;const ctx=c.getContext('2d');ctx.fillStyle='#151515';ctx.fillRect(0,0,c.width,c.height);
   for(let i=0;i<presets.length;i++)for(const [j,suffix] of ['-0.7','-random-0.35','-random-0.65','-random-1'].entries()){const im=new Image();im.src=presets[i].id+suffix+'.png';await im.decode();ctx.drawImage(im,j*300,i*192,300,169);ctx.fillStyle='#eee';ctx.font='12px sans-serif';ctx.fillText(presets[i].name+' '+['Original','Subtle','Balanced','Bold'][j],j*300+5,i*192+185);}
   return c.toDataURL().split(',')[1];
  },presets.filter(p=>p.signature));await fs.writeFile(path.join(out,'random-contact.png'),Buffer.from(data,'base64'));
 }
 assert.deepEqual(errors,[]);report.status='passed';
 await fs.writeFile(path.join(out,referencesOnly?'reference-check.json':'report.json'),JSON.stringify(report,null,2));
 const gallery=`<!doctype html><meta charset="utf-8"><title>Form & Field visual quality review</title><style>body{background:#151515;color:#eee;font:16px system-ui;margin:32px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}img{width:100%}figure{margin:0}figcaption{margin:8px 0 24px;color:#bbb}a{color:#9fe0df}</style><h1>Signature collection</h1><p>20 authored looks, rendered by the application. Frames at three loop phases; square and portrait output, seek and loop checks recorded in <a href="report.json">report.json</a>.</p><section>${presets.filter(p=>p.signature).map(p=>`<figure><h2>${p.name}</h2><p>${p.description}</p>${[0,.7,2.8].map(phase=>`<img src="${p.id}-${phase}.png" alt="${p.name}, phase ${phase}">`).join('')}<figcaption>${p.kind}</figcaption></figure>`).join('')}</section>`;
 if(!referencesOnly)await fs.writeFile(path.join(out,'gallery.html'),gallery);
 console.log(JSON.stringify({status:report.status,presets:presets.length,captures:report.captures.length,checks:report.checks.length,errors}));
} finally {await page.evaluate(()=>window.qa?.r.dispose()).catch(()=>{});await app.close();}
