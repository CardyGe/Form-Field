const header = /* glsl */`precision highp float;precision highp int;precision highp sampler2D;varying vec2 vUv;`;

/** Small random field in both channels: the pattern grows out of this. */
export const seedFragment = header + /* glsl */`
uniform float uSeed;
float hash(vec2 p,float s){vec3 q=fract(vec3(p.xyx)*.1031+s*.00137);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){vec2 c=floor(gl_FragCoord.xy);gl_FragColor=vec4(hash(c,uSeed)-.5,hash(c+71.,uSeed+9.)-.5,0.,1.)*vec4(.5,.5,1.,1.);}`;

/**
 * The steering field as a line direction (cos 2θ, sin 2θ), so θ and θ+π are the same and blends leave no seam.
 * Types: 0 radial, 1 spiral, 2 swirl, 3 parallel, 4 two opposed poles, 5 organic curl.
 */
export const directorFragment = header + /* glsl */`
uniform float uType,uMix,uSpiral,uCurlAmount,uCurlScale,uTime,uAspect;uniform vec2 uCentre;
const float PI=3.14159265;
float potential(vec2 p){float t=uTime;return sin(p.x*1.1+.7*sin(p.y*.9+t*.31)+t*.13)*cos(p.y*1.3-.6*sin(p.x*.8-t*.23))+.5*sin(p.x*2.3-p.y*1.7+1.3*cos(p.y*1.1+t*.19)-t*.17);}
float curlAngle(vec2 p){const float e=.01;return atan(-(potential(p+vec2(e,0.))-potential(p-vec2(e,0.))),potential(p+vec2(0.,e))-potential(p-vec2(0.,e)));}
void main(){
 vec2 p=(vUv-.5)*2.*vec2(uAspect,1.),q=p-uCentre*vec2(uAspect,1.);
 float radial=atan(q.y,q.x),base=radial,type=floor(uType+.5);
 if(type==1.)base+=PI*.25;else if(type==2.)base+=PI*.5;else if(type==3.)base=PI*.5;
 else if(type==4.){vec2 a=vec2(.55*uAspect,0.);base=.5*(atan(q.y-a.y,q.x-a.x)-atan(q.y+a.y,q.x+a.x))+PI*.5;}
 float organic=curlAngle(p*uCurlScale);
 if(type==5.)base=organic;
 base+=uSpiral*PI*.5+uCurlAmount*potential(p*uCurlScale)*.9;
 vec2 chosen=vec2(cos(2.*base),sin(2.*base)),curl=vec2(cos(2.*organic),sin(2.*organic));
 gl_FragColor=vec4(mix(chosen,curl,type==5.?0.:uMix*.6),0.,1.);
}`;

/**
 * Carries both fields along a moving flow, once a frame. Catmull-Rom sampling keeps the stripes crisp, because
 * plain linear sampling would blur them faster than the solver can rebuild them.
 * Outside the form the flow streams outward in pulses; inside it the form slowly turns.
 */
export const advectFragment = header + /* glsl */`
uniform sampler2D uState,uDirector,uFlow;uniform vec2 uCentre,uForm;uniform float uHasFlow,uAmount,uTime,uAspect,uFormRadius;
float potential(vec2 p){float t=uTime*.16;return sin(p.x*1.7+1.1*sin(p.y*1.3+t)+t*.7)*cos(p.y*1.9-.9*sin(p.x*1.2-t*.8))+.45*sin(p.x*3.1-p.y*2.3+t*1.3);}
vec2 eddy(vec2 p){const float e=.01;return vec2(potential(p+vec2(0.,e))-potential(p-vec2(0.,e)),-(potential(p+vec2(e,0.))-potential(p-vec2(e,0.))))/(2.*e);}
vec4 weights(float f){float g=f*f,h=g*f;return .5*vec4(-h+2.*g-f,3.*h-5.*g+2.,-3.*h+4.*g+f,h-g);}
float sampleField(vec2 st,int channel){
 ivec2 m=textureSize(uState,0)-1;st-=.5;ivec2 b=ivec2(floor(st));vec2 f=fract(st);vec4 wx=weights(f.x),wy=weights(f.y);float value=0.;
 for(int j=0;j<4;j++)for(int i=0;i<4;i++)value+=texelFetch(uState,clamp(b+ivec2(i-1,j-1),ivec2(0),m),0)[channel]*wx[i]*wy[j];
 return value;
}
void main(){
 vec2 scale=vec2(uAspect,1.),p=(vUv-.5)*2.*scale,q=p-uCentre*scale,toForm=p-uForm*scale,size=vec2(textureSize(uState,0));
 float r=length(q),pulse=.55+.45*sin(r*3.4-uTime*1.15+.8*sin(atan(q.y,q.x)*2.+uTime*.21));
 vec2 swirl=eddy(p*.9);
 vec2 ground=q/max(r,.05)*pulse*smoothstep(0.,.3,r)+swirl*.42;
 float d=length(toForm);
 vec2 turn=vec2(-toForm.y,toForm.x)/max(uFormRadius*2.,.1)*(.55+.45*sin(uTime*.19));
 vec2 body=turn*.8+toForm/max(d,.05)*pulse*.45*smoothstep(0.,.25,d)+swirl*.25;
 // Motion along a stripe keeps it intact; motion across it erases it. Keep most of the flow along the stripes.
 vec2 dir=texture2D(uDirector,vUv).rg;
 ground=mix(ground,.5*(ground+vec2(dir.x*ground.x+dir.y*ground.y,dir.y*ground.x-dir.x*ground.y)),.86);
 body=mix(body,.5*(body+vec2(dir.x*body.x+dir.y*body.y,dir.y*body.x-dir.x*body.y)),.7);
 // Movement in the room pushes the pattern directly, across the stripes as well as along them.
 vec2 push=uHasFlow>.5?clamp(texture2D(uFlow,vUv).rg*size*.7,vec2(-10.),vec2(10.)):vec2(0.);
 vec2 a=gl_FragCoord.xy-ground*uAmount-push,b=gl_FragCoord.xy-body*uAmount-push;
 gl_FragColor=vec4(clamp(sampleField(clamp(a,vec2(.5),size-.5),0),-1.5,1.5),clamp(sampleField(clamp(b,vec2(.5),size-.5),1),-1.5,1.5),0.,1.);
}`;

/**
 * One explicit Swift-Hohenberg step on both fields:
 *   du/dt = K²(r·u + g·u² − u³) − (K + ∇²)²u + a·min(K,1)·∂ₜₜu + seeds
 * ∇² is the isotropic 9-point stencil; (∇²)² is that stencil convolved with itself, a 5×5 kernel.
 */
export const stepFragment = header + /* glsl */`
uniform sampler2D uState,uDirector;uniform vec2 uK,uCentre;uniform float uDt,uDrive,uAsym,uAlign,uTravel,uSurge,uTime,uNoise,uFrame,uAspect;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031+uFrame*.0137);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
 ivec2 c=ivec2(gl_FragCoord.xy),m=textureSize(uState,0)-1;
 #define F(x,y) texelFetch(uState,clamp(c+ivec2(x,y),ivec2(0),m),0).rg
 vec2 o=F(0,0),px=F(1,0),nx=F(-1,0),py=F(0,1),ny=F(0,-1),pp=F(1,1),pn=F(1,-1),np=F(-1,1),nn=F(-1,-1);
 vec2 e1=px+nx+py+ny,d1=pp+pn+np+nn,e2=F(2,0)+F(-2,0)+F(0,2)+F(0,-2),d2=F(2,2)+F(2,-2)+F(-2,2)+F(-2,-2);
 vec2 k=F(2,1)+F(2,-1)+F(-2,1)+F(-2,-1)+F(1,2)+F(-1,2)+F(1,-2)+F(-1,-2);
 vec2 lap=.5*e1+.25*d1-3.*o,lap2=10.25*o-2.5*e1-d1+.375*e2+.25*k+.0625*d2;
 vec2 p=(vUv-.5)*vec2(uAspect,1.),q=p-uCentre*.5*vec2(uAspect,1.);
 float dist=length(q),ring=sin(dist*11.-uTime*2.1+.9*sin(atan(q.y,q.x)*3.+uTime*.37));
 // Surge rings locally change the preferred width, so stripes bunch up, fork and relax as each ring passes.
 vec2 K=uK*(1.+uSurge*.22*ring);
 vec2 op=K*K*o+2.*K*lap+lap2;
 vec2 dir=texture2D(uDirector,vUv).rg,xx=px+nx-2.*o,yy=py+ny-2.*o,xy=(pp+nn-pn-np)*.25;
 vec2 along=.5*(xx+yy)+.5*dir.x*(xx-yy)+dir.y*xy;
 float r=uDrive*(1.+uTravel*.7*sin(p.x*5.3+p.y*3.1-uTime*.9)*sin(p.y*4.1-p.x*2.2+uTime*.53));
 // Growth and steering scale with K², so Drive means the same thing at every stripe width and only the chosen width grows.
 vec2 v=o+uDt*(K*K*(r*o+uAsym*o*o-o*o*o)-op+uAlign*min(K,vec2(1.))*along);
 if(uNoise>0.)v+=(vec2(hash(vec2(c)),hash(vec2(c)+37.))-.5)*uNoise;
 if(isnan(v.x)||isinf(v.x))v.x=0.;if(isnan(v.y)||isinf(v.y))v.y=0.;
 gl_FragColor=vec4(clamp(v,-1.5,1.5),0.,1.);
}`;
