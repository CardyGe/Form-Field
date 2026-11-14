import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/instruments');
await fs.mkdir(out,{recursive:true});await fs.mkdir(path.join(root,'src/ui/assets/instruments'),{recursive:true});
await build({stdin:{contents:`export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer,applyPreset,PRESETS,parameterDefinitions,visibleParameterDefinitions,varyLayer,validateProject} from './src/core/project';export {INSTRUMENTS,INSTRUMENT_KINDS} from './src/core/instruments';export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:path.join(out,'renderer.js'),logLevel:'silent'});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><canvas width="480" height="270"></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'gpu-profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[];page.setDefaultTimeout(180000);
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const report={status:'running',captures:[],checks:[],errors};
try{
 await page.evaluate(async()=>{
  const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('canvas')),loader=new m.EXRLoader().setDataType(m.FloatType);
  const project=id=>({...m.createProject(),transparent:true,layers:[m.applyPreset(m.createLayer(m.PRESETS.find(p=>p.id===id).kind),id)]});
  const exr=async(p,phase=.7,w=160,h=90)=>{const b=await r.exportEXR(p,phase,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
  const check=(v,label)=>{if(!v)throw Error(label);};
  const delta=(a,b)=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length;
  const stats=(a,label)=>{let energy=0,minAlpha=1,maxAlpha=0;for(let i=0;i<a.length;i+=4){check([a[i],a[i+1],a[i+2],a[i+3]].every(Number.isFinite),label+' nonfinite');const alpha=a[i+3];check(alpha>=0&&alpha<=1,label+' invalid alpha');if(alpha===0)check(a[i]+a[i+1]+a[i+2]===0,label+' RGB at alpha zero');energy+=a[i]+a[i+1]+a[i+2];minAlpha=Math.min(minAlpha,alpha);maxAlpha=Math.max(maxAlpha,alpha);}return {energy:energy/(a.length/4),minAlpha,maxAlpha};};
  window.qa={m,r,project,exr,check,delta,stats};
 });
 const instruments=await page.evaluate(()=>window.qa.m.INSTRUMENTS);
 for(const info of instruments){
  for(const [index,look] of info.looks.entries()){
   const bytes=Buffer.from(await page.evaluate(async id=>Array.from(await window.qa.r.exportPNG(window.qa.project(id),.7,480,270)),look.id));
   await fs.writeFile(path.join(out,look.id+'.png'),bytes);report.captures.push(look.id+'.png');
   if(index===0)await fs.writeFile(path.join(root,'src/ui/assets/instruments',info.kind+'.png'),bytes);
   if(errors.length)throw Error(errors.join('\n'));
   const result=await page.evaluate(async id=>{
    const {m,r,project,exr,check,delta,stats}=window.qa,p=project(id),layer=p.layers[0],checks=[];
    const original=await exr(p),s=stats(original,id);check(s.energy>.0001,id+' empty');if(layer.params.backgroundOpacity===1&&layer.kind!=='glitchtunnel')check(s.minAlpha===1,id+' opaque field coverage');
    if(!(layer.kind==='livingink'&&layer.params.inkMode===2))check(delta(original,await exr(p,.7+Math.PI*2))<.00003,id+' loop');await exr(p,4.7);check(delta(original,await exr(p))===0,id+' seek');
    // Echo blocks and streaks glitch every frame by design, even over a still source.
    const still=structuredClone(p);still.layers[0].params.motion=0;if(!(layer.kind==='glitchtunnel'||layer.params.echoBlock>0||layer.params.echoStreak>0))check(delta(await exr(still,.2),await exr(still,3.4))===0,id+' stopped motion');
    layer.params.backgroundOpacity=0;const cutout=stats(await exr(p),id+' overlay');if(layer.kind!=='glitchtunnel')check(cutout.minAlpha<1&&cutout.maxAlpha>0,id+' overlay alpha');checks.push({base:s,overlay:cutout});
    for(const strength of [.35,.65,1]){const q=structuredClone(p);q.layers[0]=m.varyLayer(layer,strength,{palette:false,structure:false,motion:false,material:false},strength*1e6);checks.push({variation:strength,...stats(await exr(q),id+' variation')});}
    for(const [w,h] of [[90,160],[120,120],[160,90]]){const q=structuredClone(p);q.layers[0].params.backgroundOpacity=1;q.layers[0].transform={x:.2,y:-.3,scale:.2,rotation:.8};q.layers[0].params.scale=8;const s=stats(await exr(q,.7,w,h),id+' scale');if(!(q.layers[0].kind==='glitchtunnel'||q.layers[0].params.echoWindow>0||q.layers[0].params.echoFrame>0))check(s.minAlpha===1,id+' transformed field boundary');checks.push({aspect:[w,h],...s});}
    return checks;
   },look.id);report.checks.push({look:look.id,checks:result});console.log('PASS '+look.id);
  }
  if(!process.argv.includes('--quick')){
   const result=await page.evaluate(async id=>{
    const {m,project,exr,check,delta,stats}=window.qa,p=project(id),results=[];
    for(const d of m.visibleParameterDefinitions(p.layers[0])){
     for(const edge of ['min','max']){const q=structuredClone(p);q.layers[0].params[d.key]=d[edge];results.push({key:d.key,edge,...stats(await exr(q,.7,96,54),id+' '+d.key+' '+edge)});}
     const a=structuredClone(p),b=structuredClone(p);
     for(const q of [a,b]){if(d.key==='warpScale')q.layers[0].params.warp=.65;if(d.key==='sheenAngle')q.layers[0].params.anisotropy=.8;if(d.key==='tonePivot')q.layers[0].params.toneContrast=1.5;if(['flowDirection','travel','eddyScale'].includes(d.key))q.layers[0].params.organic=.8;if(d.key==='surfaceHole'){q.layers[0].params.motion=1;q.layers[0].params.inkMode=2;}if(['simulationQuality','pigmentCarry','loopReturn','ageColour'].includes(d.key))q.layers[0].params.inkMode=2;
      // Controls that only act when their parent finish is on.
      if(d.key.startsWith('echo')&&d.key!=='echo')q.layers[0].params.echo=.8;
      if(['echoRound','echoSquare','echoEdge'].includes(d.key))q.layers[0].params.echoWindow=.5;
      if(d.key==='echoStreakAxis')q.layers[0].params.echoStreak=.6;
      if(d.key==='streakAxis')q.layers[0].params.streaks=.6;
      if(d.key.startsWith('slit')&&d.key!=='slitShift')q.layers[0].params.slitShift=1;
      if(d.key==='slitBlocks')q.layers[0].params.slitShape=4;
      if(d.key==='toonOutlineColor')q.layers[0].params.toonOutline=3;
      if(d.key.startsWith('toon')&&d.key!=='toonMix')q.layers[0].params.toonMix=1;
      if(d.key==='delayShape')q.layers[0].params.delaySpread=.6;
      if(d.key==='snap')q.layers[0].params.sequence=2;}
     a.layers[0].params[d.key]=d.min;b.layers[0].params[d.key]=['hue','rotation','lightAngle','flowDirection'].includes(d.key)?0:d.key==='sheenAngle'?.7:d.key==='facetTwist'?.31:['phaseOffset','toonOffset'].includes(d.key)?.37:d.max;
     // Evolving ink only reaches the central obstacle later in the clip.
     const at=['surfaceHole','ageColour'].includes(d.key)?5.5:d.key==='snap'?1.78:.7;const difference=delta(await exr(a,at,96,54),await exr(b,at,96,54));check(difference>.0000001,id+' inactive control '+d.key);results.push({control:d.key,difference});
    }return results;
   },info.looks[0].id);report.checks.push({controls:info.kind,checks:result});console.log('Controls '+info.kind);
  }
 }
 // Reused optical controls must be active, loop-safe, alpha-safe and reversible.
 const optics=await page.evaluate(async()=>{
  const {m,exr,check,delta,stats}=window.qa,results=[];
  for(const kind of ['surface','oil'])for(const preset of m.PRESETS.filter(p=>p.kind===kind)){
   const p={...m.createProject(),transparent:true,layers:[m.applyPreset(m.createLayer(kind),preset.id)]};
   const baseline=await exr(p);
   for(const key of kind==='oil'?['caustics','iridescence']:['iridescence']){
    p.layers[0].params[key]=.8;const a=await exr(p),difference=delta(baseline,a);
    check(difference>.0000001,preset.id+' inactive '+key);stats(a,preset.id+' '+key);
    check(delta(a,await exr(p,.7+Math.PI*2))<.00003,preset.id+' optical loop');
    p.layers[0].params[key]=0;check(delta(baseline,await exr(p))===0,preset.id+' optical reset');
    results.push({preset:preset.id,control:key,difference});
   }
  }
  return results;
 });report.checks.push({opticalReuse:optics});console.log('Existing Surface and Oil optical controls passed');
 const resources=await page.evaluate(async()=>{
  const {m,r,project,exr,check,delta}=window.qa,p=project('ivory-coral');
  const a=await exr(p);const counts=[];
  for(let i=0;i<9;i++){const q=structuredClone(p);q.layers[0].params.seed+=i+1;await exr(q);counts.push(r.getStats().textures);}
  check(Math.max(...counts.slice(4))-Math.min(...counts.slice(4))===0,'Chemical texture cache grows after its four-entry limit');
  check(delta(a,await exr(p))===0,'Evicted chemical pattern does not reproduce');
  await exr(project('salt-mandala'));const released=r.getStats().textures;
  check(released<counts.at(-1),'Unused chemical textures were not released');
  // Equal mode choices must remain a usable figure, even with zero modal blend.
  for(const [modeA,modeB,blend] of [[5,5,0],[6,5,1]]){
   const sand=project('salt-mandala');Object.assign(sand.layers[0].params,{modeA,modeB,modalBlend:blend,motion:0});
   const pixels=await exr(sand);let lo=Infinity,hi=-Infinity;for(let i=0;i<pixels.length;i+=4){lo=Math.min(lo,pixels[i]);hi=Math.max(hi,pixels[i]);}check(hi-lo>.01,'Coincident sand modes collapse to a uniform field');
  }
  return {textures:counts,afterRelease:released,evictionReproducible:true,equalModesVisible:true};
 });report.checks.push({resources});console.log('Preparation cache and coincident modal choices passed');
 if(process.argv.includes('--production'))for(const info of instruments){
  const result=await page.evaluate(async({id,extended})=>{
   const {r,project}=window.qa,p=project(id);if(extended)Object.assign(p.layers[0].params,{backgroundOpacity:0,toneContrast:1.15,toneGamma:1.08,vibrance:.18});
   const measure=async(w,h)=>{
    await r.prepare(p);const fence=()=>r.renderer.readRenderTargetPixelsAsync(r.linearOutput,0,0,1,1,new Uint16Array(4));
    r.render(p,.7,w,h);await fence();const samples=[];
    for(let i=0;i<5;i++){const t=performance.now();r.render(p,.7+i*.07,w,h);await fence();samples.push(performance.now()-t);}
    samples.sort((a,b)=>a-b);return {width:w,height:h,medianMilliseconds:samples[2],samples,includes:"CPU submission, completed GPU work and one-pixel async readback"};
   };
   const hd=await measure(1920,1080),uhd=await measure(3840,2160),bytes=await r.exportPNG(p,.7,3840,2160);
   const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   let minAlpha=255,maxAlpha=0,low=255,high=0;for(let i=0;i<rgba.length;i+=4){minAlpha=Math.min(minAlpha,rgba[i+3]);maxAlpha=Math.max(maxAlpha,rgba[i+3]);low=Math.min(low,rgba[i]);high=Math.max(high,rgba[i]);}
   const coverage={width:canvas.width,height:canvas.height,minAlpha,maxAlpha,redRange:high-low};canvas.width=1;canvas.height=1;
   if(coverage.width!==3840||coverage.height!==2160||coverage.redRange===0||extended&&minAlpha>=maxAlpha)throw Error(id+' invalid 4K output '+JSON.stringify(coverage));
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {look:id,hd,uhd,coverage,png:btoa(binary)};
  },{id:process.argv.includes('--explorations')?info.looks.at(-1).id:info.looks[0].id,extended:process.argv.includes('--explorations')});
  await fs.writeFile(path.join(out,info.kind+(process.argv.includes('--explorations')?'-exploration':'')+'-4k.png'),Buffer.from(result.png,'base64'));delete result.png;report.checks.push({production:info.kind,...result});console.log('Production '+info.kind+' '+JSON.stringify(result));
 }
 const mixes=await page.evaluate(async()=>{
  const {m,exr,check,delta,stats}=window.qa,results=[];
  for(const kinds of [['livingink','relief','resonance'],['oil','surface','sculpture','fractal']]){
   const p={...m.createProject(),transparent:true,layers:kinds.map((kind,i)=>{
    const l=m.createLayer(kind);if('backgroundOpacity' in l.params)l.params.backgroundOpacity=0;
    l.opacity=.65;l.blend=['normal','screen','add','normal'][i];
    if(i===3)l.mask={kind:'circle',softness:.12,invert:false,size:.7};
    l.modulations.exposure={kind:'sine',cycles:3,amount:.12,phase:.3,points:[]};return l;
   })};
   const a=await exr(p),s=stats(a,kinds.join('+'));
   check(delta(a,await exr(p,.7+Math.PI*2))<.00003,'Mixed routed loop');
   for(let i=0;i<kinds.length;i++){const q=structuredClone(p);q.layers[i].visible=false;check(delta(a,await exr(q))>.000001,'Mixed layer disappeared: '+kinds[i]);}
   results.push({kinds,...s});
  }return results;
 });report.checks.push({mixedLayers:mixes});console.log('Mixed instruments, masks, blending and animated routes passed');
 const contact=await page.evaluate(async infos=>{const c=document.createElement('canvas');c.width=Math.max(...infos.map(info=>info.looks.length))*400;c.height=infos.length*248;const ctx=c.getContext('2d');ctx.fillStyle='#131318';ctx.fillRect(0,0,c.width,c.height);for(let row=0;row<infos.length;row++)for(let j=0;j<infos[row].looks.length;j++){const look=infos[row].looks[j],im=new Image();im.src=look.id+'.png';await im.decode();ctx.drawImage(im,j*400,row*248,400,225);ctx.fillStyle='#e5e5e5';ctx.font='14px sans-serif';ctx.fillText(look.name,j*400+8,row*248+242);}return c.toDataURL().split(',')[1];},instruments);
 await fs.writeFile(path.join(out,'contact.png'),Buffer.from(contact,'base64'));
 assert.deepEqual(errors,[]);report.status='passed';await fs.writeFile(path.join(out,'gpu-report.json'),JSON.stringify(report,null,2));console.log('All projection instruments passed');
}finally{await page.evaluate(()=>window.qa?.r.dispose()).catch(()=>{});await app.close();}
