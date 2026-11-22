const header = /* glsl */`precision highp float;precision highp int;precision highp sampler2D;varying vec2 vUv;`;

/** Height to liquid metal: form lens, relief normal, palette, thin film, studio reflections and clear coat. Output is HDR linear. */
export const shadeFragment = header + /* glsl */`
uniform sampler2D uState;uniform vec3 uStops[5];uniform vec2 uFormPos,uOut;
uniform float uFormStrength,uAspect,uFormType,uFormSize,uFormSoft,uRefraction,uDepth,uBevel,uSharp,uWavelength,uRough,uMetal,uCoat,uLightAngle,uEnvRotate;
uniform float uIrid,uFilm,uFilmVary,uFilmIor,uColourShift,uZones,uSaturation,uExposure,uChroma,uTime,uShimmer;
const float PI=3.14159265;

// Cubic B-spline value and gradient from one 16-texel footprint, so normals stay smooth when the field is enlarged.
void field(vec2 uv,out vec2 value,out vec2 dx,out vec2 dy){
 ivec2 size=textureSize(uState,0),m=size-1;vec2 st=uv*vec2(size)-.5,f=fract(st);ivec2 b=ivec2(floor(st));
 vec4 wx=vec4(pow(1.-f.x,3.),3.*f.x*f.x*f.x-6.*f.x*f.x+4.,-3.*f.x*f.x*f.x+3.*f.x*f.x+3.*f.x+1.,f.x*f.x*f.x)/6.;
 vec4 wy=vec4(pow(1.-f.y,3.),3.*f.y*f.y*f.y-6.*f.y*f.y+4.,-3.*f.y*f.y*f.y+3.*f.y*f.y+3.*f.y+1.,f.y*f.y*f.y)/6.;
 vec4 gx=vec4(-.5*(1.-f.x)*(1.-f.x),1.5*f.x*f.x-2.*f.x,-1.5*f.x*f.x+f.x+.5,.5*f.x*f.x);
 vec4 gy=vec4(-.5*(1.-f.y)*(1.-f.y),1.5*f.y*f.y-2.*f.y,-1.5*f.y*f.y+f.y+.5,.5*f.y*f.y);
 value=dx=dy=vec2(0.);
 for(int j=0;j<4;j++)for(int i=0;i<4;i++){
  vec2 s=texelFetch(uState,clamp(b+ivec2(i-1,j-1),ivec2(0),m),0).rg;
  value+=s*wx[i]*wy[j];dx+=s*gx[i]*wy[j];dy+=s*wx[i]*gy[j];
 }
}
vec3 ramp(float t){t=fract(t)*5.;int i=int(floor(t))%5;float f=fract(t);f=f*f*(3.-2.*f);return mix(uStops[i],uStops[(i+1)%5],f);}
float zones(vec2 p){float t=uTime*(.035+.16*uShimmer);return sin(p.x*1.15+1.6*sin(p.y*.8+t)+t*.7)*.55+sin(p.y*1.45-1.3*sin(p.x*.7-t*.8)-t*.5)*.45;}

// A procedural photo studio: a room graded from the palette with three softboxes.
vec3 studio(vec3 r,float rough){
 float turn=uEnvRotate+uTime*.27*uShimmer,c=cos(turn),s=sin(turn);r.xy=mat2(c,-s,s,c)*r.xy;
 float w=.05+rough*.5;
 vec3 room=mix(uStops[3]*.16,mix(uStops[1],uStops[0],.35)*1.05,smoothstep(-.9,.9,r.y+.25*r.x));
 float key=smoothstep(.62-w,.62+w,dot(r,normalize(vec3(-.55,.62,.56))));
 float strip=smoothstep(.1+w,.02,abs(r.x-.52+.22*r.y))*smoothstep(-.1-w,.25,r.z);
 float kick=smoothstep(.72-w,.72+w,dot(r,normalize(vec3(.72,-.6,.34))));
 return room+vec3(1.,.97,.94)*key*3.4/(1.+rough*3.)+mix(uStops[1],vec3(1.),.6)*strip*1.5+uStops[2]*kick*1.7;
}
void main(){
 vec2 scale=vec2(uAspect,1.),p=(vUv-.5)*2.*scale,q=p-uFormPos*scale;
 float d=length(q),angle=atan(q.y,q.x),type=floor(uFormType+.5),R=uFormSize*2.,px=2./uOut.y;
 if(type==3.)R*=1.+.13*sin(3.*angle+uTime*.21)+.07*sin(5.*angle-uTime*.16);
 float soft=uFormSoft+px,mask=0.,dome=0.;
 if(type==1.||type==3.){mask=1.-smoothstep(R-soft,R+soft,d);float t=clamp(d/R,0.,.985);dome=t/sqrt(1.-t*t);}
 else if(type==2.){float mid=R*.78,half_=R*.24,t=clamp((d-mid)/half_,-.985,.985);mask=1.-smoothstep(half_-soft,half_+soft,abs(d-mid));dome=t/sqrt(1.-t*t);}
 mask*=uFormStrength;dome=min(dome,3.2)*uFormStrength;
 vec2 radial=q/max(d,1e-4);
 vec2 uv=clamp(vUv-radial*dome*mask*uRefraction*.055/scale,vec2(0.),vec2(1.));
 vec2 v,dx,dy;field(uv,v,dx,dy);
 float h=mix(v.r,v.g,mask);vec2 grad=mix(vec2(dx.r,dy.r),vec2(dx.g,dy.g),mask);

 // Stripe profile: Line sharpness moves it from a soft wave toward pressed ridges.
 float gain=1.+5.*uSharp,span=atan(gain),hn=h/.75,shaped=atan(hn*gain)/span,slopeGain=gain/((1.+hn*hn*gain*gain)*span*.75);
 slopeGain*=mix(1.,1.-pow(min(abs(shaped),1.),6.),uBevel);
 vec2 slope=grad*slopeGain*uDepth*uWavelength*.42;
 vec3 n=normalize(vec3(-slope-radial*dome*mask*.72,1.));

 float zone=zones(p);
 vec3 albedo=ramp(uColourShift+uTime*.009*uShimmer+uZones*.3*zone+shaped*.11+.2*mask);
 float metal=uMetal,rough=uRough,lightTurn=uLightAngle+uTime*.41*uShimmer;
 vec3 view=vec3(0.,0.,1.),r=reflect(-view,n),l=normalize(vec3(cos(lightTurn)*.72,sin(lightTurn)*.72,.7));

 // Thin film: interference phase per channel, faded where it would alias within a pixel.
 float cosT=sqrt(max(0.,1.-(1.-n.z*n.z)/(uFilmIor*uFilmIor)));
 float thickness=uFilm*(1.+uFilmVary*(.42*shaped+.28*zone)+.12*uShimmer*sin(uTime*.33+p.x*.8-p.y*.6));
 vec3 phase=4.*PI*uFilmIor*thickness*cosT/vec3(650.,532.,450.);
 vec3 film=.5+.5*cos(phase+PI);
 float blur=fwidth(phase.g);film=mix(vec3(.5),film,1./(1.+blur*blur*.3));
 film=clamp(mix(vec3(dot(film,vec3(.3,.5,.2))),film,1.45),0.,1.);

 vec3 F0=mix(vec3(.05),albedo,metal)*mix(vec3(1.),.35+film*1.45,uIrid);
 float fres=pow(1.-max(n.z,0.),5.);vec3 F=F0+(vec3(1.)-F0)*fres;
 vec2 shift=slope*uChroma*.045;
 vec3 env=vec3(studio(reflect(-view,normalize(n+vec3(shift,0.))),rough).r,studio(r,rough).g,studio(reflect(-view,normalize(n-vec3(shift,0.))),rough).b);
 vec3 h3=normalize(l+view);float nh=max(dot(n,h3),0.),a=rough*rough,a2=a*a,ggx=a2/(PI*pow(nh*nh*(a2-1.)+1.,2.));
 vec3 colour=albedo*(1.-metal)*(.34+.95*max(dot(n,l),0.))+env*F+F*min(ggx,18.)*.22*max(dot(n,l),0.);
 colour+=uCoat*(.04+.96*fres)*studio(r,.04)*.75;
 colour+=albedo*metal*.16;

 colour*=mix(.42,1.,smoothstep(-1.,.3,shaped));
 if(type>0.){
  float outside=1.-mask,edge=type==2.?abs(d-R*.78)-R*.24:d-R;
  colour*=1.-outside*.5*uFormStrength*smoothstep(.2,0.,edge);
  colour+=mask*smoothstep(-.09,0.,edge)*mix(albedo,vec3(1.),.55)*.34;
 }
 float grey=dot(colour,vec3(.2126,.7152,.0722));
 gl_FragColor=vec4(max(mix(vec3(grey),colour,uSaturation),0.)*uExposure,1.);
}`;

export const brightFragment = /* glsl */`uniform sampler2D uImage;uniform vec2 uTexel;
void main(){vec3 c=vec3(0.);for(int y=-1;y<=1;y+=2)for(int x=-1;x<=1;x+=2)c+=texture2D(uImage,vUv+vec2(x,y)*uTexel).rgb;c*=.25;
float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(min(c*smoothstep(.85,1.7,l),vec3(8.)),1.);}`;

export const blurFragment = /* glsl */`uniform sampler2D uImage;uniform vec2 uStep;
void main(){vec3 c=texture2D(uImage,vUv).rgb*.227;c+=(texture2D(uImage,vUv+uStep*1.385).rgb+texture2D(uImage,vUv-uStep*1.385).rgb)*.316;c+=(texture2D(uImage,vUv+uStep*3.231).rgb+texture2D(uImage,vUv-uStep*3.231).rgb)*.07;gl_FragColor=vec4(c,1.);}`;

/** Adds the glow, tone maps to display range and dithers. Output is linear 0..1 for the host to encode. */
export const finishFragment = /* glsl */`uniform sampler2D uImage,uBloom;uniform float uAmount,uGrain,uTime,uFade;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031+fract(uTime)*7.);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){vec3 c=texture2D(uImage,vUv).rgb+texture2D(uBloom,vUv).rgb*uAmount*1.5;
c=clamp(c*(2.51*c+.03)/(c*(2.43*c+.59)+.14),0.,1.);
float n=hash(gl_FragCoord.xy)-.5;c=clamp(c*(1.+n*uGrain*.28)+n/255.,0.,1.);gl_FragColor=vec4(c*uFade,1.);}`;
