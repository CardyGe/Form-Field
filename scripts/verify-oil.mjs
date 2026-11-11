// Real Electron/WebGL checks for the Oil Slides instrument. --quick captures art only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/oil-build', process.argv.includes('--quick') ? 'art' : 'verification');
await fs.mkdir(out, { recursive: true });
await build({ stdin: { contents: `export {StudioRenderer} from './src/rendering/StudioRenderer';
export {createProject,createLayer,applyPreset,PRESETS,validateProject,parameterDefinitions,varyLayer} from './src/core/project';
export {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
export {FloatType} from 'three';`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(out, 'renderer.js'), logLevel: 'silent' });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas width="960" height="540"></canvas>');
await fs.writeFile(path.join(out, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(out, 'user-data'))});app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(path.join(out, 'index.html'))});});`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(out, 'main.cjs')], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = { captures: [], checks: [], timings: [], errors };
try {
  await page.evaluate(async () => {
    const m = await import('./renderer.js');
    const renderer = new m.StudioRenderer(document.querySelector('canvas'));
    const loader = new m.EXRLoader().setDataType(m.FloatType);
    const projectFor = id => { const p=m.createProject();p.layers=[m.applyPreset(m.createLayer('oil'),id)];p.layers[0].id='oil-proof';p.transparent=true;return p; };
    const exr = async (p, phase, w=320, h=180) => {const b=await renderer.exportEXR(p,phase,w,h);return loader.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).data;};
    const delta = (a,b) => a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
    const check = (value,message) => {if(!value)throw new Error(message);};
    window.oilQA={m,renderer,loader,projectFor,exr,delta,check};
  });
  const presetIds = await page.evaluate(() => window.oilQA.m.PRESETS.filter(p => p.kind === 'oil').map(p => p.id));
  for (const id of presetIds) {
    for (const phase of [0, 1.6]) {
      const name = `${id}-${phase ? 'p25' : 'p0'}.png`;
      const bytes = await page.evaluate(async ({id,phase}) => {
        const q=window.oilQA;return Array.from(await q.renderer.exportPNG(q.projectFor(id),phase,960,540));
      }, {id,phase});
      await fs.writeFile(path.join(out,name),Buffer.from(bytes));report.captures.push(name);
    }
    console.log('Captured '+id);
  }
  if (!process.argv.includes('--quick')) {
    const checks = await page.evaluate(async () => {
      const {m,renderer,projectFor,exr,delta,check}=window.oilQA, results=[];
      const stats=data=>{
        let nonFinite=0,invalidAlpha=0,zero=0,soft=0,one=0,transparentRGB=0;
        for(let i=0;i<data.length;i++){if(!Number.isFinite(data[i]))nonFinite++;if(i%4===3){const a=data[i];if(a<0||a>1)invalidAlpha++;if(a===0){zero++;if(data[i-1]||data[i-2]||data[i-3])transparentRGB++;}else if(a===1)one++;else soft++;}}
        return {nonFinite,invalidAlpha,zero,soft,one,transparentRGB};
      };
      for(const id of m.PRESETS.filter(p=>p.kind==='oil').map(p=>p.id)){
        const p=projectFor(id), a=await exr(p,.7);
        check(delta(a,await exr(p,.7+Math.PI*2))<.00001,id+' phase wrap');
        await exr(p,3.17);check(delta(a,await exr(p,.7))===0,id+' seek history');
        const s=stats(a);check(!s.nonFinite&&!s.invalidAlpha&&s.one===320*180,id+' opaque EXR');
        const step=Math.PI*2/300,z=await exr(p,0),before=await exr(p,-step),after=await exr(p,step);
        const seam=delta(before,z),next=delta(z,after);check(seam<next*4+.005,id+' seam anomaly');
        p.layers[0].params.substrate=0;
        const cutout=stats(await exr(p,.7));check(!cutout.nonFinite&&!cutout.invalidAlpha&&!cutout.transparentRGB&&cutout.zero&&cutout.soft,id+' cutout');
        p.layers[0].opacity=.37;p.layers[0].mask={kind:'circle',size:.65,softness:.3,invert:false};
        const masked=stats(await exr(p,.7));check(masked.zero&&masked.soft&&!masked.transparentRGB,id+' mask/opacity');
        m.validateProject(JSON.parse(JSON.stringify(p)));
        results.push({id,repeatable:true,seam,next,opaque:s,cutout,masked});
      }
      const p=projectFor('acid-slide');
      Object.assign(p.layers[0].params,{travel:0,relativeRotation:0,lift:0});
      check(delta(await exr(p,0),await exr(p,2.3))===0,'zero motion must stop intrinsic animation');
      for(const values of [
        {lensSize:.06,lensAspect:.6,coverage:0,thickness:0,refraction:0,wetness:0,ink:0},
        {lensSize:.34,lensAspect:1.8,coverage:1,thickness:1,refraction:1,wetness:1,ink:1,drag:1,travel:.8,relativeRotation:1.2,cellSize:.25,lift:1,quality:2},
      ]){Object.assign(p.layers[0].params,values);const s=stats(await exr(p,1.3));check(!s.nonFinite&&!s.invalidAlpha,'extreme parameters');}
      for(const quality of [0,1,2]){p.layers[0].params.quality=quality;for(const [w,h] of [[240,426],[320,320],[640,360]]){const s=stats(await exr(p,.8,w,h));check(!s.nonFinite&&!s.invalidAlpha,'quality/aspect');}}
      const controls=projectFor('acid-slide'), reference=await exr(controls,.7);
      const opticalControls=[];
      for(const key of ['deformation','lensDepth','cellComplexity','dispersion']){
        const varied=structuredClone(controls);varied.layers[0].params[key]=1;
        const difference=delta(reference,await exr(varied,.7));
        check(difference>.00001,key+' must visibly affect the material');opticalControls.push({key,meanLinearDifference:difference});
      }
      results.push({opticalControls});
      const animated=projectFor('acid-slide');animated.layers[0].modulations.travel={kind:'noise',cycles:2,phase:.2,amount:.4,points:[]};
      check(delta(await exr(animated,.4),await exr(animated,.4+Math.PI*2))<.00001,'modulated wake wrap');
      const base=await exr(projectFor('acid-slide'),.7);
      const mixed=projectFor('acid-slide');mixed.layers.push(m.applyPreset(m.createLayer('oil'),'chromatic-slides'));mixed.layers[1].opacity=.4;mixed.layers[1].blend='screen';
      check(delta(base,await exr(mixed,.7))>.001,'second Oil layer must affect composition');
      await exr(mixed,1.4);check(delta(base,await exr(projectFor('acid-slide'),.7))===0,'scratch target contamination');
      const repeated=renderer.getStats();
      await renderer.prepare(m.createProject());await exr(m.createProject(),0);
      results.push({zeroMotion:true,extremes:true,aspects:true,modulatedWake:true,multipleLayers:true,texturesBeforeRelease:repeated.textures,texturesAfterRelease:renderer.getStats().textures});
      return results;
    });report.checks.push(...checks);
    for(const [w,h] of [[1920,1080],[3840,2160]]){
      const result=await page.evaluate(async ({w,h})=>{
        const q=window.oilQA,p=q.projectFor('acid-slide'), gl=q.renderer.renderer.getContext();
        // WebGL gl.finish can return before Chromium's GPU process completes.
        // Await a one-pixel asynchronous readback fence for each measured frame.
        const fence=()=>q.renderer.renderer.readRenderTargetPixelsAsync(q.renderer.linearOutput,0,0,1,1,new Uint16Array(4));
        for(let i=0;i<5;i++){q.renderer.render(p,i*.1,w,h);await fence();}
        const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const t=[],gpu=[];
        for(let i=0;i<30;i++){
          const query=ext?gl.createQuery():null;
          const s=performance.now();if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
          q.renderer.render(p,i*.07,w,h);if(query)gl.endQuery(ext.TIME_ELAPSED_EXT);
          await fence();t.push(performance.now()-s);
          if(query){if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);}
        }
        t.sort((a,b)=>a-b);gpu.sort((a,b)=>a-b);
        return {width:w,height:h,median:t[15],p95:t[28],gpuMedian:gpu.length?gpu[Math.floor(gpu.length/2)]:null,gpuSamples:gpu.length,gpuP95:gpu.length?gpu[Math.floor(gpu.length*.95)]:null,includes:'CPU submission + completed GPU work + async one-pixel readback fence; conservative frame latency',stats:q.renderer.getStats()};
      },{w,h});report.timings.push(result);console.log('Timing '+JSON.stringify(result));
    }
    const full=await page.evaluate(async()=>{const q=window.oilQA;const p=q.projectFor('acid-slide');const s=performance.now();const data=await q.exr(p,.7,3840,2160);return {width:3840,height:2160,nonFinite:data.some(v=>!Number.isFinite(v)),milliseconds:performance.now()-s};});
    assert.equal(full.nonFinite,false);report.checks.push({fullResolutionEXR:full});
    const still=await page.evaluate(async()=>{const q=window.oilQA;return Array.from(await q.renderer.exportPNG(q.projectFor('acid-slide'),.7,3840,2160));});
    await fs.writeFile(path.join(out,'acid-slide-4k.png'),Buffer.from(still));
    for(const [name,patch] of [['cutout',{substrate:0}],['lifted',{lift:1}]]){
      const bytes=await page.evaluate(async ({patch})=>{const q=window.oilQA,p=q.projectFor('acid-slide');Object.assign(p.layers[0].params,patch);return Array.from(await q.renderer.exportPNG(p,2.37,960,540));},{patch});
      await fs.writeFile(path.join(out,name+'.png'),Buffer.from(bytes));
    }
    await fs.writeFile(path.join(out,'acid-slide.formfield'),JSON.stringify(await page.evaluate(()=>window.oilQA.projectFor('acid-slide')),null,2));
  }
  assert.deepEqual(errors,[],'GPU/renderer errors');
  report.status=process.argv.includes('--quick')?'captured':'passed';
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await page.evaluate(()=>window.oilQA?.renderer.dispose()).catch(()=>{});await app.close();}
