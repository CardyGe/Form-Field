import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { fullscreenVertex } from './shaders';
import { surfaceFieldGLSL,type PreparedSurface } from './surface-fields';

type Draw=(m:THREE.ShaderMaterial,t:THREE.WebGLRenderTarget)=>void;
const SIZE=256,RATE=24,STEPS=6,INTERVAL=48,MAX_CHECKPOINTS=8;
// Clips are at most 60 s; a looping clip also simulates up to half a clip past its end.
const MAX_SECONDS=90;
const common=`precision highp float;varying vec2 vUv;uniform sampler2D uState;uniform float uSeed,uCoverage,uFeed,uKill,uTime,uTravel,uDirection,uEddy,uObstacle;uniform vec2 uSurfaceMap;
${surfaceFieldGLSL}
vec2 surfaceUV(vec2 uv){return (uv-.5)/uSurfaceMap+.5;}
float hash(float n){return fract(sin(n*127.1+uSeed*.001)*43758.5453);}
vec2 state(vec2 uv){if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(1.,0.);return texture2D(uState,uv).rg;}
bool solid(vec2 uv){return length((uv-.5)*4.8)<uObstacle||(uSurfaceRole>.5&&uSurfaceRole<1.5&&surfaceSample(surfaceUV(uv)).r<0.);}
`;
const init=common+`void main(){float b=0.;for(int i=0;i<7;i++){float k=float(i);vec2 center=vec2(.12+.76*hash(k+1.),.16+.68*hash(k+19.));float r=.012+.024*hash(k+43.);float enabled=i<2?1.:step(1.-uCoverage,hash(k+71.));b=max(b,(1.-smoothstep(r*.6,r,length(vUv-center)))*enabled);}if(uSurfaceRole>1.5)b=max(b,surfaceCoverage(surfaceUV(vUv))*.9);if(solid(vUv))b=0.;gl_FragColor=vec4(1.-b*.8,b,b,1.);}`;
// Analytic divergence-free transport, followed by actual Gray–Scott evolution.
// References: Karl Sims https://www.karlsims.com/rd.html; Bridson et al. in the plan.
// This is a reaction-advection instrument, not a general free-surface fluid solver.
const advect=common+`
float stream(vec2 p){float c=cos(uDirection),s=sin(uDirection);vec2 q=mat2(c,-s,s,c)*p;float k=uEddy;
float psi=(.4+uTravel)*q.y+.7*sin(q.x*k+.4*sin(uTime*.31))*sin(q.y*k+.35*cos(uTime*.47))/k;
psi+=.15*sin(q.x*k*3.1+.28*sin(uTime*.87))*sin(q.y*k*3.1-.23*cos(uTime*.61))/k;
if(uObstacle>0.)psi*=smoothstep(uObstacle,uObstacle+.25,length(p));if(uSurfaceRole>.5&&uSurfaceRole<1.5)psi*=smoothstep(0.,.08,surfaceSample(surfaceUV(p/4.8+.5)).r);return psi;}
void main(){vec2 p=(vUv-.5)*4.8;float e=.004;
vec2 v=vec2(stream(p+vec2(0,e))-stream(p-vec2(0,e)),-stream(p+vec2(e,0))+stream(p-vec2(e,0)))/(2.*e);
vec2 uv=vUv-v*(.065/${RATE}.)/4.8;
vec2 value=solid(vUv)?vec2(1.,0.):state(uv);float pigment=solid(vUv)||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))?0.:texture2D(uState,uv).b*.9985;gl_FragColor=vec4(value,pigment,1.);}`;
const chemical=common+`
vec2 neighbour(vec2 uv,vec2 center){return solid(uv)?center:state(uv);}
void main(){vec2 d=vec2(1./${SIZE}.,0.),c=state(vUv);vec2 lap=-c;
lap+=(neighbour(vUv+d,c)+neighbour(vUv-d,c)+neighbour(vUv+d.yx,c)+neighbour(vUv-d.yx,c))*.2;
lap+=(neighbour(vUv+d+d.yx,c)+neighbour(vUv+d-d.yx,c)+neighbour(vUv-d+d.yx,c)+neighbour(vUv-d-d.yx,c))*.05;
float r=c.r*c.g*c.g;vec2 value=c+vec2(lap.r-r+uFeed*(1.-c.r),lap.g*.5+r-(uFeed+uKill)*c.g);
float pigment=texture2D(uState,vUv).b;float spread=(texture2D(uState,vUv+d).b+texture2D(uState,vUv-d).b+texture2D(uState,vUv+d.yx).b+texture2D(uState,vUv-d.yx).b)*.25-pigment;
pigment=clamp(pigment+c.g*.008*(1.-pigment)-pigment*.0002+spread*.18,0.,1.);
if(solid(vUv)){value=vec2(1.,0.);pigment=0.;}gl_FragColor=vec4(clamp(value,0.,1.),pigment,1.);}`;
const copy=`precision highp float;varying vec2 vUv;uniform sampler2D uState;void main(){gl_FragColor=texture2D(uState,vUv);}`;
// uFront 0: one blend weight everywhere (interpolating between ticks).
// uFront 1: a receding front. Each point switches over a short window at a
// time set by a smooth field, so ink retreats in patches instead of fading.
const interpolate=`precision highp float;varying vec2 vUv;uniform sampler2D uState,uNext;uniform float uBlend,uFront;
void main(){float w=uBlend;
if(uFront>.5){vec2 p=vUv*6.2831853;float r=.5+.25*sin(p.x*1.3+1.7*sin(p.y*.9+.4))+.25*sin(p.y*1.7+1.3*sin(p.x*1.1+2.1));const float e=.12;w=smoothstep(r-e,r+e,uBlend*(1.+2.*e)-e);}
gl_FragColor=mix(texture2D(uState,vUv),texture2D(uNext,vUv),w);}`;
function target(size=SIZE){const t=new THREE.WebGLRenderTarget(size,size,{type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});t.texture.colorSpace=THREE.NoColorSpace;return t;}
function material(fragmentShader:string){return new THREE.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader,uniforms:{...Object.fromEntries(['State','Seed','Coverage','Feed','Kill','Time','Travel','Direction','Eddy','Obstacle'].map(k=>['u'+k,{value:k==='State'?null:0}])),uSurfaceMap:{value:new THREE.Vector2(1,1)},uSurface:{value:null},uSurfaceRole:{value:0},uSurfaceInfluence:{value:0}},depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});}
export class InkSimulation {
  private a:THREE.WebGLRenderTarget;private b:THREE.WebGLRenderTarget;private tick=0;
  private readonly previous:THREE.WebGLRenderTarget;private readonly interpolated:THREE.WebGLRenderTarget;private pairTick=-1;private looped:THREE.WebGLRenderTarget|null=null;
  private readonly init=material(init);private readonly advect=material(advect);private readonly chemical:THREE.ShaderMaterial;private readonly copy=material(copy);
  private readonly mix=new THREE.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:interpolate,uniforms:{uState:{value:null},uNext:{value:null},uBlend:{value:0},uFront:{value:0}},depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
  private readonly checkpoints=new Map<number,THREE.WebGLRenderTarget>();
  private key='';private initialized=false;
  constructor(readonly size=SIZE){this.a=target(size);this.b=target(size);this.previous=target(size);this.interpolated=target(size);this.chemical=material(chemical.replace(`1./${SIZE}.`,`1./${size}.`));}
  static resolution(layer:Layer):number{return [128,256,384][layer.params.simulationQuality??1]??256;}
  static key(layer:Layer):string {const p=layer.params;return JSON.stringify(['reaction-advection-pigment-v2',InkSimulation.resolution(layer),RATE,STEPS,p.seed,p.pattern,p.branching,p.seedCoverage,p.development,p.travel,p.flowDirection,p.eddyScale,p.surfaceHole]);}
  sample(layer:Layer,seconds:number,draw:Draw,surface?:PreparedSurface,aspect=1):THREE.Texture {
    const p=layer.params,key=InkSimulation.key(layer)+JSON.stringify([surface?.key,surface?aspect:0,surface?p.scale:0]);
    for(const m of [this.init,this.advect,this.chemical]){m.uniforms.uSurface.value=surface?.texture??null;m.uniforms.uSurfaceRole.value=surface?.role??0;m.uniforms.uSurfaceInfluence.value=surface?.influence??0;m.uniforms.uSurfaceMap.value.set(p.scale*aspect/4.8,p.scale/4.8);}
    const position=Math.round(Math.max(0,Math.min(MAX_SECONDS,seconds))*RATE*1e7)/1e7,requested=Math.floor(position),fraction=position-requested;
    if(this.key!==key){this.clear();this.key=key;this.initialized=false;}
    const blend=()=>{if(fraction===0)return this.previous.texture;this.mix.uniforms.uState.value=this.previous.texture;this.mix.uniforms.uNext.value=this.a.texture;this.mix.uniforms.uBlend.value=fraction;this.mix.uniforms.uFront.value=0;draw(this.mix,this.interpolated);return this.interpolated.texture;};
    if(this.pairTick===requested&&this.tick===requested+1)return blend();
    if(!this.initialized||requested<this.tick){
      const candidates=[...this.checkpoints.keys()].filter(t=>t<=requested).sort((a,b)=>b-a),checkpoint=candidates[0];
      if(checkpoint!==undefined){this.copy.uniforms.uState.value=this.checkpoints.get(checkpoint)!.texture;draw(this.copy,this.a);this.tick=checkpoint;}
      else{const u=this.init.uniforms;u.uSeed.value=p.seed%1_000_003;u.uCoverage.value=p.seedCoverage;u.uObstacle.value=p.surfaceHole;draw(this.init,this.a);this.tick=0;}
      this.initialized=true;
    }
    const pairs=[[.055,.062],[.037,.06],[.03,.057],[.022,.051]],pair=pairs[Math.round(p.pattern)]??pairs[0];
    const u=this.chemical.uniforms;u.uFeed.value=pair[0]+(p.branching-.5)*.004;u.uKill.value=pair[1]+(p.branching-.5)*.0015;u.uObstacle.value=p.surfaceHole;
    const v=this.advect.uniforms;v.uTravel.value=p.travel;v.uDirection.value=p.flowDirection;v.uEddy.value=p.eddyScale;v.uObstacle.value=p.surfaceHole;
    while(this.tick<requested+1){
      if(this.tick===requested){this.copy.uniforms.uState.value=this.a.texture;draw(this.copy,this.previous);}
      v.uTime.value=this.tick/RATE;v.uState.value=this.a.texture;draw(this.advect,this.b);[this.a,this.b]=[this.b,this.a];
      for(let step=0;step<Math.round(STEPS*p.development);step++){u.uState.value=this.a.texture;draw(this.chemical,this.b);[this.a,this.b]=[this.b,this.a];}
      this.tick++;
      if(this.tick%INTERVAL===0&&!this.checkpoints.has(this.tick)){
        const t=target(this.size);this.copy.uniforms.uState.value=this.a.texture;draw(this.copy,t);this.checkpoints.set(this.tick,t);
        while(this.checkpoints.size>MAX_CHECKPOINTS){const first=this.checkpoints.keys().next().value!;this.checkpoints.get(first)!.dispose();this.checkpoints.delete(first);}
      }
    }
    this.pairTick=requested;return blend();
  }
  /** Mix another state into this simulation's own output (weight of this state). Used for the loop return. */
  blend(from:THREE.Texture,to:THREE.Texture,weight:number,draw:Draw):THREE.Texture{
    this.looped??=target(this.size);
    this.mix.uniforms.uState.value=from;this.mix.uniforms.uNext.value=to;this.mix.uniforms.uBlend.value=weight;this.mix.uniforms.uFront.value=1;draw(this.mix,this.looped);
    return this.looped.texture;
  }
  private clear(){for(const t of this.checkpoints.values())t.dispose();this.checkpoints.clear();this.tick=0;this.pairTick=-1;}
  getStats(){return {tick:this.tick,checkpoints:this.checkpoints.size};}
  dispose(){this.clear();this.looped?.dispose();this.a.dispose();this.b.dispose();this.previous.dispose();this.interpolated.dispose();for(const m of [this.init,this.advect,this.chemical,this.copy,this.mix])m.dispose();}
}
