import * as THREE from 'three';
import type { Layer, Project } from '../shared/types';
import { INSTRUMENT_PARAMETERS, isInstrument, type InstrumentKind } from '../core/instruments';
import { sourceViewMatrix } from './source-view';
import { instrumentFragment } from './instrument-shaders';
import { fullscreenVertex } from './shaders';
import { CurrentRenderer } from './CurrentRenderer';
import { phraseTime } from './flow-field';
import { InkSimulation } from './InkSimulation';
import { ReliefRenderer } from './ReliefRenderer';
import { prepareSurface, surfaceKey, type PreparedSurface } from './surface-fields';

type Draw=(material:THREE.ShaderMaterial,target:THREE.WebGLRenderTarget)=>void;
const SIZE=384,ITERATIONS=1100;
const rdCommon=/* glsl */`
precision highp float;varying vec2 vUv;
uniform sampler2D uState;uniform float uSeed,uFeed,uKill,uSeedCoverage;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031+uSeed*.000013);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
`;
const initFragment=rdCommon+/* glsl */`
void main(){vec2 p=vUv*18.,i=floor(p),f=fract(p);vec2 center=.25+.5*vec2(hash(i),hash(i+31.));
 float seed=(1.-smoothstep(.21,.25,length(f-center)))*step(1.-uSeedCoverage,hash(i+9.));
 gl_FragColor=vec4(1.-seed*.75,seed,0.,1.);}`;
const stepFragment=rdCommon+/* glsl */`
void main(){vec2 d=vec2(1./384.,0.);vec2 c=texture2D(uState,vUv).rg;
 vec2 lap=-c;
 lap+=(texture2D(uState,vUv+d).rg+texture2D(uState,vUv-d).rg+texture2D(uState,vUv+d.yx).rg+texture2D(uState,vUv-d.yx).rg)*.2;
 lap+=(texture2D(uState,vUv+d+d.yx).rg+texture2D(uState,vUv+d-d.yx).rg+texture2D(uState,vUv-d+d.yx).rg+texture2D(uState,vUv-d-d.yx).rg)*.05;
 float reaction=c.r*c.g*c.g;
 vec2 next=c+vec2(lap.r-reaction+uFeed*(1.-c.r),lap.g*.5+reaction-(uFeed+uKill)*c.g);
 gl_FragColor=vec4(clamp(next,0.,1.),0.,1.);}`;
function shader(fragment:string,uniforms:Record<string,THREE.IUniform>):THREE.ShaderMaterial{
 return new THREE.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
}
function fieldTarget():THREE.WebGLRenderTarget{
 const t=new THREE.WebGLRenderTarget(SIZE,SIZE,{type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
 t.texture.wrapS=t.texture.wrapT=THREE.RepeatWrapping;t.texture.colorSpace=THREE.NoColorSpace;return t;
}
/** Source passes only. StudioRenderer owns the renderer, clock, composition and export. */
export class InstrumentRenderer {
 private currents:CurrentRenderer|null=null;
 private relief:ReliefRenderer|null=null;
 private readonly simulations=new Map<string,InkSimulation>();
 private readonly surfaces=new Map<string,PreparedSurface>();
 private readonly materials=new Map<InstrumentKind,THREE.ShaderMaterial>();
 private readonly patterns=new Map<string,THREE.WebGLRenderTarget>();
 private readonly init=shader(initFragment,{uSeed:{value:0},uSeedCoverage:{value:.62}});
 private readonly step=shader(stepFragment,{uSeed:{value:0},uState:{value:null},uFeed:{value:.055},uKill:{value:.062}});
 private readonly fallback=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);
 constructor(){this.fallback.needsUpdate=true;}
 private pattern(layer:Layer,draw:Draw):THREE.Texture{
  const {seed,pattern,branching,seedCoverage,development}=layer.params,key=`rd2:${seed}:${pattern}:${branching}:${seedCoverage}:${development}`;
  const found=this.patterns.get(key);if(found){this.patterns.delete(key);this.patterns.set(key,found);return found.texture;}
  let a=fieldTarget(),b=fieldTarget();
  try{
   this.init.uniforms.uSeed.value=seed%1_000_003;this.init.uniforms.uSeedCoverage.value=seedCoverage;draw(this.init,a);
   const pairs=[[.055,.062],[.037,.06],[.03,.057],[.022,.051]];
   const pair=pairs[Math.round(pattern)]??pairs[0];
   this.step.uniforms.uFeed.value=pair[0]+(branching-.5)*.004;
   this.step.uniforms.uKill.value=pair[1]+(branching-.5)*.0015;
   for(let i=0;i<Math.round(ITERATIONS*development);i++){this.step.uniforms.uState.value=a.texture;draw(this.step,b);[a,b]=[b,a];}
   // The final write generates a mip chain for all minification levels.
   this.step.uniforms.uState.value=a.texture;
   b.texture.minFilter=THREE.LinearMipmapLinearFilter;b.texture.magFilter=THREE.LinearFilter;b.texture.generateMipmaps=true;
   draw(this.step,b);[a,b]=[b,a];
   this.patterns.set(key,a);
   while(this.patterns.size>4){const first=this.patterns.keys().next().value!;this.patterns.get(first)!.dispose();this.patterns.delete(first);}
   return a.texture;
  }catch(error){a.dispose();throw error;}finally{b.dispose();this.step.uniforms.uState.value=null;}
 }
 prepare(project:Project,draw:Draw,maskImage?:(layer:Layer)=>CanvasImageSource|undefined):void{
  const active=new Set(project.layers.filter(l=>l.visible&&l.surface).map(l=>l.id));
  for(const [id,s] of this.surfaces)if(!active.has(id)){s.texture.dispose();this.surfaces.delete(id);}
  for(const layer of project.layers)if(layer.visible&&layer.surface){const old=this.surfaces.get(layer.id);if(old?.key===surfaceKey(layer))continue;const next=prepareSurface(layer,maskImage?.(layer));old?.texture.dispose();this.surfaces.delete(layer.id);if(next)this.surfaces.set(layer.id,next);}
  for(const layer of project.layers)if(layer.visible&&layer.kind==='livingink'&&layer.params.inkMode!==2)this.pattern(layer,draw);
  if(!project.layers.some(l=>l.visible&&l.kind==='livingink'&&l.params.inkMode!==2)){for(const t of this.patterns.values())t.dispose();this.patterns.clear();}
  const ids=new Set(project.layers.filter(l=>l.visible&&l.kind==='livingink'&&l.params.inkMode===2).map(l=>l.id));
  for(const [id,sim] of this.simulations)if(!ids.has(id)){sim.dispose();this.simulations.delete(id);}
 }
 draw(layer:Layer,phase:number,width:number,height:number,target:THREE.WebGLRenderTarget,draw:Draw,renderer:THREE.WebGLRenderer,seconds=0):void{
  if(!isInstrument(layer.kind))throw new Error('Unsupported projection instrument');
  let m=this.materials.get(layer.kind);
  if(!m){
   const uniforms:Record<string,THREE.IUniform>={uView:{value:new THREE.Matrix3()},uViewInverse:{value:new THREE.Matrix3()},uViewScale:{value:1},uPalette:{value:layer.palette.map(c=>new THREE.Color(c))},uAspect:{value:1},uPhase:{value:0},uSeed:{value:0},uResolution:{value:new THREE.Vector2()},uPatternTexture:{value:this.fallback},uSurface:{value:this.fallback},uSurfaceRole:{value:0},uSurfaceInfluence:{value:0},uSurfaceEmission:{value:0}};
   for(const d of INSTRUMENT_PARAMETERS[layer.kind])uniforms['u'+d.key[0].toUpperCase()+d.key.slice(1)]={value:d.default};
   m=shader(instrumentFragment(layer.kind),uniforms);this.materials.set(layer.kind,m);
  }
  const u=m.uniforms;
  const surface=this.surfaces.get(layer.id);u.uSurface.value=surface?.texture??this.fallback;u.uSurfaceRole.value=surface?.role??0;u.uSurfaceInfluence.value=surface?.influence??0;
  u.uSurfaceEmission.value=Number(surface?.role===2&&layer.kind==='livingink'&&layer.params.inkMode===2);
  (u.uView.value as THREE.Matrix3).copy(sourceViewMatrix(layer.transform,width/height));
  (u.uViewInverse.value as THREE.Matrix3).copy(u.uView.value).invert();u.uViewScale.value=1/layer.transform.scale;
  const local=phase*Math.round(layer.params.cycles)+layer.params.phaseOffset*Math.PI*2;
  u.uAspect.value=width/height;u.uPhase.value=layer.params.phrase?phraseTime(local/(Math.PI*2),layer.params.motion,layer.params.phrase)*Math.PI*2:local;u.uSeed.value=layer.params.seed%1_000_003;
  (u.uResolution.value as THREE.Vector2).set(width,height);
  for(const d of INSTRUMENT_PARAMETERS[layer.kind])u['u'+d.key[0].toUpperCase()+d.key.slice(1)].value=layer.params[d.key];
  (u.uPalette.value as THREE.Color[]).forEach((c,i)=>c.set(layer.palette[i]));
  if(layer.kind==='livingink'&&layer.params.inkMode===2){
   let sim=this.simulations.get(layer.id);const size=InkSimulation.resolution(layer);if(sim&&sim.size!==size){sim.dispose();this.simulations.delete(layer.id);sim=undefined;}if(!sim){sim=new InkSimulation(size);this.simulations.set(layer.id,sim);}
   u.uPatternTexture.value=sim.sample(layer,seconds*layer.params.motion,draw,surface,width/height);
  }else u.uPatternTexture.value=layer.kind==='livingink'?this.pattern(layer,draw):this.fallback;
  draw(m,target);
  if(layer.kind==='currents'&&layer.params.flowMode===1){this.currents??=new CurrentRenderer();this.currents.draw(renderer,layer,phase,width,height,target,surface);}
  if(layer.kind==='relief'&&layer.params.reliefMode===1){this.relief??=new ReliefRenderer();this.relief.draw(renderer,layer,phase,width,height,target,surface);}
 }
 getStats(){return {materials:this.materials.size,patterns:this.patterns.size};}
 dispose(){this.currents?.dispose();this.relief?.dispose();for(const s of this.surfaces.values())s.texture.dispose();this.surfaces.clear();for(const sim of this.simulations.values())sim.dispose();this.simulations.clear();for(const m of this.materials.values())m.dispose();for(const t of this.patterns.values())t.dispose();this.materials.clear();this.patterns.clear();this.init.dispose();this.step.dispose();this.fallback.dispose();}
}
