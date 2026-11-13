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
uniform float uSlideAngle,uLensAngle,uPresence,uStrain,uLayout,uLoop;
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
uniform sampler2D uPattern;
uniform vec2 uPatternOffset;
// Ink tile channels (see oil-pattern.ts): r maze, g threads along x, b holes.
float inkEdge(float value,float level){float aa=fwidth(value)*.75+.0015;return smoothstep(level-aa,level+aa,value);}
void main(){
  vec2 p=world(vUv),q=sheet(p),base=q/max(uPoolSize,.1);
  vec2 warp=vec2(fbm(base*4.+uSeed*.03),fbm(base*4.+17.3))-.5;
  // Fine edge ripple: poured paint has a wavy, crisp rim rather than a soft blob.
  vec2 ripple=vec2(noise(base*26.+3.),noise(base*26.+41.))-.5;
  vec2 b=base+warp*.20+ripple*.012;
  float pool=exp(-dot((b-vec2(-.18,.12))*vec2(1.35,1.05),(b-vec2(-.18,.12))*vec2(1.35,1.05))*5.);
  pool=max(pool,.8*exp(-dot((b-vec2(.40,-.26))*vec2(1.,1.25),(b-vec2(.40,-.26))*vec2(1.,1.25))*35.));
  pool=max(pool,.8*exp(-dot(b-vec2(-.55,-.34),b-vec2(-.55,-.34))*100.));
  pool=max(pool,.8*exp(-dot(b-vec2(.54,.36),b-vec2(.54,.36))*80.));
  float threshold=mix(.85,.025,uCoverage);
  float edge=max(fwidth(pool)*.7,.001)+uSoftness*.015;
  float coverage=smoothstep(threshold-edge,threshold+edge,pool);
  float contact=0.;
  vec2 drag=uDirection;
  for(int i=0;i<${OIL_WAKE_SAMPLES};i++){
    vec2 point=uWake[i].xy;
    float radius=max(uWake[i].z,.01),weight=uWake[i].w;
    vec2 segment=vec2(0.);
    if(i>0){
      segment=uWake[i-1].xy-point;
      float along=clamp(dot(q-point,segment)/max(dot(segment,segment),.000001),0.,1.);
      point+=along*segment;
      radius=mix(radius,uWake[i-1].z,along);
      weight=mix(weight,uWake[i-1].w,along);
    }
    vec2 delta=q-point;
    float w=exp(-dot(delta,delta)/(radius*radius*1.8))*weight;
    // Threads keep the direction the glass was moving when it passed here.
    if(w>contact){contact=w;if(dot(segment,segment)>1e-10)drag=normalize(segment);}
  }
  if(uLayout>.5){
    // Full-frame layouts. The paint covers the frame and the ink pattern runs
    // through all of it, not only where the glass has pressed. Regions breathe
    // on their own clocks, so cells open and close at different times.
    float tile=2.1*max(uCellSize,.1);
    float breathe=.05*sin(uLoop+fbm(q*1.3+uSeed*.02)*6.2831853);
    float s,ink=0.;
    if(uLayout<1.5){
      // Pour: one paint mass with cells opening through it, two cell sizes by region.
      float big=texture2D(uPattern,q/(tile*1.9)+uPatternOffset).b;
      float small=texture2D(uPattern,q/(tile*.9)+uPatternOffset.yx).b;
      float h=mix(big,small,smoothstep(.35,.65,fbm(q*.9+3.1)));
      s=h-(mix(.34,.1,uCoverage)+breathe);
      float aa=fwidth(s)*.75+.0015;
      // A dark lacing ring where the paint meets each cell.
      ink=1.-smoothstep(.03*(.6+uInk)-aa,.03*(.6+uInk)+aa,abs(s));
    } else {
      // Lacing: ribbons that run edge to edge, laced inside with drag threads.
      float v=q.y+.45*(fbm(q*1.1+uSeed*.03)-.5)+.08*sin(q.x*2.3+uLoop);
      float freq=6.2831853/(.42*max(uPoolSize,.1));
      s=sin(v*freq)-mix(.7,-.7,uCoverage)+breathe*3.;
      vec2 along=vec2(q.x*(1.+.3*fbm(q*2.)),v)/(tile*.8);
      float threads=texture2D(uPattern,along+uPatternOffset).g-mix(.26,.16,uInk);
      float aa=fwidth(s)*.75+.0015;
      ink=inkEdge(threads,0.)*smoothstep(.25,.6,s)*uFilaments;
      ink=max(ink,1.-smoothstep(.06-aa,.06+aa,abs(s)));
    }
    float aa=fwidth(s)*.75+.0015+uSoftness*.015;
    float cover=smoothstep(-aa,aa,s);
    if(uCoverage<=0.)cover=0.;
    float height=cover*(.004+(.010+.030*uThickness)*smoothstep(0.,.3,s));
    gl_FragColor=vec4(height,ink*smoothstep(0.,.15,uInk)*max(cover,.0),cover,contact);
    return;
  }
  // Paint carried at the contact point gives the lens a real material footprint.
  float contactEdge=max(fwidth(contact),.002)+uSoftness*.015;
  coverage=max(coverage,smoothstep(.35-contactEdge,.35+contactEdge,contact)*smoothstep(0.,.10,uCoverage));
  // Flat paint with a thin rounded meniscus at its rim.
  float body=smoothstep(threshold,threshold+.16,pool);
  body=max(body,smoothstep(.35,.5,contact));
  float height=coverage*(.004+(.010+.030*uThickness)*body);
  height+=coverage*contact*.006*uThickness;
  if(uCoverage<=0.){coverage=0.;height=0.;}
  if(coverage<=0.||uInk<=0.){gl_FragColor=vec4(height,0.,coverage,contact);return;}
  // Tile size in canvas heights; Cell size scales the whole pattern.
  float tile=2.1*max(uCellSize,.1);
  // Spatter: scattered drops of varied size, some stretched, in loose clusters.
  float spatter=0.;
  float cluster=smoothstep(.45,.7,fbm(q*2.6+uSeed*.07));
  if(cluster>0.){
    vec2 cellP=q*38./max(uCellSize,.1)*.8,id=floor(cellP);
    float nearest=10.;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 g=id+vec2(float(x),float(y));
      float h=hash(g+uSeed*.013);
      if(h>cluster*.55)continue;
      vec2 centre=g+.2+.6*vec2(hash(g+7.1),hash(g+3.7));
      float angle=hash(g+9.3)*6.2831853,radius=mix(.06,.32,pow(hash(g+5.9),2.2));
      vec2 d=rot(angle)*(cellP-centre);d.x/=mix(1.,2.4,hash(g+1.3));
      nearest=min(nearest,length(d)-radius);
    }
    float aa=fwidth(cellP.x)*.8;
    spatter=1.-smoothstep(-aa,aa,nearest);
  }
  if(contact<.006){gl_FragColor=vec4(height,spatter*smoothstep(0.,.15,uInk),coverage,contact);return;}
  vec2 lensSheet=sheet(uLens),local=q-lensSheet;
  vec2 dir=drag,side=vec2(-dir.y,dir.x);
  // Stretch the material along the drag, so pressed shapes smear with it.
  float stretch=1.+uStrain*contact*2.5*uFilaments;
  vec2 domain=lensSheet+dir*(dot(local,dir)/stretch)+side*dot(local,side);
  // Where the glass has pressed hardest the ink takes over and only thin paint
  // lines remain; at the edges of the footprint it thins to separate lines.
  float level=mix(.25,.11,smoothstep(.3,1.,contact));
  // Each pattern as a signed value (positive is ink). Blending these before
  // the cut morphs one shape family into another and keeps edges crisp.
  float maze=texture2D(uPattern,domain/tile+uPatternOffset).r-level;
  // Foam: big ink cells with thin paint walls (inverted holes, larger scale).
  float foam=mix(.16,.25,smoothstep(.2,.9,contact))-texture2D(uPattern,domain/(tile*1.2)+uPatternOffset.yx).b;
  // Where foam or maze appears is a slow regional choice, set by Cell complexity.
  float region=smoothstep(-.12,.12,fbm(domain*2.2+uSeed*.05)-1.+uCellComplexity);
  float shape=mix(foam,maze,region);
  // Drag threads: the striped channel turned to run along the drag.
  vec2 along=vec2(dot(domain,dir),dot(domain,side));
  float threads=texture2D(uPattern,along/(tile*.8)+uPatternOffset).g-level;
  // Radial fingers just outside the glass, as when it is pressed and lifted.
  float r=length(lensCoord(p));
  float n=floor(6.2831853*uLensSize*1.2/(tile*.8)+.5);
  vec2 polar=vec2(length(local)/(tile*.8),atan(local.y,local.x)/6.2831853*n);
  float fingers=texture2D(uPattern,polar+uPatternOffset.yx).g-.2;
  float rimZone=exp(-pow((r-1.2)/.22,2.))*uPresence;
  float threadMix=clamp(uStrain*contact*1.6,0.,1.)*uFilaments;
  shape=mix(shape,threads,threadMix);
  shape=mix(shape,fingers,rimZone*mix(.35,.9,uFilaments));
  // Away from the glass the pattern thins and breaks up rather than fading,
  // so ink is always solid black with a crisp edge.
  shape-=(1.-smoothstep(.04,.4,contact))*.3;
  // Ink amount thickens or thins every line.
  shape+=(uInk-.85)*.12;
  float darkPool=fbm(domain*9.+5.)-.62-(1.-smoothstep(.15,.7,contact))*.3;
  shape=max(shape,darkPool*mix(1.,.5,uCellComplexity));
  // A dark contact ring belongs to the paint; it remains when the lens lifts away.
  float collar=(exp(-pow((r-1.03)/.05,2.))-.5)*.2*uPresence;
  shape=max(shape,collar);
  float ink=max(inkEdge(shape,0.),spatter)*smoothstep(0.,.15,uInk);
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
  // Paper or felt under the paint: fine fibres and a soft mottle.
  float paper=(noise(p*260.)-.5)*.7+(fbm(p*42.)-.5)*1.1;
  vec3 substrate=uPalette[3]*(1.+grain*.25+paper*(.05+uGrain*.5))+uPalette[5]*caustic*.45;
  if(uSubstrate>.5 && f.b<1.){
  // Thick paint and glass stand off the surface and cast a hard, offset shadow
  // in the deep shade colour. A small blur keeps its edge clean, not soft.
  vec2 offset=normalize(l.xy)*(.035+.045*uThickness);
  float castShadow=0.;
  for(int i=0;i<8;i++){
    float a=float(i)*.785398;
    vec2 tap=p+offset+vec2(cos(a),sin(a))*.008;
    castShadow+=texture2D(uFields,clamp(uvFor(tap),vec2(0),vec2(1))).b;
  }
  castShadow/=8.;
  float shadow=smoothstep(.1,.6,castShadow)*(1.-f.b);
  vec2 lc=lensCoord(p+normalize(l.xy)*(.06+.06*uThickness));
  shadow=max(shadow,(1.-smoothstep(.85,1.05,length(lc)))*uPresence);
  substrate=mix(substrate,uPalette[4],clamp(shadow*uShadow*1.25,0.,.94));
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
  vec2 shift=rot(uLensAngle)*local*uLensSize*height*uRefraction*mix(.12,.45,uLensDepth);
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
