import { sourceViewGLSL } from './source-view';
import { projectionOpticsGLSL } from './projection-optics';
import { INSTRUMENT_PARAMETERS, type InstrumentKind } from '../core/instruments';
import { surfaceFieldGLSL } from './surface-fields';
import { timingGLSL } from '../core/timing';

const common=/* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform vec3 uPalette[6];
uniform float uAspect,uPhase,uSeed;
uniform vec2 uResolution;
uniform sampler2D uPatternTexture;
uniform float uSurfaceEmission;
${projectionOpticsGLSL}
${surfaceFieldGLSL}
const float PI=3.14159265359,TAU=6.28318530718;
mat2 spin(float a){return mat2(cos(a),sin(a),-sin(a),cos(a));}
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031+uSeed*.000017);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 hash22(vec2 p){return vec2(hash21(p),hash21(p+71.3));}
float smoothNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);}
vec3 colour(float t){float q=fract(t)*5.;int i=int(floor(q));return mix(uPalette[i],uPalette[min(i+1,4)],smoothstep(0.,1.,fract(q)));}
vec2 orbit(){
 vec2 original=vec2(sin(uPhase),cos(uPhase));
 if(uOrganic==0.)return original*uMotion;
 vec2 layered=vec2(.62*sin(uPhase+.4)+.23*sin(2.*uPhase-1.2)+.15*sin(3.*uPhase),.6*cos(uPhase-.7)+.28*cos(2.*uPhase+.8)+.12*sin(3.*uPhase+.2));
 return mix(original,layered,uOrganic)*uMotion;
}
vec2 domain(){
 vec2 p=spin(uRotation)*((sourceUV(vUv)-.5)*vec2(uAspect,1.))*uScale;
 p.x/=uStretch;
 if(uTwist!=0.)p=spin(uTwist*length(p)*.5)*p;
 if(uWarp>0.){vec2 q=p*uWarpScale+orbit()*.3;
  // Curl of an analytic stream function: coherent deformation, no simulation state.
  vec2 curl=vec2(cos(q.y)*sin(q.x),-cos(q.x)*sin(q.y));
  p+=uWarp*curl*.7/uWarpScale;
 }
 if(uOrganic>0.){
  vec2 d=vec2(cos(uFlowDirection),sin(uFlowDirection)),crossD=vec2(-d.y,d.x);
  float travel=dot(p,d)*uEddyScale-uPhase;
  p+=crossD*sin(travel+.3*sin(dot(p,crossD)*.8+uPhase*2.))*uOrganic*uMotion*(.12+uTravel*.36);
  p+=d*sin(dot(p,crossD)*uEddyScale*.7-uPhase*2.+.7)*uOrganic*uMotion*.16;
 }return p;
}
vec3 fieldNormal(vec2 p,float h){
  vec2 a=dFdx(p),b=dFdy(p);float det=a.x*b.y-a.y*b.x;
  if(abs(det)<1e-12)return vec3(0,0,1);
  vec2 g=vec2(dFdx(h)*b.y-dFdy(h)*a.y,dFdy(h)*a.x-dFdx(h)*b.x)/det;
  g=clamp(g,vec2(-8.),vec2(8.));return normalize(vec3(-g,1.));
}
vec3 coat(vec3 base,vec3 n,float angle,float rough,float metal){
  vec3 l=normalize(vec3(cos(angle)*.65,sin(angle)*.65,uLightHeight));
  vec3 halfL=normalize(l+vec3(0,0,1));
  float diffuse=uFillLight+(1.-uFillLight)*max(dot(n,l),0.);
  float variance=0.;
  if(uAnisotropy>0.||uClearcoat>0.){vec3 dx=dFdx(n),dy=dFdy(n);variance=min(.25,max(dot(dx,dx),dot(dy,dy))*.5);}
  float filteredRough=sqrt(min(1.,rough*rough+variance));
  if(variance==0.)filteredRough=rough;
  float shine=pow(max(dot(n,halfL),0.),mix(96.,7.,filteredRough));
  if(uAnisotropy>0.)shine=mix(shine,optAnisotropic(n,l,filteredRough,uSheenAngle),uAnisotropy);
  float rim=pow(1.-max(n.z,0.),3.);
  vec3 environment=mix(uPalette[2],uPalette[4],smoothstep(-.3,.8,n.y));
  vec3 result=base*diffuse*(1.-metal*.25)+environment*(shine*.9+rim*.2)*metal+vec3(shine)*mix(.14,.6,metal);
  if(uClearcoat>0.){
   float f=.04+.96*pow(1.-n.z,5.);
   float coat=pow(max(dot(n,halfL),0.),max(6.,48./(1.+variance*96.)));
   result=result*(1.-uClearcoat*f*.3)+vec3(coat*.35+f*.08)*uClearcoat;
  }return result;
}
void outputField(vec3 pigment,float coverage){
  float c=clamp(coverage,0.,1.);float a=c+(1.-c)*uBackgroundOpacity;
  vec3 rgb=max(pigment,vec3(0.))*c+uPalette[5]*(1.-c)*uBackgroundOpacity;
  float surface=uSurfaceEmission>.5?1.:surfaceCoverage(sourceUV(vUv));gl_FragColor=vec4(a>0.?rgb*surface:vec3(0.),a*surface);
}
// F1, distance to a connected Voronoi border, stable cell identity.
vec4 sites(vec2 p,float jitter){
 vec2 b=floor(p),f=fract(p);float first=10.,second=10.,id=0.;vec2 nearest=vec2(0.);
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 g=vec2(float(x),float(y)),j=hash22(b+g);vec2 r=g+.2+.6*j-f;if(jitter!=.6)r=g+.5+jitter*(j-.5)-f;float d=dot(r,r);
  if(d<first){second=first;first=d;id=hash21(b+g);nearest=r;}else second=min(second,d);
 }return vec4(nearest,sqrt(second)-sqrt(first),id);
}
vec3 cells(vec2 p){vec4 s=sites(p,.6);return vec3(length(s.xy),s.z,s.w);}
`;
const bodies:Record<InstrumentKind,string>={
livingink:/* glsl */`
${timingGLSL}
void main(){
 vec2 p=domain(),q=p+uFlow*.28*vec2(sin(p.y*1.4+orbit().x),cos(p.x*1.1+orbit().y));
 q+=orbit()*.13;vec2 uv=q*.36+.5;
 if(uInkMode>.5&&uInkMode<1.5){vec2 aligned=spin(uFlowDirection)*q;
  // Travel advances one whole pattern period per loop. With timing on, each
  // region of the frame runs its own clock, so pulses of flow cross the field.
  float clock=uDelaySpread>0.||uPause>0.?stagedTime(uPhase,delayOrder((sourceUV(vUv)-.5)*vec2(uAspect,1.),uAspect)):uPhase;
  uv=aligned*.36+.5+vec2(clock/TAU,0.);}
 if(uInkMode>1.5)uv=(sourceUV(vUv)-.5)*vec2(uAspect,1.)*uScale/4.8+.5;
 vec4 f=textureGrad(uPatternTexture,uv,dFdx(uv),dFdy(uv));
 if(uInkMode>1.5)f.g=mix(f.g,f.b,uPigmentCarry);
 if(uInkMode>.5&&uInkMode<1.5&&uMotion<1.){vec2 base=q*.36+.5;f=mix(textureGrad(uPatternTexture,base,dFdx(base),dFdy(base)),f,uMotion);}
 float h=f.g;float aa=max(fwidth(h),.005)+uEdgeSoftness*.08;float edge=mix(.32,.08,(uPigment-.15)/.7);
 float cover=smoothstep(edge-aa,edge+aa,h);
 if(uInkMode>1.5){cover=mix(cover,1.-exp(-f.b*(1.+uPigment*5.)),uPigmentCarry);float border=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));cover*=smoothstep(0.,.08,border);}
 float ridge=exp(-pow((h-edge)/.09,2.));
 vec3 n=fieldNormal(p,h*uRelief*.23);
 vec3 base=mix(uPalette[0],uPalette[1],h*.6);
 if(uInkMode>1.5&&uAgeColour>0.){float age=smoothstep(.05,.85,f.b);base=mix(base,age<.5?mix(uPalette[2],uPalette[0],age*2.):mix(uPalette[0],uPalette[4],age*2.-1.),uAgeColour);}
 vec3 color=coat(base,n,uLightAngle,uRoughness,.12);
 color=mix(color,uPalette[3],ridge*uEdgeInk);outputField(color,cover);
}`,
currents:/* glsl */`
void main(){
 if(uFlowMode>.5){outputField(vec3(0.),0.);return;}
 vec2 p=domain();float weave=0.,height=0.,tone=0.;
 for(int i=0;i<3;i++){
  float k=float(i),weight=i==0?1.:(1.-uCoherence)*.6;
  vec2 q=spin(k*.48*(1.-uCoherence)+uVortex*exp(-dot(p,p)*.15)*3.)*p;
  q+=uCurl*.45*vec2(sin(q.y*1.3+orbit().y+k),sin(q.x*1.1+orbit().x));
  float flow=q.y+uCurl*(sin(q.x*1.1+orbit().x+k)*.48+sin(q.x*2.1-orbit().y+k)*.13);
  flow+=uBraid*.12*sin(q.x*3.+orbit().y+k*2.1);
  if(uFlowDetail>0.)flow+=uFlowDetail*.05*sin(q.x*5.7+orbit().x)*sin(q.y*3.1-orbit().y);
  float t=flow*uFibres;
  float fibres=optStripe(t,(.12+uWidth*.55)*(1.-uTaper*.8*(.5+.5*sin(q.x*1.5+orbit().x+k))));
  float drift=q.x*.22+sin(uPhase)*uMotion*.25+hash21(vec2(floor(t),k));
  float tail=mix(1.,.24+.76*pow(.5+.5*cos(drift*TAU),2.),1.-uTrailLength);
  float strand=fibres*tail*weight;
  weave+=strand;height+=strand*.012*uDepth;tone+=strand*(.15+.13*k+.08*sin(q.x+orbit().x));
 }
 float coverage=clamp(weave,0.,1.);vec3 n=fieldNormal(p,height);
 vec3 base=colour(tone/max(weave,.001)+.08*sin(p.y*.3));
 vec3 color=coat(base,n,uLightAngle,uRoughness,.35)*1.65;
 outputField(color,coverage);
}`,
relief:/* glsl */`
${timingGLSL}
void main(){
 if(uReliefMode>.5){outputField(vec3(0.),0.);return;}
 vec2 p=domain(),q=p*uColumns;
 q.x+=mod(floor(q.y),2.)*uStagger*.5;vec2 id=floor(q),f=fract(q)-.5;
 float angle=uAxis<.5?0.:uAxis<1.5?PI*.5:PI*.25;
 vec2 local=spin(angle)*f;
 float clock=uPhase;
 if(uDelaySpread>0.||uPause>0.){vec2 cell=(id+.5)/uColumns;cell.x*=uStretch;vec2 frame=spin(-uRotation)*cell/uScale;clock=stagedTime(uPhase,delayOrder(frame,uAspect));}
 float wave=.5+.5*sin(dot(id,vec2(.23,.17))*uWaveCount+clock+uPhaseSpread*hash21(id)*TAU)*uMotion;
 float opening=uOpening*(.2+.8*wave);float hinge=opening*1.15;
 float projected=max(.2,cos(hinge));
 vec2 plate=vec2((local.x-uHingeBias*.18)/projected+uHingeBias*.18,local.y);
 float box=max(abs(plate.x),abs(plate.y));
 if(uRoundness>0.){float radius=uRoundness*.2;vec2 corner=max(abs(plate)-(.5-uGap*.5-radius),0.);box=length(corner)+min(max(abs(plate.x),abs(plate.y))-(.5-uGap*.5-radius),0.)+(.5-uGap*.5-radius);}float aa=max(fwidth(box),.001);
 float cover=1.-smoothstep(.5-uGap*.5-aa,.5-uGap*.5+aa,box);
 float rim=1.-smoothstep(.5-uGap*.5-uBevel,.5-uGap*.5,box);
 float h=(plate.x+.5)*sin(hinge)*uDepth*.1+rim*uDepth*.018;
 vec3 n=fieldNormal(p,h);vec3 base=mix(uPalette[0],uPalette[2],.18+.34*smoothNoise(id*.2+uSeed*.01));
 vec3 color=coat(base,n,uLightAngle,uRoughness,.2);
 color*=1.-uShadow*(1.-rim)*.4;
 outputField(color,cover);
}`,
resonance:/* glsl */`
float chladni(vec2 q,float modeA,float modeB0,float blend){
 float x=q.x*PI,y=q.y*PI;
 float modeB=modeB0+(abs(modeA-modeB0)<.5?1.:0.);
 float a=cos(modeA*x)*cos(modeB*y)-cos(modeB*x)*cos(modeA*y);
 float other=modeB+1.;if(abs(other-modeA)<.5)other+=1.;
 float b=sin(modeA*x)*sin(other*y)-sin(other*x)*sin(modeA*y);
 float field=mix(a,b,blend);
 if(uRadialMix>0.){float angle=atan(q.y,q.x+1e-10),radius=length(q);float radial=cos(modeA*angle)*sin(modeB*radius*PI);field=mix(field,radial,uRadialMix);}
 if(uHarmonic>0.)field+=uHarmonic*.35*sin((modeA+modeB)*x*.5)*sin((modeB+2.)*y);
 return field;
}
void main(){
 vec2 p=domain(),q=p*.75+orbit()*.035;
 float blend=clamp(uModalBlend+sin(uPhase)*uMotion*.2,0.,1.);
 float field;
 if(uSequence>.5&&uMotion>0.){
  // Mode score: the plate holds one figure, then the sand snaps into the next
  // mode, and so on, returning to the first figure as the loop closes.
  float n=uSequence+1.,f=fract(uPhase/TAU)*n,k=floor(f);
  float snap=smoothstep(1.-.45*uSnap,1.,fract(f));
  float kNext=mod(k+1.,n);
  field=mix(chladni(q,uModeA+k,uModeB+k,uModalBlend),chladni(q,uModeA+kNext,uModeB+kNext,uModalBlend),snap);
 } else field=chladni(q,uModeA,uModeB,blend);
 float aa=max(fwidth(field),.0005)+uNodalSoftness*.12;
 float cover=1.-smoothstep(uBandWidth-aa,uBandWidth+aa,abs(field));
 vec2 grainUV=q*uGrainSize;float grain=hash21(floor(grainUV));
 float grainFilter=smoothstep(.35,1.5,max(length(dFdx(grainUV)),length(dFdy(grainUV))));
 float grainValue=mix(.55+grain*.45,.775,grainFilter);
 vec3 n=fieldNormal(p,field*uRelief*.018);
 vec3 color=coat(colour(.08+.22*abs(field)),n,uLightAngle,uRoughness,.15);
 color*=mix(1.,grainValue,uGrains);
 if(uFill>0.){
  // Flat fills: the plate between nodal lines takes two palette colours by the
  // sign of the vibration, and the sand lines are drawn over it in a third.
  float side=smoothstep(-aa,aa,field);
  vec3 plate=mix(uPalette[1],uPalette[3],side);
  color=mix(plate,color,cover);cover=mix(cover,1.,uFill*uBackgroundOpacity);
 }
 outputField(color,cover);
}`,
};
export function instrumentFragment(kind:InstrumentKind):string{
 const uniforms=INSTRUMENT_PARAMETERS[kind].filter(d=>!['saturation','hue','exposure','cycles'].includes(d.key)).map(d=>`uniform float u${d.key[0].toUpperCase()+d.key.slice(1)};`).join('\n');
 return common.replace('const float PI=',uniforms+'\nconst float PI=')+bodies[kind];
}
