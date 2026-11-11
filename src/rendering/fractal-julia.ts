// Quadratic Julia sets with smooth escape colouring and original orbit traps.
// Sampling positions and animation are deterministic; no previous frame is used.
export const juliaFunctions = /* glsl */`
vec2 juliaSquare(vec2 z) { return vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y); }

vec2 juliaDomainPlane(vec2 pixelOffset) {
  vec2 p=(sourceUV(vUv+pixelOffset/uResolution)-.5)*vec2(uAspect,1.);
  float denominator=1.+p.y*.18*tan(uCameraPitch);
  p/=(denominator<0.?-1.:1.)*max(abs(denominator),.08);
  p=turn(uCameraYaw+uTravel*.12*sin(uPhase))*p;
  p*=2.8*uScale/1.7/max(uZoom,.5)*.78;
  p+=uTravel*.18*vec2(sin(uPhase),cos(uPhase));
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
  float seed=mod(uSeed,997.)*.0137;
  float reference=mod(1729.,997.)*.0137;
  vec2 c=vec2(uJuliaReal,uJuliaImag);
  c+=.0009*(vec2(sin(seed),cos(seed))-vec2(sin(reference),cos(reference)));
  c+=uMorph*.014*vec2(cos(uPhase)-1.,sin(uPhase));

  float logDerivative=0.,count=0.,r2=dot(z,z);
  float trap=8.,orbitSum=0.,orbitWeight=0.,weight=1.;
  vec3 filigree=vec3(0.);
  float trapRadius=.28+.58*uFold;
  float iterations=uQuality<.5?128.:(uQuality<1.5?192.:256.);
  for(int i=0;i<256;i++) {
    if(float(i)>=iterations||r2>256.)break;
    float radius=sqrt(max(r2,0.));
    // Both circle and crossed-line traps follow the true complex orbit.
    vec2 trapPoint=turn(.35+uFold*.9)*z;
    float circle=abs(radius-trapRadius);
    float crossLine=min(abs(trapPoint.x-.13),abs(trapPoint.y+.08));
    trap=min(trap,mix(circle,crossLine,.4));
    float ornament=exp(-circle*(2.+uDensity*2.5));
    ornament+=.35*exp(-crossLine*(4.+uDensity*4.));
    orbitSum+=ornament*weight;orbitWeight+=weight;weight*=.87;
    if(i<28) {
      float orbitPixel=pixel*exp(clamp(logDerivative,-20.,20.));
      float width=.0045*uLineWidth;
      float thread=juliaTrapStroke(circle,orbitPixel,width);
      thread+=juliaTrapStroke(crossLine,orbitPixel,width*.7)*.48;
      thread*=smoothstep(1.,6.,float(i));
      thread=clamp(thread/(1.+float(i)*.055),0.,.9);
      vec3 ink=pigment(uOffset+float(i)*.091+ornament*.055,.001);
      filigree=mix(filigree,ink,thread);
    }
    logDerivative+=log(max(2.*radius,.000001));
    z=juliaSquare(z)+c;r2=dot(z,z);count+=1.;
  }

  float escaped=r2>256.?1.:0.;
  float logRadius=.5*log(max(r2,1.00001));
  float smoothCount=count+1.-log2(max(logRadius,.00001));
  float distance=escaped*.5*exp(clamp(logRadius+log(max(logRadius,.00001))-logDerivative,-40.,4.));
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
  exterior*=mix(.006,.16+1.04*stroke,nearSet);

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
