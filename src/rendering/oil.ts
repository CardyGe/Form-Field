import { projectionOpticsGLSL } from './projection-optics';
import { sourceViewGLSL } from './source-view';
import { OIL_WAKE_SAMPLES } from './oil-motion';

// Material data is deliberately separate from optical colour. All distances use
// canvas-height units; sampling/filter widths track the actual render resolution.
const common = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform vec2 uResolution;
uniform float uAspect,uSeed,uCaustics,uIridescence,uAnisotropy,uSheenAngle;
${projectionOpticsGLSL}
uniform vec3 uPalette[6];
uniform float uPoolSize,uCoverage,uCellSize,uLensSize,uLensAspect;
uniform float uDrag,uThickness,uRefraction,uWetness,uInk,uFilaments;
uniform float uSoftness,uLightAngle,uShadow,uGrain,uSubstrate,uQuality;
uniform float uDeformation,uLensDepth,uCellComplexity,uDispersion,uLensShapePhase;
uniform vec2 uSlide,uLens,uDirection;
uniform float uSlideAngle,uLensAngle,uPresence,uStrain;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
vec2 world(vec2 uv){return (sourceUV(uv)-.5)*vec2(uAspect,1.);}
vec2 uvFor(vec2 p){return sourceScreenUV(p/vec2(uAspect,1.)+.5);}
vec2 sheet(vec2 p){return rot(-uSlideAngle)*(p-uSlide);}
float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33+uSeed*.0001);return fract((p3.x+p3.y)*p3.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float a=noise(p)*.57; p=rot(.7)*p*2.03+5.7;a+=noise(p)*.28;return a+noise(p*2.01+8.3)*.15;}
vec2 lensCoord(vec2 p){
  vec2 v=rot(-uLensAngle)*(p-uLens)/vec2(uLensSize*sqrt(uLensAspect),uLensSize/sqrt(uLensAspect));
  vec2 axis=rot(uLensShapePhase)*(v/max(length(v),.0001));
  float lobes=axis.x*(axis.x*axis.x-3.*axis.y*axis.y);
  float boundary=1.+uDeformation*(lobes*.055+axis.x*axis.y*.045);
  return v/boundary;
}
vec3 light(){return normalize(vec3(cos(uLightAngle)*.55,sin(uLightAngle)*.55,1.));}
`;

export const oilFieldsFragment = /* glsl */`${common}
uniform vec4 uWake[${OIL_WAKE_SAMPLES}];
vec2 cells(vec2 p){
  vec2 id=floor(p),f=fract(p);float first=10.,second=10.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 jitter=vec2(hash(id+g),hash(id+g+31.7));
    vec2 r=g+.15+.7*jitter-f;float d=dot(r,r);
    if(d<first){second=first;first=d;}else second=min(second,d);
  }
  return vec2(sqrt(first),sqrt(second)-sqrt(first));
}
void main(){
  vec2 p=world(vUv),q=sheet(p),base=q/max(uPoolSize,.1);
  vec2 warp=vec2(fbm(base*4.+uSeed*.03),fbm(base*4.+17.3))-.5;
  vec2 b=base+warp*.20;
  float pool=exp(-dot((b-vec2(-.18,.12))*vec2(1.35,1.05),(b-vec2(-.18,.12))*vec2(1.35,1.05))*5.);
  pool=max(pool,.8*exp(-dot((b-vec2(.40,-.26))*vec2(1.,1.25),(b-vec2(.40,-.26))*vec2(1.,1.25))*35.));
  pool=max(pool,.8*exp(-dot(b-vec2(-.55,-.34),b-vec2(-.55,-.34))*100.));
  pool=max(pool,.8*exp(-dot(b-vec2(.54,.36),b-vec2(.54,.36))*80.));
  float threshold=mix(.85,.025,uCoverage);
  float edge=max(fwidth(pool)*.7,.001)+uSoftness*.015;
  float coverage=smoothstep(threshold-edge,threshold+edge,pool);
  float contact=0.;
  for(int i=0;i<${OIL_WAKE_SAMPLES};i++){
    vec2 point=uWake[i].xy;
    float radius=max(uWake[i].z,.01),weight=uWake[i].w;
    if(i>0){
      vec2 segment=uWake[i-1].xy-point;
      float along=clamp(dot(q-point,segment)/max(dot(segment,segment),.000001),0.,1.);
      point+=along*segment;
      radius=mix(radius,uWake[i-1].z,along);
      weight=mix(weight,uWake[i-1].w,along);
    }
    vec2 delta=q-point;
    float w=exp(-dot(delta,delta)/(radius*radius*1.8))*weight;
    contact=max(contact,w);
  }
  // Paint carried at the contact point gives the lens a real material footprint.
  float contactEdge=max(fwidth(contact),.002)+uSoftness*.015;
  coverage=max(coverage,smoothstep(.35-contactEdge,.35+contactEdge,contact)*smoothstep(0.,.10,uCoverage));
  // A rounded meniscus extends into the pool instead of shading only one pixel.
  float body=smoothstep(threshold,threshold+.18,pool);
  body=max(body,smoothstep(.35,.68,contact));
  float height=coverage*(.006+(.014+.045*uThickness)*body)*(.73+.27*fbm(q*7.));
  height+=coverage*contact*.008*uThickness;
  if(uCoverage<=0.){coverage=0.;height=0.;}
  // Cell evaluation is the expensive part. Outside contact its contribution is
  // exactly zero, so quiet pools and empty substrate need no cellular search.
  if(contact<.006 || uInk<=0. || uCoverage<=0.){
    gl_FragColor=vec4(height,0.,coverage,contact);return;
  }
  vec2 local=q-sheet(uLens);
  vec2 dir=uDirection,side=vec2(-dir.y,dir.x);
  // Stretch the ink's material domain in the direction of relative sliding.
  float stretch=1.+uStrain*contact*7.*uFilaments;
  vec2 streak=dir*(dot(local,dir)/stretch)+side*dot(local,side);
  vec2 inkDomain=sheet(uLens)+streak;
  float frequency=38./uCellSize;
  vec2 w=vec2(fbm(inkDomain*12.+9.),fbm(inkDomain*12.+38.))-.5;
  float scaleVariation=mix(1.,.65+.65*noise(inkDomain*4.+6.),uCellComplexity);
  vec2 cq=(inkDomain+w*mix(.045,.11,uCellComplexity))*frequency*scaleVariation;
  // The branching material needs no nearest-cell search. Fade the regular
  // cellular component fully out before skipping its nine-site evaluation.
  float cellWeight=1.-smoothstep(.10,.60,uCellComplexity);
  float cellular=0.,holes=0.;
  if(cellWeight>0.){
    vec2 cell=cells(cq);
    float aa=max(fwidth(cell.y),.003);
    float veins=1.-smoothstep(.065-aa,.065+aa,cell.y);
    holes=1.-smoothstep(.13-max(fwidth(cell.x),.003),.13+max(fwidth(cell.x),.003),cell.x);
    cellular=mix(veins,1.-smoothstep(.22,.46,cell.x),.55);
  }
  float organic=0.;
  if(cellWeight<1.){
    float maze=fbm(inkDomain*frequency*mix(.38,.62,uCellComplexity)+w*2.3);
    float mazeAA=max(fwidth(maze),.001);
    float branches=1.-smoothstep(.035-mazeAA,.035+mazeAA,abs(maze-.50));
    organic=mix(branches,smoothstep(.58,.72,maze),.20);
  }
  float pattern=mix(organic,cellular,cellWeight);
  holes*=cellWeight;
  // Threads run along the measured slide direction, rather than the image X axis.
  // Their bends stay attached to material coordinates as the lens moves past.
  float across=dot(inkDomain,side)*frequency*1.1;
  float along=dot(inkDomain,dir)*frequency*.22;
  float fine=sin(across+sin(along*.75)*1.15+fbm(inkDomain*10.)*3.);
  float lineAA=max(fwidth(fine),.01);
  float threads=1.-smoothstep(.13-lineAA,.13+lineAA,abs(fine));
  float threadMix=uStrain*uFilaments*.9;
  pattern=mix(pattern,threads,threadMix);
  float sparse=smoothstep(.90,.98,noise(q*115.+4.))*noise(q*5.);
  float darkPool=smoothstep(.48,.67,fbm(inkDomain*11.+5.))*smoothstep(.20,.72,contact);
  float rawInk=clamp(darkPool*mix(.85,.50,uCellComplexity)+pattern*smoothstep(.01,.75,contact)*1.8+holes*contact*.35+sparse*.25,0.,1.);
  float ink=smoothstep(.10,.56,rawInk)*uInk;
  // A dark collar belongs to the paint; it remains when the lens lifts away.
  float r=length(lensCoord(p));
  float collar=exp(-pow((r-1.08)/.17,2.))*.35*pattern;
  ink=clamp(ink+collar*uInk,0.,1.);
  ink=1.-pow(1.-ink,2.2);
  gl_FragColor=vec4(height,ink,coverage,contact);
}
`;

export const oilPaintFragment = /* glsl */`${common}
uniform sampler2D uFields;
void main(){
  vec2 p=world(vUv),q=sheet(p),texel=1./uResolution;
  vec4 f=texture2D(uFields,vUv);
  float caustic=0.;
  if(uCaustics>0.)caustic=optCaustic(q*7.,uLensShapePhase,.6)*uCaustics;
  if(uSubstrate<.5 && f.b<=0.){gl_FragColor=vec4(0.);return;}
  vec3 l=light();
  float grain=(noise(p*650.)-.5)*uGrain;
  vec3 substrate=uPalette[3]*(1.+grain*.25)+uPalette[5]*caustic*.45;
  if(uSubstrate>.5 && f.b<1.){
  float shadow=0.;
  vec2 shadowUV=uvFor(p+l.xy*.035);
  vec2 blurX=uvFor(p+vec2(.008,0))-uvFor(p),blurY=uvFor(p+vec2(0,.008))-uvFor(p);
  float castShadow=(texture2D(uFields,clamp(shadowUV+blurX,vec2(0),vec2(1))).b+
    texture2D(uFields,clamp(shadowUV-blurX,vec2(0),vec2(1))).b+
    texture2D(uFields,clamp(shadowUV+blurY,vec2(0),vec2(1))).b+
    texture2D(uFields,clamp(shadowUV-blurY,vec2(0),vec2(1))).b)*.25;
  shadow+=castShadow*(1.-f.b)*.85;
  vec2 lc=lensCoord(p+l.xy*.055);
  shadow+=exp(-dot(lc,lc)*1.8)*uPresence*.65;
  substrate=mix(substrate,uPalette[4],clamp(shadow*uShadow,0.,.88));
  }
  if(f.b<=0.){gl_FragColor=vec4(max(substrate,vec3(0.)),1.);return;}
  float hx=texture2D(uFields,vUv+vec2(texel.x,0)).r-texture2D(uFields,vUv-vec2(texel.x,0)).r;
  float hy=texture2D(uFields,vUv+vec2(0,texel.y)).r-texture2D(uFields,vUv-vec2(0,texel.y)).r;
  vec2 gradient=vec2(hx,hy)*uResolution.y*.5;
  gradient=vec2(dot(vec2(uViewInverse[0].x,uViewInverse[0].y/uAspect),gradient),
    dot(vec2(uViewInverse[1].x*uAspect,uViewInverse[1].y),gradient));
  vec3 n=normalize(vec3(-gradient,1.));
  float diffuse=.58+.42*max(dot(n,l),0.);
  float variation=fbm(q*5.+uSeed*.04);
  float pigment=smoothstep(.30,.78,variation);
  vec3 paint=mix(uPalette[0],uPalette[1],pigment*.48);
  // Thin edges transmit more support colour; the body retains its pigment.
  vec3 edgeTint=mix(uPalette[0],uPalette[3],.12);
  paint=mix(edgeTint,paint,smoothstep(.004,.025,f.r));
  paint*=diffuse*(1.+grain*.10);
  float edgeShade=clamp(length(gradient),0.,1.);
  paint=mix(paint,uPalette[5],edgeShade*.18*uThickness);
  paint=mix(paint,uPalette[2],clamp(f.g,0.,1.));
  float shine=pow(max(dot(n,normalize(l+vec3(0,0,1))),0.),95.);
  if(uAnisotropy>0.)shine=mix(shine,optAnisotropic(n,l,.18,uSheenAngle),uAnisotropy);
  paint+=vec3(1.)*shine*edgeShade*uWetness*.28;
  if(uIridescence>0.)paint=mix(paint,paint*optFilm(n.z,1.35)*1.65,uIridescence);
  paint+=uPalette[5]*caustic*.25;
  float alpha=mix(f.b,1.,uSubstrate);
  vec3 color=mix(substrate,paint,f.b);
  if(uSubstrate<.5)color=paint;
  gl_FragColor=vec4(max(color,vec3(0.))*alpha,alpha);
}
`;

export const oilLensFragment = /* glsl */`${common}
uniform sampler2D uUnderlay;
vec4 under(vec2 uv){return texture2D(uUnderlay,clamp(uv,vec2(0),vec2(1)));}
vec4 optical(vec2 uv){
  vec2 p=world(uv),local=lensCoord(p);float r2=dot(local,local);
  vec4 base=under(uv);
  float aa=max(2.*uViewScale/(uResolution.y*uLensSize),.001);
  float mask=(1.-smoothstep(1.-aa,1.+aa,sqrt(r2)))*uPresence;
  if(mask<=0.)return base;
  float height=sqrt(max(1.-min(r2,.999),.001));
  vec2 slope=rot(uLensAngle)*(local/vec2(sqrt(uLensAspect),1./sqrt(uLensAspect)));
  vec3 n=normalize(vec3(slope*mix(.45,1.2,uLensDepth),height));
  // Approximate transmission through a cap onto its underlying material sheet.
  // A bounded local displacement magnifies the same ink pattern seen outside.
  vec2 shift=rot(uLensAngle)*local*uLensSize*height*uRefraction*mix(.25,.85,uLensDepth);
  vec2 refracted=uvFor(p-shift);
  vec4 transmitted=under(refracted);
  vec3 color=transmitted.rgb/max(transmitted.a,.00001);
  if(uDispersion>.001 && uRefraction>.001){
    vec2 split=uvFor(p+shift*uDispersion*.025)-uvFor(p);
    vec4 red=under(refracted-split),blue=under(refracted+split);
    color.r=red.r/max(red.a,.00001);color.b=blue.b/max(blue.a,.00001);
  }
  vec3 tint=mix(vec3(1.),mix(vec3(.96,1.,.90),uPalette[0],.15),uThickness);
  color*=exp(-(.04+uThickness*.22)*height*(vec3(1.)-tint));
  color*=.82+.18*max(dot(n,light()),0.);
  if(uIridescence>0.)color=mix(color,color*optFilm(n.z,1.35)*1.65,uIridescence*.5);
  float fresnel=.035+.90*pow(1.-max(n.z,0.),5.);
    vec3 reflection=mix(uPalette[2],uPalette[3],.22+.16*max(n.y,0.));
  color=mix(color,reflection,fresnel*.8*uWetness);
  vec3 halfLight=normalize(light()+vec3(0,0,1));
  float highlight=pow(max(dot(n,halfLight),0.),400.);
  if(uAnisotropy>0.)highlight=mix(highlight,optAnisotropic(n,light(),.12,uSheenAngle),uAnisotropy);
  vec3 card=normalize(vec3(-.55,.8,1.5));
  float broad=pow(max(dot(n,card),0.),90.);
  // A broad light card and a compact lamp give the dome an optical surface.
  vec2 cardDelta=n.xy-card.xy;
  float cardStrip=exp(-pow(cardDelta.x*11.+cardDelta.y*3.,2.)-pow(cardDelta.y*2.,2.));
  color+=vec3(1.,.99,.94)*(highlight*1.05+broad*.10+cardStrip*.13)*uWetness;
  float rim=exp(-pow((sqrt(r2)-.975)/.025,2.));
  color=mix(color,uPalette[5],rim*.22*uThickness);
  color+=mix(uPalette[0],vec3(1.),.65)*rim*uWetness*.20;
  float innerRim=exp(-pow((sqrt(r2)-.92)/.025,2.));
  color*=1.-innerRim*.17*uThickness*uWetness;
  // Cutout mode has its own tinted/reflected cap; RGBA cannot refract layers
  // that are composited later. Never emit RGB outside associated coverage.
  float lensAlpha=mix(max(transmitted.a,.16+.40*uWetness),1.,uSubstrate);
  vec4 lens=vec4(max(color,vec3(0.))*lensAlpha,lensAlpha);
  return mix(base,lens,mask);
}
void main(){
  vec4 color=optical(vUv);
  if(uQuality>1.5){
    vec2 d=.30/uResolution;
    color=(optical(vUv+vec2(-d.x,-d.y))+optical(vUv+vec2(d.x,-d.y))+optical(vUv+vec2(-d.x,d.y))+optical(vUv+d))*.25;
  }
  gl_FragColor=color;
}
`;
