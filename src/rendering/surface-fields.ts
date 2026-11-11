import * as THREE from 'three';
import type { Layer } from '../shared/types';
import {distanceGrid,polygonDistance,sampleSurface,type SurfaceGrid} from '../core/surface-layout';
export interface PreparedSurface {key:string;grid:SurfaceGrid;texture:THREE.DataTexture;role:number;influence:number}
export function prepareSurface(layer:Layer,image?:CanvasImageSource):PreparedSurface|null {
  const surface=layer.surface;if(!surface||surface.influence===0)return null;
  const size=128,coverage=new Float32Array(size*size);
  if(surface.source==='polygon'){
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)coverage[y*size+x]=polygonDistance((x+.5)/size,(y+.5)/size,surface.points)<0?1:0;
  }else{
    if(!image)throw new Error('The surface image mask is still loading.');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,size,size);const pixels=ctx.getImageData(0,0,size,size).data;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const u=((x+.5)/size-.5)/layer.mask.size+.5,v=((y+.5)/size-.5)/layer.mask.size+.5;
      const ix=Math.max(0,Math.min(size-1,Math.floor(u*size))),iy=Math.max(0,Math.min(size-1,Math.floor((1-v)*size))),i=(iy*size+ix)*4;
      const a=u<0||u>1||v<0||v>1?0:(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/255*pixels[i+3]/255;
      coverage[y*size+x]=layer.mask.invert?1-a:a;
    }
    canvas.width=canvas.height=1;
  }
  const grid=distanceGrid(coverage,size),data=new Uint16Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const s=sampleSurface(grid,(x+.5)/size,(y+.5)/size),i=(y*size+x)*4;[s.distance,s.nx,s.ny,s.coverage].forEach((v,j)=>data[i+j]=THREE.DataUtils.toHalfFloat(v));}
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.HalfFloatType);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;
  return {key:surfaceKey(layer),grid,texture,role:{obstacle:1,emitter:2,edge:3}[surface.role],influence:surface.influence};
}
const maskIdentities=new WeakMap<Layer['mask'],{dataUrl:string|undefined;id:number}>();let nextMaskIdentity=0;
export function surfaceKey(layer:Layer):string{
  if(layer.surface?.source!=='mask')return JSON.stringify(layer.surface);
  let identity=maskIdentities.get(layer.mask);if(!identity||identity.dataUrl!==layer.mask.dataUrl){identity={dataUrl:layer.mask.dataUrl,id:++nextMaskIdentity};maskIdentities.set(layer.mask,identity);}
  return JSON.stringify([layer.surface,identity.id,layer.mask.size,layer.mask.invert]);
}
export const surfaceFieldGLSL=/* glsl */`
uniform sampler2D uSurface;uniform float uSurfaceRole,uSurfaceInfluence;
vec4 surfaceSample(vec2 uv){vec4 f=texture2D(uSurface,clamp(uv,0.,1.));if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){f.r=max(f.r,0.)+length(max(max(-uv,uv-1.),0.));f.a=0.;}return f;}
float surfaceCoverage(vec2 uv){if(uSurfaceRole<.5)return 1.;vec4 f=surfaceSample(uv);float a=uSurfaceRole<1.5?smoothstep(-.006,.006,f.r):uSurfaceRole<2.5?1.-smoothstep(-.006,.006,f.r):exp(-abs(f.r)*90.);return mix(1.,a,uSurfaceInfluence);}
`;
