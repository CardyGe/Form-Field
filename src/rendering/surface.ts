import { projectionOpticsGLSL } from './projection-optics';
import { sourceViewGLSL } from './source-view';
import { timingGLSL } from '../core/timing';
export const surfaceFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform vec3 uPalette[6];
uniform vec2 uResolution;
uniform float uAspect, uPhase, uSeed, uStyle, uScale, uWarp, uDetail;
uniform float uSoftness, uContrast, uOffset, uReveal, uRotation, uRoundness, uRelief;
uniform float uVariant, uDensity, uStretch, uTurbulence, uCenterX, uCenterY, uLightAngle, uRoughness;
uniform float uIridescence,uAnisotropy,uSheenAngle;
uniform float uDelaySpread,uDelayShape,uPause;
${projectionOpticsGLSL}
const float TAU = 6.28318530718;
${timingGLSL}
float gPhase;
vec2 gViewRow0, gViewRow1; float gViewScale;
// Maps a point of the rotated, stretched pattern domain back to frame coordinates.
vec2 dripFrame(vec2 p) { vec2 s=p/gViewScale; return vec2(dot(gViewRow0,s),dot(gViewRow1,s)); }

float hash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float noise(vec3 p) {
  vec3 i=floor(p), f=fract(p);
  f=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float field(vec2 p) {
  vec2 orbit=vec2(cos(gPhase),sin(gPhase));
  float z=mod(uSeed,4093.)*.031;
  float fine=uDetail*.13;
  return (.58*noise(vec3(p+orbit*.47,z))+.29*noise(vec3(p*2.03+orbit*.58,z+9.))
    +fine*noise(vec3(p*4.07+orbit*.36,z+17.)))/(.87+fine);
}
vec3 paletteMean() {
  return (uPalette[0]+uPalette[1]+uPalette[2]+uPalette[3]+uPalette[4]+uPalette[5])/6.;
}
vec3 surfaceLight() {
  if(uLightAngle==0.) return normalize(vec3(-.48,.7,1.1));
  float c=cos(uLightAngle), s=sin(uLightAngle);
  return normalize(vec3(mat2(c,-s,s,c)*vec2(-.48,.7),1.1));
}
float gloss(float legacyExponent) {
  if(uRoughness==.3) return legacyExponent;
  return clamp(legacyExponent*pow(.3/max(uRoughness,.05),1.35),4.,240.);
}
float glossStrength() { return uRoughness==.3?1.:clamp(sqrt(.3/max(uRoughness,.05)),.45,1.5); }
vec3 paint(float t, bool relief) {
  float coordinate=t*6.;
  // Take derivatives before wrapping so palette boundaries cannot create seams.
  vec2 gradient=vec2(dFdx(coordinate),dFdy(coordinate));
  // Drip colors are constant per column; their silhouette has its own AA.
  float aa=relief?max(abs(gradient.x)+abs(gradient.y),.001):.001;
  int a=int(mod(floor(coordinate),6.));
  int b=a==5?0:a+1;
  float s=fract(coordinate)-.5;
  float softness=.025+uSoftness*.21;
  float blend=smoothstep(-softness-aa,softness+aa,s);
  vec3 color=mix(uPalette[a],uPalette[b],blend);
  if(relief) {
    float bevelWidth=.07+uSoftness*.15;
    float width2=bevelWidth*bevelWidth;
    // Adjacent periodic copies keep the height and its slope continuous at
    // cell wraps, even at the widest bevel setting.
    vec3 positions=vec3(s-1.,s,s+1.);
    vec3 valleys=exp(-positions*positions/width2);
    float valley=dot(valleys,vec3(1.));
    float slope=2.*dot(positions,valleys)/width2;
    float pixelWidth=max(length(fwidth(vUv)*vec2(uAspect,1.))*uViewScale,.000001);
    // Fade the normal at flow critical points instead of amplifying tiny
    // gradients into a full-strength direction flip. Units match at 4K.
    vec2 direction=gradient/sqrt(dot(gradient,gradient)+pixelWidth*pixelWidth*.25);
    vec3 normal=normalize(vec3(-direction*slope*uRelief*.085,1.));
    vec3 light=surfaceLight();
    float diffuse=(.32+.68*max(dot(normal,light),0.))/(.32+.68*light.z);
    float specular=pow(max(dot(normal,normalize(light+vec3(0,0,1))),0.),gloss(28.));
    if(uAnisotropy>0.)specular=mix(specular,optAnisotropic(normal,light,uRoughness,uSheenAngle),uAnisotropy);
    color*=diffuse*(1.-uRelief*valley*.15);
    if(uIridescence>0.)color=mix(color,color*optFilm(normal.z,1.35)*1.65,uIridescence);
    color+=mix(color,vec3(1.),.55)*specular*valley*uRelief*.3*glossStrength();
  }
  float gapWidth=uReveal*.17;
  float gap=1.-smoothstep(gapWidth-aa,gapWidth+aa,abs(s));
  gap=mix(gap,2.*gapWidth,smoothstep(.35,1.1,aa));
  color*=1.-gap*step(.0001,uReveal);
  // A footprint wider than a palette segment converges to the palette mean.
  return mix(color,paletteMean()*(1.-2.*gapWidth),smoothstep(.55,1.35,aa));
}
float superellipse(vec2 p, float power) {
  vec2 a=abs(p);
  float m=max(max(a.x,a.y),.00001);
  vec2 unit=a/m;
  return m*pow(pow(unit.x,power)+pow(unit.y,power),1./power);
}
float bandCoordinate(vec2 p, float warp) {
  float wave=sin(p.x*1.35+.65*sin(gPhase));
  float tension=mix(tanh(wave*2.8)/tanh(2.8),wave,uRoundness);
  float spatial=(p.y+warp+.3*uWarp*tension)*.47;
  return (uDensity==1.?spatial:spatial*uDensity)+uOffset-gPhase/TAU;
}
float ribbonCoverage(float coordinate, float width) {
  // Filter signed edges separately, preserving a ribbon's integrated width
  // when the pattern becomes smaller than the preview's pixel footprint.
  float edge=fract(coordinate)-.5;
  float aa=max(fwidth(coordinate),.0001);
  float coverage=clamp((edge+width)/aa+.5,0.,1.)-clamp((edge-width)/aa+.5,0.,1.);
  return mix(coverage,2.*width,smoothstep(.5,1.25,aa));
}
vec3 bandPaint(vec2 p, float warp) {
  if(uVariant<.5) return paint(bandCoordinate(p,warp),true);
  if(uVariant<1.5) {
    float carrier=(p.y+warp*.45)*.54*uDensity;
    float angle=p.x*(1.05+.2*uDensity)+.36*sin(gPhase);
    float wave=sin(angle)*(.32+.32*uRoundness);
    float a=carrier-wave, b=carrier+wave+.5;
    float width=.17+.055*uRoundness-uReveal*.11;
    float first=ribbonCoverage(a-gPhase/TAU,width);
    float second=ribbonCoverage(b-gPhase/TAU,width);
    vec3 colorA=paint(a*.37+p.x*.035+uOffset-gPhase/TAU,true);
    vec3 colorB=paint(b*.37+p.x*.035+uOffset+.47-gPhase/TAU,true);
    float over=smoothstep(-.18,.18,cos(angle));
    vec3 background=paletteMean()*(.035+.055*uSoftness);
    vec3 underA=mix(background,colorA*(1.-second*uRelief*.3),first);
    vec3 underB=mix(background,colorB*(1.-first*uRelief*.3),second);
    return mix(mix(underA,colorB,second),mix(underB,colorA,first),over);
  }
  float wave=.65*sin(p.x*.85+.55*sin(gPhase));
  float pleat=.3*sin(p.x*2.2+p.y*.65+.4*cos(gPhase));
  float coordinate=(p.y+wave+pleat+warp*.42)*.64*uDensity;
  return paint(coordinate+uOffset-gPhase/TAU,true);
}
vec3 ringPaint(vec2 p, vec2 flow, float variant) {
  vec2 center=vec2(.07*sin(uPhase),.05*cos(uPhase))*uScale;
  vec2 q=p-center+flow*uWarp*.85;
  float radius=superellipse(q,mix(15.,2.5,uRoundness));
  float footprint=max(length(fwidth(q)),.000001);
  // Log spacing creates depth. Unresolvable rings converge to their average,
  // including the focal pixels where a radial derivative can be symmetric.
  // This radius floor is analytic. Feeding fwidth(q) into paint() would make
  // its palette gradients second-order derivatives, undefined on some GPUs.
  float stretch=sqrt(max(uStretch,.25));
  float radiusFloor=max(uScale,.1)*max(stretch,1./stretch)/max(uResolution.y,1.)*.25*uViewScale;
  float safeRadius=max(radius,radiusFloor);
  float spatial=log(safeRadius)*.66;
  if(variant>.5 && variant<1.5) {
    // Evenly spaced elliptical ripples have a different sense of depth from
    // the logarithmic terraces. This smooth modulation never has an angular seam.
    radius=length(q);
    safeRadius=max(radius,radiusFloor);
    spatial=radius*.8+.13*uWarp*sin(q.x*1.7+.4*sin(gPhase))*cos(q.y*1.7+.4*cos(gPhase));
  } else if(variant>1.5) {
    float angle=atan(q.y,q.x+.0000001);
    float winding=3.*angle+log(safeRadius)*3.2;
    // Only periodic functions consume angle: derivatives remain continuous at
    // atan's branch cut, unlike an unwrapped angular palette coordinate.
    spatial=log(safeRadius)*.66+.2*sin(winding+.35*sin(gPhase));
  }
  float coordinate=spatial*uDensity+uOffset-gPhase/TAU;
  vec3 color=paint(coordinate,true);
  vec3 average=paletteMean()*(1.-uReveal*.34);
  color=mix(average,color,smoothstep(footprint,footprint*3.,radius));
  return color*mix(1.,.12+.88*smoothstep(.04,1.35,radius),uRelief);
}
vec3 dripPaint(vec2 p) {
  float density=2.15*uDensity;
  float bend=(field(vec2(p.y*.4,3.7))-.5)*uWarp*.65;
  vec2 q=p+vec2(bend,0.);
  if(uVariant>1.5) {
    q.x+=.24*sin(q.y*1.6+.55*sin(gPhase))+.11*sin(q.y*3.1+.5*cos(gPhase));
  }
  float column=floor(q.x*density);
  float seed=hash(vec3(column,31.,mod(uSeed,4093.)));
  // Every pixel of a column must agree on its clock, so the delay is taken at
  // the column's centre line rather than at the pixel.
  float columnPhase=uPhase;
  if(uDelaySpread>0.||uPause>0.){
    vec2 centre=dripFrame(vec2((column+.5)/density,0.));
    columnPhase=stagedTime(uPhase,delayOrder(centre,uAspect));
  }
  float tip=.2+1.35*sin(columnPhase+seed*TAU)+.25*sin(2.*columnPhase+seed*11.);
  float x=fract(q.x*density)-.5;
  float y=min((q.y-tip)*density,0.);
  float width=(.31+.11*seed)*(1.-uReveal*.58);
  width*=1.+uWarp*.08*sin(q.y*2.+sin(columnPhase)+seed*5.);
  if(uPause>0. && uVariant<.5) {
    // Run, pool, release: each drip falls from above the frame to its own
    // depth, swells there, then drains away before the next one starts.
    float span=.5*max(uScale,.1)/sqrt(max(uStretch,.25));
    float f=fract(columnPhase/TAU+seed*.37);
    float run=.5-.25*uPause, poolEnd=.88;
    float top=span*1.25, depth=span*mix(.15,-.75,hash(vec3(column,57.,mod(uSeed,4093.))));
    float g=clamp(f/run,0.,1.);g=1.-(1.-g)*(1.-g)*(1.-g);
    tip=mix(top,depth,g);
    float release=smoothstep(poolEnd,1.,f);
    float tail=mix(top+span*4.,tip,release);
    y=q.y>tail?(q.y-tail)*density:min((q.y-tip)*density,0.);
    float pool=smoothstep(run*.8,run,f)*(1.-release);
    float nearTip=exp(-pow((q.y-tip)*density*1.6,2.));
    width*=(1.+pool*.45*nearTip)*(1.-smoothstep(.92,1.,f));
  }
  if(uVariant>.5 && uVariant<1.5) {
    // Beads are separated closed droplets rather than a clipped liquid column.
    y=(fract(q.y*density*.7+seed*.65+.3*sin(columnPhase+seed*TAU))-.5)*1.12;
    width*=.82+.15*sin(q.y*.7+seed*6.);
  } else if(uVariant>1.5) {
    // A full-length strand has no moving end cap. Its cross-section gently
    // swells along the flow, producing a continuous liquid cable.
    y=0.;
    width*=.82+.16*sin(q.y*1.9+seed*4.+.7*sin(columnPhase));
  }
  float distance=superellipse(vec2(x,y),mix(11.,2.,uRoundness))-width;
  // Different columns have different tips. Their discontinuous distance values
  // must not enlarge coverage across the empty space between liquid strands.
  float aa=max(length(fwidth(q))*density,.001);
  float feather=aa+.055*uSoftness;
  float coverage=1.-smoothstep(-feather,feather,distance);
  vec3 color=paint(column*.117+seed*.025+uOffset-columnPhase/TAU,false);
  // The normal follows the capsule cross-section, giving the liquid body volume.
  vec2 profile=vec2(x,y)/max(width,.02);
  vec3 normal=normalize(vec3(profile*.8,sqrt(max(.025,1.-min(dot(profile,profile),.99)))));
  vec3 light=surfaceLight();
  float diffuse=(.32+.68*max(dot(normal,light),0.))/(.32+.68*light.z);
  float shine=pow(max(dot(normal,normalize(light+vec3(0,0,1))),0.),gloss(26.));
  if(uAnisotropy>0.)shine=mix(shine,optAnisotropic(normal,light,uRoughness,uSheenAngle),uAnisotropy);
  color*=mix(1.,diffuse,uRelief);
  if(uIridescence>0.)color=mix(color,color*optFilm(normal.z,1.35)*1.65,uIridescence);
  color+=mix(color,vec3(1.),.65)*shine*uRelief*.38*glossStrength();
  return mix(vec3(.0007),color,coverage);
}
void main() {
  vec2 world=(sourceUV(vUv)-.5)*vec2(uAspect,1.)-vec2(uCenterX,uCenterY)*.5;
  gPhase=uDelaySpread>0.||uPause>0.?stagedTime(uPhase,delayOrder(world,uAspect)):uPhase;
  float c=cos(uRotation), s=sin(uRotation);
  vec2 p=mat2(c,-s,s,c)*world*max(uScale,.1);
  float stretch=sqrt(max(uStretch,.25));
  p*=vec2(stretch,1./stretch);
  // Inverse of the domain transform above, for per-column clocks.
  mat2 inverse=mat2(c,s,-s,c)*mat2(1./stretch,0.,0.,stretch);
  gViewRow0=vec2(inverse[0][0],inverse[1][0]);gViewRow1=vec2(inverse[0][1],inverse[1][1]);gViewScale=max(uScale,.1);
  vec2 flow=vec2(field(p*.65),field(p*.65+vec2(13.7,8.2)))-.5;
  // An independently controlled curl keeps Flow useful at its original scale.
  // All time dependence is a closed orbit; density changes only spatial terms.
  vec2 curl=uTurbulence*vec2(sin(p.y*1.6+.65*cos(gPhase)),sin(p.x*1.3+.65*sin(gPhase)))*.7;
  vec2 q=p+flow*uWarp*2.6+curl;
  float warp=(field(q*.8)-.5)*uWarp*1.6;
  vec3 color;
  if(uStyle<.5) color=bandPaint(q,warp);
  else if(uStyle<1.5) color=ringPaint(p+curl*.65,flow,uVariant);
  else if(uStyle<2.5) color=dripPaint(p+curl*.35);
  else {
    vec2 center=vec2(.07*sin(uPhase),.05*cos(uPhase));
    vec2 box=abs(world-center);
    float rounding=.015+uRoundness*.12;
    vec2 corner=box-vec2(.32-rounding);
    float distance=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-rounding;
    vec2 innerDomain=p;
    if(uVariant>.5 && uVariant<1.5) {
      vec2 twinWorld=world-center;
      float side=twinWorld.x<0.?-1.:1.;
      vec2 twin=abs(twinWorld-vec2(side*.28,.035*side*sin(uPhase)));
      vec2 twinCorner=twin-vec2(.205-rounding,.285-rounding);
      distance=length(max(twinCorner,0.))+min(max(twinCorner.x,twinCorner.y),0.)-rounding;
      innerDomain-=mat2(c,-s,s,c)*vec2(side*.28,.035*side*sin(uPhase))*max(uScale,.1)*vec2(stretch,1./stretch);
    } else if(uVariant>1.5) {
      vec2 lens=(world-center)*vec2(.78,1.18);
      distance=length(lens)-.34;
      // A magnified inner contour field and broad glass-like rim make the lens
      // an optical composition, distinct from the square aperture.
      innerDomain*=.72;
    }
    float aa=max(fwidth(distance),.001);
    float portal=1.-smoothstep(-aa,aa,distance);
    // The portal's variant controls its aperture. Its outer and inner fields
    // retain the original bands and terraces instead of inheriting that variant.
    vec3 outer=paint(bandCoordinate(q,warp),true);
    vec3 inner=ringPaint(innerDomain,flow,0.);
    color=mix(outer,inner,portal);
    // Occlusion falls inside the opening; a finer highlight catches its rim.
    float innerLip=exp(-pow(distance/.024,2.))*portal;
    float outerLip=exp(-pow(distance/.006,2.))*(1.-portal);
    color*=1.-uRelief*innerLip*.48;
    color+=mix(color,vec3(.8),.35)*outerLip*uRelief*.16;
  }
  float contrast=mix(.65,1.65,uContrast);
  color=max((color-.18)*contrast+.18,vec3(0.));
  gl_FragColor=vec4(color,1.);
}
`;
