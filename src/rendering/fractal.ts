import { sourceViewGLSL } from './source-view';
import { juliaFunctions } from './fractal-julia';
import { boxFunctions } from './fractal-box';

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
const float TAU=6.28318530718;
mat2 turn(float a) { float c=cos(a),s=sin(a);return mat2(c,-s,s,c); }
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
vec2 planeAt(vec2 offset) {
  vec2 p=(sourceUV(vUv+offset/uResolution)-.5)*vec2(uAspect,1.);
  float denominator=1.+p.y*.18*tan(uCameraPitch);
  p/=(denominator<0.?-1.:1.)*max(abs(denominator),.08);
  p=turn(uCameraYaw+uTravel*.12*sin(uPhase))*p;
  p*=2.8*uScale/1.7/max(uZoom,.5);
  p+=uTravel*.22*vec2(sin(uPhase),cos(uPhase));
  return p;
}
vec2 plane() {return planeAt(vec2(0.));}
float planePixel() {
  // Analytic, conservative plane footprint. A derivative here would become
  // undefined higher-order derivatives when the material normal is evaluated.
  float tilt=.18*abs(tan(uCameraPitch));
  float gain=2.8*uScale/1.7/max(uZoom,.5);
  return uViewScale*gain*1.414214*(1.+uAspect*tilt*.5)/(uResolution.y*pow(1.-tilt*.5,2.));
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
  vec2 z=wedge(turn(uTwist*.7+uMorph*.18*sin(uPhase))*p);
  float derivative=1.,height=0.;
  vec3 color=uPalette[5]*.025,halo=vec3(0.);
  float pixel=planePixel();
  float growth=1.65+uFold*.52;
  float angle=.24+uTwist*.5+.12*sin(seed)+uMorph*.065*sin(uPhase+seed);
  for(int i=0;i<7;i++) {
    z=wedge(turn(angle)*z);
    z=abs(z)-vec2(.64+uFold*.2,.18+uMorph*.045*cos(uPhase));
    z*=growth;derivative*=growth;
    float shape=length(z)-(.34+.12*uFold);
    if(uVariant>.5&&uVariant<1.5) {
      // Elliptical petals with a wider inner body and a fine edge.
      shape=(length(z*vec2(.72,1.3))-(.42+.16*uFold))/1.3;
    } else if(uVariant>1.5) {
      // Orthogonal woven ribbons, recursively reflected into the radial field.
      shape=min(abs(z.x),abs(z.y))-(.12+.05*uFold);
    }
    float signedDistance=shape/derivative;
    float distance=abs(signedDistance);
    float width=.055*uLineWidth/derivative;
    float level=smoothstep(-.05,.18,uDetail-float(i)*.16+.18);
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
    color=mix(color,ink,coverage*.9);
    height+=coverage/(1.+float(i)*.35);
    float haloWidth=width*2.8;
    halo+=ink*exp(-distance/max(haloWidth,pixel*.6))*min(1.,haloWidth/(pixel*.6))*level*.11;
  }
  return glaze(color,height,1.)+halo*uGlow;
}
vec3 kaleidoscope() {
  if(uQuality<.5)return kaleidoscopeSample(vec2(0.));
  if(uQuality<1.5)return (kaleidoscopeSample(vec2(-.25,-.25))+kaleidoscopeSample(vec2(.25,.25)))*.5;
  return (kaleidoscopeSample(vec2(-.25,-.25))+kaleidoscopeSample(vec2(.25,-.25))
    +kaleidoscopeSample(vec2(-.25,.25))+kaleidoscopeSample(vec2(.25,.25)))*.25;
}
${juliaFunctions}
${boxFunctions}
void main() {
  vec4 pixel;
  if(uStyle<.5)pixel=vec4(kaleidoscope(),1.);
  else if(uStyle<1.5)pixel=vec4(juliaBloom(),1.);
  else {
    // Fixed, deterministic subpixel samples also produce associated edge alpha.
    pixel=mandelbox();
  }
  if(pixel.a>0.) {
    vec3 color=pixel.rgb/pixel.a;
    color=max((color-.18)*mix(.65,1.65,uContrast)+.18,vec3(0.));
    pixel.rgb=color*uExposure*pixel.a;
  }
  gl_FragColor=pixel;
}
`;
