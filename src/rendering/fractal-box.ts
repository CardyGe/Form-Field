// Original Mandelbox renderer. Axis-aligned negative-scale folds have a finite
// enclosure; the enclosing sphere limits traversal and never adds cut surfaces.
export const boxFunctions = /* glsl */`
vec3 boxLimits() {
  float limit=.72+.38*uFold;
  if(uVariant>.5&&uVariant<1.5)return vec3(limit*.82);
  if(uVariant>1.5)return limit*vec3(1.18,.72,.94);
  return vec3(limit);
}
vec3 boxDomain(vec3 position) {
  vec3 p=position*(uScale/1.7);
  float seed=mod(uSeed,997.)*.0137;
  float angle=uTwist*.9+.035*sin(seed)+uMorph*.12*sin(uPhase);
  p.xy=turn(angle)*p.xy;
  p.yz=turn(uTwist*.38+uMorph*.045*cos(uPhase))*p.yz;
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
  float scale=-(uBoxScale+uMorph*.12*sin(uPhase));
  float outer=uVariant>.5&&uVariant<1.5?1.25:1.;
  float minimum2=uBoxRadius*uBoxRadius,outer2=outer*outer;
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
  // Inside the box the camera also turns once per loop, so the space keeps changing.
  float yaw=uCameraYaw+uTravel*.25*sin(uPhase)+(uApproach>0.?uPhase:0.);
  float pitch=uCameraPitch+uTravel*.12*cos(uPhase);
  float radius=2.*length(boxLimits())/size+.01/size;
  float framing=radius+3.6/max(uZoom,.5)-uTravel*.35*cos(uPhase);
  // Fly in: the camera moves inside the bounding sphere toward the folded core.
  if(uApproach>0.)framing=mix(framing,radius*(.62-.12*uApproach)-uTravel*.35*radius*.3*cos(uPhase),uApproach);
  vec3 origin=framing*vec3(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch));
  vec3 forward=normalize(-origin),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward);
  vec2 uv=(sourceUV(vUv+offset/uResolution)-.5)*vec2(uAspect,1.);
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
