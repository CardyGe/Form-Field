import {StudioRenderer,createProject,createLayer,applyPreset,PRESETS} from './renderer.js';
async function run(){
  const config=await window.instrumentProof.config(), renderer=new StudioRenderer(document.querySelector('canvas'));
  function projectFor(id){
    const p=createProject();p.id=id+'-v6-proof';p.name=id+' v6';p.seed=1729;p.duration=config.frameCount*config.fps.den/config.fps.num;
    p.transparent=true;p.background='#070912';const preset=PRESETS.find(item=>item.id===id);if(!preset)throw new Error('Unknown proof preset '+id);p.layers=[applyPreset(createLayer(preset.kind),id)];p.layers[0].id=id+'-v6-layer';p.layers[0].params.seed=1729;return p;
  }
  try{
    const project=projectFor(config.preset);await renderer.prepare(project);
    await window.instrumentProof.still(config.preset+'-v6.formfield',new TextEncoder().encode(JSON.stringify(project,null,2)));
    await window.instrumentProof.still(config.preset+'-v6-4K.png',await renderer.exportPNG(project,.7,config.width,config.height));
    const zero=await renderer.exportEXR(project,0,config.width,config.height);
    await window.instrumentProof.phase(config.preset+':zero',zero);
    await window.instrumentProof.phase(config.preset+':full-cycle',await renderer.exportEXR(project,Math.PI*2,config.width,config.height));
    await renderer.exportEXR(project,1.731,config.width,config.height);
    await window.instrumentProof.phase(config.preset+':zero-after-seek',await renderer.exportEXR(project,0,config.width,config.height));
    const job=await window.instrumentProof.start({project,format:'prores4444',width:config.width,height:config.height,fps:config.fps,frameCount:config.frameCount,transparent:true,background:project.background});
    const completed=new Set(job.completedFrames),timings=[];
    if(!completed.has(0))await window.instrumentProof.frame(job.id,0,zero);
    for(let i=1;i<config.frameCount;i++){
      if(completed.has(i))continue;
      const start=performance.now(),bytes=await renderer.exportEXR(job.request.project,Math.PI*2*i/config.frameCount,config.width,config.height);
      timings.push(performance.now()-start);await window.instrumentProof.frame(job.id,i,bytes);
    }
    const sorted=[...timings].sort((a,b)=>a-b);
    await window.instrumentProof.finish(job.id,{kind:project.layers[0].kind,style:project.layers[0].params.style,renderMilliseconds:{measuredFrames:timings.length,mean:timings.reduce((a,b)=>a+b,0)/Math.max(timings.length,1),median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],includes:'render, readback and EXR ZIP compression'},stats:renderer.getStats()});
  }finally{renderer.dispose();}
}
run().catch(error=>window.instrumentProof.fail(error.stack||String(error)));
