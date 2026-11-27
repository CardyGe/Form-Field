import * as THREE from 'three';
import { cellAudioHighlight, isCellWave } from '../core/graphics';
import type { Layer } from '../shared/types';
import { GraphicLayoutCache, sampleGraphicGlyphs, type Glyph } from './graphic-layout';
import { graphicGridBounds } from './graphic-view';

const vertex = /* glsl */`
attribute vec4 aBounds, aStyle, aPaint, aExtra;
attribute vec2 aCell;
uniform float uAspect, uPixel, uRotation;
uniform vec4 uCellField; // Strength, loop phase, still phase, motion depth.
uniform float uCellFieldLayout;
varying float vCellField;
uniform float uPackedSolid,uClipCell;
uniform vec2 uPatternScale,uTranslation;
uniform float uLayerScale,uLayerRotation;
uniform vec2 uLayerTranslation;
varying vec2 vPoint, vHalf;
varying vec4 vStyle, vPaint, vExtra;
float fieldWave(vec2 grid, float phase) {
  if(uCellFieldLayout>1.5){
    // A periodic distance field keeps the ripple continuous across tiled edges.
    float radius=length(sin(grid*.5));
    return .83*cos(8.2*radius-phase)+.17*cos(grid.x-grid.y+phase);
  }
  if(uCellFieldLayout>.5){
    return .57*cos(grid.x+grid.y-phase)+.43*cos(grid.x-grid.y+phase);
  }
  return .76*cos(grid.x+grid.y-phase)+.24*cos(grid.y+phase);
}
void main(){
  vHalf=aBounds.zw;
  // Conservative subpixel coverage closes float32 cracks between packed fills
  // after rotation/magnification; SDF shapes keep their normal filter padding.
  float padding=mix(5.,.02,uPackedSolid)*uPixel/(min(uPatternScale.x,uPatternScale.y)*uLayerScale);
  vPoint=position.xy*(vHalf+vec2(padding));
  vStyle=aStyle;vPaint=aPaint;vExtra=aExtra;
  // Whole harmonics make the reflection continuous at the boundaries of a repeated source.
  vCellField=0.;
  if(aPaint.y>2.5&&uCellField.x>0.){
    vec2 grid=6.2831853*vec2(aBounds.x/uAspect,aBounds.y);
    float stillWave=fieldWave(grid,uCellField.z);
    float movingWave=fieldWave(grid,uCellField.y);
    vCellField=uCellField.x*mix(stillWave,movingWave,uCellField.w);
  }
  float c=cos(aStyle.w),s=sin(aStyle.w);
  vec2 p=aBounds.xy+mat2(c,s,-s,c)*vPoint;
  // Grid glyphs are axis-aligned in pattern space (path segments turn by 90°).
  // Clip their quads before projection, retaining local SDF coordinates. Doing
  // this in fragments discards MSAA samples at cell joins and leaves a seam.
  if(uClipCell>.5){
    p=clamp(p,aCell-vec2(uAspect*.5,.5),aCell+vec2(uAspect*.5,.5));
    vPoint=mat2(c,-s,s,c)*(p-aBounds.xy);
  }
  p*=uPatternScale;
  c=cos(uRotation);s=sin(uRotation);
  p=mat2(c,s,-s,c)*p+uTranslation;
  c=cos(uLayerRotation);s=sin(uLayerRotation);
  p=mat2(c,s,-s,c)*p*uLayerScale+uLayerTranslation;
  gl_Position=vec4(p*vec2(2./uAspect,2.),0.,1.);
}`;
const fragment = /* glsl */`
precision highp float;
uniform vec3 uPalette[6];
uniform float uSoftness,uBorder,uBalance,uCellRim,uCellGrain;
uniform float uPackedSolid;
uniform vec3 uCellFinish;
uniform vec2 uCellLight;
uniform float uCellAudio;
varying float vCellField;
varying vec2 vPoint,vHalf;
varying vec4 vStyle,vPaint,vExtra;
vec3 palette(float value){
  float t=1.-abs(mod(value,2.)-1.);
  t=pow(clamp(t,0.,1.),uBalance)*4.;
  int i=int(min(floor(t),3.));
  return mix(uPalette[i],uPalette[i+1],fract(min(t,3.99999)));
}
float distanceToShape(){
  if(vStyle.x>.5&&vStyle.x<1.5)return (length(vPoint/max(vHalf,vec2(.000001)))-1.)*min(vHalf.x,vHalf.y);
  if(vStyle.x>1.5){
    vec2 p=vPoint/max(vHalf,vec2(.000001));
    float sector=6.28318530718/max(vStyle.z,3.);
    float a=atan(p.y,p.x);
    return (cos(floor(.5+a/sector)*sector-a)*length(p)-cos(3.14159265359/vStyle.z))*min(vHalf.x,vHalf.y);
  }
  float r=min(vHalf.x,vHalf.y)*vStyle.y;
  vec2 q=abs(vPoint)-vHalf+r;
  return length(max(q,0.))+min(max(q.x,q.y),0.)-r;
}
float grainHash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float grainAt(vec2 p) {
  vec2 i=floor(p), f=smoothstep(0.,1.,fract(p));
  return mix(mix(grainHash(i),grainHash(i+vec2(1.,0.)),f.x),
    mix(grainHash(i+vec2(0.,1.)),grainHash(i+1.),f.x),f.y)-.5;
}
vec3 reflectCell(vec3 ink, vec2 point, float inside, float seed) {
  float metal=uCellFinish.x, iridescence=uCellFinish.y, roughness=uCellFinish.z;
  // A broad reflected strip on the face and a tighter highlight along the bevel.
  // The light moves on the same closed timeline as the rest of the graphic.
  float crossLight=dot(point,uCellLight);
  float reflection=crossLight+.15*dot(point,point)+.18*(seed-.5);
  float width=mix(.17,.49,roughness);
  float filterWidth=max(width,.75*fwidth(reflection));
  float band=(1.-smoothstep(0.,filterWidth,abs(reflection-.18-.58*vCellField)))*(width/filterWidth);
  band*=1.+.36*min(vCellField,0.);
  float facing=clamp(.54+.34*crossLight,0.,1.);
  float edge=(1.-smoothstep(.02,.38,inside))*facing;
  float reflectionAmount=clamp(band*.68+edge*.50,0.,1.);
  vec3 metalTint=mix(ink,vec3(1.,.975,.92),.58);
  ink*=1.-metal*(.06+.11*(1.-band));
  ink=mix(ink,metalTint,metal*reflectionAmount*.63);
  // Angle-dependent tint concentrated on the highlights keeps the palette readable.
  float filmAngle=3.25*crossLight+2.2*seed+1.6*uCellLight.x+1.15*vCellField;
  vec3 film=.60+.36*cos(filmAngle+vec3(0.,2.0944,4.1888));
  vec3 pearl=mix(ink,film,.58);
  ink=mix(ink,pearl,iridescence*clamp(band*.64+edge*.72,0.,1.)*.72);
  // Lift only the strip and bevel, with headroom for pale colours and no change to alpha.
  vec3 headroom=max(vec3(1.)-ink,vec3(0.));
  return ink+min(vec3(.12),headroom*.36)*uCellAudio*reflectionAmount;
}
void main(){
  float d=distanceToShape();
  float aa=max(fwidth(d)*.7,.0000005)*(1.+uSoftness);
  float coverage=1.-smoothstep(-aa,aa,d);
  // Contiguous rectangular fills share hardware sample coverage. Independently
  // fading both SDF edges would leave alpha .75 at their join, a false dark grid.
  if(uPackedSolid>.5)coverage=1.;
  if(vPaint.y>.5&&vPaint.y<1.5)coverage*=smoothstep(-vPaint.z-aa,-vPaint.z+aa,d);
  if(vPaint.y>1.5&&vPaint.y<2.5){
    float spacing=max(vPaint.w,.000001);
    float band=(abs(fract((-d+vExtra.y)/spacing)-.5)-vExtra.x*.5)*spacing;
    float resolved=1.-smoothstep(-aa,aa,band);
    coverage*=mix(resolved,vExtra.x,smoothstep(.3,.8,aa/spacing));
  }
  vec3 color=palette(vPaint.x);
  if(vPaint.y>2.5){
    float halfSize=min(vHalf.x,vHalf.y);
    float inside=max(-d/max(halfSize,.000001),0.);
    float rimWidth=max(.14*halfSize,aa);
    float hole=1.-smoothstep(-rimWidth-aa,-rimWidth+aa,d);
    vec2 cellPoint=vPoint/max(vHalf,vec2(.000001));
    float insetDist=(max(abs(cellPoint.x),abs(cellPoint.y))-.40)*halfSize;
    float inset=(1.-smoothstep(-aa,aa,insetDist))*vExtra.y;
    float body=mix(1.,1.-hole,vExtra.x);
    vec2 grainUv=cellPoint*32.+vec2(vExtra.w*153.,vExtra.w*79.);
    float grainFootprint=length(fwidth(grainUv));
    float fine=1.-smoothstep(.30,1.1,grainFootprint);
    float coarse=1.-smoothstep(.30,1.1,grainFootprint*.27);
    float grain=grainAt(grainUv)*fine+.4*grainAt(grainUv*.27)*coarse;
    float light=clamp(.5+.30*cellPoint.y-.24*cellPoint.x,0.,1.);
    float highlight=(1.-smoothstep(0.,.095,inside))*light;
    float bevel=smoothstep(.03,.18,inside)*(1.-smoothstep(.18,.45,inside));
    color*=max(.35,1.+uCellGrain*grain-uCellRim*bevel*.38);
    color=mix(color,vec3(1.,.98,.96),uCellRim*highlight*.37);
    color=mix(color,palette(vPaint.x+.11),inset*(1.-body));
    if(uCellFinish.x>0.||uCellFinish.y>0.||uCellAudio>0.)color=reflectCell(color,cellPoint,inside,vExtra.w);
    coverage*=max(body,inset);
  }
  coverage*=vExtra.z;
  if(coverage<=.00001)discard;
  if(uBorder>.5&&vPaint.y<.5){
    float edge=smoothstep(-vPaint.z-aa,-vPaint.z+aa,d);
    color=mix(color,mix(uPalette[5],uPalette[0],.35),edge);
  }
  gl_FragColor=vec4(color*coverage,coverage);
}`;
const quadVertex='void main(){gl_Position=vec4(position.xy,0.,1.);}';

class GlyphBatch {
  readonly geometry = new THREE.InstancedBufferGeometry();
  readonly mesh:THREE.Mesh;
  private capacity=0;
  constructor(readonly material:THREE.ShaderMaterial){
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
    this.geometry.setIndex([0,1,2,0,2,3]);
    this.mesh=new THREE.Mesh(this.geometry,material);this.mesh.frustumCulled=false;
  }
  update(glyphs:Glyph[]):void {
    if(glyphs.length>this.capacity){
      this.capacity=2**Math.ceil(Math.log2(Math.max(16,glyphs.length)));
      // Retire old GPU buffers before replacing their attributes.
      this.geometry.dispose();
      for(const key of ['aBounds','aStyle','aPaint','aExtra'])this.geometry.setAttribute(key,new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage));
      this.geometry.setAttribute('aCell',new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*2),2).setUsage(THREE.DynamicDrawUsage));
    }
    this.geometry.instanceCount=glyphs.length;this.mesh.visible=glyphs.length>0;
    if(!glyphs.length)return;
    const bounds=this.geometry.getAttribute('aBounds') as THREE.InstancedBufferAttribute;
    const styles=this.geometry.getAttribute('aStyle') as THREE.InstancedBufferAttribute;
    const paints=this.geometry.getAttribute('aPaint') as THREE.InstancedBufferAttribute;
    const extras=this.geometry.getAttribute('aExtra') as THREE.InstancedBufferAttribute;
    const cells=this.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    glyphs.forEach((g,i)=>{bounds.setXYZW(i,g.x,g.y,g.hx,g.hy);styles.setXYZW(i,g.type,g.roundness,g.sides,g.angle);paints.setXYZW(i,g.color,g.fill,g.stroke,g.spacing);extras.setXYZW(i,g.duty,g.bandPhase,g.alpha,g.textureSeed??0);cells.setXY(i,g.cellX??0,g.cellY??0);});
    for(const attr of [bounds,styles,paints,extras]){attr.clearUpdateRanges();attr.addUpdateRange(0,glyphs.length*4);attr.needsUpdate=true;}
    cells.clearUpdateRanges();cells.addUpdateRange(0,glyphs.length*2);cells.needsUpdate=true;
  }
  dispose():void {this.geometry.dispose();this.material.dispose();}
}

/** Draws integrated procedural layers directly into StudioRenderer's source target. */
export class GraphicRenderer {
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private readonly cache=new GraphicLayoutCache();
  private readonly uniforms={
    uPatternScale:{value:new THREE.Vector2(1,1)},uTranslation:{value:new THREE.Vector2()},uRotation:{value:0},
    uLayerScale:{value:1},uLayerRotation:{value:0},uLayerTranslation:{value:new THREE.Vector2()},
    uAspect:{value:1},uPixel:{value:1/540},uSoftness:{value:0},uBorder:{value:0},uBalance:{value:1},
    uPackedSolid:{value:0},uCellRim:{value:0},uCellGrain:{value:0},
    uCellFinish:{value:new THREE.Vector3()},uCellLight:{value:new THREE.Vector2()},uCellAudio:{value:0},
    uCellField:{value:new THREE.Vector4()},uCellFieldLayout:{value:0},
    uClipCell:{value:0},
    uPalette:{value:Array.from({length:6},()=>new THREE.Color())},
  };
  private readonly paint:GlyphBatch;
  private readonly erase:GlyphBatch;
  private readonly backgroundMaterial:THREE.ShaderMaterial;
  private readonly backgroundGeometry=new THREE.PlaneGeometry(2,2);
  constructor(){
    const settings={vertexShader:vertex,fragmentShader:fragment,uniforms:this.uniforms,depthWrite:false,depthTest:false,toneMapped:false,transparent:true,premultipliedAlpha:true};
    this.paint=new GlyphBatch(new THREE.ShaderMaterial(settings));
    this.erase=new GlyphBatch(new THREE.ShaderMaterial({...settings,blending:THREE.CustomBlending,blendSrc:THREE.ZeroFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquation:THREE.AddEquation}));
    this.paint.mesh.renderOrder=0;this.erase.mesh.renderOrder=1;
    this.backgroundMaterial=new THREE.ShaderMaterial({vertexShader:quadVertex,fragmentShader:'uniform vec3 uColor;uniform float uAlpha;void main(){gl_FragColor=vec4(uColor*uAlpha,uAlpha);}',uniforms:{uColor:{value:new THREE.Color()},uAlpha:{value:1}},depthTest:false,depthWrite:false,toneMapped:false,transparent:true,premultipliedAlpha:true,blending:THREE.CustomBlending,blendSrc:THREE.OneMinusDstAlphaFactor,blendDst:THREE.OneFactor,blendEquation:THREE.AddEquation});
    const bg=new THREE.Mesh(this.backgroundGeometry,this.backgroundMaterial);bg.renderOrder=2;bg.frustumCulled=false;
    this.scene.add(this.paint.mesh,this.erase.mesh,bg);
  }
  draw(renderer:THREE.WebGLRenderer,target:THREE.WebGLRenderTarget,layer:Layer,phase:number,width:number,height:number,inView=false,signals?:Readonly<Record<string,number>>):void {
    const aspect=width/height;
    const radial = layer.params.style === 1 || layer.params.style === 3;
    // Grid fields repeat a complete cell through a filtered compositor sampler.
    // Radial fields extend their geometry instead, preserving a single centre.
    const sourceLayer = radial ? layer : { ...layer, params: { ...layer.params, size: 1, stretch: 1,
      centerX: 0, centerY: 0, orientation: 0, turns: 0 }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } };
    let glyphs=sampleGraphicGlyphs(sourceLayer,phase,aspect,this.cache.get(sourceLayer.params,aspect));
    if(!radial&&inView){
      const template=glyphs, cells=graphicGridBounds(layer,phase,aspect);
      const p=layer.params,tr=layer.transform;
      const wrapped=((phase%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
      const angle=p.orientation+(p.style===4?0:p.turns*wrapped);
      const c=Math.cos(angle),s=Math.sin(angle),lc=Math.cos(-tr.rotation),ls=Math.sin(-tr.rotation);
      glyphs=[];
      for(let y=cells.y0;y<=cells.y1;y++)for(let x=cells.x0;x<=cells.x1;x++){
        const cellX=x*aspect,cellY=y;
        for(const glyph of template){
          const gx=glyph.x+cellX,gy=glyph.y+cellY;
          const px=gx*p.size*p.stretch,py=gy*p.size;
          const qx=(px*c-py*s+p.centerX*aspect*.5)*tr.scale,qy=(px*s+py*c+p.centerY*.5)*tr.scale;
          const wx=qx*lc-qy*ls+tr.x*aspect,wy=qx*ls+qy*lc-tr.y;
          const bound=Math.hypot(glyph.hx,glyph.hy)*p.size*Math.max(p.stretch,1)*tr.scale+5/height;
          if(Math.abs(wx)<=aspect/2+bound&&Math.abs(wy)<=.5+bound)glyphs.push({...glyph,x:gx,y:gy,cellX,cellY});
        }
      }
    }
    this.paint.update(glyphs.filter(g=>!g.erase));this.erase.update(glyphs.filter(g=>g.erase));
    const p = inView ? layer.params : sourceLayer.params, tr = inView ? layer.transform : sourceLayer.transform;
    const wrapped=((phase%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
    this.uniforms.uPatternScale.value.set(p.size*p.stretch,p.size);
    this.uniforms.uTranslation.value.set(p.centerX*aspect*.5,p.centerY*.5);
    this.uniforms.uRotation.value=p.orientation+(p.style===4?0:p.turns*wrapped);
    this.uniforms.uLayerScale.value=tr.scale;this.uniforms.uLayerRotation.value=-tr.rotation;
    this.uniforms.uLayerTranslation.value.set(tr.x*aspect,-tr.y);
    this.uniforms.uAspect.value=aspect;this.uniforms.uPixel.value=1/height;
    this.uniforms.uSoftness.value=layer.params.softness;this.uniforms.uBorder.value=Number(layer.params.style===3);
    const cellWave=isCellWave(p.style,p.variant);
    this.uniforms.uCellRim.value=cellWave?p.cellRim:0;
    this.uniforms.uCellGrain.value=cellWave?p.cellGrain:0;
    if (cellWave) {
      const lightCycles=p.cellLightCycles||p.cycles;
      const stillPhase=p.phaseOffset*Math.PI*2;
      const lightPhase=wrapped*Math.round(lightCycles)+stillPhase;
      const lightTravel=p.cellLightTravel??.46;
      const lightAngle=(p.cellLightAngle??.72)+lightTravel*Math.sin(lightPhase)*p.motion;
      this.uniforms.uCellFinish.value.set(p.cellMetallic??0,p.cellIridescence??0,p.cellRoughness??.5);
      this.uniforms.uCellLight.value.set(Math.cos(lightAngle),Math.sin(lightAngle));
      const fieldMotion=p.motion*Math.min(1,lightTravel/.46);
      this.uniforms.uCellField.value.set(p.cellLightField??0,lightPhase,stillPhase,fieldMotion);
      this.uniforms.uCellFieldLayout.value=p.cellLightLayout??0;
      this.uniforms.uCellAudio.value=cellAudioHighlight(p.cellAudioAmount,p.cellAudioSource,signals);
    }
    this.uniforms.uPackedSolid.value=Number(!cellWave&&p.style===2&&p.fill===0&&p.tileGap===0&&p.roundness===0
      &&(p.sweep===0||p.motion===0||(p.shrink===0&&p.rounding===0)));
    this.uniforms.uClipCell.value=Number(!radial&&inView);
    this.uniforms.uBalance.value=layer.params.colorBalance;
    layer.palette.forEach((hex,i)=>this.uniforms.uPalette.value[i].set(hex));
    this.backgroundMaterial.uniforms.uColor.value.set(layer.palette[5]);
    this.backgroundMaterial.uniforms.uAlpha.value=layer.params.backgroundOpacity;
    renderer.setRenderTarget(target);renderer.render(this.scene,this.camera);
  }
  dispose():void {this.paint.dispose();this.erase.dispose();this.backgroundGeometry.dispose();this.backgroundMaterial.dispose();this.cache.clear();}
}
