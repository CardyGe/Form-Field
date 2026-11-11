import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'work/zoom-quality',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(out,{recursive:true});
const entry=`export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer,applyPreset} from './src/core/project';export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`;
const options={stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',logLevel:'silent'};
await build({...options,outfile:path.join(out,'renderer.js')});
let baseline=false;
if(process.argv[2]) {
 const asar=createRequire(import.meta.url)('@electron/asar'),archive=path.resolve(process.argv[2],'Contents/Resources/app.asar');
 const mapName=asar.listPackage(archive).find(f=>/dist\/assets\/index-.*\.js\.map$/.test(f));
 const map=JSON.parse(asar.extractFile(archive,mapName.replace(/^\//,'')));
 const replacements=new Map();
 for(let i=0;i<map.sources.length;i++)if(/src\/rendering\/(StudioRenderer|GraphicRenderer|shaders)\.ts$/.test(map.sources[i]))replacements.set(path.basename(map.sources[i]),map.sourcesContent[i]);
 assert.equal(replacements.size,3);
 await build({...options,outfile:path.join(out,'baseline.js'),plugins:[{name:'baseline',setup(b){b.onLoad({filter:/src\/rendering\/(StudioRenderer|GraphicRenderer|shaders)\.ts$/},args=>({contents:replacements.get(path.basename(args.path)),loader:'ts',resolveDir:path.dirname(args.path)}));}}]});
 baseline=true;
}
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><canvas></canvas><canvas id="old"></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[];
page.setDefaultTimeout(120000);
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
 const checks=await page.evaluate(async baseline=>{
  const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('canvas'));
  const old=baseline?new (await import('./baseline.js')).StudioRenderer(document.querySelector('#old')):null;
  const loader=new m.EXRLoader().setDataType(m.FloatType),checks=[];
  const exr=async(engine,p,w,h)=>{const b=await engine.exportEXR(p,.7,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
  const compare=(a,b,w,h,factor)=>{
   let total=0,significant=0;const rw=w*factor,x0=(rw-w)/2,y0=(h*factor-h)/2;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<4;c++){
    const d=Math.abs(a[(y*w+x)*4+c]-b[((y+y0)*rw+x+x0)*4+c]); total+=d; if(d>.05)significant++;
   }
   return {mean:total/a.length,significant:significant/a.length};
  };
  for(const id of ['uneven-pillars','nested-tiles','neon-frames','circuit-worms','maze-carpet','radial-circuit']) {
   for(const factor of [2,4,8]) {
    const layer=m.applyPreset(m.createLayer('graphic'),id);
    Object.assign(layer.params,{motion:0,softness:0,backgroundOpacity:0});
    layer.palette=['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#000000'];
    layer.transform={x:.22,y:-.13,scale:factor,rotation:.23};
    const p={...m.createProject(),transparent:true,layers:[layer]},reference=structuredClone(p);
    reference.layers[0].transform={...layer.transform,scale:1,x:layer.transform.x/factor,y:layer.transform.y/factor};
    const w=320,h=180,high=await exr(r,reference,w*factor,h*factor);
    const current=compare(await exr(r,p,w,h),high,w,h,factor);
    const previous=old?compare(await exr(old,p,w,h),high,w,h,factor):null;
    if(current.mean>.004)throw Error(`${id} ${factor}x differs from native-detail reference: ${JSON.stringify(current)}`);
    if(previous&&previous.mean>.003&&current.mean>previous.mean*.6)throw Error(`${id}: zoom detail did not improve`);
    checks.push({id,factor,current,previous});
   }
  }
  // Authored colours and cells reached by panning must match the same field.
  for(const id of ['nested-tiles','circuit-worms','radial-circuit']) {
   const layer=m.applyPreset(m.createLayer('graphic'),id),factor=4,w=320,h=180;
   Object.assign(layer.params,{motion:0,orientation:.42,size:1.2,stretch:1.4});
   layer.transform={x:1.1,y:-.8,scale:factor,rotation:-.35};
   const p={...m.createProject(),transparent:true,layers:[layer]},reference=structuredClone(p);
   reference.layers[0].transform={...layer.transform,scale:1,x:layer.transform.x/factor,y:layer.transform.y/factor};
   const current=compare(await exr(r,p,w,h),await exr(r,reference,w*factor,h*factor),w,h,factor);
   if(current.mean>.004)throw Error(`${id}: authored colours or panned repeats changed: ${JSON.stringify(current)}`);
   checks.push({id,colouredPannedField:true,current});
  }
  // Rotated contiguous fills cannot acquire transparent seams in the geometry path.
  const solid=m.applyPreset(m.createLayer('graphic'),'packed-mosaic');
  Object.assign(solid.params,{motion:0,fill:0,tileGap:0,roundness:0,sweep:0,backgroundOpacity:0});
  solid.transform={x:.37,y:-.41,scale:4,rotation:.65};
  const p={...m.createProject(),transparent:true,layers:[solid]},data=await exr(r,p,640,360);
  let minimum=1;for(let i=3;i<data.length;i+=4)minimum=Math.min(minimum,data[i]);
  if(minimum<.999)throw Error('Magnified solid tiles acquired seams: '+minimum);
  checks.push({solidTileSeams:false,minimumAlpha:minimum});
  window.zoomProof={r,old,m};
  return checks;
 },baseline);
 for(const [id,factor] of [['nested-tiles',8],['circuit-worms',4]]) {
  const bytes=await page.evaluate(async({id,factor})=>{
   const {r,m}=window.zoomProof,layer=m.applyPreset(m.createLayer('graphic'),id);
   layer.transform.scale=factor;layer.params.motion=0;
   return Array.from(await r.exportPNG({...m.createProject(),layers:[layer]},.7,960,540));
  },{id,factor});
  await fs.writeFile(path.join(out,`${id}-${factor}x.png`),Buffer.from(bytes));
 }
 assert.deepEqual(errors,[]);
 const report={status:'passed',checks,errors};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));console.log('Report: '+out);
} finally {await page.evaluate(()=>{window.zoomProof?.r.dispose();window.zoomProof?.old?.dispose();}).catch(()=>{});await app.close();}
