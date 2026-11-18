export const portalFunctions = /* glsl */`
float portalPhase() {
  return TAU*fract(uPosition+uAutoTravel*uPhase/TAU);
}
float portalDistance(float x) {
  return abs(fract(x+.5)-.5);
}
float portalAngle(vec2 p) {
  return dot(p,p)>1.e-12?atan(p.y,p.x):0.;
}
float portalFill(float distance,float width,float footprint) {
  return 1.-smoothstep(max(0.,width-footprint),width+footprint,distance);
}
vec4 portalOutput(vec3 emission,float coverage) {
  float alpha=clamp(coverage,0.,1.);
  float background=(1.-uCutout)*(1.-alpha);
  return vec4(emission+background*vec3(.0015,.002,.004),alpha+background);
}
vec2 portalPlane(vec2 offset,float phase) {
  vec2 p=fractalView(vUv+offset/uResolution);
  p-=uTravel*vec2(.19*sin(phase),.11*(cos(phase)-1.));
  p=turn(uCameraYaw+uBank*.55*sin(phase))*p;
  p.x+=sin(uCameraPitch)*p.y*.48;
  return p*2.*uScale/1.7/max(uZoom,.5);
}
float portalPixel() {
  return 2.*uScale/1.7*uViewScale/(uResolution.y*max(uZoom,.5));
}

vec4 beadedTunnel(vec2 p,float phase) {
  float pixel=portalPixel();
  float r=max(length(p),.0001),a=portalAngle(p);
  float pulse=.5-.5*cos(phase);
  float radius=.42+.23*uDepth;
  // The repeated ribs live in inverse depth. Their spacing in the image
  // expands as they approach the viewer, while the silhouette can breathe.
  float bend=uTwist*(.65*sin(r*2.8-phase)+.33*log(1.+r));
  float angle=a+bend+.018*mod(uSeed,997.)/997.;
  float lobes=cos(angle*3.+.2*sin(phase));
  float wall=radius*(1.+uFold*(.28*lobes+.10*cos(angle*6.-phase)));
  float z=wall/max(r,.012);
  float speed=phase/TAU-uReveal*.108*sin(phase);
  float row=z*mix(2.9,5.6,uDepth)+6.*speed;
  float count=uSymmetry*4.;
  float lane=angle*count/TAU+uFold*.42*sin(z*.9+angle*3.);
  float laneAA=max(.006,pixel*count/(TAU*r));
  float rowAA=max(.006,fwidth(row)*.64);
  float aa=max(laneAA,rowAA);
  vec2 cell=vec2(portalDistance(lane),portalDistance(row)*1.02);
  float shape=length(cell);
  float beadWidth=.26+.035*uFold;
  float line=.045*uLineWidth;
  float shell=portalFill(abs(shape-beadWidth),line,aa);
  float core=portalFill(shape,beadWidth*.64,aa)*(.35+.3*(1.-uRelief));
  float highlight=portalFill(abs(shape-beadWidth*.72),line*.45,aa)*uRelief;
  float soft=portalFill(abs(shape-beadWidth),line*3.3,aa)*uGlow*.20;
  float legibility=(1.-smoothstep(.16,.54,aa))*smoothstep(.062,.15+.045*uReveal*pulse,r);
  float light=1./(1.+uDepth*.19*z*z);
  float track=.5+.5*cos(angle*2.+.55*cos(phase));
  float colorIndex=uOffset+.42*track+uDensity*(.12*sin(row*TAU/6.)+.14/(.7+z));
  vec3 ink=pigment(colorIndex,aa*.12);
  float lines=portalFill(cell.x,.043, laneAA)*uDetail*.13;
  float intensity=legibility*(.32+.68*light);
  float contour=portalFill(abs(r-(.075+.034*pulse)*(.85+.16*lobes)),.007+uLineWidth*.003,pixel);
  vec3 rim=pigment(uOffset+.10+.22*cos(angle*3.),.001);
  vec3 beads=ink*(shell*1.19+core*.55+soft+lines)+mix(ink,vec3(1.),.6)*highlight*.29;
  return portalOutput(beads*intensity+rim*contour*.61,
    (shell+core+highlight*.28+soft+lines)*legibility+contour*.66);
}

vec4 mosaicSpiral(vec2 p,float phase) {
  float pixel=portalPixel();
  float r=max(length(p),.0001),a=portalAngle(p);
  float pulse=.5-.5*cos(phase);
  float foldAmount=.58+.32*uFold;
  float pitch=mix(3.0,5.4,uDepth)*sqrt(uDensity);
  // A full revolution shifts the log-radius by six bands. Both the tile
  // geometry and the six-colour sequence repeat after that translation.
  float travel=phase/TAU-uReveal*.125*sin(phase);
  float smallDisc=.105+.28*smoothstep(.22,.94,pulse);
  float aperture=smoothstep(smallDisc*.55,smallDisc*1.55,r);
  float lifted=uReveal*(1.-aperture);
  // Compress the finest levels into a readable inner rosette. Its footprint
  // expands with the aperture and eases into the identical outer tile field.
  float repeatScale=mix(1.,mix(.72,1.85,1.-pulse),lifted);
  float nearLimit=.068*lifted;
  float readableRadius=sqrt(r*r*repeatScale*repeatScale+nearLimit*nearLimit);
  float groundRadius=log2(readableRadius)*pitch;
  float logRadius=groundRadius-6.*travel;
  float seedRotation=.17*(mod(uSeed,997.)/997.-.5);
  float spin=a+(uTwist+.28)*groundRadius*.27+(lifted*.45+uTwist*.26)*sin(phase)+seedRotation;
  float lobe=uSymmetry*spin;
  float shell=cos(lobe+.42*sin(logRadius*TAU/3.));
  float band=logRadius+foldAmount*shell;
  // Fewer spokes in the nested disc keep the smallest cells present in a
  // reduced preview. Both counts are integer multiples of the motif.
  float tiles=uSymmetry*7.;
  float col=spin*tiles/TAU+.66*sin(logRadius*TAU/3.)+lifted*.22*sin(lobe);
  float bandAA=max(.007,fwidth(band)*.59);
  // The angle wraps once at pi. Its analytical footprint never sees a seam.
  float colAA=max(.008,pixel*tiles/TAU*(1.+abs(uTwist+.28)*pitch*.5)/r);
  float gap=.063+.067*uLineWidth;
  float detailedSeam=portalFill(portalDistance(col),gap*.76,colAA);
  float discSeam=portalFill(portalDistance(spin*uSymmetry*2./TAU),gap*.82,colAA*2./7.);
  float seam=max(portalFill(portalDistance(band),gap,bandAA),mix(detailedSeam,discSeam,lifted));
  float angularAA=mix(colAA,colAA*2./7.,lifted);
  float clarity=(1.-smoothstep(.18,.65,max(bandAA,angularAA)))*smoothstep(.013,.036,r);
  float coloredArm=.5+.5*cos(spin*2.);
  float bandColor=(floor(band)+.5)/6.;
  float texture=.5+.5*sin(fract(col)*TAU)*sin(fract(band)*TAU);
  vec3 ink=pigment(uOffset+bandColor+.46*coloredArm+.07*shell,.002);
  float inner=.55+.45*smoothstep(.10,.78,pulse);
  float lighting=mix(1.,.69+.20*shell+.27*texture,uRelief);
  lighting*=mix(1.,mix(.52,1.23,1.-abs(aperture-inner)),uReveal*.57);
  float rim=portalFill(abs(r-smallDisc*(1.+.08*shell)),.005,pixel)*uReveal*uGlow;
  float jewel=portalFill(r,.027+.02*pulse,pixel)*uReveal;
  float coverage=(1.-seam)*clarity;
  float grout=.045*uDetail*clarity*seam;
  return portalOutput(ink*(coverage*lighting+grout+rim*.25)+pigment(uOffset+.035,.002)*jewel*.73,
    coverage+rim*.32+grout+jewel*.78);
}

vec4 lightHalo(vec2 p,float phase) {
  float pixel=portalPixel(),r=max(length(p),.0001),a=portalAngle(p);
  float progress=phase/TAU;
  float phrase=.5-.5*cos(phase);
  float petalWave=cos(uSymmetry*a+uTwist*1.8+sin(phase)*.20);
  float aperture=.20+.12*uReveal*phrase;
  float shape=r/(1.+.15*uFold*petalWave);
  float width=.006+.006*uLineWidth;
  float spokes=uSymmetry*3.;
  float spokeAA=max(.005,pixel*spokes/(TAU*r));
  float spoke=portalFill(portalDistance(a*spokes/TAU+uTwist*r*.6),.10,spokeAA);
  float energy=0.,coverage=0.;
  vec3 color=vec3(0.);
  for(int i=0;i<6;i++){
    float level=float(i);
    float delayedPhase=phase-level*.72;
    float opening=.5-.5*cos(delayedPhase);
    float spread=.049+.031*uDensity;
    float radius=aperture+level*spread+uReveal*level*.014*(opening-.5);
    float arrival=fract(progress-.085*level);
    float wave=smoothstep(.045,.23,arrival)*(1.-smoothstep(.55,.92,arrival));
    float visibility=i==0?mix(1.,.58+.42*wave,uReveal)
      :mix(.68,.08+.92*wave,uReveal)*pow(.87,level)*uAfterglow;
    float distance=abs(shape-radius);
    float crown=portalFill(distance,width,pixel);
    float interleave=portalFill(distance,width*(2.+uDepth),pixel)*spoke;
    float haze=portalFill(distance,width*4.1,pixel)*uGlow*.21;
    float amount=(crown+interleave*.47+haze)*visibility;
    vec3 light=pigment(uOffset+level*.143+.039*petalWave+.052*sin(delayedPhase),.003);
    color+=light*amount*(1.+.42*uRelief*crown);
    energy+=amount;
    coverage=max(coverage,amount);
  }
  float rays=spoke*portalFill(abs(shape-aperture),.13+.08*uDepth,pixel)*uDetail*uReveal*.23;
  float seedAngle=mod(uSeed,997.)*.004;
  float coreRadius=.044+.038*phrase*uReveal;
  float core=portalFill(abs(r-coreRadius),width*.64,pixel);
  float heart=portalFill(r,coreRadius*.33,pixel)*(.65+.35*phrase);
  vec3 warm=pigment(uOffset+.025+.025*cos(seedAngle),.002);
  // A fine vertical trace connects the centre to the physical footing of a
  // projection. The hot point travels up it before the wider rings appear.
  float beamAxis=abs(p.x+.018*sin(p.y*9.+phase)*p.y);
  float beamLimit=(1.-smoothstep(.32,.72,-p.y))*smoothstep(.008,.055,-p.y);
  float beam=portalFill(beamAxis,width*.24,pixel)*beamLimit*uDepth*uReveal;
  float spark=portalFill(abs(p.y+mix(.58,.04,smoothstep(.04,.56,phrase))),.025,pixel);
  float beamLight=beam*(.14+.74*spark)*(.45+.55*phrase);
  color+=warm*(rays+core*.97+heart*1.18+beamLight);
  return portalOutput(color/(1.+max(0.,energy-1.)*.45),max(coverage,rays+core+heart+beamLight));
}

vec4 portalSample(vec2 offset) {
  float phase=portalPhase();
  vec2 p=portalPlane(offset,phase);
  if(uVariant<.5)return beadedTunnel(p,phase);
  if(uVariant<1.5)return mosaicSpiral(p,phase);
  return lightHalo(p,phase);
}
vec4 fractalPortal() {
  if(uQuality<.5)return portalSample(vec2(0.));
  if(uQuality<1.5)return (portalSample(vec2(-.25,-.25))+portalSample(vec2(.25,.25)))*.5;
  return (portalSample(vec2(-.25,-.25))+portalSample(vec2(.25,-.25))
    +portalSample(vec2(-.25,.25))+portalSample(vec2(.25,.25)))*.25;
}
`;
