import {StudioRenderer,createProject,createLayer,applyPreset,PRESETS,phaseAtFrame} from './renderer.js';
async function run(){
  const config=await window.fractalProof.config(), renderer=new StudioRenderer(document.querySelector('canvas'));
  function projectFor(id){
    const p=createProject();p.id=id+'-v5-proof';p.name=id+' v5';p.seed=1729;p.duration=config.frameCount*config.fps.den/config.fps.num;
    p.transparent=true;p.background='#070912';p.layers=[applyPreset(createLayer('fractal'),id)];p.layers[0].id=id+'-v5-layer';p.layers[0].params.seed=1729;return p;
  }
  try{
    for(const preset of PRESETS.filter(p=>p.kind==='fractal')){
      const p=projectFor(preset.id);await renderer.prepare(p);
      await window.fractalProof.still(preset.id+'-v5.formfield',new TextEncoder().encode(JSON.stringify(p,null,2)));
      await window.fractalProof.still(preset.id+'-v5-4K.png',await renderer.exportPNG(p,.7,config.width,config.height));
    }
    const project=projectFor(config.preset);await renderer.prepare(project);
    const zero=await renderer.exportEXR(project,0,config.width,config.height);
    await window.fractalProof.phase(config.preset+':zero',zero);
    await window.fractalProof.phase(config.preset+':full-cycle',await renderer.exportEXR(project,Math.PI*2,config.width,config.height));
    await renderer.exportEXR(project,1.731,config.width,config.height);
    await window.fractalProof.phase(config.preset+':zero-after-seek',await renderer.exportEXR(project,0,config.width,config.height));
    const job=await window.fractalProof.start({project,format:'prores4444',width:config.width,height:config.height,fps:config.fps,frameCount:config.frameCount,transparent:true,background:project.background});
    const completed=new Set(job.completedFrames),timings=[];
    if(!completed.has(0))await window.fractalProof.frame(job.id,0,zero);
    for(let i=1;i<config.frameCount;i++){
      if(completed.has(i))continue;
      const start=performance.now(),bytes=await renderer.exportEXR(job.request.project,phaseAtFrame(i,config.frameCount),config.width,config.height);
      timings.push(performance.now()-start);await window.fractalProof.frame(job.id,i,bytes);
    }
    const sorted=[...timings].sort((a,b)=>a-b);
    await window.fractalProof.finish(job.id,{renderMilliseconds:{measuredFrames:timings.length,mean:timings.reduce((a,b)=>a+b,0)/Math.max(timings.length,1),median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],includes:'render, readback and EXR ZIP compression'},stats:renderer.getStats()});
  }finally{renderer.dispose();}
}
run().catch(error=>window.fractalProof.fail(error.stack||String(error)));
