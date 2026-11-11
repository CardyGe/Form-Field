// Actual Electron/WebGL integration checks, reference captures and native export proof.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'work/graphics-build/verification');await fs.mkdir(out,{recursive:true});
await build({stdin:{contents:`export {StudioRenderer} from './src/rendering/StudioRenderer';export {createProject,createLayer,applyPreset,PRESETS,validateProject,visibleParameterDefinitions} from './src/core/project';export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';export {FloatType} from 'three';`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:path.join(out,'renderer.js'),logLevel:'silent'});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'user-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(out,'main.cjs')],env}),page=await app.firstWindow(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
const report={captures:[],checks:[],errors};
try{
  await page.evaluate(async()=>{
    const m=await import('./renderer.js'),r=new m.StudioRenderer(document.querySelector('canvas')),loader=new m.EXRLoader().setDataType(m.FloatType);
    const project=id=>({...m.createProject(),transparent:true,layers:[m.applyPreset(m.createLayer('graphic'),id)]});
    const exr=async(p,t,w=256,h=144)=>{const b=await r.exportEXR(p,t,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
    const delta=(a,b)=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length;
    window.graphicsQA={m,r,loader,project,exr,delta};
  });
  const ids=await page.evaluate(()=>window.graphicsQA.m.PRESETS.filter(p=>p.kind==='graphic').map(p=>p.id));
  if(!process.argv.includes('--checks-only')) for(const id of ids){
    const png=await page.evaluate(async id=>{const q=window.graphicsQA;return Array.from(await q.r.exportPNG(q.project(id),1.3,960,540));},id);
    await fs.writeFile(path.join(out,id+'.png'),Buffer.from(png));report.captures.push(id+'.png');console.log('Captured '+id);
  }
  if(!process.argv.includes('--quick')){
    for(const id of ids){
      const result=await page.evaluate(async id=>{
        const {m,r,project,exr,delta}=window.graphicsQA,p=project(id),check=(v,msg)=>{if(!v)throw Error(id+': '+msg);};
        const stats=a=>{let min=1,max=0,nonFinite=0,transparentRGB=0;for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i]))nonFinite++;if(i%4===3){min=Math.min(min,a[i]);max=Math.max(max,a[i]);if(a[i]===0&&(a[i-1]||a[i-2]||a[i-3]))transparentRGB++;}}return {min,max,nonFinite,transparentRGB};};
        const a=await exr(p,.7);check(stats(a).nonFinite===0,'finite render');
        check(stats(a).min===1&&stats(a).max===1,'opaque pattern background');
        check(delta(a,await exr(p,.7+Math.PI*2))<.00001,'phase wrap');
        await exr(p,3.9);check(delta(a,await exr(p,.7))===0,'seek history');
        const variation=delta(a,await exr(p,2.2));check((p.layers[0].params.style===2&&p.layers[0].params.sweep===0)||variation>.00005,'visible intrinsic motion');
        p.layers[0].params.motion=0;p.layers[0].params.turns=0;check(delta(await exr(p,0),await exr(p,2))===0,'zero motion');
        p.layers[0].params.backgroundOpacity=0;p.layers[0].params.size=.35;const alpha=stats(await exr(p,.7));
        // Small patterns now continue across the viewport. A filled motif can
        // cover its entire cell even with no background. Empty rectangular
        // borders are no longer a valid transparency assertion; the explicit
        // mask below must still produce genuine zero and fractional alpha.
        check(alpha.min>=0&&alpha.max>0&&alpha.max<=1&&!alpha.transparentRGB&&!alpha.nonFinite,'pattern alpha '+JSON.stringify(alpha));
        p.layers[0].opacity=.4;p.layers[0].mask={kind:'circle',size:.6,softness:.2,invert:false};const masked=stats(await exr(p,.7));check(masked.min===0&&masked.max<=.401,'mask + opacity');
        m.validateProject(JSON.parse(JSON.stringify(p)));
        return {id,variation,alpha,masked};
      },id);report.checks.push(result);console.log('Verified '+id);
    }
    const params=await page.evaluate(async()=>{
      const {project,exr,delta}=window.graphicsQA,results=[];
      for(const [id,key,value] of [['pillar-wave','amplitude',.05],['orbital-bloom','orbit',.1],['neon-frames','stroke',6],['nested-tiles','contourSpacing',12],['tile-ripple','sweepWidth',.5],['beaded-spiral','angularStep',1.2],['web-rosette','glyphSize',.6],['line-interference','profileAngle',.7],['particle-rays','twistDepth',.03],['circuit-worms','pathWidth',.8],['circuit-channels','direction',1.57],['maze-carpet','hollow',.2],['radial-circuit','ringWidth',.06]]){
        const p=project(id),a=await exr(p,1.3);p.layers[0].params[key]=value;const difference=delta(a,await exr(p,1.3));if(difference<.00005)throw Error('Inactive control '+id+' '+key);results.push({id,key,difference});
      }
      const rotating=project('circle-fans');rotating.layers[0].params.motion=0;
      const stillDepth=await exr(rotating,1.3);rotating.layers[0].params.motion=.000001;
      const depthLimit=delta(stillDepth,await exr(rotating,1.3));
      if(depthLimit>.0002)throw Error('motion-depth zero must not reset independent whole turns');
      results.push({independentRotation:true,depthLimit});
      for(const id of ['pillar-wave','orbital-bloom','nested-tiles','disc-mandala','maze-carpet']){
        for(const [w,h] of [[144,256],[192,192]]){const a=await exr(project(id),1.3,w,h);if(a.some(v=>!Number.isFinite(v)))throw Error(id+' aspect');}
      }
      return results;
    });report.checks.push({controls:params});
    // Pass real graphic EXRs through the native movie export manager.
    const require=createRequire(import.meta.url),{ExportManager,resolveMediaTools}=require(path.join(root,'electron/export-manager.cjs'));
    const manager=new ExportManager({...resolveMediaTools(),jobsDirectory:path.join(out,'jobs'),defaultExportDir:path.join(out,'exports'),rendererFingerprint:'graphics-proof-v1'});
    const project=await page.evaluate(()=>window.graphicsQA.project('tile-ripple'));
    const job=await manager.beginExport({project,format:'prores4444',width:320,height:180,fps:{num:24,den:1},frameCount:12,transparent:true,background:'#000000'});
    for(let i=0;i<12;i++){
      const bytes=await page.evaluate(async({i,project})=>Array.from(await window.graphicsQA.r.exportEXR(project,i/12*Math.PI*2,320,180)),{i,project});
      await manager.writeFrame(job.id,i,Buffer.from(bytes));
    }
    const movie=await manager.finishExport(job.id);assert.equal(movie.status,'complete');report.checks.push({nativeMovie:movie.outputPath});
    const bytes=await page.evaluate(async()=>{const q=window.graphicsQA;return Array.from(await q.r.exportPNG(q.project('nested-tiles'),1.3,3840,2160));});
    await fs.writeFile(path.join(out,'nested-tiles-4k.png'),Buffer.from(bytes));report.checks.push({native4kStill:true});
  }
  assert.deepEqual(errors,[],'No WebGL or renderer errors');report.status='passed';
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}finally{await page.evaluate(()=>window.graphicsQA?.r.dispose()).catch(()=>{});await app.close();}
