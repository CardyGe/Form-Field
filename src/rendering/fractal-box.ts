// Original Mandelbox renderer. Axis-aligned negative-scale folds have a finite
// enclosure; the enclosing sphere limits traversal and never adds cut surfaces.
export const boxFunctions = /* glsl */`
vec3 boxLimits() {
  float limit=.72+.38*uFold;
  vec3 proportions=vec3(1.);
  if(uVariant>.5&&uVariant<1.5)proportions=vec3(.82);
  if(uVariant>1.5)proportions=vec3(1.18,.72,.94);
  if(uEvolution>0.){
    // The chamber and its silhouette change proportions with the fold.
    // The same animated limits are used by the camera's enclosure.
    float phase=uPhase+uVariant*.8;
    proportions*=1.+uEvolution*vec3(.13*sin(phase),.15*cos(phase-.95),.12*sin(2.*phase+.55));
  }
  return limit*proportions;
}
vec3 boxDomain(vec3 position) {
  vec3 p=position*(uScale/1.7);
  float seed=mod(uSeed,997.)*.0137;
  float sway=uMorph*legacyCameraMotion();
  float angle=uTwist*.9+.035*sin(seed)+sway*.12*sin(uPhase);
  p.xy=turn(angle)*p.xy;
  p.yz=turn(uTwist*.38+sway*.045*cos(uPhase))*p.yz;
  // A full radial reflection preserves radius and is an isometry in each
  // sector. Blending folded and original coordinates could collapse opposite
  // rays, so radial folding is deliberately a discrete option.
  if(uRadial>.5)p.xy=wedge(p.xy);
  return p;
}
vec2 boxField(vec3 position) {
  float size=uScale/1.7;
  vec3 p=boxDomain(position),z=p,limits=boxLimits();
  float derivative=1.,orbit=0.,weight=1.,totalWeight=0.;
  float change=uEvolution*(.72+.28*uMorph);
  float scale=-(uBoxScale+uMorph*.12*sin(uPhase)+change*.24*cos(uPhase+uVariant*.8));
  float outer=uVariant>.5&&uVariant<1.5?1.25:1.;
  float inner=clamp(uBoxRadius+change*.115*sin(uPhase*2.-.8+uVariant),.16,.90);
  float minimum2=inner*inner,outer2=outer*outer;
  // Detail changes the geometric recursion, never the render resolution.
  // Keep the estimator converged even when artistic Detail is low. Fewer
  // than twelve passes can turn smooth surfaces into hit/normal stippling at 4K.
  float iterations=12.+uDetail*2.;
  float distance=length(z);
  for(int i=0;i<14;i++) {
    if(float(i)>=ceil(iterations))break;
    z=2.*clamp(z,-limits,limits)-z;
    float r2=dot(z,z);
    float factor=r2<minimum2?outer2/minimum2:(r2<outer2?outer2/max(r2,.0000001):1.);
    z*=factor;derivative*=factor;
    z=z*scale+p;derivative=derivative*abs(scale)+1.;
    // Early orbit averages give broad material variation without noisy colour
    // discontinuities from the final, exponentially sensitive iterations.
    // Smooth the final recursion level so animated Detail never switches an
    // entire geometric iteration on in one frame.
    float level=smoothstep(0.,1.,iterations-float(i));
    distance=mix(distance,length(z)/max(derivative,.000001),level);
    orbit+=weight*level*log(1.+length(z));totalWeight+=weight*level;weight*=.28;
    if(dot(z,z)>1.e12)break;
  }
  return vec2(distance/size,orbit/max(totalWeight,.000001));
}
vec3 boxNormal(vec3 p,float epsilon) {
  vec2 e=vec2(1.,-1.)*.57735027;
  vec3 n=e.xyy*boxField(p+e.xyy*epsilon).x+e.yyx*boxField(p+e.yyx*epsilon).x
    +e.yxy*boxField(p+e.yxy*epsilon).x+e.xxx*boxField(p+e.xxx*epsilon).x;
  float magnitude=length(n);
  return magnitude>.00000001?n/magnitude:vec3(0.,1.,0.);
}
float boxShadow(vec3 p,vec3 light,float epsilon) {
  float t=epsilon*4.,shade=1.;
  float size=uScale/1.7;
  for(int i=0;i<24;i++) {
    float d=boxField(p+light*t).x;
    if(!(d>=0.))return 1.;
    shade=min(shade,10.*d/t);
    if(d<epsilon*.3||t>2.8/size)break;
    t+=clamp(d*.6,epsilon*.5,.22/size);
  }
  return clamp(shade,.035,1.);
}
vec4 traceBox(vec2 offset) {
  float size=uScale/1.7;
  float oldMotion=legacyCameraMotion();
  float yaw=uCameraYaw+oldMotion*(uTravel*.25*sin(uPhase)+(uApproach>0.?uPhase:0.));
  float pitch=uCameraPitch+oldMotion*uTravel*.12*cos(uPhase);
  float radius=2.*length(boxLimits())/size+.01/size;
  float framing=radius+3.6/max(uZoom,.5)-oldMotion*uTravel*.35*cos(uPhase);
  // Fly in: the camera moves inside the bounding sphere toward the folded core.
  if(uApproach>0.)framing=mix(framing,radius*(.62-.12*uApproach)-uTravel*.35*radius*.3*cos(uPhase),uApproach*oldMotion);
  float phase=fract(uPhase/TAU);
  float route=smoothstep(.13,.49,phase)*(1.-smoothstep(.62,.95,phase));
  float oldBank=.39*uBank*sin(uPhase)*(.32+.68*route);
  if(oldMotion>0.&&(uPassage>0.||uBank!=0.)){
    framing=mix(framing,radius+mix(3.7/max(uZoom,.5),.18/max(uZoom,.5),route),uPassage*oldMotion);
    yaw+=oldMotion*uPassage*(.25+.22*uBank)*sin(uPhase-.32)*(.3+.7*route);
    pitch+=oldMotion*uPassage*.15*sin(uPhase+.5);
  }
  if(uEvolution>0.){
    // Establish the full object and travel toward the same point on its
    // surface. No phase-driven pan, yaw, pitch, or roll on the new path.
    float journey=smoothstep(.08,.64-.23*uTravel,phase)*(1.-smoothstep(.73,1.,phase));
    float strength=max(uPassage,uApproach*.79)*(1.-oldMotion);
    framing=mix(framing,radius+mix(4.6,.09,pow(journey,1.17))/max(uZoom,.5),strength);
  }
  float bank=mix(uBank*.42,oldBank,oldMotion);
  vec3 origin=framing*vec3(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch));
  vec3 forward=normalize(-origin),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward);
  vec2 uv=fractalView(vUv+offset/uResolution);
  if(bank!=0.)uv=turn(bank)*uv;
  vec3 ray=normalize(forward*1.65+right*uv.x+up*uv.y);
  // A negative-scale Mandelbox lies within [-2L,2L] on each fold axis.
  // Global rotations and the optional radial reflection preserve this radius.
  float b=dot(origin,ray),disc=b*b-dot(origin,origin)+radius*radius;
  if(disc<0.)return vec4(0.);
  float t=max(0.,-b-sqrt(disc)),end=-b+sqrt(disc);
  float epsilon=.0001,hit=0.;vec2 field=vec2(0.);
  float steps=uQuality<.5?100.:(uQuality<1.5?144.:192.);
  for(int i=0;i<192;i++) {
    if(float(i)>=steps)break;
    field=boxField(origin+ray*t);
    epsilon=max(.000025/size,t*uViewScale/(1.65*uResolution.y)*mix(.9,.45,uQuality*.5));
    if(!(field.x>=0.)||field.x>1.e6)break;
    if(field.x<epsilon) {hit=1.;break;}
    t+=field.x*.6;
    if(t>end)break;
  }
  if(hit<.5)return vec4(0.);
  vec3 p=origin+ray*t,n=boxNormal(p,max(epsilon*mix(3.,1.5,uDetail),.000045/size));
  vec3 light=normalize(vec3(sin(uLightAngle)*1.1,.95,cos(uLightAngle)*1.1));
  float shadow=boxShadow(p+n*epsilon*4.,light,epsilon);
  float diffuse=max(dot(n,light),0.);
  float ao=1.;
  for(int i=1;i<=4;i++) {
    float reach=(.025+float(i*i)*.018)/size;
    ao-=max(reach-boxField(p+n*reach).x,0.)/reach*.18;
  }
  ao=clamp(ao,.12,1.);
  vec3 domain=boxDomain(p);
  float coordinate=uOffset+uDensity*(field.y*.11+domain.y*.045+length(domain)*.055);
  coordinate+=uMorph*.025*sin(uPhase);
  vec3 base=pigment(coordinate,.002);
  float ambient=(.055+.075*max(n.y,0.))*ao;
  float lighting=ambient+diffuse*shadow*1.12*sqrt(ao);
  // Ease rapidly into shaped light; moderate Relief should still reveal
  // cavities rather than introducing a large, unshadowed albedo floor.
  float materialWeight=1.-pow(1.-uRelief,2.);
  vec3 color=base*mix(.78,lighting,materialWeight);
  vec3 halfVector=light-ray;
  float exponent=mix(120.,8.,uRoughness*uRoughness);
  float shine=pow(max(dot(n,halfVector/max(length(halfVector),.000001)),0.),exponent);
  float facing=max(dot(n,-ray),0.),rim=pow(1.-facing,3.);
  float fresnel=.06+.55*pow(1.-facing,5.);
  color+=mix(base,vec3(1.),.72)*shine*shadow*materialWeight*mix(.8,.16,uRoughness)*(1.+fresnel);
  vec3 rimLight=normalize(vec3(.8,.3,-.7));
  color+=pigment(coordinate+.18,.002)*max(dot(n,rimLight),0.)*ao*materialWeight*.15;
  color+=pigment(coordinate+.2,.002)*rim*uGlow*.32;
  if(uDepth>0.){
    float separation=exp(-max(0.,t-framing+radius*.56)*.86*size);
    float stripe=length(domain.xy)*7.+domain.z*.62+field.y*1.6;
    float line=abs(fract(stripe+.5)-.5);
    float aa=clamp(epsilon*size*12.,.006,.42);
    float band=(1.-smoothstep(.09-aa,.09+aa,line))*(1.-smoothstep(.16,.42,aa));
    vec3 edge=pigment(coordinate+.27+.10*separation,aa*.13);
    vec3 fillDirection=normalize(vec3(-.8,.28,.52));
    float fill=pow(max(0.,dot(n,fillDirection)),1.6)*(.33+.67*sqrt(ao));
    color=color*mix(1.,.48+.52*separation,uDepth*.82)
      +edge*band*uDepth*(.14+.28*separation)*(.48+.52*sqrt(ao))
      +uPalette[0]*fill*uDepth*.33;
  }
  if(uEvolution>0.){
    // Successive crests follow the material's surface, including its folds.
    // Pulse spacing is band-limited at grazing angles and in the distance.
    float surface=length(domain.xy)*2.95+domain.z*.74+field.y*1.2;
    float wavelength=surface*2.6-uPhase/TAU*2.;
    float aa=clamp(epsilon*size*14.,.016,.34);
    float groove=abs(fract(wavelength+.5)-.5);
    float crest=(1.-smoothstep(.056-aa,.056+aa,groove))*(1.-smoothstep(.14,.34,aa));
    float xray=.5+.5*cos(surface*2.1-uPhase+3.1*domain.y);
    vec3 signal=pigment(coordinate+surface*.12-uPhase/TAU,aa*.16);
    color+=signal*crest*uEvolution*(.26+.51*xray)*(.36+.64*sqrt(ao));
  }
  return vec4(color,1.);
}
vec4 mandelbox() {
  if(uQuality<.5)return traceBox(vec2(0.));
  if(uQuality<1.5)return (traceBox(vec2(-.25,-.25))+traceBox(vec2(.25,.25)))*.5;
  vec4 color=traceBox(vec2(-.25,-.25))+traceBox(vec2(.25,-.25));
  color+=traceBox(vec2(-.25,.25))+traceBox(vec2(.25,.25));
  return color*.25;
}
`;
