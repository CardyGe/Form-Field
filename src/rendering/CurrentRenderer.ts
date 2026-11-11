import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { sourceViewMatrix } from './source-view';
import { flowHash, flowStep, FLOW_STEPS, phraseTime, smooth, TAU, wrapUnit, type FlowSettings } from './flow-field';
import { sampleSurface } from '../core/surface-layout';
import { surfaceFieldGLSL, type PreparedSurface } from './surface-fields';

const MAX_STRANDS = 4096, MAX_VERTICES = MAX_STRANDS * FLOW_STEPS * 6;
/** Finite-age trajectories reconstructed from their birth, not display history.
 * See the motion/lifecycle design and primary sources in docs/projection-media-direction-2026-11-10.md.
 */
export class CurrentRenderer {
  private pathKey='';
  private paths=new Map<string,Float64Array>();
  private readonly pathGroups=new Map<string,Map<string,Float64Array>>();
  private readonly positions = new Float32Array(MAX_VERTICES * 3);
  private readonly shades = new Float32Array(MAX_VERTICES * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: `attribute vec3 shade; varying vec3 vShade;varying vec2 vSource; uniform mat3 uInverse; uniform vec2 uField;
      void main(){vec2 uv=position.xy/uField+.5;vSource=uv;vec2 screen=(uInverse*vec3(uv,1.)).xy;gl_Position=vec4(screen*2.-1.,0.,1.);vShade=shade;}`,
    fragmentShader: `precision highp float; varying vec3 vShade;varying vec2 vSource; uniform vec3 uPalette[6];uniform float uSheen,uDepth;
      ${surfaceFieldGLSL}
      void main(){float surface=uSurfaceRole>1.5&&uSurfaceRole<2.5?1.:surfaceCoverage(vSource);float a=clamp(vShade.x,0.,1.)*(1.-smoothstep(.55,1.,abs(vShade.z)))*surface;vec3 color=mix(uPalette[0],uPalette[2],vShade.y);
      color=mix(color,uPalette[4],(.5+.5*sin(vShade.y*6.28))*.24)*(.75+uSheen*.6+(1.-abs(vShade.z))*uDepth*.6);gl_FragColor=vec4(color*a,a);}`,
    uniforms: { uInverse: {value:new THREE.Matrix3()}, uField:{value:new THREE.Vector2()}, uPalette:{value:Array.from({length:6},()=>new THREE.Color())},uSheen:{value:0},uDepth:{value:0},uSurface:{value:null},uSurfaceRole:{value:0},uSurfaceInfluence:{value:0} },
    transparent:true, premultipliedAlpha:true, depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
  });
  constructor(){
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('shade',new THREE.BufferAttribute(this.shades,3).setUsage(THREE.DynamicDrawUsage));
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
  }
  draw(renderer:THREE.WebGLRenderer,layer:Layer,phase:number,width:number,height:number,target:THREE.WebGLRenderTarget,surface?:PreparedSurface):void{
    const p=layer.params,aspect=width/height,scale=p.scale,view=sourceViewMatrix(layer.transform,aspect),inverse=view.clone().invert();
    const corners=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>new THREE.Vector3(x,y,1).applyMatrix3(view));
    const spacing=.8,marginX=Math.abs(Math.cos(p.flowDirection))*3.8+1.3,marginY=Math.abs(Math.sin(p.flowDirection))*3.8+1.3;
    const x0=Math.floor((Math.min(...corners.map(v=>(v.x-.5)*aspect*scale))-marginX)/spacing);
    const x1=Math.ceil((Math.max(...corners.map(v=>(v.x-.5)*aspect*scale))+marginX)/spacing);
    const y0=Math.floor((Math.min(...corners.map(v=>(v.y-.5)*scale))-marginY)/spacing);
    const y1=Math.ceil((Math.max(...corners.map(v=>(v.y-.5)*scale))+marginY)/spacing);
    const density=Math.max(1,Math.round(p.fibres/3)),cells=(x1-x0+1)*(y1-y0+1);
    const stride=Math.max(1,Math.ceil(Math.sqrt(cells*density/MAX_STRANDS)));
    const settings:FlowSettings={travel:p.travel,curl:p.curl,eddy:p.eddyScale,detail:p.flowDetail,direction:p.flowDirection,obstacle:p.surfaceHole,seed:p.seed};
    const pathKey=JSON.stringify([settings,surface?.key,surface?aspect*scale:0,surface?scale:0]);
    if(pathKey!==this.pathKey){let paths=this.pathGroups.get(pathKey);if(!paths){paths=new Map();this.pathGroups.set(pathKey,paths);}else{this.pathGroups.delete(pathKey);this.pathGroups.set(pathKey,paths);}this.paths=paths;this.pathKey=pathKey;while(this.pathGroups.size>4)this.pathGroups.delete(this.pathGroups.keys().next().value!);}
    if(surface?.role===1)settings.boundary=(x,y)=>{const f=sampleSurface(surface.grid,x/(aspect*scale)+.5,y/scale+.5),nx=f.nx/(aspect*scale),ny=f.ny/scale,length=Math.max(1e-8,Math.hypot(nx,ny));return {distance:f.distance/length,nx:nx/length,ny:ny/length};};
    const time=phraseTime((phase/TAU*p.cycles+p.phaseOffset),p.motion,p.phrase);
    const t=p.motion===0?0:time;
    let vertices=0,strands=0;
    const vertex=(x:number,y:number,alpha:number,tone:number,sheen:number)=>{const i=vertices++*3;this.positions[i]=x;this.positions[i+1]=y;this.positions[i+2]=0;this.shades[i]=alpha;this.shades[i+1]=tone;this.shades[i+2]=sheen;};
    outer:for(let iy=Math.floor(y0/stride)*stride;iy<=y1;iy+=stride)for(let ix=Math.floor(x0/stride)*stride;ix<=x1;ix+=stride)for(let j=0;j<density;j++){
      if(strands++>=MAX_STRANDS)break outer;
      const seed=p.seed+j*97,identity=flowHash(ix,iy,seed),age=wrapUnit(t+identity);
      let x=(ix+flowHash(ix+7,iy,seed))*spacing,y=(iy+flowHash(ix,iy+11,seed))*spacing;
      if(settings.obstacle>0&&Math.hypot(x,y)<settings.obstacle+.04)continue;
      if(settings.boundary&&settings.boundary(x,y).distance<.005)continue;
      if(surface&&surface.role!==1){const f=sampleSurface(surface.grid,x/(aspect*scale)+.5,y/scale+.5);if(surface.role===2?f.coverage<.5:Math.abs(f.distance)>.03)continue;}
      const key=`${ix}:${iy}:${j}`;
      let path=this.paths.get(key);
      if(!path){path=new Float64Array((FLOW_STEPS+1)*2);path.set([x,y]);let X=x,Y=y;for(let i=1;i<=FLOW_STEPS;i++){[X,Y]=flowStep(X,Y,-identity+(i-1)/FLOW_STEPS,1/FLOW_STEPS,settings);path[i*2]=X;path[i*2+1]=Y;}this.paths.set(key,path);while(this.paths.size>8192)this.paths.delete(this.paths.keys().next().value!);}
      const tail=Math.max(.04,p.trailLength*.68),begin=Math.max(0,age-tail);
      const life=smooth(age/.08)*smooth((1-age)/.12);
      const tone=flowHash(ix+41,iy-31,seed),radius=(.0015+p.width*.005)*(1+p.depth*(identity-.5));
      let previous:[number,number]|null=null,previousAge=0;
      for(let step=0;step<=FLOW_STEPS;step++){
        const at=step/FLOW_STEPS;
        x=path[step*2];y=path[step*2+1];
        const next=Math.min(at,age);
        if(at>age&&previous){const f=(age-previousAge)*FLOW_STEPS;x=previous[0]+(x-previous[0])*f;y=previous[1]+(y-previous[1])*f;}
        if(previous&&next>begin&&next>previousAge){
          const dx=x-previous[0],dy=y-previous[1],length=Math.max(1e-7,Math.hypot(dx,dy)),nx=-dy/length*radius,ny=dx/length*radius;
          const a=life*smooth((previousAge-begin)/(.025+tail*.12))*smooth((age-previousAge)/.04),b=life*smooth((next-begin)/(.025+tail*.12))*smooth((age-next)/.04);
          
          vertex(previous[0]-nx,previous[1]-ny,a,tone,-1);vertex(previous[0]+nx,previous[1]+ny,a,tone,1);vertex(x+nx,y+ny,b,tone,1);
          vertex(previous[0]-nx,previous[1]-ny,a,tone,-1);vertex(x+nx,y+ny,b,tone,1);vertex(x-nx,y-ny,b,tone,-1);
        }
        previous=[x,y];previousAge=next;if(at>=age)break;
      }
    }
    this.geometry.setDrawRange(0,vertices);for(const key of ['position','shade']){const a=this.geometry.getAttribute(key) as THREE.BufferAttribute;a.clearUpdateRanges();a.addUpdateRange(0,vertices*3);a.needsUpdate=true;}
    const u=this.material.uniforms;u.uInverse.value.copy(inverse);u.uField.value.set(aspect*scale,scale);
    u.uPalette.value.forEach((c:THREE.Color,i:number)=>c.set(layer.palette[i]));u.uSheen.value=p.anisotropy;u.uDepth.value=p.depth;
    u.uSurface.value=surface?.texture??null;u.uSurfaceRole.value=surface?.role??0;u.uSurfaceInfluence.value=surface?.influence??0;
    const auto=renderer.autoClear;renderer.autoClear=false;
    try{renderer.setRenderTarget(target);renderer.render(this.scene,this.camera);}finally{renderer.autoClear=auto;}
  }
  dispose(){this.paths.clear();this.pathGroups.clear();this.geometry.dispose();this.material.dispose();}
}
