export const fullscreenVertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export { surfaceFragment } from './surface';
import { sourceViewGLSL } from './source-view';

export const imageFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform sampler2D uImage;
uniform vec2 uFit;
uniform float uMirror,uRepeat;
void main() {
  vec2 uv=(sourceUV(vUv)-.5)/uFit+.5;
  // Derivatives belong to the unwrapped domain: fract() would introduce a
  // false giant texture footprint along every tile seam.
  vec2 dx=dFdx(uv)*uRepeat,dy=dFdy(uv)*uRepeat;
  if(uRepeat<1.5&&(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.))))) { gl_FragColor=vec4(0.); return; }
  if(uRepeat>1.)uv=fract(uv*uRepeat);
  if(mod(uMirror,2.)>.5){uv.x=1.-uv.x;dx.x=-dx.x;dy.x=-dy.x;}
  if(uMirror>1.5){uv.y=1.-uv.y;dx.y=-dx.y;dy.y=-dy.y;}
  vec4 c=(uMirror<.5&&uRepeat<1.5)?texture2D(uImage,uv):textureGrad(uImage,uv,dx,dy);
  gl_FragColor=vec4(c.rgb*c.a,c.a);
}
`;

export const compositeFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uBelow, uSource, uMask;
uniform vec2 uTranslation, uTexel;
uniform vec3 uTopMean;
vec3 blendPaletteMean(){return uTopMean;}
uniform float uScale, uRotation, uOpacity, uBlend, uAspect;
uniform vec2 uPatternScale, uPatternTranslation;
uniform float uPatternRotation, uPatternRepeat;
uniform float uSourceInView;
uniform mat3 uSourceViewInverse;
uniform vec4 uPatternRing;
uniform vec3 uPatternBackground;
uniform float uMaskKind, uMaskSize, uMaskSoftness, uMaskInvert, uGlow;
uniform float uSaturation,uHue,uExposure;
uniform float uToneContrast,uTonePivot,uToneGamma,uShadowLift,uHighlightRoll,uVibrance;
uniform float uColorMode,uColorSteps,uColorMix,uColorOffset;
uniform vec3 uGradePalette[6];
uniform float uToonMix,uToonBands,uToonOffset,uToonCycles,uToonSoftness,uToonOutline,uToonOutlineColor,uLoopPhase;
uniform sampler2D uGlowLevel0,uGlowLevel1,uGlowLevel2,uGlowLevel3,uGlowLevel4;
uniform float uGlowWeights[5];
uniform vec3 uGlowColour;
uniform float uGlowOn,uGlowTint;
const vec3 GRADE_LUMA=vec3(.2126,.7152,.0722);
float stepIntegral(float x){float n=floor(x);return n*(n-1.)*.5+n*fract(x);}
float strokeIntegral(float x,float width){return floor(x)*width*2.+min(fract(x),width)+max(fract(x)-(1.-width),0.);}
float contourStroke(float x,float aa){
  return clamp((strokeIntegral(x+aa*.5,.055)-strokeIntegral(x-aa*.5,.055))/aa,0.,1.);
}
vec3 gradePalette(float t,float footprint){
  float q=t*6.,f=fract(q);int a=int(mod(floor(q),6.)),b=a==5?0:a+1;
  vec3 color=mix(uGradePalette[a],uGradePalette[b],f*f*(3.-2.*f));
  vec3 average=(uGradePalette[0]+uGradePalette[1]+uGradePalette[2]+uGradePalette[3]+uGradePalette[4]+uGradePalette[5])/6.;
  return mix(color,average,smoothstep(.4,1.2,footprint*6.));
}
vec4 recolor(vec4 pixel){
  // This is a separate render pass. Derivatives act on a sampled source texture,
  // never on the derivative-based lighting/filtering inside a source shader.
  vec3 original=pixel.rgb/max(pixel.a,.000001);
  float luminance=dot(max(original,vec3(0.)),GRADE_LUMA);
  float tone=luminance/(.35+luminance);
  vec3 ink;
  float stroke=0.;
  if(uColorMode<1.5){
    ink=mix(uGradePalette[5],uGradePalette[0],smoothstep(.01,.7,tone));
  }else{
    float coordinate=tone*uColorSteps,footprint=max(fwidth(coordinate),.00001);
    float quantized=(stepIntegral(coordinate+footprint*.5)-stepIntegral(coordinate-footprint*.5))/footprint;
    float band=clamp((quantized+.5)/uColorSteps,0.,1.);
    ink=gradePalette(uColorOffset+band*.8,footprint/uColorSteps);
    stroke=contourStroke(coordinate,footprint);
  }
  // Changing the colour treatment must retain surface lighting and filigree.
  // A black source/palette remains black; the denominator is always finite.
  float inkLuminance=dot(ink,GRADE_LUMA);
  vec3 mapped=inkLuminance>.000001?ink*(luminance/inkLuminance):vec3(0.);
  mapped*=1.-stroke*.48;
  return vec4(mix(original,mapped,uColorMix)*pixel.a,pixel.a);
}
vec3 toonSwatch(float index){
  return uGradePalette[int(mod(index+.5,6.))];
}
float toonShift(){
  // Palette motion moves in whole six-swatch turns, so the band field after one
  // loop is identical to the first frame: the loop closes exactly.
  return (uToonOffset+uToonCycles*uLoopPhase/6.283185307179586)*6.;
}
float toonCoordinate(vec4 pixel,float shift){
  vec3 straight=pixel.rgb/max(pixel.a,.000001);
  float luminance=dot(max(straight,vec3(0.)),GRADE_LUMA);
  return luminance/(.35+luminance)*uToonBands-shift;
}
vec4 sampleSource(vec2 uv);
vec4 toon(vec4 pixel,vec2 uv){
  // Separate pass over the sampled source. Derivatives and neighbour samples
  // describe the visible tone field at the output pixel size.
  vec3 original=pixel.rgb/max(pixel.a,.000001);
  float shift=toonShift();
  float coordinate=toonCoordinate(pixel,shift);
  float footprint=max(fwidth(coordinate),.00001);
  vec2 px=dFdx(uv),py=dFdy(uv);
  // A source edge (or a gradient denser than one band per pixel) spans several
  // bands between neighbours. Snap to the nearer side, so anti-aliased source
  // edges never produce slivers of the intermediate bands.
  float low=coordinate,high=coordinate;
  for(int i=0;i<4;i++){
    vec2 o=i==0?px:i==1?-px:i==2?py:-py;
    float c=toonCoordinate(sampleSource(uv+o),shift);
    low=min(low,c);high=max(high,c);
  }
  bool discontinuity=high-low>1.;
  vec3 poster;
  float centre;
  if(discontinuity){
    centre=coordinate-low<high-coordinate?low:high;
    poster=toonSwatch(floor(centre));
  }else{
    centre=coordinate;
    float band=floor(coordinate),f=coordinate-band;
    // Signed distance to the nearest band boundary, in band units.
    float t=f<.5?f:f-1.;
    vec3 below=toonSwatch(f<.5?band-1.:band),above=toonSwatch(f<.5?band:band+1.);
    float width=max(footprint,uToonSoftness*.5);
    poster=mix(below,above,clamp(t/(2.*width)+.5,0.,1.));
  }
  if(uToonOutline>0.){
    // Width is defined at 1080 lines, so every export size keeps its proportions.
    float pixels=uToonOutline/(1080.*uTexel.y);
    float radius=pixels*.5;
    float band=floor(centre);
    float inner=0.,outer=0.;
    for(int i=0;i<8;i++){
      float a=float(i)*.7853981633974483;
      vec2 direction=cos(a)*px+sin(a)*py;
      if(floor(toonCoordinate(sampleSource(uv+direction*max(radius-.5,.35)),shift))!=band)inner=1.;
      if(floor(toonCoordinate(sampleSource(uv+direction*(radius+.5)),shift))!=band)outer=1.;
    }
    // Inner ring hits are fully inside the line; outer-only hits are its filtered rim.
    float line=max(inner,outer*.5)*min(pixels,1.);
    if(discontinuity)line=max(line,min(pixels,1.));
    vec3 ink=uToonOutlineColor<.5?vec3(0.):uGradePalette[int(uToonOutlineColor-.5)];
    poster=mix(poster,ink,line);
  }
  return vec4(mix(original,poster,uToonMix)*pixel.a,pixel.a);
}
vec3 grade(vec3 color) {
  // Rotate two luminance-free chroma axes in linear RGB. Neutral defaults bypass
  // this path entirely, retaining the original composition's exact arithmetic.
  float y=dot(color,vec3(.2126,.7152,.0722));
  vec2 chroma=vec2(color.r-y,color.b-y)*uSaturation;
  float c=cos(uHue),s=sin(uHue);
  chroma=mat2(c,-s,s,c)*chroma;
  float r=y+chroma.x,b=y+chroma.y;
  float g=(y-.2126*r-.0722*b)/.7152;
  return max(vec3(r,g,b)*uExposure,vec3(0.));
}
vec3 tonalFinish(vec3 color){
  float y=max(dot(color,GRADE_LUMA),0.);
  float tone=y;
  if(uToneContrast!=1.)tone=uTonePivot*pow(max(tone/uTonePivot,0.),uToneContrast);
  if(uToneGamma!=1.)tone=pow(max(tone,0.),1./uToneGamma);
  tone=max(0.,tone+uShadowLift*exp(-tone*4.));
  tone=tone/(1.+uHighlightRoll*tone);
  // The working layer is half float. Keep extreme artistic grades finite.
  tone=min(tone,64.);
  vec3 result=y>.000001?color*(tone/y):vec3(tone);
  if(uVibrance!=0.){
    float hi=max(result.r,max(result.g,result.b)),lo=min(result.r,min(result.g,result.b));
    float chroma=(hi-lo)/max(hi,.00001);
    result=vec3(tone)+(result-vec3(tone))*(1.+uVibrance*(1.-chroma*.75));
  }
  return max(result,vec3(0.));
}
float sampleMask(vec2 uv) {
  if(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return 0.;
  vec4 m=texture2D(uMask,uv);
  return dot(m.rgb,vec3(.2126,.7152,.0722))*m.a;
}
vec4 sampleSource(vec2 uv) {
  // Magnified grids and radial geometry render directly in the current view.
  // Masks and the single radial-circuit cutout retain their layer coordinates.
  if(uPatternRepeat>.5) {
    vec2 p=(uv-.5-uPatternTranslation)*vec2(uAspect,1.);
    float c=cos(uPatternRotation),s=sin(uPatternRotation);
    p=mat2(c,-s,s,c)*p/uPatternScale;
    vec2 coordinate=p/vec2(uAspect,1.)+.5;
    // Derivatives precede wrapping. Otherwise tile seams select a false giant
    // mip footprint, turning fine patterns into blurred rectangular borders.
    vec4 pattern=uPatternRepeat>1.5?texture2D(uSource,vUv):textureGrad(uSource,fract(coordinate),dFdx(coordinate),dFdy(coordinate));
    if(uPatternRing.w>.5) {
      float radius=length(p),aa=max(fwidth(radius),.00001);
      float ring=smoothstep(uPatternRing.x-aa,uPatternRing.x+aa,radius)
        *(1.-smoothstep(uPatternRing.x+uPatternRing.y-aa,uPatternRing.x+uPatternRing.y+aa,radius));
      pattern=mix(pattern,vec4(uPatternBackground*uPatternRing.z,uPatternRing.z),ring);
    }
    return pattern;
  }
  if(uSourceInView>.5) return texture2D(uSource,(uSourceViewInverse*vec3(uv,1.)).xy);
  if(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return vec4(0.);
  return texture2D(uSource,uv);
}
void main() {
  vec2 p=(vUv-.5-uTranslation)*vec2(uAspect,1.);
  float c=cos(uRotation), s=sin(uRotation);
  p=mat2(c,s,-s,c)*p/max(uScale,.001);
  vec2 uv=p/vec2(uAspect,1.)+.5;
  vec4 top=sampleSource(uv);
  if(uGlow>.0001) {
    // Radius is defined in composition units, so a 4K export has the same
    // apparent halo width as its reduced preview.
    vec2 r=vec2(5./(1080.*uAspect),5./1080.);
    vec4 blur=(sampleSource(uv+vec2(r.x,0.))+sampleSource(uv-vec2(r.x,0.))+
      sampleSource(uv+vec2(0.,r.y))+sampleSource(uv-vec2(0.,r.y)))*.25;
    float coverage=blur.a*(1.-top.a)*uGlow*.32;
    top.rgb+=(blur.a>.00001?blur.rgb/blur.a:vec3(0.))*coverage;
    top.a+=coverage;
  }
  // Mode is uniform for the layer, so all pixels evaluate the contour footprint.
  if(uColorMode>.5)top=recolor(top);
  if(uToonMix>0.)top=toon(top,uv);
  if(uGlowOn>.5) {
    // Glow finish: blurred bright light of this layer, added as light. The
    // levels are in the same view space as the source. It follows flat colour
    // so it is never posterised, and precedes the grade so it is graded too.
    vec2 g=(uSourceViewInverse*vec3(uv,1.)).xy;
    vec3 glow=uGlowWeights[0]*texture2D(uGlowLevel0,g).rgb+uGlowWeights[1]*texture2D(uGlowLevel1,g).rgb
      +uGlowWeights[2]*texture2D(uGlowLevel2,g).rgb+uGlowWeights[3]*texture2D(uGlowLevel3,g).rgb
      +uGlowWeights[4]*texture2D(uGlowLevel4,g).rgb;
    if(uGlowTint>.5)glow=uGlowColour*dot(glow,GRADE_LUMA);
    top.rgb+=glow;
    top.a+=(1.-top.a)*clamp(max(glow.r,max(glow.g,glow.b)),0.,1.);
  }
  if(top.a>.00001 && (abs(uSaturation-1.)>.000001 || abs(uHue)>.000001 || abs(uExposure-1.)>.000001)) {
    top.rgb=grade(top.rgb/top.a)*top.a;
  }
  if(top.a>.00001&&(uToneContrast!=1.||uToneGamma!=1.||uShadowLift!=0.||uHighlightRoll!=0.||uVibrance!=0.))top.rgb=tonalFinish(top.rgb/top.a)*top.a;
  float mask=1.;
  float softness=max(uMaskSoftness*.18,.001);
  if(uMaskKind>.5 && uMaskKind<1.5) {
    float d=length((uv-.5)*vec2(uAspect,1.))-uMaskSize*.5;
    mask=1.-smoothstep(-softness,softness,d);
  } else if(uMaskKind>1.5 && uMaskKind<2.5) {
    vec2 d=abs(uv-.5)-vec2(uMaskSize*.5);
    mask=1.-smoothstep(-softness,softness,max(d.x*uAspect,d.y));
  } else if(uMaskKind>2.5) {
    vec2 muv=(uv-.5)/max(uMaskSize,.001)+.5;
    vec2 radius=vec2(uMaskSoftness*.026)/vec2(uAspect,1.);
    mask=sampleMask(muv)*.4;
    mask+=(sampleMask(muv+vec2(radius.x,0.))+sampleMask(muv-vec2(radius.x,0.))+
      sampleMask(muv+vec2(0.,radius.y))+sampleMask(muv-vec2(0.,radius.y)))*.15;
  }
  if(uMaskKind>.5 && uMaskInvert>.5) mask=1.-mask;
  // Coverage/opacity always scale associated RGB and alpha together.
  top*=clamp(mask*uOpacity,0.,1.);
  vec4 below=texture2D(uBelow,vUv);
  vec3 a=below.a>.00001?below.rgb/below.a:vec3(0.);
  vec3 b=top.a>.00001?top.rgb/top.a:vec3(0.);
  vec3 blended=b;
  if(uBlend>.5 && uBlend<1.5) blended=max(a+b-a*b,vec3(0.));
  else if(uBlend>1.5 && uBlend<2.5) blended=a*b;
  else if(uBlend>2.5&&uBlend<3.5) blended=a+b;
  else if(uBlend>3.5) {
    // Colour from below: this layer keeps its shapes and shading but takes its
    // colour from the layers under it (for example an imported paint scan).
    float shade=dot(b,vec3(.2126,.7152,.0722))/max(dot(blendPaletteMean(),vec3(.2126,.7152,.0722)),.02);
    blended=a*clamp(shade,0.,4.);
  }
  vec3 rgb=below.rgb*(1.-top.a)+top.rgb*(1.-below.a)+blended*(top.a*below.a);
  float alpha=top.a+below.a*(1.-top.a);
  gl_FragColor=vec4(rgb,alpha);
}
`;

export const finishFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec3 uBackground;
uniform float uOpaque, uExactHighlights;
#include <tonemapping_pars_fragment>
void main() {
  vec4 pixel=texture2D(uImage,vUv);
  // Nonlinear look operates on unassociated colour. The result stays linear-light SDR.
  vec3 straight=pixel.a>.00001?max(pixel.rgb/pixel.a,vec3(0.)):vec3(0.);
  // Soft roll-off compresses and desaturates bright colour. Exact mode keeps
  // palette colours at their authored values (flat graphic and neon work).
  vec3 color=uExactHighlights>.5?clamp(straight,0.,1.):clamp(NeutralToneMapping(straight),0.,1.);
  float alpha=clamp(pixel.a,0.,1.);
  if(uOpaque>.5) { color=color*alpha+uBackground*(1.-alpha); alpha=1.; }
  gl_FragColor=vec4(color,alpha);
}
`;

export const displayFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
vec3 srgb(vec3 c) {
  return mix(12.92*c,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));
}
void main() {
  vec4 pixel=texture2D(uImage,vUv);
  vec3 color=srgb(clamp(pixel.rgb,0.,1.));
  // A static, sub-LSB dither is applied only at the eight-bit output boundary.
  float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
  color=clamp(color+dither/255.,0.,1.);
  // Quantize coverage at this eight-bit boundary before clearing transparent
  // RGB. Faint filtered edges can otherwise round to alpha zero with colour.
  float alpha=floor(clamp(pixel.a,0.,1.)*255.+.5)/255.;
  gl_FragColor=vec4(alpha>0.?color:vec3(0.),alpha);
}
`;

/**
 * Supersampling resolve: filters a finished, straight-alpha, linear-light frame
 * rendered at an integer multiple of the delivery size. A separable
 * Mitchell–Netravali kernel (B = C = 1/3, support of two delivery pixels) keeps
 * hard graphic edges crisp while suppressing shimmer and moiré. Filtering runs
 * on associated colour so transparent pixels never bleed their RGB into edges.
 */
export const downsampleFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uSourceSize;
uniform float uFactor;
float mitchell(float x) {
  x=abs(x);
  if(x<1.) return (7.*x*x*x-12.*x*x+16./3.)/6.;
  if(x<2.) return (-7./3.*x*x*x+12.*x*x-20.*x+32./3.)/6.;
  return 0.;
}
void main() {
  vec2 center=vUv*uSourceSize;
  vec2 base=floor(center-.5);
  float radius=2.*uFactor;
  vec4 sum=vec4(0.);
  float total=0.;
  for(int j=-6;j<=7;j++) {
    float y=base.y+float(j);
    float dy=(y+.5-center.y)/uFactor;
    if(abs(dy)>=2.) continue;
    float wy=mitchell(dy);
    for(int i=-6;i<=7;i++) {
      float x=base.x+float(i);
      float dx=(x+.5-center.x)/uFactor;
      if(abs(dx)>=2.) continue;
      float w=mitchell(dx)*wy;
      vec2 uv=(clamp(vec2(x,y),vec2(0.),uSourceSize-1.)+.5)/uSourceSize;
      vec4 texel=texture2D(uImage,uv);
      sum+=vec4(texel.rgb*texel.a,texel.a)*w;
      total+=w;
    }
  }
  sum/=max(total,1e-6);
  float alpha=clamp(sum.a,0.,1.);
  vec3 color=alpha>.00001?clamp(max(sum.rgb,0.)/alpha,0.,1.):vec3(0.);
  gl_FragColor=vec4(color,alpha);
}
`;
