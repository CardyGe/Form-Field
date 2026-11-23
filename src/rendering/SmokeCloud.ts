/**
 * Smoke Cloud: Live's fluid solver carries colour smoke and about 590,000 fine points.
 * The smoke gives soft volume; the points, drawn one pixel wide at output resolution, give the sharp detail.
 */
import * as THREE from 'three';
import type { Layer } from '../shared/types';
import type { SmokeAudioFrame } from '../react/ember-smoke';
import { Fluid, type FluidState } from '../live/fluid';
import { Passes, type Pair } from '../live/passes';
import { sourceViewMatrix } from './source-view';
import { cloudBeats, cloudHit, cloudLoopBlend, cloudSettings, cloudSteps, type CloudSettings } from './smoke-cloud-model';

const SIDE = 768, COUNT = SIDE * SIDE, STEP = 1 / 60, GRID_LONG = 256, DYE_LONG = 1280;
const PRESSURE_STEPS = 12;
const PRE_ROLL_SECONDS = 4, MAX_CHECKPOINTS = 6, SEEK_STEPS_PER_FRAME = 16;
const TAU = Math.PI * 2;

const noise = /* glsl */`
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float cloud(vec2 p,float t){p+=.9*vec2(noise(p*.5+vec2(0.,t*.4)),noise(p*.5+vec2(5.2,-t*.3)))-.45;return .5*noise(p)+.3*noise(p*2.1+vec2(t*.3,7.))+.2*noise(p*4.3-vec2(3.,t*.9));}
// Where smoke is released: a torn inner mass, a thin ring and a ragged outer border.
vec3 shapes(vec2 p,float t,float c){float r=length(p);vec2 d=p/max(r,.001);
 float a=(.24+.16*noise(d*2.3+t*.12))*c,b=.72+.24*noise(d*2.9+7.-t*.09);
 float inner=smoothstep(a,a+.07,r)*(1.-smoothstep(b,b+.1,r));
 float ring=exp(-pow((r-.99-.018*noise(d*6.+t*.2))/.022,2.));
 float e0=1.2+.08*noise(d*5.+t*.1),e=1.52+.36*noise(d*3.4+11.+t*.11)+.09*noise(d*12.-t*.2);
 return vec3(inner,ring,smoothstep(e0,e0+.05,r)*(1.-smoothstep(e,e+.07,r)));}
`;
const forceFragment = /* glsl */`
uniform sampler2D uCurrent; uniform float uAspect,uScale,uT,uDt,uKick,uTurn,uCore,uTurbulence,uShear,uPlumes,uChannels; uniform vec2 uGrid,uShift;
${noise}
float psi(vec2 p,float t){return noise(p*1.7+vec2(t*.11,-t*.08))+.5*noise(p*4.1-vec2(t*.17,1.3))+.3*noise(p*9.3+vec2(4.,t*.27))+.14*noise(p*21.+vec2(t*.4,8.));}
void main(){
 vec2 p=(vUv-.5)*vec2(uAspect,1.)/uScale,v=texture2D(uCurrent,vUv).xy;float e=.025,q=length(p);vec2 way=p/max(q,.04),turn=vec2(-way.y,way.x);
 vec2 o=p+uShift;float ft=uT*2.6;vec2 curl=vec2(psi(o+vec2(0.,e),ft)-psi(o-vec2(0.,e),ft),psi(o-vec2(e,0.),ft)-psi(o+vec2(e,0.),ft))/(2.*e);
 v+=curl*uGrid.y*uDt*.5*uTurbulence;
 // Rings of smoke sliding past each other stretch whirlpools into strands.
 float shear=sin(q*3.4-uT*.19+way.x*.7)+.62*sin(q*7.1+uT*.13+way.y*1.3);v+=turn*shear*smoothstep(.12,.34,q)*uGrid.y*uDt*.5*uShear;
 vec3 band=shapes(p,uT,uCore);float streak=.35+1.3*noise(way*3.1+vec2(q*.8-uT*.34,q*.5+uT*.1));v+=way*(band.x*.5+band.z*.42)*streak*uGrid.y*uDt*uPlumes;
 float channel=exp(-pow((q-.895)/.05,2.))+exp(-pow((q-1.095)/.055,2.));
 v*=1.-uDt*(.45+3.2*smoothstep(1.55,2.05,q)+5.5*channel*uChannels+4.*(1.-smoothstep(.16*uCore,.34*uCore+.001,q)));
 if(uKick>0.){float amount=clamp(band.x+band.y+band.z,0.,1.)*(.45+1.1*noise(p*3.7+uT));v+=(way+turn*uTurn*sin(5.*way.x+3.*way.y+uT))*amount*uKick*uGrid.y*.15;}
 float edge=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));v*=smoothstep(0.,.045,edge);
 gl_FragColor=vec4(v,0.,1.);
}`;
const emitFragment = /* glsl */`
uniform sampler2D uCurrent,uVelocity; uniform float uAspect,uScale,uT,uDt,uBeat,uEmit,uCore,uRing,uOuter,uChannels; uniform vec3 uDeep,uMain,uPale,uAccent;
${noise}
void main(){
 vec2 p=(vUv-.5)*vec2(uAspect,1.)/uScale;vec3 s=shapes(p,uT,uCore),now=texture2D(uCurrent,vUv).rgb;
 float q=length(p);vec2 way=p/max(q,.04);float wisps=smoothstep(.45,.65,cloud(way*7.2+vec2(q*1.25-uT*.62,q*.8+uT*.2),uT*1.25)),fine=smoothstep(.42,.68,cloud(way*23.+vec2(q*3.4-uT*1.1,9.),uT*1.9));
 float add=(s.x*1.75+s.y*4.2*uRing+s.z*1.45*uOuter)*wisps*(.2+.8*fine)*(.72+2.2*uBeat)*uEmit;
 float tone=noise(p*3.1+vec2(uT*.13,2.)),second=noise(p*1.9+vec2(-uT*.09,6.)),full=max(now.r,max(now.g,now.b))/1.05;
 vec3 tint=mix(uDeep,uMain,smoothstep(.15,.6,tone));tint=mix(tint,uAccent,smoothstep(.5,.78,second)*.6);tint=mix(tint,uPale,smoothstep(.62,.92,tone)*.75);
 vec3 next=now+tint*add*uDt*5.*max(0.,1.-full);
 // Clear air, as in Live: thin smoke in still air fades, moving wisps stay.
 float slow=1.-smoothstep(4.,20.,length(texture2D(uVelocity,vUv).xy)),thin=1.-smoothstep(.02,.4,max(now.r,max(now.g,now.b)));
 next*=max(0.,1.-uDt*1.2*thin*slow);
 float wob=.05*(noise(p*3.3+uT*.14)-.5),core=1.-smoothstep(.17*uCore,.31*uCore+.001,q+wob),gapA=exp(-pow((q+wob-.895)/.035,2.)),gapB=exp(-pow((q+wob-1.095)/.04,2.));
 next*=max(0.,1.-uDt*(13.*core+5.*uChannels*(gapA+gapB)));
 float border=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));next*=mix(max(0.,1.-uDt*3.),1.,smoothstep(0.,.06,border));
 gl_FragColor=vec4(next,1.);
}`;
const particleFragment = /* glsl */`
uniform sampler2D uState,uRand,uVelocity; uniform float uAspect,uScale,uT,uDt,uCore; uniform vec2 uGridTexel;
const float TAU=6.2831853;
${noise}
void main(){
 vec4 c=texture2D(uState,vUv),r=texture2D(uRand,vUv);vec2 v=texture2D(uVelocity,c.xy).xy;
 vec2 jitter=vec2(hash(vUv*53.+uT),hash(vUv*71.-uT))-.5;vec2 next=c.xy+v*uGridTexel*uDt*(.58+.72*r.z)+jitter*.0011/vec2(uAspect,1.);float age=c.z+uDt/(.75+1.9*r.y);
 if(age>=1.||next.x<0.||next.x>1.||next.y<0.||next.y>1.){
  float a=fract(r.x+hash(vUv*91.+uT))*TAU,u=hash(vUv*37.+uT*1.7),R;vec2 d=vec2(cos(a),sin(a));
  if(r.w<.46)R=mix((.24+.16*noise(d*2.3+uT*.12))*uCore,.72+.24*noise(d*2.9+7.-uT*.09),sqrt(u));
  else if(r.w<.6)R=.99+(u-.5)*.05;
  else R=mix(1.2,1.52+.36*noise(d*3.4+11.+uT*.11),sqrt(u));
  next=d*R*uScale/vec2(uAspect,1.)+.5;age=0.;
 }
 gl_FragColor=vec4(next,age,1.);
}`;
const downFragment = /* glsl */`uniform sampler2D uT; uniform vec2 uTexel;
void main(){vec2 e=uTexel;gl_FragColor=.25*(texture2D(uT,vUv+e*vec2(-1.,-1.))+texture2D(uT,vUv+e*vec2(1.,-1.))+texture2D(uT,vUv+e*vec2(-1.,1.))+texture2D(uT,vUv+e*vec2(1.,1.)));}`;
const blurFragment = /* glsl */`uniform sampler2D uT; uniform vec2 uTexel;
void main(){gl_FragColor=texture2D(uT,vUv)*.227+(texture2D(uT,vUv+uTexel*1.385)+texture2D(uT,vUv-uTexel*1.385))*.316+(texture2D(uT,vUv+uTexel*3.231)+texture2D(uT,vUv-uTexel*3.231))*.07;}`;
// The soft shapes are worked out small: dark form in red, the ring's wander in green, its broken light in blue.
const formFragment = /* glsl */`
uniform float uAspect,uScale,uT,uCore,uChannels;
${noise}
void main(){
 vec2 p=(vUv-.5)*vec2(uAspect,1.)/uScale;float r=length(p);vec2 d=p/max(r,.001);
 float rag=.075*(noise(d*2.6+uT*.13)-.5)+.028*(noise(d*9.+vec2(uT*.3,4.))-.5);
 float wa=.032+.05*noise(d*3.7+uT*.09),wb=.036+.06*noise(d*3.1+vec2(6.,-uT*.08)),oa=.1*(noise(d*2.2+vec2(uT*.1,3.))-.5),ob=.13*(noise(d*2.7+vec2(8.,uT*.07))-.5);
 float openA=smoothstep(.26,.62,noise(d*4.3+vec2(uT*.17,1.))),openB=smoothstep(.24,.6,noise(d*3.8+vec2(-uT*.15,5.)));
 float heart=smoothstep(.2*uCore,.37*uCore+.001,r+rag),inside=exp(-pow((r+rag-.875-oa)/wa,2.))*openA,outside=exp(-pow((r+rag-1.115-ob)/wb,2.))*openB;
 float wander=.055*(noise(d*5.+uT*.2)-.5)+.026*(noise(d*17.-uT*.4)-.5)+.009*(noise(d*47.+uT*.7)-.5);
 float broken=.08+.92*smoothstep(.34,.68,noise(d*6.2+vec2(-uT*.26,2.)))*(.55+.45*noise(d*29.+uT));
 gl_FragColor=vec4(heart*(1.-uChannels*inside)*(1.-uChannels*outside),wander*5.+.5,broken,1.);
}`;
const compositeFragment = /* glsl */`
uniform sampler2D uDye,uSoft,uWide,uForm; uniform vec2 uSize; uniform float uBeat,uAspect,uScale,uSharp,uHaze,uLighting,uExposure,uRing; uniform vec3 uPale;
vec3 cubic(sampler2D t,vec2 uv,vec2 size){vec2 p=uv*size-.5,i=floor(p),f=p-i,f2=f*f,f3=f2*f;
 vec2 w0=(1.-f)*(1.-f)*(1.-f)/6.,w1=(4.-6.*f2+3.*f3)/6.,w2=(1.+3.*f+3.*f2-3.*f3)/6.,w3=f3/6.,g0=w0+w1,g1=w2+w3;
 vec2 a=(i-.5+w1/g0+.5)/size,b=(i+1.5+w3/g1+.5)/size;
 return (texture2D(t,a).rgb*g0.x+texture2D(t,vec2(b.x,a.y)).rgb*g1.x)*g0.y+(texture2D(t,vec2(a.x,b.y)).rgb*g0.x+texture2D(t,b).rgb*g1.x)*g1.y;}
float H(vec2 uv){vec3 c=texture2D(uSoft,uv).rgb;return log(1.+4.*max(c.r,max(c.g,c.b)));}
void main(){
 vec3 sharp=cubic(uDye,vUv,uSize),soft=cubic(uSoft,vUv,uSize*.5),wide=texture2D(uWide,vUv).rgb,form=texture2D(uForm,vUv).rgb;
 vec2 e=5./uSize;float x=H(vUv+vec2(e.x,0.))-H(vUv-vec2(e.x,0.)),y=H(vUv+vec2(0.,e.y))-H(vUv-vec2(0.,e.y));
 vec3 N=normalize(vec3(-x*2.3*uLighting,-y*2.3*uLighting,1.)),L=normalize(vec3(-.46,.7,.55));float lit=max(dot(N,L),0.);
 vec3 body=mix(mix(soft,sharp,uSharp),wide*1.25,uHaze);float m=max(body.r,max(body.g,body.b));body*=pow(m+.0001,.16)/pow(.55,.16);
 float edge=smoothstep(.04,.5,m)*pow(lit,4.);
 vec3 col=(body*(.34+1.25*lit)+wide*.34+uPale*edge*.2*uLighting)*uBeat*form.r;
 vec2 p=(vUv-.5)*vec2(uAspect,1.)/uScale;float rr=length(p)-.99-(form.g-.5)/5.;
 col+=(uPale*exp(-rr*rr/.000034)*.86+mix(uPale,col,.5)*exp(-rr*rr/.0009)*.18)*form.b*uBeat*uRing;
 col=max(1.-exp(-col*uExposure)-.002,0.);
 // The picture is authored in display values; Studio encodes its output, so hand it linear light.
 gl_FragColor=vec4(pow(col,vec3(2.2)),max(col.r,max(col.g,col.b)));
}`;
const mixFragment = /* glsl */`uniform sampler2D uA,uB; uniform float uWeight; void main(){gl_FragColor=mix(texture2D(uA,vUv),texture2D(uB,vUv),uWeight);}`;
const viewFragment = /* glsl */`uniform sampler2D uT; uniform mat3 uView;
void main(){vec2 uv=(uView*vec3(vUv,1.)).xy;gl_FragColor=uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.?vec4(0.):texture2D(uT,uv);}`;

function randomField(seed: number): Float32Array {
  const out = new Float32Array(COUNT * 4);
  let s = seed | 0;
  const next = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < out.length; i++) out[i] = next();
  return out;
}
const fieldTexture = (array: Float32Array) => { const t = new THREE.DataTexture(array, SIDE, SIDE, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; };

interface Shared { random: THREE.DataTexture; start: THREE.DataTexture; geometry: THREE.BufferGeometry }
export interface CloudInput { layer: Layer; simulation: Record<string, number>; seconds: number; loopSeconds: number; exact: boolean; playing: boolean; audio?: SmokeAudioFrame; width: number; height: number }
interface Checkpoint { fluid: FluidState; points: THREE.WebGLRenderTarget }

class Cloud {
  private readonly passes: Passes;
  private readonly fluid: Fluid;
  private readonly state: Pair;
  private readonly m: Record<'force' | 'emit' | 'particles' | 'form' | 'composite' | 'down' | 'blur' | 'mix' | 'view' | 'copy', THREE.ShaderMaterial>;
  private readonly pointMaterial: THREE.RawShaderMaterial;
  private readonly pointScene = new THREE.Scene();
  private readonly pointCamera = new THREE.Camera();
  private readonly soft: THREE.WebGLRenderTarget;
  private readonly form: THREE.WebGLRenderTarget;
  private readonly wideA: THREE.WebGLRenderTarget;
  private readonly wideB: THREE.WebGLRenderTarget;
  private frame: THREE.WebGLRenderTarget | null = null;
  private smoke: THREE.WebGLRenderTarget | null = null;
  private readonly checkpoints = new Map<number, Checkpoint>();
  private tail: Cloud | null = null;
  private key = '';
  private tick = 0;
  private onTimeline = false;
  private clock = 0;
  private lastSeconds = -1;
  private remainder = 0;
  private lastAudioBeat = -1;
  pending = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, readonly aspect: number, private readonly shared: Shared) {
    this.passes = new Passes(renderer);
    const fit = (long: number): [number, number] => aspect >= 1 ? [long, Math.max(16, Math.round(long / aspect))] : [Math.max(16, Math.round(long * aspect)), long];
    const grid = fit(GRID_LONG), dye = fit(DYE_LONG);
    this.fluid = new Fluid(this.passes, grid, dye, PRESSURE_STEPS);
    this.state = this.passes.pair(SIDE, SIDE, { float: true, nearest: true });
    this.soft = this.passes.target(dye[0] >> 1, dye[1] >> 1);
    this.form = this.passes.target(dye[0] >> 1, dye[1] >> 1);
    this.wideA = this.passes.target(dye[0] >> 3, dye[1] >> 3);
    this.wideB = this.passes.target(dye[0] >> 3, dye[1] >> 3);
    const base = () => ({ uAspect: { value: aspect }, uScale: { value: .3 }, uT: { value: 0 }, uDt: { value: STEP }, uCore: { value: 1 } });
    const colours = () => ({ uDeep: { value: new THREE.Color() }, uMain: { value: new THREE.Color() }, uPale: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() } });
    const m = (f: string, u: Record<string, THREE.IUniform>) => this.passes.material(f, u);
    this.m = {
      force: m(forceFragment, { ...base(), uCurrent: { value: null }, uKick: { value: 0 }, uTurn: { value: 1 }, uTurbulence: { value: 1 }, uShear: { value: 1 }, uPlumes: { value: 1 }, uChannels: { value: 1 }, uGrid: { value: new THREE.Vector2(...grid) }, uShift: { value: new THREE.Vector2() } }),
      emit: m(emitFragment, { ...base(), ...colours(), uCurrent: { value: null }, uVelocity: { value: null }, uBeat: { value: 0 }, uEmit: { value: 1 }, uRing: { value: 1 }, uOuter: { value: 1 }, uChannels: { value: 1 } }),
      particles: m(particleFragment, { ...base(), uState: { value: null }, uRand: { value: shared.random }, uVelocity: { value: null }, uGridTexel: { value: new THREE.Vector2(1 / grid[0], 1 / grid[1]) } }),
      form: m(formFragment, { ...base(), uChannels: { value: 1 } }),
      composite: m(compositeFragment, { uDye: { value: null }, uSoft: { value: null }, uWide: { value: null }, uForm: { value: null }, uSize: { value: new THREE.Vector2(...dye) }, uBeat: { value: 1 }, uAspect: { value: aspect }, uScale: { value: .3 }, uSharp: { value: .3 }, uHaze: { value: 0 }, uLighting: { value: 1 }, uExposure: { value: 2.5 }, uRing: { value: 1 }, uPale: { value: new THREE.Color() } }),
      down: m(downFragment, { uT: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      blur: m(blurFragment, { uT: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      mix: m(mixFragment, { uA: { value: null }, uB: { value: null }, uWeight: { value: 1 } }),
      view: m(viewFragment, { uT: { value: null }, uView: { value: new THREE.Matrix3() } }),
      copy: m('uniform sampler2D uT;void main(){gl_FragColor=texture2D(uT,vUv);}', { uT: { value: null } }),
    };
    this.pointMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */`precision highp float; precision highp int; precision highp sampler2D;
in float position; uniform sampler2D uState,uRand,uDye; uniform float uSize,uGain,uAspect,uScale,uCore; uniform mat3 uInverse; out vec3 vColour;
void main(){
 ivec2 at=ivec2(gl_VertexID%${SIDE},gl_VertexID/${SIDE});vec4 s=texelFetch(uState,at,0),r=texelFetch(uRand,at,0);
 vec3 d=textureLod(uDye,s.xy,0.).rgb;float m=max(d.r,max(d.g,d.b)),fade=smoothstep(0.,.07,s.z)*(1.-smoothstep(.72,1.,s.z)),g=fract(r.z*91.7);
 float b=smoothstep(.012,.2,m)*(.42+.58*smoothstep(.1,.7,m))*fade*(.075+3.6*g*g*g*g*g*g*g*g)*uGain*position;
 vec2 form=(s.xy-.5)*vec2(uAspect,1.)/uScale;float fr=length(form);b*=smoothstep(.2*uCore,.36*uCore+.001,fr)*(1.-.45*exp(-pow((fr-.875)/.05,2.)))*(1.-.45*exp(-pow((fr-1.115)/.055,2.)));
 if(b<.004){gl_Position=vec4(2.,2.,0.,1.);gl_PointSize=0.;vColour=vec3(0.);return;}
 vColour=pow(mix(d/max(m,.001),vec3(.96,.92,1.),.62)*min(b,1.),vec3(2.2));gl_Position=vec4((uInverse*vec3(s.xy,1.)).xy*2.-1.,0.,1.);gl_PointSize=uSize;
}`,
      fragmentShader: /* glsl */`precision highp float; in vec3 vColour; out vec4 c; void main(){c=vec4(vColour,max(vColour.r,max(vColour.g,vColour.b)));}`,
      uniforms: { uState: { value: null }, uRand: { value: shared.random }, uDye: { value: null }, uSize: { value: 1 }, uGain: { value: 1 }, uAspect: { value: aspect }, uScale: { value: .3 }, uCore: { value: 1 }, uInverse: { value: new THREE.Matrix3() } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, toneMapped: false,
    });
    const points = new THREE.Points(shared.geometry, this.pointMaterial); points.frustumCulled = false;
    this.pointScene.add(points);
    this.resetPoints();
  }

  private resetPoints(): void { this.m.copy.uniforms.uT.value = this.shared.start; this.passes.draw(this.m.copy, this.state.read); }
  private copyTo(from: THREE.Texture, to: THREE.WebGLRenderTarget): void { this.m.copy.uniforms.uT.value = from; this.passes.draw(this.m.copy, to); }
  private filter(material: THREE.ShaderMaterial, from: THREE.Texture, to: THREE.WebGLRenderTarget, x: number, y: number): void {
    material.uniforms.uT.value = from; (material.uniforms.uTexel.value as THREE.Vector2).set(x, y); this.passes.draw(material, to);
  }
  private clearCheckpoints(): void { for (const c of this.checkpoints.values()) { c.fluid.dispose(); c.points.dispose(); } this.checkpoints.clear(); }

  private configure(s: CloudSettings, palette: readonly string[]): void {
    const scale = s.size * Math.min(1, this.aspect);
    for (const material of [this.m.force, this.m.emit, this.m.particles, this.m.form, this.pointMaterial]) { material.uniforms.uScale.value = scale; material.uniforms.uCore.value = s.core; }
    this.m.composite.uniforms.uScale.value = scale;
    const f = this.m.force.uniforms, e = this.m.emit.uniforms;
    f.uTurbulence.value = s.turbulence; f.uShear.value = s.shear; f.uPlumes.value = s.plumes; f.uChannels.value = s.channels;
    e.uEmit.value = s.emit; e.uRing.value = s.ring; e.uOuter.value = s.outer; e.uChannels.value = s.channels; this.m.form.uniforms.uChannels.value = s.channels;
    (e.uDeep.value as THREE.Color).set(palette[0]); (e.uMain.value as THREE.Color).set(palette[1]); (e.uPale.value as THREE.Color).set(palette[2]); (e.uAccent.value as THREE.Color).set(palette[4]);
    (this.m.composite.uniforms.uPale.value as THREE.Color).set(palette[2]);
  }

  private stepOnce(seconds: number, s: CloudSettings, loop: number, beats: number, seedTime: number, extra = 0): void {
    const t = seconds + seedTime, hit = cloudHit(seconds, loop, beats), before = Math.floor((seconds - STEP) * beats / loop + 1e-9), count = Math.floor(seconds * beats / loop + 1e-9);
    const isHit = count !== before, f = this.m.force.uniforms, e = this.m.emit.uniforms, p = this.m.particles.uniforms;
    f.uT.value = e.uT.value = p.uT.value = t;
    (f.uShift.value as THREE.Vector2).set((count * 2.399963) % 7, (count * 1.618034) % 5);
    f.uKick.value = ((isHit ? hit.strength : 0) + extra) * s.punch; f.uTurn.value = count % 2 ? 1 : -1;
    this.fluid.inject('velocity', this.m.force);
    e.uVelocity.value = this.fluid.velocity; e.uBeat.value = hit.level * Math.min(1, s.punch);
    this.fluid.inject('dye', this.m.emit);
    this.fluid.step(STEP, 3, .95, s.dyeLife, 2);
    p.uState.value = this.state.read.texture; p.uVelocity.value = this.fluid.velocity;
    this.passes.draw(this.m.particles, this.state.write); this.state.swap();
  }

  private advanceExact(target: number, s: CloudSettings, loop: number, beats: number, seedTime: number, budget = Infinity): boolean {
    const start = -Math.round(Math.min(PRE_ROLL_SECONDS, loop) * 60);
    if (!this.onTimeline || target < this.tick) {
      let best: number | undefined;
      for (const tick of this.checkpoints.keys()) if (tick <= target && (best === undefined || tick > best)) best = tick;
      if (best !== undefined) { const c = this.checkpoints.get(best)!; this.fluid.restoreState(c.fluid); this.copyTo(c.points.texture, this.state.read); this.tick = best; }
      else { this.fluid.clear(); this.resetPoints(); this.tick = start; }
      this.onTimeline = true;
    }
    const spacing = Math.max(60, Math.ceil(loop * 2 * 60 / MAX_CHECKPOINTS));
    for (let used = 0; this.tick < target; used++) {
      if (used >= budget) return false;
      this.stepOnce(this.tick / 60, s, loop, beats, seedTime);
      this.tick++;
      if (this.tick > 0 && this.tick % spacing === 0 && !this.checkpoints.has(this.tick) && this.checkpoints.size < MAX_CHECKPOINTS) {
        const points = this.passes.target(SIDE, SIDE, { float: true, nearest: true });
        this.copyTo(this.state.read.texture, points);
        this.checkpoints.set(this.tick, { fluid: this.fluid.saveState(), points });
      }
    }
    return true;
  }

  private advanceLive(input: CloudInput, s: CloudSettings, beats: number, seedTime: number): void {
    if (this.lastSeconds < 0) { this.clock = input.seconds; this.lastSeconds = input.seconds; }
    let elapsed = input.seconds - this.lastSeconds;
    if (elapsed < -input.loopSeconds / 2) elapsed += input.loopSeconds;
    this.lastSeconds = input.seconds;
    if (elapsed <= 0) return;
    let extra = 0;
    for (const beat of input.audio?.beats ?? []) if (beat.id > this.lastAudioBeat) { this.lastAudioBeat = beat.id; extra = Math.max(extra, beat.strength * (input.simulation.cloudResponse ?? 0)); }
    const owed = elapsed + this.remainder, steps = Math.max(cloudSteps(owed), extra ? 1 : 0);
    this.remainder = Math.min(STEP, Math.max(0, owed - steps * STEP));
    for (let i = 0; i < steps; i++) { this.stepOnce(this.clock, s, input.loopSeconds, beats, seedTime, i === 0 ? extra : 0); this.clock += STEP; }
    if (steps) this.onTimeline = false;
  }

  private present(output: THREE.WebGLRenderTarget, view: THREE.Matrix3, seconds: number, loop: number, beats: number, seedTime: number, shown: CloudSettings, palettePale: string): void {
    const hit = cloudHit(seconds, loop, beats), depth = Math.min(1, shown.punch), beat = (1 - depth) * .8 + depth * (.56 + .56 * hit.level);
    const w = this.wideA.width, h = this.wideA.height;
    this.filter(this.m.down, this.fluid.dye, this.soft, .5 / this.soft.width, .5 / this.soft.height);
    this.filter(this.m.down, this.soft.texture, this.wideA, 1 / w, 1 / h);
    this.filter(this.m.blur, this.wideA.texture, this.wideB, 1 / w, 0); this.filter(this.m.blur, this.wideB.texture, this.wideA, 0, 1 / h);
    this.m.form.uniforms.uT.value = seconds + seedTime; this.passes.draw(this.m.form, this.form);
    const c = this.m.composite.uniforms;
    c.uDye.value = this.fluid.dye; c.uSoft.value = this.soft.texture; c.uWide.value = this.wideA.texture; c.uForm.value = this.form.texture;
    c.uBeat.value = beat; c.uSharp.value = shown.sharpness; c.uHaze.value = shown.haze; c.uLighting.value = shown.lighting; c.uExposure.value = shown.exposure; c.uRing.value = Math.min(1.6, shown.ring);
    (c.uPale.value as THREE.Color).set(palettePale);
    const rows = Math.min(1080, output.height), columns = Math.max(1, Math.round(rows * output.width / output.height));
    if (!this.smoke) this.smoke = this.passes.target(columns, rows);
    else if (this.smoke.width !== columns || this.smoke.height !== rows) this.smoke.setSize(columns, rows);
    this.passes.draw(this.m.composite, this.smoke);
    const v = this.m.view.uniforms; v.uT.value = this.smoke.texture; (v.uView.value as THREE.Matrix3).copy(view);
    this.passes.draw(this.m.view, output);
    if (shown.sparkle > 0) {
      const u = this.pointMaterial.uniforms;
      u.uState.value = this.state.read.texture; u.uDye.value = this.fluid.dye; (u.uInverse.value as THREE.Matrix3).copy(view).invert();
      u.uSize.value = Math.max(1, Math.round(output.height / 1080)); u.uGain.value = .62 * shown.sparkle * (.5 + .55 * hit.level);
      this.renderer.setRenderTarget(output); this.renderer.render(this.pointScene, this.pointCamera);
    }
  }

  private frameTarget(width: number, height: number): THREE.WebGLRenderTarget {
    if (!this.frame) this.frame = this.passes.target(width, height);
    else if (this.frame.width !== width || this.frame.height !== height) this.frame.setSize(width, height);
    return this.frame;
  }

  sample(input: CloudInput, target: THREE.WebGLRenderTarget): void {
    const { autoClear } = this.renderer, shadows = this.renderer.shadowMap.autoUpdate;
    this.renderer.autoClear = false; this.renderer.shadowMap.autoUpdate = false;
    try { this.run(input, target); } finally { this.renderer.autoClear = autoClear; this.renderer.shadowMap.autoUpdate = shadows; }
  }

  private run(input: CloudInput, target: THREE.WebGLRenderTarget): void {
    const stable = cloudSettings(input.simulation), shown = cloudSettings(input.layer.params), loop = input.loopSeconds;
    const beats = cloudBeats(input.simulation.cloudBeats ?? 20, loop), seed = (input.simulation.seed ?? 1729) >>> 0, seedTime = (seed % 881) * .73;
    const palette = input.layer.palette;
    const key = JSON.stringify([stable.emit, stable.turbulence, stable.shear, stable.plumes, stable.punch, stable.dyeLife, stable.core, stable.ring, stable.channels, stable.outer, stable.size, seed, beats, loop, palette]);
    if (key !== this.key) { this.key = key; this.clearCheckpoints(); this.onTimeline = false; this.tail?.dispose(); this.tail = null; }
    this.configure(stable, palette);
    const tick = Math.round(input.seconds * 60);
    this.pending = false;
    let tailWeight = 1;
    if (input.exact) {
      this.advanceExact(tick, stable, loop, beats, seedTime);
      this.lastSeconds = input.seconds;
      const blend = cloudLoopBlend(input.seconds, loop);
      tailWeight = blend.weight;
      if (tailWeight < 1) {
        this.tail ??= new Cloud(this.renderer, this.aspect, this.shared);
        this.tail.configure(stable, palette);
        this.tail.advanceExact(tick + Math.round(loop * 60), stable, loop, beats, seedTime);
      }
    } else if (input.playing || input.seconds === this.lastSeconds) {
      this.advanceLive(input, stable, beats, seedTime);
    } else {
      if (!this.advanceExact(tick, stable, loop, beats, seedTime, SEEK_STEPS_PER_FRAME)) { this.pending = true; return; }
      this.lastSeconds = input.seconds;
    }
    const view = sourceViewMatrix(input.layer.transform, input.width / input.height);
    if (input.exact && tailWeight < 1) {
      const own = this.frameTarget(input.width, input.height), tail = this.tail!.frameTarget(input.width, input.height);
      this.present(own, view, input.seconds, loop, beats, seedTime, shown, palette[2]);
      this.tail!.present(tail, view, input.seconds, loop, beats, seedTime + loop, shown, palette[2]);
      const mix = this.m.mix.uniforms; mix.uA.value = tail.texture; mix.uB.value = own.texture; mix.uWeight.value = tailWeight;
      this.passes.draw(this.m.mix, target);
    } else this.present(target, view, input.seconds, loop, beats, seedTime, shown, palette[2]);
  }

  dispose(): void {
    this.clearCheckpoints(); this.tail?.dispose(); this.tail = null; this.frame?.dispose(); this.smoke?.dispose();
    for (const item of [this.fluid, this.state, this.soft, this.form, this.wideA, this.wideB, ...Object.values(this.m), this.pointMaterial]) item.dispose();
    this.passes.dispose();
  }
}

/** One cloud per visible layer. Random data and point geometry are shared between them. */
export class SmokeCloudRenderer {
  private readonly clouds = new Map<string, Cloud>();
  private shared: Shared | null = null;

  private resources(): Shared {
    if (this.shared) return this.shared;
    const start = randomField(90210);
    for (let i = 2; i < start.length; i += 4) { start[i] = 1; start[i + 1] = 1; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(COUNT).fill(1), 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    return this.shared = { random: fieldTexture(randomField(1729)), start: fieldTexture(start), geometry };
  }

  draw(renderer: THREE.WebGLRenderer, layer: Layer, original: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, audio: SmokeAudioFrame | undefined, timing: { exact: boolean; playing: boolean; duration: number }): void {
    const aspect = width / height;
    let cloud = this.clouds.get(layer.id);
    if (cloud && Math.abs(cloud.aspect - aspect) > .001) { cloud.dispose(); this.clouds.delete(layer.id); cloud = undefined; }
    if (!cloud) { cloud = new Cloud(renderer, aspect, this.resources()); this.clouds.set(layer.id, cloud); }
    const clock = ((phase % TAU) + TAU) % TAU;
    cloud.sample({ layer, simulation: original.params, seconds: clock / TAU * timing.duration, loopSeconds: timing.duration, exact: timing.exact, playing: timing.playing, audio, width, height }, target);
  }

  needsRefresh(): boolean { for (const cloud of this.clouds.values()) if (cloud.pending) return true; return false; }
  keep(ids: ReadonlySet<string>): void { for (const [id, cloud] of this.clouds) if (!ids.has(id)) { cloud.dispose(); this.clouds.delete(id); } }
  /** After a lost GPU context everything on the GPU has gone, so the clouds start again. */
  resetGpuHistory(): void { for (const cloud of this.clouds.values()) cloud.dispose(); this.clouds.clear(); if (this.shared) { this.shared.random.dispose(); this.shared.start.dispose(); this.shared.geometry.dispose(); this.shared = null; } }
  dispose(): void { this.resetGpuHistory(); }
}
