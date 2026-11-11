import { StudioRenderer, createProject, createLayer, applyPreset, EXRLoader, FloatType } from './renderer.js';
const TAU = Math.PI * 2;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
const loader = new EXRLoader().setDataType(FloatType);
function pixels(bytes) { return loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).data; }
function finite(data) {
  let invalid = 0, alphaInvalid = 0;
  for (let i=0;i<data.length;i++) { if (!Number.isFinite(data[i])) invalid++; if (i%4===3 && (data[i]<0 || data[i]>1)) alphaInvalid++; }
  return { invalid, alphaInvalid };
}
async function sheet(name, captures) {
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 656;
  const ctx = canvas.getContext('2d'); ctx.fillStyle='#100d1c';ctx.fillRect(0,0,2048,656);
  for (let i=0;i<captures.length;i++) {
    const bitmap = await createImageBitmap(new Blob([captures[i].bytes], {type:'image/png'}));
    const x = i%4*512, y = Math.floor(i/4)*328;ctx.drawImage(bitmap,x,y,512,288);bitmap.close();
    ctx.fillStyle='#eee8f7';ctx.font='14px sans-serif';ctx.fillText(captures[i].name,x+10,y+312);
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  await window.study.write(name,new Uint8Array(await blob.arrayBuffer()));
}
async function run() {
  const renderer = new StudioRenderer(document.querySelector('#canvas'));
  const report = { checkedCorners: [], zeroBreathStatic: false, normalViews: 0, createdAt: new Date().toISOString() };
  const captures = [], normals = [], projects = [];
  try {
    for (const roughness of [.02,1]) for (const opening of [0,1]) for (const twist of [-1,1]) {
      const project=createProject();project.transparent=true;
      project.layers=[applyPreset(createLayer('sculpture'),'pearl-organism')];
      project.layers[0].id='edge-study';Object.assign(project.layers[0].params,{seed:1729,fold:1,ridges:1,opening,twist,roughness,breath:1});
      const title=`opening ${opening} · twist ${twist} · rough ${roughness}`;
      await renderer.prepare(project);
      const zero=await renderer.exportPNG(project,0,512,288), wrapped=await renderer.exportPNG(project,TAU,512,288);
      assert(same(zero,wrapped), title+': endpoint mismatch');
      let nonFinite=0, alphaInvalid=0;
      for (const phase of [0,TAU*.25,TAU*.5,TAU*.75]) {
        const stats=finite(pixels(await renderer.exportEXR(project,phase,320,180)));
        nonFinite+=stats.invalid;alphaInvalid+=stats.alphaInvalid;
      }
      assert(!nonFinite&&!alphaInvalid,title+': invalid EXR values');
      const opaque={...project,transparent:false};
      captures.push({name:title,bytes:await renderer.exportPNG(opaque,.7,512,288)});projects.push(opaque);
      report.checkedCorners.push({opening,twist,roughness,fold:1,ridges:1,breath:1,exactPhaseWrap:true,finitePhases:4,nonFinite,alphaInvalid});
    }
    const staticProject=structuredClone(projects[0]);staticProject.layers[0].params.breath=0;
    const first=await renderer.exportPNG(staticProject,0,512,288);
    for (const phase of [1.73,Math.PI,TAU]) assert(same(first,await renderer.exportPNG(staticProject,phase,512,288)),'breath0 changed frame');
    report.zeroBreathStatic=true;
    await sheet('extreme-materials.png',captures);
    const material=renderer.sculptureMaterial, original=material.onBeforeCompile, key=material.customProgramCacheKey();
    material.onBeforeCompile=function(shader,...rest){original.call(this,shader,...rest);shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor=vec4(normalize(normal)*.5+.5,diffuseColor.a);');};
    material.customProgramCacheKey=()=>key+'-edge-normal';material.needsUpdate=true;
    for(let i=0;i<projects.length;i++) {
      const bytes=await renderer.exportPNG(projects[i],.7,512,288);
      normals.push({name:captures[i].name,bytes});
      const stats=finite(pixels(await renderer.exportEXR(projects[i],.7,320,180)));
      assert(!stats.invalid,'nonfinite extreme shading normal');report.normalViews++;
    }
    await sheet('extreme-normals.png',normals);
    await window.study.done(report);
  } finally {renderer.dispose();}
}
run().catch(error=>window.study.fail(error.stack||String(error)));
