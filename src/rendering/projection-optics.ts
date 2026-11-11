/** Shared, resolution-aware optical primitives. All inputs are linear colour or
 * unwrapped source coordinates, never a repeated screenshot of a finite frame. */
export const projectionOpticsGLSL = /* glsl */`
float optSinc(float x){return abs(x)<.0001?1.:sin(x)/x;}
float optCos(float phase){return cos(phase)*optSinc(dFdx(phase)*.5)*optSinc(dFdy(phase)*.5);}
float optPulseIntegral(float x,float duty){return floor(x)*duty+min(fract(x),duty);}
float optStripe(float phase,float duty){
  float w=max(fwidth(phase),.0001);
  return clamp((optPulseIntegral(phase+w*.5+duty*.5,duty)-optPulseIntegral(phase-w*.5+duty*.5,duty))/w,0.,1.);
}
// Tangent-frame elliptical highlight, bounded for real-time artistic materials.
float optAnisotropic(vec3 n,vec3 light,float roughness,float direction){
 vec3 dx=dFdx(n),dy=dFdy(n);
 roughness=sqrt(min(1.,roughness*roughness+min(.25,max(dot(dx,dx),dot(dy,dy))*.5)));
 vec3 t0=vec3(cos(direction),sin(direction),0.);
 vec3 tangent=normalize(t0-n*dot(n,t0));vec3 bitangent=cross(n,tangent);
 vec3 h=normalize(light+vec3(0,0,1));
 float rt=.18+roughness*.65,rb=.035+roughness*.2;
 float x=dot(h,tangent)/rt,y=dot(h,bitangent)/rb;
 return exp(-.5*(x*x+y*y))*max(dot(n,light),0.);
}
vec3 optFilm(float facing,float thickness){
  // A restrained three-band thin-film approximation, normalized before tinting.
  vec3 wave=.5+.5*cos(6.2831853*(thickness*(.35+.65*facing)*vec3(1.,1.28,1.65)+vec3(0.,.16,.36)));
  return mix(vec3(.7),wave,.75);
}
float optCaustic(vec2 p,float phase,float focus){
  vec2 w=p+vec2(sin(p.y*1.7+sin(phase)*.5),cos(p.x*1.3+cos(phase)*.5))*.42;
  float a=.5+.5*optCos(w.x*4.+sin(w.y*2.+cos(phase)));
  float b=.5+.5*optCos(w.y*4.3+cos(w.x*1.8+sin(phase)));
  return pow(clamp(a*b,0.,1.),mix(1.,5.,focus));
}
`;
