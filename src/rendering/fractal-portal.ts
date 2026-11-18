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
  float sway=legacyCameraMotion();
  p-=uTravel*sway*vec2(.19*sin(phase),.11*(cos(phase)-1.));
  p=turn(uCameraYaw+uBank*mix(.42,.55*sin(phase),sway))*p;
  p.x+=sin(uCameraPitch)*p.y*.48;
  return p*2.*uScale/1.7/max(uZoom,.5);
}
float portalPixel() {
  return 2.*uScale/1.7*uViewScale/(uResolution.y*max(uZoom,.5));
}

vec4 beadedTunnel(vec2 p,float phase) {
  float pixel=portalPixel();
  float pulse=.5-.5*cos(phase);
  float evolution=smoothstep(0.,.72,uEvolution);
  float progress=phase/TAU;
  float junction=fractalCue(progress,vec4(.22,.50,.73,.98));
  float surge=fractalCue(progress,vec4(.08,.27,.52,.86));
  if(evolution>0.){
    // A complex square turns two fixed-axis throats into a single one when
    // their roots meet. The screen centre and horizon stay fixed.
    float separation=.38*(1.-junction);
    vec2 pair=vec2(p.x*p.x-p.y*p.y-separation*separation,2.*p.x*p.y);
    p=mix(p,pair/max(.28,length(p)+separation*.47),evolution);
  }
  float r=max(length(p),.0001),a=portalAngle(p);
  float radius=.42+.23*uDepth;
  // The repeated ribs live in inverse depth. Their spacing in the image
  // expands as they approach the viewer, while the silhouette can breathe.
  float bend=uTwist*(.65*sin(r*2.8-phase)+.33*log(1.+r));
  bend+=evolution*surge*(.36*log(1.+r*2.8)-.12*cos(5.*a));
  float angle=a+bend+.018*mod(uSeed,997.)/997.;
  float lobes=cos(angle*3.+.2*sin(phase));
  float wall=radius*(1.+uFold*(.28*lobes+.10*cos(angle*6.-phase))
    +evolution*junction*.22*cos(angle*4.+r*1.9));
  float z=wall/max(r,.012);
  float speed=phase/TAU-uReveal*mix(.108,mix(.077,.137,uTravel),evolution)*sin(phase);
  float rowCycle=6.+floor(6.*evolution+.5);
  float row=z*mix(2.9,5.6,uDepth)+rowCycle*speed;
  float count=uSymmetry*mix(4.,2.75,evolution);
  count=floor(count+.5);
  float lane=angle*count/TAU+uFold*.42*sin(z*.9+angle*3.);
  float laneAA=max(.006,pixel*count/(TAU*r));
  float rowAA=max(.006,fwidth(row)*.64);
  float aa=max(laneAA,rowAA);
  vec2 cell=vec2(portalDistance(lane),portalDistance(row)*mix(1.02,.92,evolution));
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
  float colorIndex=uOffset+.42*track+uDensity*(.12*sin(row*TAU/rowCycle)+.14/(.7+z));
  vec3 ink=pigment(colorIndex,aa*.12);
  if(evolution>0.){
    float heat=uOffset-progress+.16*sin(angle)+.055*sin(row*TAU/rowCycle)+.17*surge;
    vec3 current=pigment(heat,aa*.12);
    ink=mix(ink,current,evolution*.81);
  }
  float lines=portalFill(cell.x,.043, laneAA)*uDetail*.13;
  float intensity=legibility*(.32+.68*light);
  float contour=portalFill(abs(r-(.075+.034*pulse)*(.85+.16*lobes)),.007+uLineWidth*.003,pixel);
  vec3 rim=pigment(uOffset+.10+.22*cos(angle*3.),.001);
  float hotSpot=shell*(.60+.40*cos(a+z*.6))*evolution;
  vec3 beads=ink*(shell*1.19+core*.55+soft+lines)+mix(ink,vec3(1.),.6)*(highlight*.29+hotSpot*.19);
  float innerRim=portalFill(abs(r-(.103+.083*junction)*(.82+.18*lobes)),.0035,pixel)*junction*evolution;
  float filament=portalFill(cell.x,.022,laneAA)*portalFill(cell.y,.23,rowAA)
    *legibility*surge*evolution*.20;
  return portalOutput(beads*intensity+rim*(contour*.61+innerRim*.81)+ink*filament,
    (shell+core+highlight*.28+soft+lines)*legibility+contour*.66+innerRim+filament);
}

vec4 mosaicFanSheet(vec2 p,float pixel) {
  float radius=max(length(p),.0001),angle=portalAngle(p);
  float pitch=mix(2.7,4.2,uDepth)*sqrt(uDensity);
  float logRadius=log2(sqrt(radius*radius+.00064))*pitch;
  float petals=.32+.32*uFold;
  float rowCoord=logRadius+petals*cos(uSymmetry*angle+logRadius*1.37);
  float row=floor(rowCoord),height=fract(rowCoord);
  float arms=uSymmetry;
  float spiral=angle*arms/TAU+(uTwist+.41)*logRadius+row*.5;
  float toward=fract(spiral)-.5;
  vec2 fan=vec2(toward*1.7,height*1.12);
  float arc=length(fan);
  float arcPitch=mix(4.2,6.,uDetail);
  float stepAngle=atan(fan.x,max(fan.y,.0001))*2.9;
  float arcAA=max(.008,fwidth(rowCoord)*.39+pixel/radius*.55);
  float colAA=max(.008,pixel*arms/(TAU*radius));
  float width=.088+.042*uLineWidth;
  float glass=1.-max(portalFill(portalDistance(arc*arcPitch),width,arcAA),
    portalFill(portalDistance(stepAngle+.5*floor(arc*arcPitch)),width*.72,colAA));
  float mortar=max(portalFill(.5-abs(toward),.027,colAA),portalFill(portalDistance(rowCoord),.031,arcAA*.58));
  float legible=1.-smoothstep(.16,.68,max(arcAA,colAA));
  float coverage=glass*(1.-mortar)*legible;
  float sector=abs(cos(angle+logRadius*.11));
  vec3 ink=pigment(uOffset+(row+.31)/6.+sector*.37+.012*floor(arc*arcPitch),.001);
  float tile=.68+.41*portalFill(portalDistance(arc*arcPitch+.5),.29,arcAA);
  float core=portalFill(radius,.028,pixel);
  return vec4(ink*coverage*mix(.93,tile,uRelief)+pigment(uOffset+.16,.001)*core*.95,coverage+core);
}
vec4 mosaicFans(vec2 p,float phase) {
  float pixel=portalPixel(),radius=length(p);
  float progress=phase/TAU;
  // The foreground disc replaces its parent as it grows. On wrap, each layer
  // takes the next layer's exact scale and position. Only invisible extremes
  // are removed, so there is no reverse zoom or crossfade at the seam.
  float advance=progress-mix(.04,.14,uReveal)*sin(phase);
  float ratio=mix(3.65,5.1,uDepth);
  float initial=mix(.24,.31,uTravel);
  float coverage=0.;
  vec3 color=vec3(0.);
  for(int i=2;i>=-3;i--){
    float scale=initial*pow(ratio,float(i)+advance);
    float visible=smoothstep(max(.014,pixel*2.5),max(.027,pixel*6.),scale)
      *(1.-smoothstep(2.8,initial*ratio*ratio,scale));
    if(visible<=0.)continue;
    // Keep derivatives defined across a fragment quad before testing its coverage.
    vec4 sheet=mosaicFanSheet(p/scale,pixel/scale);
    float disc=1.-smoothstep(scale-pixel*2.,scale+pixel*2.,radius);
    float edge=portalFill(abs(radius-scale),pixel*1.8,pixel)*(.18+.29*uGlow);
    float normalLight=.84+.26*clamp(p.y/max(scale,.01),-1.,1.);
    float focus=.37+.80*(1.-smoothstep(.57,1.85,scale));
    float layerAlpha=disc*visible;
    color=mix(color,sheet.rgb*normalLight*focus,layerAlpha)
      +pigment(uOffset+.075,.001)*edge*visible;
    coverage=mix(coverage,clamp(sheet.a,0.,1.),layerAlpha)+edge*visible;
  }
  return portalOutput(color,coverage);
}

vec4 mosaicSpiral(vec2 p,float phase) {
  if(uEvolution>=.72)return mosaicFans(p,phase);
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
  vec4 ribbons=portalOutput(ink*(coverage*lighting+grout+rim*.25)+pigment(uOffset+.035,.002)*jewel*.73,
    coverage+rim*.32+grout+jewel*.78);
  return uEvolution<=0.?ribbons:mix(ribbons,mosaicFans(p,phase),smoothstep(0.,.72,uEvolution));
}

vec4 stackedHalo(vec2 p,float phase) {
  float pixel=portalPixel(),progress=phase/TAU;
  float opening=fractalCue(progress,vec4(.16,.42,.82,.98));
  float crownChange=fractalCue(progress,vec4(.37,.62,.83,.99));
  vec2 crown=p-vec2(0.,.055+.23*opening);
  vec2 lower=p+vec2(0.,.21+.085*crownChange);
  float angle=portalAngle(crown),minorAngle=portalAngle(lower);
  float points=max(4.,uSymmetry);
  float flutes=cos(points*angle+uTwist*1.7);
  // A pinched two-lobed opening rises and becomes a wheel. A smaller,
  // differently shaped bloom forms on the beam beneath it.
  float upperForm=1.+(1.-crownChange)*(.17*cos(2.*angle)-.22*sin(angle)-.10*sin(3.*angle))
    +uFold*(.031+.075*crownChange)*flutes;
  float lowerForm=1.+.16*cos(2.*minorAngle)-.18*sin(minorAngle)-.10*sin(3.*minorAngle);
  float upperShape=length(crown)/upperForm;
  float lowerShape=length(lower)/lowerForm;
  float width=.0035+.0044*uLineWidth;
  float beamEdge=(1.-smoothstep(.46,.77,abs(p.y+.09)));
  float beamMask=portalFill(abs(p.x),width*.58,pixel)*beamEdge;
  float beamGlow=exp(-abs(p.x)*50.)*beamEdge*(.12+.19*opening)*uGlow;
  float spark=portalFill(abs(fract(p.y*6.2-progress*2.)-.5),.084,pixel*6.2);
  vec3 color=pigment(uOffset+.03,.001)*(beamMask*(.29+.91*spark)+beamGlow);
  float alpha=beamMask*(.35+.49*spark)+beamGlow;
  for(int i=0;i<9;i++){
    float order=float(i);
    float age=fract(progress-mix(.067,.113,uTravel)*order);
    float envelope=fractalCue(age,vec4(.01,.11,.55,1.));
    float radius=.045+(.41+.18*uDepth+.04*uDensity)*age+.04*opening;
    float rib=abs(upperShape-radius);
    float spokeCoord=angle*points/TAU;
    float spokeAA=pixel*points/(TAU*max(length(crown),.04));
    float spokes=mix(portalFill(portalDistance(spokeCoord*4.),.086,spokeAA*4.),
      portalFill(portalDistance(spokeCoord*7.),.086,spokeAA*7.),crownChange);
    float ghost=portalFill(rib,width*3.5,pixel)*uGlow*.28;
    float light=(portalFill(rib,width,pixel)+spokes*portalFill(rib,width*2.85,pixel)*(.30+.54*uDetail)+ghost)*envelope;
    light*=i==0?1.:uAfterglow*(.68+.32*uReveal);
    vec3 ink=pigment(uOffset+order*.143+.12*opening+.035*flutes,.003);
    color+=mix(ink,vec3(1.),.06+.20*uRelief)*light;
    alpha=max(alpha,light);
    float lowerRim=abs(lowerShape-(.035+.26*age));
    float lowerRing=(portalFill(lowerRim,width*.78,pixel)+.24*uGlow*portalFill(lowerRim,width*3.1,pixel))
      *envelope*opening;
    color+=pigment(uOffset+order*.129,.002)*lowerRing*.82;
    alpha=max(alpha,lowerRing);
  }
  float core=portalFill(length(crown),width*1.5,pixel)*(.46+.54*opening);
  float footing=length(vec2(p.x,(p.y+.57)*3.4));
  float foot=portalFill(abs(footing-(.071+.06*opening)),width,pixel);
  foot+=.49*portalFill(abs(footing-(.108+.076*opening)),width*.63,pixel);
  float wheel=portalFill(abs(length(crown)-.27),width*.56,pixel)*crownChange;
  float sparks=portalFill(portalDistance(angle*points/TAU),.07,pixel*points/(TAU*max(length(crown),.04)));
  sparks*=portalFill(abs(length(crown)-.27),width*2.7,pixel)*crownChange;
  color+=pigment(uOffset-.025,.002)*(core+foot*.40)+pigment(uOffset+.48,.001)*wheel*.65+vec3(1.,.79,.49)*sparks;
  return portalOutput(color,max(alpha,max(core,max(foot*.45,wheel*.65+sparks))));
}

vec4 lightHalo(vec2 p,float phase) {
  if(uEvolution>=.72)return stackedHalo(p,phase);
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
  vec4 halo=portalOutput(color/(1.+max(0.,energy-1.)*.45),max(coverage,rays+core+heart+beamLight));
  return uEvolution<=0.?halo:mix(halo,stackedHalo(p,phase),smoothstep(0.,.72,uEvolution));
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
