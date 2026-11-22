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
uniform vec3 uGlowChannels[5];
uniform sampler2D uGlowStreakMap;
uniform vec3 uGlowColour;
uniform float uGlowOn,uGlowTint,uGlowStreak,uGlowMix;
uniform float uPrintOn,uPrintCells,uPrintOffset;
uniform float uPrintAngles[4];
uniform float uPrintMix,uPrintType,uPrintDot,uPrintMatrix,uPrintFloor,uPrintCeiling,uPrintMax,uPrintGain,uPrintSoft,uPrintInvert;
uniform float uPrintColour,uPrintInk,uPrintPaper,uPrintArea,uPrintEdgeWidth,uPrintEdgeSense,uPrintEdgeFeather;
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
/** Frame coordinate to the layer's own coordinate. */
vec2 layerUv(vec2 frameUv) {
  vec2 p=(frameUv-.5-uTranslation)*vec2(uAspect,1.);
  float c=cos(uRotation), s=sin(uRotation);
  p=mat2(c,s,-s,c)*p/max(uScale,.001);
  return p/vec2(uAspect,1.)+.5;
}
// ---- Print screen finish ---------------------------------------------------
// Halftone dots, line screens and ordered dither, drawn analytically. The grid
// is built from the frame coordinate, in cells of a 1080-line frame, so it is
// fixed to the frame and identical at every render size. Every mark edge is a
// signed reach in cells, filtered to exactly one output pixel. The mark
// maths mirrors src/rendering/print-screen.ts.
const float PRINT_PI=3.141592653589793;
mat2 printRotation(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
vec2 printTravel(){return vec2(uPrintOffset,uPrintType>.5&&uPrintType<1.5?uPrintOffset:0.);}
vec2 printToScreen(vec2 frameUv,float a){
  return printRotation(a)*((frameUv-.5)*vec2(uAspect,1.)*uPrintCells)+printTravel();
}
vec2 printToFrame(vec2 s,float a){
  return printRotation(-a)*(s-printTravel())/(uPrintCells*vec2(uAspect,1.))+.5;
}
vec4 printSource(vec2 frameUv){return sampleSource(layerUv(frameUv));}
/** Tone of a pixel for one screen, 0–1, scaled by coverage so marks shrink at
 * the layer's silhouette. Channel -1 is the brightest channel; 0–2 are red, green, blue
 * (RGB light) or cyan, magenta, yellow (CMYK ink); 3 is black. */
float printTone(vec4 pixel,int channel){
  vec3 straight=max(pixel.rgb/max(pixel.a,.000001),vec3(0.));
  vec3 v=min(1.35*straight/(.35+straight),vec3(1.));
  float t;
  // The whole-colour screen follows the brightest channel, not luminance: a
  // mark brightened by 1/coverage then never passes full value, so saturated
  // colours keep their hue and their light instead of clipping.
  if(channel<0)t=max(v.r,max(v.g,v.b));
  else if(uPrintColour<2.5)t=channel==0?v.r:channel==1?v.g:v.b;
  else{
    // Inks are separated from the linear colour: their overprinted marks
    // average in linear light, so the layer keeps its brightness.
    vec3 l=min(straight,vec3(1.));
    float k=1.-max(l.r,max(l.g,l.b));
    if(channel==3)t=k;
    else{float x=channel==0?l.r:channel==1?l.g:l.b;t=k>.9999?0.:(1.-x-k)/(1.-k);}
  }
  return t*pixel.a;
}
/** Tone to the share of a cell its mark covers, at most Largest mark (printCoverage). */
float printCurve(float tone,int channel){
  float x=uPrintCeiling<=uPrintFloor?step(uPrintFloor+.000001,tone):clamp((tone-uPrintFloor)/max(uPrintCeiling-uPrintFloor,.001),0.,1.);
  if(uPrintGain!=0.)x=pow(x,exp2(-1.5*uPrintGain));
  return (channel<0&&uPrintInvert>.5?1.-x:x)*uPrintMax;
}
float printClassicLevel(float c){
  const float levels[17]=float[17](1.,.8131,.6446,.4938,.3599,.2426,.1421,.0592,0.,-.0592,-.1421,-.2426,-.3599,-.4938,-.6446,-.8131,-1.);
  float t=clamp(c,0.,1.)*16.;int i=int(min(floor(t),15.));
  return mix(levels[i],levels[i+1],t-float(i));
}
/** Signed reach in cells from p (relative to a cell centre) to that cell's
 * mark, sized so the mark covers the share c of a cell (printMarkSize). */
float printDotDistance(vec2 p,float c){
  if(c<=0.)return 4.;
  if(uPrintDot>2.5){vec2 q=abs(p)-sqrt(c)*.5;return max(q.x,q.y);}
  if(uPrintDot>1.5){
    float h=c<=.5?sqrt(c*.5):1.-sqrt((1.-c)*.5);
    return (abs(p.x)+abs(p.y)-h)*.7071067811865476;
  }
  float touch=PRINT_PI*.25;
  float r=c<=touch?sqrt(c/PRINT_PI):.5+(.7171067811865476-.5)*(c-touch)/(1.-touch);
  return length(p)-r;
}
float printBayer(vec2 cell){
  int bits=int(uPrintMatrix+.5)+1;
  float n=exp2(float(bits));
  ivec2 q=ivec2(mod(cell,n));
  int index=0;
  for(int b=0;b<3;b++){
    if(b>=bits)break;
    int bx=q.x&1,by=q.y&1;
    index=index*4+((bx^by)*2+by);
    q/=2;
  }
  return (float(index)+.5)/(n*n);
}
/**
 * Coverage of one screen at this pixel. Returns the frame position, source
 * pixel and target coverage of the cell that governs the pixel, so the caller
 * can colour whole marks from one place.
 */
float printMark(float angle,int channel,out vec2 centreUv,out vec4 centrePixel,out float target){
  vec2 s=printToScreen(vUv,angle);
  // One output pixel, in cells. Known exactly, so no derivative is needed.
  float pixel=uPrintCells*uTexel.y;
  float width=max(pixel,uPrintSoft*.5);
  float coverage;
  if(uPrintType>1.5){
    // Ordered dither: each cell is on or off; cell edges are box-filtered.
    vec2 q=s-.5,base=floor(q);
    vec2 weight=clamp(.5+(s-(base+1.))/pixel,0.,1.);
    coverage=0.;
    float best=-1.;
    for(int j=0;j<2;j++)for(int i=0;i<2;i++){
      vec2 cell=base+vec2(float(i),float(j));
      float share=(i==0?1.-weight.x:weight.x)*(j==0?1.-weight.y:weight.y);
      vec2 uv=printToFrame(cell+.5,angle);
      vec4 texel=printSource(uv);
      float c=printCurve(printTone(texel,channel),channel);
      coverage+=share*step(printBayer(cell),c-.000001);
      if(share>best){best=share;centreUv=uv;centrePixel=texel;target=c;}
    }
    return mix(coverage,target,smoothstep(.35,.6,pixel));
  }
  if(uPrintType>.5){
    // Line screen: lines run along the screen's x axis. Width follows the tone
    // read on the line's own centre, so both edges of a line agree.
    float row=floor(s.y),reach=8.;
    for(int j=-1;j<=1;j++){
      float centre=row+float(j)+.5;
      vec2 uv=printToFrame(vec2(s.x,centre),angle);
      vec4 texel=printSource(uv);
      float c=printCurve(printTone(texel,channel),channel);
      float d=c<=0.?4.+abs(float(j)):abs(s.y-centre)-c*.5;
      if(d<reach){reach=d;centreUv=uv;centrePixel=texel;target=c;}
    }
    coverage=clamp(.5-reach/width,0.,1.)*clamp(target/pixel,0.,1.);
    return mix(coverage,target,smoothstep(.35,.6,pixel));
  }
  // Dots. The own cell reads five taps so a dot does not flicker when fine
  // detail passes under its centre.
  vec2 cell=floor(s)+.5,p=s-cell;
  vec2 ownUv=printToFrame(cell,angle);
  vec4 own=printSource(ownUv);
  float tone=printTone(own,channel);
  for(int i=0;i<4;i++){
    vec2 o=i==0?vec2(.25,0.):i==1?vec2(-.25,0.):i==2?vec2(0.,.25):vec2(0.,-.25);
    tone+=printTone(printSource(printToFrame(cell+o,angle)),channel);
  }
  float c=printCurve(tone*.2,channel);
  centreUv=ownUv;centrePixel=own;target=c;
  float reach;
  if(uPrintDot>.5&&uPrintDot<1.5){
    // Classic: the dot grows from the cell centre until it meets its
    // neighbours at half tone, then the gaps shrink as holes on the corners.
    // Each half is governed by the tone at its own centre, so nothing seams.
    float field=(cos(2.*PRINT_PI*p.x)+cos(2.*PRINT_PI*p.y))*.5;
    float slope=max(PRINT_PI*length(vec2(sin(2.*PRINT_PI*p.x),sin(2.*PRINT_PI*p.y))),.001);
    float level;
    if(abs(p.x)+abs(p.y)<.5)level=printClassicLevel(min(c,.5));
    else{
      vec2 corner=cell+sign(p+.000001)*.5;
      float hole=printCurve(printTone(printSource(printToFrame(corner,angle)),channel),channel);
      level=printClassicLevel(max(hole,.5));
    }
    reach=c<=0.&&level>=.9999?4.:(level-field)/slope;
  }else{
    // Union with the four cells that share an edge, so dots that outgrow
    // their cell join their neighbours with no seam.
    reach=printDotDistance(p,c);
    for(int i=0;i<4;i++){
      vec2 o=i==0?vec2(1.,0.):i==1?vec2(-1.,0.):i==2?vec2(0.,1.):vec2(0.,-1.);
      vec2 uv=printToFrame(cell+o,angle);
      vec4 texel=printSource(uv);
      float neighbour=printCurve(printTone(texel,channel),channel);
      float d=printDotDistance(p-o,neighbour);
      if(d<reach){reach=d;centreUv=uv;centrePixel=texel;target=neighbour;}
    }
  }
  // A mark smaller than one output pixel keeps its share of light, not a speck.
  coverage=clamp(.5-reach/width,0.,1.)*clamp(target/(pixel*pixel),0.,1.);
  // A screen finer than about two output pixels becomes its plain tone.
  return mix(coverage,target,smoothstep(.35,.6,pixel));
}
/** Edge strength of the layer's tone around a frame position, 0–1. The
 * silhouette counts, because tone carries the layer's coverage. */
float printEdge(vec2 frameUv){
  float centre=printTone(printSource(frameUv),-1),difference=0.;
  vec2 reach=vec2(uPrintEdgeWidth/1080.)/vec2(uAspect,1.);
  for(int i=0;i<12;i++){
    float a=float(i)*.5235987755982988;
    difference=max(difference,abs(printTone(printSource(frameUv+vec2(cos(a),sin(a))*reach),-1)-centre));
    a+=.2617993877991494;
    difference=max(difference,abs(printTone(printSource(frameUv+vec2(cos(a),sin(a))*reach*.5),-1)-centre));
  }
  float threshold=mix(.5,.02,uPrintEdgeSense);
  float feather=max(uPrintEdgeFeather*threshold,.004);
  return smoothstep(threshold-feather,threshold+feather,difference);
}
/** The layer's finished colour (Fractal recolouring and Flat colour) for a
 * source pixel read at a frame position. */
vec4 printFinished(vec4 pixel,vec2 frameUv){
  if(uColorMode>.5)pixel=recolor(pixel);
  if(uToonMix>0.)pixel=toon(pixel,layerUv(frameUv));
  return pixel;
}
vec4 printScreen(vec4 plain){
  bool paper=uPrintPaper>.5;
  vec3 paperColour=paper?uGradePalette[int(uPrintPaper-.5)]:vec3(1.);
  vec2 centreUv;vec4 centrePixel;float target;
  vec2 maskUv;
  vec4 screened;
  if(uPrintColour<1.5){
    float coverage=printMark(uPrintAngles[2],-1,centreUv,centrePixel,target);
    maskUv=centreUv;
    // Lines take the colour under each pixel; dots and dither cells are one colour each.
    bool lines=uPrintType>.5&&uPrintType<1.5;
    vec4 finished=lines?plain:printFinished(centrePixel,centreUv);
    vec3 ink;
    if(uPrintColour>.5)ink=uGradePalette[int(uPrintInk-.5)];
    else{
      // The mark is brightened towards the cell's average, but never past
      // full value, so a colour keeps its hue instead of clipping.
      vec3 straight=finished.rgb/max(finished.a,.000001);
      float peak=max(straight.r,max(straight.g,straight.b));
      ink=straight*min(min(1./max(target,.0001),8.),max(1./max(peak,.0001),1.));
    }
    if(paper)screened=vec4(mix(paperColour,ink,coverage)*plain.a,plain.a);
    else{
      // A mark that straddles the silhouette stays whole; its size already
      // shrank with the coverage at its centre.
      float a=min(max(plain.a,centrePixel.a),1.);
      screened=vec4(ink*a*coverage,a*coverage);
    }
  }else if(uPrintColour<2.5){
    // RGB light: three screens, each a primary, added.
    vec3 light=vec3(0.);float most=0.;
    for(int channel=0;channel<3;channel++){
      float coverage=printMark(uPrintAngles[channel],channel,centreUv,centrePixel,target);
      if(channel==0)maskUv=centreUv;
      vec3 straight=centrePixel.rgb/max(centrePixel.a,.000001);
      float value=channel==0?straight.r:channel==1?straight.g:straight.b;
      float strength=value*min(min(1./max(target,.0001),8.),max(1./max(value,.0001),1.))*centrePixel.a;
      float amount=coverage*max(strength,0.);
      if(channel==0)light.r=amount;else if(channel==1)light.g=amount;else light.b=amount;
      most=max(most,coverage);
    }
    float a=plain.a;
    if(paper)screened=vec4((paperColour*(1.-most)+light)*a,a);
    else screened=vec4(light*a,a*most);
  }else{
    // CMYK ink: four screens overprinted on paper. Each ink removes its
    // complement; black is the part all three share.
    vec3 colour=paperColour;float clear=1.;
    for(int channel=0;channel<4;channel++){
      float coverage=printMark(uPrintAngles[channel],channel,centreUv,centrePixel,target);
      if(channel==0)maskUv=centreUv;
      vec3 absorbs=channel==0?vec3(1.,0.,0.):channel==1?vec3(0.,1.,0.):channel==2?vec3(0.,0.,1.):vec3(1.);
      colour*=1.-coverage*absorbs;
      clear*=1.-coverage;
    }
    float a=plain.a;
    if(paper)screened=vec4(colour*a,a);
    else screened=vec4(colour*a*(1.-clear),a*(1.-clear));
  }
  float mask=1.;
  if(uPrintArea>.5){
    // Dots and dither cells are judged at their centre, so whole marks fade
    // in and out of the area; lines are judged at each pixel.
    float edge=printEdge(uPrintType>.5&&uPrintType<1.5?vUv:maskUv);
    mask=uPrintArea<1.5?edge:1.-edge;
  }
  return mix(plain,screened,clamp(uPrintMix,0.,1.)*mask);
}
void main() {
  vec2 uv=layerUv(vUv);
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
  if(uPrintOn>.5)top=printScreen(top);
  // Glow finish: the blurred bright light of this layer. It is kept apart from
  // the layer's coverage and added as light at the end, so it can only brighten
  // what is underneath. The levels are in the same view space as the source.
  vec3 glow=vec3(0.);
  if(uGlowOn>.5) {
    vec2 g=(uSourceViewInverse*vec3(uv,1.)).xy;
    glow=uGlowChannels[0]*texture2D(uGlowLevel0,g).rgb+uGlowChannels[1]*texture2D(uGlowLevel1,g).rgb
      +uGlowChannels[2]*texture2D(uGlowLevel2,g).rgb+uGlowChannels[3]*texture2D(uGlowLevel3,g).rgb
      +uGlowChannels[4]*texture2D(uGlowLevel4,g).rgb;
    if(uGlowStreak>.0001)glow+=uGlowStreak*uGlowMix*texture2D(uGlowStreakMap,g).rgb;
    if(uGlowTint>.5)glow=uGlowColour*max(glow.r,max(glow.g,glow.b));
    // Saturation, Hue and Exposure act on the glow as they do on the layer.
    if(abs(uSaturation-1.)>.000001 || abs(uHue)>.000001 || abs(uExposure-1.)>.000001)glow=grade(glow);
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
  glow*=clamp(mask*uOpacity,0.,1.);
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
  // Where nothing is underneath, the glow carries its own alpha for transparent export.
  rgb+=glow;
  alpha+=(1.-alpha)*clamp(max(glow.r,max(glow.g,glow.b)),0.,1.);
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
 * With uWrap (Tile edges) taps past the frame edge read the opposite edge.
 */
export const downsampleFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uSourceSize;
uniform float uFactor, uWrap;
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
      vec2 uv=((uWrap>.5?mod(vec2(x,y),uSourceSize):clamp(vec2(x,y),vec2(0.),uSourceSize-1.))+.5)/uSourceSize;
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
