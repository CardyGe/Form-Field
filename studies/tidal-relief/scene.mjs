import * as T from 'three';
import {pinball} from './pinball.mjs';

// A fixed-camera lighting study. Each blade has a closed section with two
// chamfers, a brushed face and a contrasting enamel return.
export function createStudy(canvas, width, height, {arcade = false} = {}) {
  const renderer = new T.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
  renderer.setSize(width,height,false);
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.08;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene();
  scene.background=new T.Color(0x0d1019);
  const camera=new T.PerspectiveCamera(26, width/height,.1,50);
  camera.position.set(.04,.06,10);
  camera.lookAt(0,0,0);

  // Softboxes have a shape in the reflection even when their direct light is
  // out of frame. Bake their linear intensities once.
  const studio=new T.Scene();
  studio.background=new T.Color(.055,.057,.07);
  function softbox(x,y,z,w,h,r,g,b) {
    const card=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:new T.Color(r,g,b),side:T.DoubleSide}));
    card.position.set(x,y,z);card.lookAt(0,0,0);studio.add(card);
  }
  softbox(-4,2,3,2.2,7,4,5.8,8);
  softbox(3,4,2,6,.8,7,5.4,4.3);
  softbox(3,-2,2,1.4,6,5.2,2.3,1.4);
  softbox(-.8,-3,3,2.6,.6,1.7,2.8,4.2);
  const pmrem=new T.PMREMGenerator(renderer);
  const reflection=pmrem.fromScene(studio,.018);
  scene.environment=reflection.texture;
  pmrem.dispose();
  studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});

  const key=new T.DirectionalLight(0xffe2cc,2.75);
  key.position.set(-3.5,4.8,4.5);
  key.castShadow=true;
  Object.assign(key.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:20});
  key.shadow.mapSize.set(2048,2048);key.shadow.normalBias=.006;key.shadow.bias=-.00015;
  scene.add(key,new T.HemisphereLight(0xc7deff,0x44313b,.48));
  const bed=new T.Mesh(new T.PlaneGeometry(16,12),new T.MeshStandardMaterial({color:0x191d28,roughness:.87}));
  bed.position.z=-.27;bed.receiveShadow=true;scene.add(bed);

  const metal=(color,roughness,metalness)=>new T.MeshPhysicalMaterial({color,roughness,metalness,clearcoat:.28,clearcoatRoughness:.23});
  const materials=[metal(0x668ca0,.27,.84),metal(0xc9d9d5,.23,.91),metal(0xa83821,.34,.58),metal(0x343744,.48,.65)];
  // Vary roughness along the machining direction. Filter the fine grooves
  // once they approach pixel size so the moving highlight doesn't sparkle.
  materials[0].onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vMetalUv;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>', '#include <uv_vertex>\nvMetalUv = uv;');
    shader.fragmentShader = 'varying vec2 vMetalUv;\n' + shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float line = vMetalUv.x * 57.0 + 0.4*sin(vMetalUv.y*18.0);
        float fine = sin(line*6.28318) * (1.0-smoothstep(.16,.48,fwidth(line)));
        float broad = sin(vMetalUv.x*16.0 + 1.1*sin(vMetalUv.y*6.0));
        roughnessFactor += .028*broad + .045*fine;`);
  };
  // Each pair bounds a longitudinal strip. Duplicate vertices across adjacent
  // strips for crisp edges, and smooth the normal along each curved blade.
  const section=[[-.46,.07],[.46,.07],[.50,.045],[.50,-.09],[.46,-.11],[-.46,-.11],[-.50,-.09],[-.50,.045]];
  const sides=section.length,segments=72,count=40,pitch=.216;
  const geometry=new T.BufferGeometry();
  const vertsPerStrip=(segments+1)*2;
  const positions=new T.Float32BufferAttribute(count*sides*vertsPerStrip*3,3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position',positions);
  const uv = new T.Float32BufferAttribute(count*sides*vertsPerStrip*2,2);
  for(let j=0;j<count*sides;j++)for(let k=0;k<=segments;k++){
    const index=j*vertsPerStrip+2*k;
    uv.setXY(index,0,k/segments);uv.setXY(index+1,1,k/segments);
  }
  geometry.setAttribute('uv',uv);
  const indices=[];
  const byMat=[0,1,2,2,3,3,2,1];
  for(let mat=0;mat<materials.length;mat++){
    const start=indices.length;
    for(let j=0;j<count;j++)for(let side=0;side<sides;side++){
      if(byMat[side]!==mat)continue;
      const base=(j*sides+side)*vertsPerStrip;
      for(let k=0;k<segments;k++){const i=base+2*k;indices.push(i,i+1,i+2,i+1,i+3,i+2);}
    }
    geometry.addGroup(start,indices.length-start,mat);
  }
  geometry.setIndex(indices);
  const blades=new T.Mesh(geometry,materials);blades.castShadow=true;blades.receiveShadow=true;blades.frustumCulled=false;scene.add(blades);

  const machine=arcade ? pinball(scene,materials[0]) : null;
  function render(phase, bonusAge){
    machine?.update(phase-Math.floor(phase),bonusAge);
    const a=(phase-Math.floor(phase))*Math.PI*2;
    for(let j=0;j<count;j++){
      const x=(j-(count-1)/2)*pitch;
      for(let k=0;k<=segments;k++){
        const v=k/segments, y=(v-.5)*5.1;
        const edge=Math.sin(Math.PI*v)**2*Math.sin(Math.PI*(j+.5)/count)**.7;
        const spine=.55*x+.70*Math.sin(.79*x+a)+.34*Math.sin(a-.52*x);
        const d=y-spine;
        const crest=Math.exp(-d*d*.89);
        const shoulder=Math.exp(-((d+.87)**2)*1.5);
        const hit=machine?.ripple(x,y) ?? 0;
        const twist=hit*.97+edge*(1.43*crest-.77*shoulder+.25*Math.sin(.82*x-a)*crest);
        const z=machine ? edge*(.18*crest+.46*hit) : edge*(.90*crest-.21*shoulder);
        const cx=x+edge*.27*Math.sin(1.3*d+.5)*crest;
        const cos=Math.cos(twist),sin=Math.sin(twist);
        for(let side=0;side<sides;side++)for(let end=0;end<2;end++){
          const [across,depth]=section[(side+end)%sides],dx=across*pitch;
          positions.setXYZ((j*sides+side)*vertsPerStrip+2*k+end,cx+dx*cos+depth*sin,y,z-dx*sin+depth*cos);
        }
      }
    }
    positions.needsUpdate=true;geometry.computeVertexNormals();
    renderer.render(scene,camera);
  }
  return {render};
}
