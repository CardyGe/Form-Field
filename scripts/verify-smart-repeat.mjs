// Real GPU proof: geometry across joins, not merely equality of repeated images.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/smart-repeat');
await fs.mkdir(out,{recursive:true});
await build({stdin:{contents:`export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS,parameterDefinitions} from './src/core/project';
export {generateGraphicLayout} from './src/rendering/graphic-layout';
export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:path.join(out,'renderer.js'),logLevel:'silent'});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.evaluate(async()=>{
  const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('canvas')),loader=new m.EXRLoader().setDataType(m.FloatType);
  const project=id=>({...m.createProject(),transparent:true,layers:[m.applyPreset(m.createLayer(m.PRESETS.find(p=>p.id===id).kind),id)]});
  const exr=async(p,phase=.7,w=320,h=180)=>{const b=await r.exportEXR(p,phase,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
  const delta=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
  const check=(v,label)=>{if(!v)throw Error(label);};
  const stats=a=>{let zero=0,soft=0,one=0;for(let i=0;i<a.length;i+=4){check([a[i],a[i+1],a[i+2],a[i+3]].every(Number.isFinite),'non-finite source');const alpha=a[i+3];check(alpha>=0&&alpha<=1,'alpha outside bounds');if(alpha===0){zero++;check(a[i]+a[i+1]+a[i+2]===0,'RGB at alpha zero');}else if(alpha===1)one++;else soft++;}return {zero,soft,one};};
  window.repeatQA={m,r,project,exr,delta,check,stats};
 });
 const checks=await page.evaluate(async()=>{
  const {m,r,project,exr,delta,check,stats}=window.repeatQA,checks=[];
  // Find actual seeded wires which cross either seam. Their filled centre must
  // stay solid on both sides, rather than terminating with two unrelated caps.
  const p=project('circuit-worms'),q=p.layers[0];Object.assign(q.params,{size:.5,pathResolution:12,pathLength:80,pathWidth:.9,hollow:0,motion:0,reveal:1,backgroundOpacity:0});
  q.palette=['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#000000'];
  const layout=m.generateGraphicLayout(q.params,16/9),pixels=await exr(p,1.3,960,540);
  let xJoins=0,yJoins=0;
  for(const path of layout.paths)for(let i=1;i<path.length;i++) {
   const a=path[i-1],b=path[i],aspect=16/9;
   for(const axis of ['x','y']) {
    const period=axis==='x'?aspect:1,aa=a[axis],bb=b[axis];
    if(Math.floor((aa+period/2)/period)===Math.floor((bb+period/2)/period))continue;
    const other=axis==='x'?a.y:a.x,otherPeriod=axis==='x'?1:aspect;
    const wrapped=((other+otherPeriod/2)%otherPeriod+otherPeriod)%otherPeriod-otherPeriod/2;
    const x=axis==='x'?.75:.5+.5*wrapped/aspect,y=axis==='y'?.75:.5+.5*wrapped;
    const ix=Math.round(x*960-.5),iy=Math.round(y*540-.5);
    for(const offset of [-2,-1,0,1,2]) {
     const xx=ix+(axis==='x'?offset:0),yy=iy+(axis==='y'?offset:0);
     check(pixels[(yy*960+xx)*4+3]>.95,'wire stops at a '+axis+' repeat boundary');
    }
    if(axis==='x')xJoins++;else yJoins++;
   }
  }
  check(xJoins>0&&yJoins>0,'must exercise both path joins');checks.push({wireJoins:{x:xJoins,y:yJoins}});
  const tiles=project('neon-frames');Object.assign(tiles.layers[0].params,{size:.5,tileResolution:12,tileArea:8,tileGap:0,roundness:0,fill:1,stroke:4,motion:0,sweep:0,backgroundOpacity:0});
  tiles.layers[0].palette=q.palette;
  const packed=m.generateGraphicLayout(tiles.layers[0].params,16/9),image=await exr(tiles,1.3,960,540);
  let interiors=0;
  for(const t of packed.tiles){
   if(t.x-t.w/2<8/9&&t.x+t.w/2>8/9+.04){
    const y=((t.y+.5)%1+1)%1-.5,ix=720,iy=Math.round((.5+.5*y)*540-.5);
    for(const dx of [-1,0,1])check(image[(iy*960+ix+dx)*4+3]<.01,'phantom rectangle outline at a wrapped tile interior');interiors++;
   }
  }
  check(interiors>0,'exercise a packed tile crossing the seam');checks.push({wrappedTileInteriors:interiors});
  const pillars=project('uneven-pillars');Object.assign(pillars.layers[0].params,{size:.25,columns:12,gutter:0,motion:0,backgroundOpacity:0});pillars.layers[0].palette=q.palette;
  const cols=m.generateGraphicLayout(pillars.layers[0].params,16/9).columns,ix=Math.round((.5+.25*(-.5+cols[0]/2))*960-.5),bars=await exr(pillars,1.3,960,540);
  for(const edge of [.125,.375,.625,.875])for(let dy=-2;dy<=2;dy++)check(bars[(Math.round(edge*540-.5+dy)*960+ix)*4+3]>.95,'rounded column cap exposes horizontal tile edge');
  checks.push({pillarJoins:4,fractionalWaves:true});
  const ring=project('radial-circuit');Object.assign(ring.layers[0].params,{size:.25,motion:0,backgroundOpacity:0});
  const radial=await exr(ring,.7);ring.layers[0].params.ringWidth=0;const noRing=await exr(ring,.7);
  let changed=0;
  for(let y=0;y<180;y++)for(let x=0;x<320;x++) {
   const distance=Math.hypot(((x+.5)/320-.5)*16/9/.25,((y+.5)/180-.5)/.25);
   const i=(y*320+x)*4;
   if(distance>.42)check(radial[i]===noRing[i]&&radial[i+3]===noRing[i+3],'radial core must not repeat as a grid of rings');
   else if(Math.abs(radial[i+3]-noRing[i+3])>.01)changed++;
  }
  check(changed>0,'radial cutout remains active');checks.push({singleRadialCore:true});
  // Actual field evaluation is equivalent to a wider procedural domain, without
  // cloning a finite frame or adding a rectangular transparency boundary.
  for(const kind of ['surface','fractal','super8']) {
   const a={...m.createProject(),transparent:true,layers:[m.createLayer(kind)]},layer=a.layers[0];
   for(const [key,value] of Object.entries({scale:1.5,relief:0,travel:0,cameraPitch:0,rotation:0,warp:0}))if(key in layer.params)layer.params[key]=value;
   if(kind==='super8')Object.assign(layer.params,{emulsion:0,pullDown:0,shutter:0,reelLoops:0,frameLines:0,grain:0,scratches:0,flicker:0,weave:0,dust:0,hair:0,lightLeak:0,halation:0,vignette:0,lensSoftness:0,colorFade:0,feedback:0});
   layer.transform.scale=.5;
   const b=structuredClone(a);b.layers[0].transform.scale=1;b.layers[0].params.scale=3;
   const difference=delta(await exr(a,0),await exr(b,0));check(difference<.001,kind+': view scale must evaluate the wider field ('+difference+')');checks.push({kind,domainEquivalence:difference});
  }
  for(const preset of m.PRESETS) {
   const a=project(preset.id),layer=a.layers[0];
   layer.transform={x:.2,y:-.15,scale:.3,rotation:.45};
   if(layer.kind==='graphic')Object.assign(layer.params,{size:.35,stretch:.65});
   if(layer.kind==='super8')layer.params.gateMode=0;
   const data=await exr(a,.7,192,108),s=stats(data);
   if(layer.kind==='surface'||layer.kind==='oil'||layer.kind==='super8'||layer.kind==='fractal'&&layer.params.style!==2||layer.kind==='graphic')check(s.one===192*108,preset.id+': opaque field must cover the view');
   check(delta(data,await exr(a,.7+Math.PI*2,192,108))<.00002,preset.id+': transformed loop');
   await exr(a,4.7,192,108);check(delta(data,await exr(a,.7,192,108))===0,preset.id+': seek');
   checks.push({preset:preset.id,kind:layer.kind,...s});
  }
  // A tightly framed 3D source may originally lie beyond the frame. Scaling the
  // object down must reveal its geometry, not retain the old rectangular crop.
  const object={...m.createProject(),transparent:true,layers:[m.createLayer('sculpture')]};
  Object.assign(object.layers[0].params,{zoom:2.5,breath:0});object.layers[0].transform.scale=.35;
  const sculpture=await exr(object,.7);let outside=0;
  for(let y=0;y<180;y++)for(let x=0;x<320;x++)if(Math.abs((x+.5)/320-.5)>.175||Math.abs((y+.5)/180-.5)>.175)outside+=sculpture[(y*320+x)*4+3]>.01?1:0;
  check(outside>100,'Sculpture retains the cropped source rectangle');checks.push({sculptureRevealedOutsideFormerCrop:outside});
  for(const form of [0,1,2,3]) {
   Object.assign(object.layers[0].params,{form,zoom:3,stretch:1.8,asymmetry:1});
   stats(await exr(object,.7));
  }
  checks.push({sculptureNearCameraClipping:true});
  // A repeatable imported texture uses a genuine wrapping sampler, independently
  // of masks and a second layer using the same image with ordinary contain fit.
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),rgba=ctx.createImageData(64,64);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;rgba.data[i]=128+Math.round(100*Math.sin((x+.5)/64*Math.PI*2));rgba.data[i+1]=128+Math.round(100*Math.cos((y+.5)/64*Math.PI*2));rgba.data[i+2]=100;rgba.data[i+3]=255;}ctx.putImageData(rgba,0,0);
  const img=m.createLayer('image');img.image={name:'Periodic image',dataUrl:canvas.toDataURL(),width:64,height:64,fit:'cover'};img.params.repeat=3;img.transform={x:.2,y:-.15,scale:.25,rotation:.4};
  const imported={...m.createProject(),transparent:true,layers:[img]};check(stats(await exr(imported)).one===320*180,'repeated imported artwork must fill the view');
  const separate=structuredClone(imported);separate.layers[0].params.repeat=1;
  check(stats(await exr(separate)).zero>0,'single imported artwork must retain finite transparent bounds');
  check(stats(await exr(imported)).one===320*180,'single/repeat sampler state must not leak');
  checks.push({imageRepeat:true,imageSingleBounds:true,samplerIsolation:true});
  return checks;
 });
 for(const id of ['circuit-worms','maze-carpet','nested-tiles','uneven-pillars','radial-circuit','orbital-bloom']) {
  const bytes=await page.evaluate(async id=>{const {r,project}=window.repeatQA,p=project(id);Object.assign(p.layers[0].params,{size:.3,motion:.7});return Array.from(await r.exportPNG(p,1.3,960,540));},id);
  await fs.writeFile(path.join(out,id+'.png'),Buffer.from(bytes));
 }
 const full=await page.evaluate(async()=>{const {r,project}=window.repeatQA,p=project('circuit-worms');p.layers[0].params.size=.3;return Array.from(await r.exportPNG(p,1.3,3840,2160));});
 await fs.writeFile(path.join(out,'circuit-4k.png'),Buffer.from(full));
 assert.deepEqual(errors,[]);const report={status:'passed',checks,errors};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await page.evaluate(()=>window.repeatQA?.r.dispose()).catch(()=>{});await app.close();}
