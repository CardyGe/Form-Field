// Quadratic Julia sets with smooth escape colouring and original orbit traps.
// Sampling positions and animation are deterministic; no previous frame is used.
export const juliaFunctions = /* glsl */`
vec2 juliaSquare(vec2 z) { return vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y); }
vec2 cMul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec2 cDiv(vec2 a,vec2 b){return vec2(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/max(dot(b,b),1e-30);}
vec2 cSqrt(vec2 z){float r=length(z);return vec2(sqrt(max(.5*(r+z.x),0.)),(z.y<0.?-1.:1.)*sqrt(max(.5*(r-z.x),0.)));}
vec2 juliaBaseConstant() {
  float seed=mod(uSeed,997.)*.0137;
  float reference=mod(1729.,997.)*.0137;
  vec2 c=vec2(uJuliaReal,uJuliaImag);
  c+=.0009*(vec2(sin(seed),cos(seed))-vec2(sin(reference),cos(reference)));
  return c;
}
vec2 juliaConstant() {
  vec2 c=juliaBaseConstant()+uMorph*.014*vec2(cos(uPhase)-1.,sin(uPhase));
  c+=uDance*vec2(.17*(cos(uPhase)-1.),.23*sin(uPhase)+.06*sin(2.*uPhase));
  if(uEvolution>0.){
    float progress=fract(uPhase/TAU);
    float open=fractalCue(progress,vec4(.06,.36,.51,.75));
    float divide=fractalCue(progress,vec4(.40,.65,.78,.98));
    vec2 emergence=mix(vec2(-.066,.048),vec2(.066,-.054),uVariant*.50);
    vec2 branching=mix(vec2(.044,.085),vec2(-.060,-.053),uVariant*.50);
    c+=uEvolution*(.69+.31*uMorph)*(emergence*open+branching*divide);
  }
  return c;
}
// Zoom flight dives toward a repelling period-2 point z1 of z²+c. Near it the
// Julia set repeats exactly under the inverse map, scaled by the cycle's
// multiplier 4(c+1). Each loop goes 2k inverse steps deep, so the last frame
// is the first frame's own preimage: same image, no crossfade. Returns false
// when that cycle is not repelling enough to zoom.
float juliaDiveMultiplier() {
  vec2 c=uEvolution>0.?juliaBaseConstant():juliaConstant();
  return length(4.*(c+vec2(1.,0.)));
}
bool juliaCanDive() { return uZoomFlight>0.&&juliaDiveMultiplier()>(uEvolution>0.?1.25:1.03); }

vec2 juliaDomainPlane(vec2 pixelOffset) {
  vec2 p=fractalView(vUv+pixelOffset/uResolution);
  float denominator=1.+p.y*.18*tan(uCameraPitch);
  p/=(denominator<0.?-1.:1.)*max(abs(denominator),.08);
  float sway=uTravel*legacyCameraMotion();
  p=turn(uCameraYaw+sway*.12*sin(uPhase))*p;
  p*=2.8*uScale/1.7/max(uZoom,.5)*.78*gZoom;
  p+=sway*.18*vec2(sin(uPhase),cos(uPhase));
  // Frame the unfolding arms slightly closer during their transition.
  float open=fractalCue(fract(uPhase/TAU),vec4(.12,.43,.66,.99));
  p*=1.-uEvolution*(.18+.19*uTravel)*open;
  return turn(uTwist*.6)*p;
}
vec2 juliaPlane(vec2 pixelOffset) {
  vec2 p=juliaDomainPlane(pixelOffset);
  if(uVariant>.5&&uVariant<1.5) {
    // Reflection changes only this variant: Classic keeps the actual Julia set.
    p=wedge(p)*.92-vec2(.12,0.);
  } else if(uVariant>1.5) {
    // A continuous spiral diffeomorphism, including a finite origin.
    p=turn((.45+uFold*.9)*log(1.+dot(p,p)))*p;
  }
  return p;
}

float juliaStrokeIntegral(float coordinate,float halfWidth) {
  float part=fract(coordinate);
  return floor(coordinate)*halfWidth*2.+min(part,halfWidth)+max(part-(1.-halfWidth),0.);
}
float juliaStroke(float coordinate,float footprint,float halfWidth) {
  // Exact box integration of a periodic stroke preserves the average coverage
  // when filigree becomes narrower than a pixel, instead of erasing it.
  float aa=max(footprint,.00001);
  return clamp((juliaStrokeIntegral(coordinate+aa*.5,halfWidth)
    -juliaStrokeIntegral(coordinate-aa*.5,halfWidth))/aa,0.,1.);
}
float juliaTrapStroke(float distance,float footprint,float width) {
  // Convolution of a Gaussian filament with the pixel footprint. The width /
  // sigma factor conserves its energy as successive preimages get smaller.
  float sigma=sqrt(width*width+footprint*footprint/6.);
  return width/max(sigma,.000001)*exp(-min(60.,distance*distance/(2.*sigma*sigma)));
}

vec3 juliaSample(vec2 pixelOffset) {
  vec2 domain=juliaPlane(pixelOffset),z=domain;
  float pixel=planePixel()*.78;
  if(uVariant>1.5) {
    vec2 unwarped=juliaDomainPlane(pixelOffset);
    float radius2=dot(unwarped,unwarped);
    float shear=2.*(.45+.9*uFold)*radius2/(1.+radius2);
    pixel*=.5*(sqrt(4.+shear*shear)+shear);
  }
  vec2 c=juliaConstant();
  // shift: inverse steps the view has dived; ratio: local zoom of the dive.
  float shift=0.,ratio=1.;
  if(juliaCanDive()) {
    vec2 d=cSqrt(vec2(-3.,0.)-4.*c),zp=.5*(vec2(-1.,0.)+d),zq=.5*(vec2(-1.,0.)-d);
    vec2 lambda2=4.*(c+vec2(1.,0.));
    // Hold the number of inverse steps while the constant evolves.
    float k=clamp(ceil(log(1.+5.*uZoomFlight)/log(juliaDiveMultiplier())),1.,8.),n=2.*k;
    float f=fract(uPhase/TAU);
    vec2 delta=domain,start=zp+delta,back=start;
    for(int j=0;j<16;j++) {
      if(float(j)>=n)break;
      vec2 s=cSqrt(back-c),target=mod(float(j),2.)<.5?zq:zp;
      back=dot(s-target,s-target)<dot(-s-target,-s-target)?s:-s;
    }
    // Spiral zoom by the k-th power of the multiplier, corrected so that the
    // end of the loop lands exactly on the inverse-mapped start.
    float logLength=k*log(length(lambda2)),angle=k*atan(lambda2.y,lambda2.x);
    vec2 lambda=exp(logLength)*vec2(cos(angle),sin(angle));
    vec2 inward=exp(-f*logLength)*vec2(cos(-f*angle),sin(-f*angle));
    // The residual is scaled with the zoom so the dive keeps an even pace.
    vec2 residual=cMul(lambda,back-zp)-delta;
    z=zp+cMul(inward,delta+f*residual);
    shift=n*f;
    ratio=max(1.e-6,length(fwidth(z))/max(length(fwidth(domain)),1e-12));
    pixel*=ratio;
  }

  float logDerivative=0.,count=0.,r2=dot(z,z);
  float trap=8.,orbitSum=0.,orbitWeight=0.,weight=pow(.87,-shift);
  vec3 filigree=vec3(0.);
  float trapRadius=.28+.58*uFold;
  float crestPhase=uPhase-length(domain)*(2.1+2.8*uTravel);
  trapRadius+=uEvolution*.19*cos(crestPhase+.85);
  float iterations=uQuality<.5?128.:(uQuality<1.5?192.:256.);
  for(int i=0;i<256;i++) {
    if(float(i)>=iterations||r2>256.)break;
    float radius=sqrt(max(r2,0.));
    // Both circle and crossed-line traps follow the true complex orbit.
    vec2 trapPoint=turn(.35+uFold*.9)*z;
    float circle=abs(radius-trapRadius);
    float crossLine=min(abs(trapPoint.x-.13),abs(trapPoint.y+.08));
    // Orbit position counted from the original view: the dived orbit has
    // shift extra leading steps, which fade out so colours match the start.
    float index=float(i)-shift,present=clamp(1.+index,0.,1.);
    trap=min(trap,mix(circle,crossLine,.4)+(1.-present)*8.);
    float ornament=exp(-circle*(2.+uDensity*2.5));
    ornament+=.35*exp(-crossLine*(4.+uDensity*4.));
    orbitSum+=ornament*weight*present;orbitWeight+=weight*present;weight*=.87;
    if(index<28.) {
      float orbitPixel=pixel*exp(clamp(logDerivative,-20.,20.));
      float width=.0045*uLineWidth;
      float thread=juliaTrapStroke(circle,orbitPixel,width);
      thread+=juliaTrapStroke(crossLine,orbitPixel,width*.7)*.48;
      thread*=smoothstep(1.,6.,index);
      thread=clamp(thread/(1.+index*.055),0.,.9)*clamp(28.-index,0.,1.);
      vec3 ink=pigment(uOffset+index*.091+ornament*.055,.001);
      filigree=mix(filigree,ink,thread);
    }
    logDerivative+=log(max(2.*radius,.000001));
    z=juliaSquare(z)+c;r2=dot(z,z);count+=1.;
  }

  float escaped=r2>256.?1.:0.;
  float logRadius=.5*log(max(r2,1.00001));
  float smoothCount=count+1.-log2(max(logRadius,.00001))-shift;
  // Measured in units of the undived view, so glow widths stay the same on screen.
  float distance=escaped*.5*exp(clamp(logRadius+log(max(logRadius,.00001))-logDerivative,-40.,4.))/ratio;
  float orbit=orbitSum/max(orbitWeight,.000001);
  float trapLog=-log(max(trap,.000001));
  float density=uDensity*(.74+.56*uDetail);
  float exteriorCoordinate=uOffset+smoothCount*.105*density+uTrap*orbit*.12;
  float interiorCoordinate=uOffset+.21+orbit*.46+trapLog*.037*density;
  float exteriorAA=max(fwidth(exteriorCoordinate),.000001);
  float interiorAA=max(fwidth(interiorCoordinate),.000001);

  // Fine escape contours carry the exterior; distant pixels fall into a quiet,
  // structured dark ground instead of a large blurred colour ramp.
  float stroke=juliaStroke(exteriorCoordinate*2.4,exteriorAA*2.4,.06*uLineWidth);
  float nearSet=exp(-distance*52.);
  vec3 exterior=pigment(exteriorCoordinate,exteriorAA);
  // Outside colour fills the space beyond the set with dim escape bands instead of black.
  exterior*=mix(.006+uOutside*(.22+.5*stroke),.16+1.04*stroke,nearSet);

  // Early-orbit texture keeps bounded basins visible, including an attracting
  // interior whose final orbit would otherwise collapse to one flat colour.
  float innerStroke=juliaStroke(interiorCoordinate*3.6,interiorAA*3.6,.16*uLineWidth);
  vec3 interior=pigment(interiorCoordinate,interiorAA);
  interior*=.1+.2*innerStroke;

  // Fixed subpixel samples integrate the true Julia boundary. Replacing a
  // pixel-sized exterior band with dark interior changes the image's energy
  // with export resolution and must not be used as an antialiasing shortcut.
  float resolve=escaped;
  vec3 color=mix(interior,exterior,resolve);
  float ornamentMask=(1.-escaped)+escaped*exp(-distance*75.);
  color+=filigree*uTrap*ornamentMask*.3;
  float detailGlow=exp(-distance*45.)*escaped;
  color+=pigment(exteriorCoordinate+.12,exteriorAA)*detailGlow*uGlow*.065;
  if(uReveal>0.){
    // The bright crest advances along the same escape levels as the filigree.
    // A second, wider envelope keeps one part of the field readable at a time.
    float crest=exteriorCoordinate*1.65-uPhase/TAU;
    float ripple=juliaStroke(crest,exteriorAA*1.65,.13+.055*uLineWidth);
    float sweep=.5+.5*cos(uPhase-length(domain)*6.5-domain.y*2.);
    float emphasis=smoothstep(.20,.88,sweep);
    float band=exp(-distance*mix(28.,15.,emphasis))*escaped;
    vec3 tracer=pigment(exteriorCoordinate+.025*cos(uPhase),exteriorAA);
    color=color*mix(1.,.48+.52*emphasis,uReveal*.76)
      +tracer*ripple*band*uReveal*(.14+.62*emphasis);
  }
  if(uEvolution>0.){
    // A metallic edge, a darker basin and a spreading light front make
    // the branching forms readable at different scales.
    float progress=fract(uPhase/TAU);
    float opening=fractalCue(progress,vec4(.14,.42,.64,.94));
    float bandCoordinate=smoothCount*.29-progress+.09*cos(crestPhase);
    float bandFootprint=max(.00001,fwidth(bandCoordinate));
    float filament=juliaStroke(bandCoordinate,bandFootprint,.10+.056*uLineWidth);
    float bevel=juliaStroke(bandCoordinate-.19,bandFootprint,.056+.028*uLineWidth);
    float basin=juliaStroke(interiorCoordinate*4.-progress,interiorAA*4.,.14);
    float reach=mix(40.,15.,opening);
    float field=exp(-distance*reach);
    vec3 plated=pigment(exteriorCoordinate+.07+.19*opening,exteriorAA);
    vec3 lip=mix(plated,vec3(1.,.96,.86),.32+.25*uRelief);
    vec3 inlay=pigment(interiorCoordinate-.17+.18*opening,interiorAA);
    vec3 inside=(inlay*(.034+.25*basin)+filigree*.42*uTrap);
    vec3 outside=plated*(.025+uOutside*.12)+field*(plated*(.095+.63*filament)+lip*bevel*.43);
    color=mix(color,mix(inside,outside,escaped),uEvolution*.83);
  }

  // This unfiltered height contains no derivative calls. Filtered colour and
  // footprint values never feed the material derivative inside glaze().
  float height=orbit*.08+sin(interiorCoordinate*TAU)*.012;
  float reliefWeight=1./(1.+fwidth(height)*12.);
  if(uVariant>.5&&uVariant<1.5) {
    vec2 p=juliaDomainPlane(pixelOffset);
    float sector=TAU/max(uSymmetry,3.);
    float angle=length(p)>.0000001?abs(mod(atan(p.y,p.x)+sector*.5,sector)-sector*.5):0.;
    reliefWeight*=smoothstep(0.,.045,min(angle,sector*.5-angle));
  }
  return glaze(color,height,reliefWeight*(.35+.65*(1.-resolve)));
}

vec3 juliaBloom() {
  if(uQuality<.5)return juliaSample(vec2(0.));
  vec3 color=vec3(0.);
  if(uQuality<1.5) {
    color+=juliaSample(vec2(-.25,-.25));
    color+=juliaSample(vec2(.25,-.25));
    color+=juliaSample(vec2(-.25,.25));
    color+=juliaSample(vec2(.25,.25));
    return color*.25;
  }
  // Centred 3x3 stratification integrates narrow filaments reproducibly.
  for(int i=0;i<9;i++) {
    vec2 offset=(vec2(mod(float(i),3.),floor(float(i)/3.))-1.)/3.;
    color+=juliaSample(offset);
  }
  return color/9.;
}
`;
