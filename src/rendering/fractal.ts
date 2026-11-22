import { sourceViewGLSL } from './source-view';
import { juliaFunctions } from './fractal-julia';
import { boxFunctions } from './fractal-box';
import { portalFunctions } from './fractal-portal';

// Original instrument shaders. Mandelbox folding follows Tom Lowe's mathematical
// definition; no artistic shader or third-party implementation is copied.
export const fractalFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform vec3 uPalette[6];
uniform vec2 uResolution;
uniform float uAspect,uPhase,uSeed,uStyle,uScale,uDetail,uFold,uSymmetry,uTwist;
uniform float uMorph,uTravel,uOffset,uRelief,uGlow,uContrast,uCameraYaw,uCameraPitch,uZoom;
uniform float uVariant,uQuality,uDensity,uJuliaReal,uJuliaImag,uTrap,uLineWidth;
uniform float uBoxScale,uBoxRadius,uRadial,uRoughness,uLightAngle,uExposure;
uniform float uZoomFlight,uApproach,uOutside;
uniform float uSwirl,uLens,uMelt,uDance,uNeon;
uniform float uFocalX,uFocalY,uCutout,uReveal,uPassage,uDepth,uBank,uPosition,uAutoTravel,uAfterglow,uEvolution;
// Extra magnification for Zoom flight; 1 leaves the plane unchanged.
float gZoom=1.;
const float TAU=6.28318530718;
mat2 turn(float a) { float c=cos(a),s=sin(a);return mat2(c,-s,s,c); }
// Screen-space swirl, roaming lens and melt. At zero they leave the picture untouched.
vec2 fractalBend(vec2 p) {
  float ph=uPhase;
  if(uSwirl>0.) p=turn(uSwirl*(2.2+1.3*sin(ph))*exp(-1.4*dot(p,p)))*p;
  if(uLens>0.) {
    vec2 centre=.16*vec2(cos(ph),sin(2.*ph)),d=p-centre;
    p=centre+d*(1.-uLens*.72*(.68+.32*sin(ph))*exp(-5.*dot(d,d)));
  }
  if(uMelt>0.) {
    float sag=sin(5.*p.x+ph)+.5*sin(11.*p.x-2.*ph);
    p+=uMelt*vec2(.035*sin(8.*p.y+ph),.13*sag*(.65+.35*sin(3.*p.y+ph)));
  }
  return p;
}
// A conservative widening of the line filter wherever the bend compresses the picture.
float bendFootprint() {return 1.+.7*uSwirl+.6*uLens+.8*uMelt;}
vec3 neonGrade(vec3 color) {
  float level=max(color.r,max(color.g,color.b));
  vec3 hue=pow(color/max(level,.0001),vec3(1.6));
  float lit=smoothstep(.03,.62,level);
  return hue*lit*lit*1.55+vec3(.55)*pow(lit,7.);
}
vec3 meanPalette() {return (uPalette[0]+uPalette[1]+uPalette[2]+uPalette[3]+uPalette[4]+uPalette[5])/6.;}
vec3 pigment(float t,float aa) {
  float q=t*6.;
  float f=fract(q);
  int a=int(mod(floor(q),6.));int b=a==5?0:a+1;
  vec3 color=mix(uPalette[a],uPalette[b],f*f*(3.-2.*f));
  return mix(color,meanPalette(),smoothstep(.4,1.2,aa*6.));
}
vec2 wedge(vec2 p) {
  float r=length(p);if(r<.0000001)return vec2(0.);
  float sector=TAU/max(uSymmetry,3.);
  float angle=abs(mod(atan(p.y,p.x)+sector*.5,sector)-sector*.5);
  return r*vec2(cos(angle),sin(angle));
}
vec2 fractalView(vec2 uv) {
  return fractalBend((sourceUV(uv)-.5-vec2(uFocalX,uFocalY))*vec2(uAspect,1.));
}
float legacyCameraMotion() {
  return 1.-smoothstep(0.,.30,uEvolution);
}
// An arrival, a hold and a release. Both ends are flat at the loop seam.
float fractalCue(float progress,vec4 timing) {
  return smoothstep(timing.x,timing.y,progress)*(1.-smoothstep(timing.z,timing.w,progress));
}
vec2 planeAt(vec2 offset) {
  vec2 p=fractalView(vUv+offset/uResolution);
  float denominator=1.+p.y*.18*tan(uCameraPitch);
  p/=(denominator<0.?-1.:1.)*max(abs(denominator),.08);
  float sway=uTravel*legacyCameraMotion();
  p=turn(uCameraYaw+sway*.12*sin(uPhase))*p;
  p*=2.8*uScale/1.7/max(uZoom,.5)*gZoom;
  p+=sway*.22*vec2(sin(uPhase),cos(uPhase));
  return p;
}
vec2 plane() {return planeAt(vec2(0.));}
float planePixel() {
  // Analytic, conservative plane footprint. A derivative here would become
  // undefined higher-order derivatives when the material normal is evaluated.
  float tilt=.18*abs(tan(uCameraPitch));
  float gain=2.8*uScale/1.7/max(uZoom,.5)*gZoom;
  return bendFootprint()*uViewScale*gain*1.414214*(1.+uAspect*tilt*.5)/(uResolution.y*pow(1.-tilt*.5,2.));
}
vec3 glaze(vec3 color,float height,float weight) {
  vec2 g=vec2(dFdx(height),dFdy(height));
  float pixel=length(vec2(uAspect/uResolution.x,1./uResolution.y))*uViewScale;
  vec2 slope=g/max(pixel,.000001)*.025;
  slope/=sqrt(1.+dot(slope,slope));
  vec3 n=normalize(vec3(-slope*uRelief*weight*1.25,1.));
  vec3 l=normalize(vec3(-.45,.65,1.2));
  float diffuse=(.3+.7*max(dot(n,l),0.))/(.3+.7*l.z);
  float shine=pow(max(dot(n,normalize(l+vec3(0,0,1))),0.),32.);
  return color*diffuse+mix(color,vec3(1.),.65)*shine*uRelief*weight*.14;
}
vec3 kaleidoscopeSample(vec2 offset) {
  vec2 p=planeAt(offset);
  float seed=mod(uSeed,997.)*.0137;
  float radius=length(p);
  float wave=uPhase-radius*(2.5+uTravel*3.);
  float progress=fract(uPhase/TAU);
  float unfurl=fractalCue(progress,vec4(.08,.34,.53,.89));
  float interlace=fractalCue(progress,vec4(.48,.65,.78,.99));
  float shellRadius=1.24+.64*unfurl+.26*interlace;
  // The smaller centre becomes a readable rosette before the outer folds open.
  float reach=smoothstep(.32,1.5,radius);
  p*=1.+uEvolution*(.27*(1.-reach)-.23*reach)*unfurl;
  vec2 z=wedge(turn(uTwist*.7+uMorph*.18*sin(uPhase)*legacyCameraMotion())*p);
  float derivative=1.,height=0.;
  vec3 color=uPalette[5]*.025,halo=vec3(0.);
  float pixel=planePixel();
  float growth=1.65+uFold*.52;
  float angle=.24+uTwist*.5+.12*sin(seed)+uMorph*.065*sin(uPhase+seed)+uDance*.42*sin(uPhase);
  for(int i=0;i<7;i++) {
    float levelIndex=float(i);
    float stageMix=1.,opening=0.;
    if(uReveal>0.){
      float beat=.5-.5*cos(uPhase-.40*levelIndex);
      opening=uReveal*(smoothstep(.12,.88,beat)-.5);
      stageMix=mix(1.,mix(.16,1.,smoothstep(.04,.72,beat)),uReveal*min(1.,levelIndex*.50+.18));
    }
    // The inner levels change first. Alternating offsets turn the same folded
    // scaffold through laced rings, pronounced chambers and narrow bridges.
    float arrival=wave-levelIndex*.79;
    float crest=cos(arrival),alternate=sin(arrival*2.+levelIndex*.37);
    float change=uEvolution*(.77+.23*uMorph);
    float onset=.10+.036*levelIndex+.075*reach;
    float outward=fractalCue(progress,vec4(onset,onset+.23,.68,.98));
    vec2 hinge=vec2(.64+uFold*.2+.20*opening,.18+uMorph*.045*cos(uPhase)+.16*opening);
    hinge+=change*vec2(.31*outward-.19*interlace+.075*crest,.24*interlace-.14*outward+.065*alternate);
    z=wedge(turn(angle+.16*opening+change*(.20*interlace-.14*outward+.065*crest))*z);
    z=abs(z)-hinge;
    float levelGrowth=growth+change*(.20*outward-.13*interlace+.06*cos(arrival+.8));
    z*=levelGrowth;derivative*=levelGrowth;
    float shape=length(z)-(.34+.12*uFold);
    if(uVariant>.5&&uVariant<1.5) {
      // Elliptical petals with a wider inner body and a fine edge.
      shape=(length(z*vec2(.72,1.3))-(.42+.16*uFold))/1.3;
    } else if(uVariant>1.5) {
      // Orthogonal woven ribbons, recursively reflected into the radial field.
      shape=min(abs(z.x),abs(z.y))-(.12+.05*uFold);
    }
    if(uEvolution>0.){
      float bevel=abs(z.x)*.58+abs(z.y)*1.04-(.39+.11*uFold);
      float lens=(length(z*vec2(.58,1.48))-(.35+.13*uFold))*.78;
      shape=mix(shape,lens,change*outward*.72);
      shape=mix(shape,bevel,change*interlace*.64);
    }
    float signedDistance=shape/derivative;
    float distance=abs(signedDistance);
    float width=.055*uLineWidth/derivative;
    float level=smoothstep(-.05,.18,uDetail-levelIndex*.16+.18)*stageMix;
    // Integrate both stroke edges. Thin lines preserve their coverage instead
    // of turning into half-opaque pixels or changing thickness with recursion.
    float coverage=clamp((width-signedDistance+pixel*.5)/pixel,0.,1.)
      -clamp((-width-signedDistance+pixel*.5)/pixel,0.,1.);
    if(uVariant>.5&&uVariant<1.5) {
      float body=clamp((-signedDistance+pixel*.5)/pixel,0.,1.);
      coverage=max(coverage,body*.34);
    }
    coverage*=level;
    float coordinate=uOffset+uDensity*(float(i)*.115+.055*length(z))+uMorph*.035*sin(uPhase);
    vec3 ink=pigment(coordinate,max(.001,uDensity*.055*derivative*pixel));
    if(uEvolution>0.){
      float brilliance=.70+.48*smoothstep(.12,.83,outward);
      float zones=smoothstep(.24,1.75,radius);
      vec3 enamel=pigment(uOffset+.22*zones+.139*levelIndex+.15*interlace-.14*outward,
        pixel*derivative*.25);
      ink=mix(ink,enamel*brilliance,uEvolution*.88);
    }
    color=mix(color,ink,coverage*.9);
    float ridge=exp(-pow(distance/max(width*1.85,pixel),2.));
    height+=mix(coverage,ridge*level,uEvolution*.88)/(1.+levelIndex*mix(.35,.45,uEvolution));
    float haloWidth=width*2.8;
    halo+=ink*exp(-distance/max(haloWidth,pixel*.6))*min(1.,haloWidth/(pixel*.6))*level*.11;
  }
  vec3 result=glaze(color,height,1.)+halo*uGlow;
  if(uEvolution>0.){
    // A subdued second scale extends into the corners while the main rosette unfolds.
    float broadcast=1.-smoothstep(shellRadius-.1,shellRadius+.52,radius);
    float ambient=.38+.17*unfurl+.36*broadcast;
    result*=mix(1.,ambient,uEvolution);
  }
  if(uReveal>0.){
    float outward=smoothstep(.30,1.48,length(p));
    float bloom=smoothstep(.04,.77,.5-.5*cos(uPhase-1.2*outward));
    result*=1.-uReveal*outward*.88*(1.-bloom);
  }
  return result;
}
vec3 kaleidoscope() {
  if(uQuality<.5)return kaleidoscopeSample(vec2(0.));
  if(uQuality<1.5)return (kaleidoscopeSample(vec2(-.25,-.25))+kaleidoscopeSample(vec2(.25,.25)))*.5;
  return (kaleidoscopeSample(vec2(-.25,-.25))+kaleidoscopeSample(vec2(.25,-.25))
    +kaleidoscopeSample(vec2(-.25,.25))+kaleidoscopeSample(vec2(.25,.25)))*.25;
}
${juliaFunctions}
${boxFunctions}
${portalFunctions}
void main() {
  vec4 pixel;
  if(uStyle>2.5)pixel=fractalPortal();
  else if(uStyle>.5&&uStyle<1.5&&juliaCanDive())pixel=vec4(juliaBloom(),1.);
  else if(uStyle<1.5&&uZoomFlight>0.) {
    // Zoom flight: two copies one zoom step apart. The nearer one magnifies
    // across the cycle and the farther one replaces it in a short fade at the
    // end, so the last frame is the first one and the loop closes exactly.
    float f=fract(uPhase/TAU),step=1.+5.*uZoomFlight,w=smoothstep(.78,1.,f);
    gZoom=pow(step,-f);
    vec3 color=uStyle<.5?kaleidoscope():juliaBloom();
    // The farther copy is only drawn during the fade.
    if(w>0.){gZoom=pow(step,1.-f);color=mix(color,uStyle<.5?kaleidoscope():juliaBloom(),w);}
    pixel=vec4(color,1.);
  }
  else if(uStyle<.5)pixel=vec4(kaleidoscope(),1.);
  else if(uStyle<1.5)pixel=vec4(juliaBloom(),1.);
  else {
    // Fixed, deterministic subpixel samples also produce associated edge alpha.
    pixel=mandelbox();
  }
  if(uStyle<1.5&&uCutout>0.){
    float peak=max(max(pixel.r,pixel.g),pixel.b);
    pixel.a=mix(1.,smoothstep(.012,.22,peak),uCutout);
    pixel.rgb*=pixel.a;
  }
  if(pixel.a>0.) {
    vec3 color=pixel.rgb/pixel.a;
    color=max((color-.18)*mix(.65,1.65,uContrast)+.18,vec3(0.));
    if(uNeon>0.)color=mix(color,neonGrade(color),uNeon);
    pixel.rgb=color*uExposure*pixel.a;
  }
  gl_FragColor=pixel;
}
`;
