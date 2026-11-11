import { sourceViewGLSL } from './source-view';
import { projectionOpticsGLSL } from './projection-optics';
import { INSTRUMENT_PARAMETERS, type InstrumentKind } from '../core/instruments';
import { surfaceFieldGLSL } from './surface-fields';

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
caustic:/* glsl */`
void main(){
 vec2 p=domain(),q=p+orbit()*.3;vec3 curvature=vec3(0.);
 for(int i=0;i<8;i++){
  if(float(i)>=uWaves)break;float k=float(i)+1.;float angle=mix(k*2.39996,k*.18,uWaveBias)+uSeed*.01;
  vec2 axis=vec2(cos(angle),sin(angle));float frequency=1.6+k*.43;
  float wave=dot(q,axis)*frequency+sin(uPhase+k)*uMotion*.7;
  wave+=uWaveSkew*.4*sin(wave*2.+k);
  float amplitude=(.12+.3*uDepth)/sqrt(uWaves);
  float crest=cos(wave);
  if(uOrganic>0.)crest=mix(crest,cos(wave-uPhase*(1.+mod(k,3.))),uOrganic*uMotion);
  curvature-=crest*frequency*frequency*amplitude*vec3(axis.x*axis.x,axis.y*axis.y,axis.x*axis.y);
 }
 float strength=.65+uFocus*1.15;vec3 light=vec3(0.);float coverage=0.;
 for(int channel=0;channel<3;channel++){
  float dispersion=1.+(float(channel)-1.)*uDispersion*.065;
  vec3 h=curvature*strength*dispersion*uRefraction;
  float det=(1.+h.x)*(1.+h.y)-h.z*h.z;
  float width=uWidth*2.4,aa=max(fwidth(det),.004);
  float ridge=1.-smoothstep(width-aa,width+aa,abs(det));
  float halo=exp(-abs(det)*2.5)*uHalo;
  light[channel]=ridge+halo;coverage=max(coverage,ridge+halo);
 }
 vec3 tint=mix(uPalette[0],uPalette[1],.5+.5*sin(p.x*.3+p.y*.4));
 vec3 pigment=light*tint*1.6+uPalette[4]*pow(max(light.r,max(light.g,light.b)),3.)*.25;
 outputField(pigment/max(coverage,.025),coverage);
}`,
livingink:/* glsl */`
void main(){
 vec2 p=domain(),q=p+uFlow*.28*vec2(sin(p.y*1.4+orbit().x),cos(p.x*1.1+orbit().y));
 q+=orbit()*.13;vec2 uv=q*.36+.5;
 if(uInkMode>.5&&uInkMode<1.5){vec2 aligned=spin(uFlowDirection)*q;uv=aligned*.36+.5+vec2(uPhase/TAU,0.);}
 if(uInkMode>1.5)uv=(sourceUV(vUv)-.5)*vec2(uAspect,1.)*uScale/4.8+.5;
 vec4 f=textureGrad(uPatternTexture,uv,dFdx(uv),dFdy(uv));
 if(uInkMode>1.5)f.g=mix(f.g,f.b,uPigmentCarry);
 if(uInkMode>.5&&uInkMode<1.5&&uMotion<1.){vec2 base=q*.36+.5;f=mix(textureGrad(uPatternTexture,base,dFdx(base),dFdy(base)),f,uMotion);}
 float h=f.g;float aa=max(fwidth(h),.005)+uEdgeSoftness*.08;float edge=mix(.32,.08,(uPigment-.15)/.7);
 float cover=smoothstep(edge-aa,edge+aa,h);
 if(uInkMode>1.5){cover=mix(cover,1.-exp(-f.b*(1.+uPigment*5.)),uPigmentCarry);float border=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));cover*=smoothstep(0.,.08,border);}
 float ridge=exp(-pow((h-edge)/.09,2.));
 vec3 n=fieldNormal(p,h*uRelief*.23);
 vec3 color=coat(mix(uPalette[0],uPalette[1],h*.6),n,uLightAngle,uRoughness,.12);
 color=mix(color,uPalette[3],ridge*uEdgeInk);outputField(color,cover);
}`,
magnetic:/* glsl */`
void main(){
 vec2 p=domain(),magnet=orbit()*1.2;
 vec2 displacement=p-magnet;
 vec2 q=(p+displacement*exp(-dot(displacement,displacement)*.5/(uAttractorRadius*uAttractorRadius))*uPull*.6)*uPeaks+orbit()*.3;
 q+=.24*vec2(sin(q.y*.8+uSeed),sin(q.x*.7+uSeed*.3));
 vec3 cell=cells(q);float radius=cell.x;
 float field=exp(-radius*radius*(5.+uSharpness*7.));
 if(uRidgeBlend>0.)field=mix(field,exp(-cell.y*cell.y*(18.+uSharpness*30.)),uRidgeBlend);
 float pull=exp(-dot(p-magnet,p-magnet)*.65/(uAttractorRadius*uAttractorRadius));
 float h=field*(.05+.24*uPull)+pull*uPull*.25;
 vec3 n=fieldNormal(p,h*uPeakHeight);vec3 base=colour(field*.23+pull*.22);
 vec3 color=coat(base,n,uLightAngle,uRoughness,uMetallic);
 color=mix(color,color*optFilm(n.z,1.3+pull),uIridescence*.75);
 float aa=max(fwidth(field),.001);outputField(color,mix(smoothstep(.008-aa,.05+aa,field+pull*.02),1.,uValleyFill));
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
void main(){
 if(uReliefMode>.5){outputField(vec3(0.),0.);return;}
 vec2 p=domain(),q=p*uColumns;
 q.x+=mod(floor(q.y),2.)*uStagger*.5;vec2 id=floor(q),f=fract(q)-.5;
 float angle=uAxis<.5?0.:uAxis<1.5?PI*.5:PI*.25;
 vec2 local=spin(angle)*f;
 float wave=.5+.5*sin(dot(id,vec2(.23,.17))*uWaveCount+uPhase+uPhaseSpread*hash21(id)*TAU)*uMotion;
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
loom:/* glsl */`
void main(){
 vec2 p=domain(),q=p;
 float fold=sin(p.x*uFolds*.8+orbit().x)*(.12+.22*(1.-uTension));
 if(uOrganic>0.)fold=mix(fold,sin(p.x*uFolds*.8-uPhase)*(.12+.22*(1.-uTension)),uOrganic*uMotion);
 fold+=sin(p.y*1.1+orbit().y)*.13*(1.-uTension);
 fold*=uFoldDepth;q+=vec2(fold*.3,fold);
 float a=q.x*uWeave,b=(spin(uCrossingAngle)*q).x*uWeave;
 float interference=.5+.5*optCos((a-b)*TAU);
 float warp=optStripe(a,uThreadWidth),weft=optStripe(q.y*uWeave*uWeftRatio,uThreadWidth);
 float yarn=warp+weft-warp*weft;
 float overUnder=optCos((a+q.y*uWeave*uWeftRatio)*PI);
 float h=fold*.8+(warp-weft)*.0003;
 vec3 n=fieldNormal(p,h);vec3 base=mix(uPalette[0],uPalette[2],interference*.5);
 vec3 color=coat(base,n,uLightAngle,uRoughness,.12);
 vec3 film=optFilm(n.z,1.2+interference*.65)*1.65;
 color=mix(color,color*mix(vec3(dot(film,vec3(.2126,.7152,.0722))),film,.32),uFoil);
 if(uCrossweave>0.)color*=1.+overUnder*uCrossweave*.22;
 float cover=clamp(.28+yarn*.72,0.,1.);outputField(color,cover);
}`,
reef:/* glsl */`
void main(){
 vec2 p=domain(),q=p*uDensity;vec4 site=sites(q,uCellIrregularity);vec3 cell=vec3(length(site.xy),site.z,site.w);
 float aa=max(fwidth(cell.y),.001);
 float vein=1.-smoothstep(uBranchWidth-aa,uBranchWidth+aa,cell.y);
 float phase=sin(uPhase+cell.z*TAU)*uMotion;
 float growth=mix(1.,smoothstep(-.65,.45,phase+(1.-uMotion)),uGrowth);
 if(uOrganic>0.){float front=.5+.5*sin(uPhase-dot(p,vec2(cos(uFlowDirection),sin(uFlowDirection)))*1.5+cell.z*.6);growth=mix(growth,mix(1.,smoothstep(.15,.8,front),uGrowth),uOrganic*uMotion);}
 float angle=atan(site.y,site.x)+uFacetTwist;
 float facet=cos(floor(angle/TAU*uFacetCount+.5)*TAU/uFacetCount-angle);
 float crystal=max(0.,uCrystalSpread-cell.x*facet)*1.5;
 float height=(vein*.23+crystal*.5)*uHeight*growth;
 vec3 n=fieldNormal(p,height);
 vec3 base=colour(cell.z*.65+.07);
 vec3 color=coat(base,n,uLightAngle,uRoughness,.6);
 color*=1.-uVeinBias*vein*.65;
 color+=uPalette[1]*uEmission*vein*growth*.55;
 float cover=clamp(max(vein, smoothstep(.03,.18,crystal))*growth,0.,1.);
 outputField(color,cover);
}`,
prism:/* glsl */`
void main(){
 vec2 p=domain(),unfolded=p*.7+orbit()*.05;
 vec2 q=asin(sin(unfolded))*1.1;vec3 color=vec3(0.);float coverage=0.;
 float footprint=max(length(dFdx(unfolded)),length(dFdy(unfolded)))*1.1;
 for(int i=17;i>=0;i--){
  if(float(i)>=uArches)continue;
  float z=float(i),zoom=1.+z*.22*uSpacing;
  if(uOrganic>0.)zoom+=sin(uPhase-z*.38)*uOrganic*uMotion*.16;
  vec2 v=spin(z*uTwistDepth*.12)*(q*zoom-vec2(uVanishX,uVanishY)*(zoom-1.)*.35);float arch=max(abs(v.x),abs(v.y)*.82);
  arch=mix(arch,pow(pow(abs(v.x),4.)+pow(abs(v.y),4.),.25),uArchShape);
  float radius=uAperture*.9;
  float aa=max(footprint*zoom,.0005);
  float band=1.-smoothstep(uFrameWidth-aa,uFrameWidth+aa,abs(arch-radius));
  float reflected=.5+.5*cos(atan(v.y,v.x)*4.+z*.7+orbit().x);
  float glass=.5+.5*cos(arch*9.+uDispersion*z+sin(uPhase)*uMotion);
  float bevel=clamp((arch-radius)/uFrameWidth,-1.,1.);
  vec2 gradient=spin(-z*uTwistDepth*.12)*normalize(v*v*v+vec2(.00001));
  vec3 n=normalize(vec3(gradient*bevel*1.8,1.));
  vec3 pigment=coat(mix(uPalette[0],uPalette[2],clamp(z*.027+reflected*.22,0.,1.)),n,uLightAngle,uRoughness,uReflection);
  pigment=mix(pigment,pigment*optFilm(glass,1.+uDispersion),uDispersion*.5);
  pigment*=exp(-z*.055);color=mix(color,pigment,band);coverage=max(coverage,band);
 }
 outputField(color/max(coverage,.01),coverage);
}`,
resonance:/* glsl */`
void main(){
 vec2 p=domain(),q=p*.75+orbit()*.035;
 float x=q.x*PI,y=q.y*PI;
 float modeB=uModeB+(abs(uModeA-uModeB)<.5?1.:0.);
 float a=cos(uModeA*x)*cos(modeB*y)-cos(modeB*x)*cos(uModeA*y);
 float other=modeB+1.;if(abs(other-uModeA)<.5)other+=1.;
 float b=sin(uModeA*x)*sin(other*y)-sin(other*x)*sin(uModeA*y);
 float blend=clamp(uModalBlend+sin(uPhase)*uMotion*.2,0.,1.);
 float field=mix(a,b,blend);
 if(uRadialMix>0.){float angle=atan(q.y,q.x+1e-10),radius=length(q);float radial=cos(uModeA*angle)*sin(modeB*radius*PI);field=mix(field,radial,uRadialMix);}
 if(uHarmonic>0.)field+=uHarmonic*.35*sin((uModeA+modeB)*x*.5)*sin((modeB+2.)*y);
 float aa=max(fwidth(field),.0005)+uNodalSoftness*.12;
 float cover=1.-smoothstep(uBandWidth-aa,uBandWidth+aa,abs(field));
 vec2 grainUV=q*uGrainSize;float grain=hash21(floor(grainUV));
 float grainFilter=smoothstep(.35,1.5,max(length(dFdx(grainUV)),length(dFdy(grainUV))));
 float grainValue=mix(.55+grain*.45,.775,grainFilter);
 vec3 n=fieldNormal(p,field*uRelief*.018);
 vec3 color=coat(colour(.08+.22*abs(field)),n,uLightAngle,uRoughness,.15);
 color*=mix(1.,grainValue,uGrains);outputField(color,cover);
}`,
veils:/* glsl */`
float mist(vec3 p){
  vec2 phase=orbit();
 vec3 q=p+.35*sin(p.yzx*1.6+vec3(phase.x,phase.y,phase.x));
 if(uTurbulence>0.)q+=uTurbulence*.3*vec3(sin(q.y*3.3+phase.x)*cos(q.z*2.),sin(q.z*2.7+phase.y)*cos(q.x*2.1),sin(q.x*3.1+phase.x));
 float folds=sin(q.x*uFolds*.65+sin(q.z*1.4+phase.x))*.7;
 float curl=sin(q.x*2.7-q.z*2.2+phase.y)*.25+sin(q.z*3.1+q.y)*.2;
 float sheet=sin(q.y*3.4+folds*2.+q.z*1.4+phase.y+curl);
 float detail=smoothNoise(q.xy*5.1+vec2(q.z*1.7,-q.z*1.4));
 float erosion=smoothNoise(q.xy*2.3+vec2(q.z*.7,-q.z*.4));
 float ribbon=exp(-sheet*sheet*mix(8.,24.,uErosion)/(uRibbonWidth*uRibbonWidth));
 return ribbon*(.65+.35*detail)*(1.-uErosion*erosion*.7);
}
void main(){
 vec2 p=domain();vec3 sum=vec3(0.);float transmission=1.;
 int steps=uQuality<.5?24:uQuality<1.5?40:64;
 float dz=uDepth/float(steps),offset=.5;
 if(uBanding>0.)offset+=(hash21(gl_FragCoord.xy)-.5)*uBanding;
 float g=uScatterBias,mu=clamp(uLightHeight/sqrt(1.+uLightHeight*uLightHeight),-1.,1.);
 float phaseWeight=(1.-g*g)/pow(max(1.+g*g-2.*g*mu,.05),1.5);
 for(int i=0;i<64;i++){
  if(i>=steps)break;
  float z=(float(i)+offset)*dz;
  vec3 q=vec3(p+vec2(.16,-.09)*z,z);
  float density=mist(q)*uDensity;
  float neighbour=mist(q+vec3(cos(uLightAngle),sin(uLightAngle),uLightHeight)*.09);
  float edge=clamp(density/max(uDensity,.01)-neighbour,0.,1.);
  float absorb=1.-exp(-density*dz*uAbsorption);
  vec3 color=mix(uPalette[0],uPalette[2],smoothstep(0.,uDepth,z));
  color*=(.4+uScattering*(edge*2.4+.45))*phaseWeight;
  sum+=transmission*absorb*color;transmission*=1.-absorb;
 }
 float alpha=clamp(1.-transmission,0.,1.);
 outputField(sum/max(alpha,.0001),alpha);
}`,
};
export function instrumentFragment(kind:InstrumentKind):string{
 const constants=kind==='caustic'?'const float uLightHeight=1.,uFillLight=.26,uAnisotropy=0.,uSheenAngle=0.,uClearcoat=0.;':kind==='veils'?'const float uFillLight=.26,uAnisotropy=0.,uSheenAngle=0.,uClearcoat=0.;':'';
 const uniforms=INSTRUMENT_PARAMETERS[kind].filter(d=>!['saturation','hue','exposure','cycles'].includes(d.key)).map(d=>`uniform float u${d.key[0].toUpperCase()+d.key.slice(1)};`).join('\n');
 return common.replace('const float PI=',uniforms+'\n'+constants+'\nconst float PI=')+bodies[kind];
}
