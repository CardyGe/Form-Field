import { sourceViewGLSL } from './source-view';
// Optical finish samples associated linear paint. It shares the studio's render
// loop and output resolution; no wall clock or persistent simulation is used.
export const super8ProjectorFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform sampler2D uImage;
uniform mat3 uPaintViewInverse;
uniform vec2 uResolution;
uniform float uAspect, uSubstrate, uSeed;
uniform vec4 uGate; // view, inset, corners, perforations
uniform vec4 uOptics; // softness, halation, vignette, fading
uniform vec4 uWear; // hair, light leak, frame lines, gate weave
uniform vec4 uTransport; // pull, reel roll, shutter light, continuous loop phase
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx)*.1031);
  q += dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p)-b+r;
  return min(max(d.x,d.y),0.)+length(max(d,0.))-r;
}
vec4 image(vec2 uv) { return texture2D(uImage,clamp((uPaintViewInverse*vec3(uv,1.)).xy,vec2(0.),vec2(1.))); }
vec4 blur(vec2 uv, float radius) {
  vec2 d = vec2(radius/uAspect,radius);
  return (image(uv)*4.+image(uv+vec2(d.x,0.))*2.+image(uv-vec2(d.x,0.))*2.
    +image(uv+vec2(0.,d.y))*2.+image(uv-vec2(0.,d.y))*2.
    +image(uv+d)+image(uv-d)+image(uv+vec2(d.x,-d.y))+image(uv+vec2(-d.x,d.y)))/16.;
}
void main() {
  vec2 filmUV=sourceUV(vUv);
  float phase = uTransport.w;
  float seed = mod(uSeed,997.);
  float inset = uGate.x > .5 ? uGate.y : 0.;
  float rail = uGate.x > 1.5 ? .085 : 0.;
  vec2 center = vec2(rail*.5,0.);
  vec2 halfSize = vec2(.5-inset-rail*.5,.5-inset);
  vec2 uv = (filmUV-.5-center)/(2.*halfSize)+.5;
  vec4 src = image(uv);
  if (uOptics.x > 0.) src = mix(src,blur(uv,.0006+uOptics.x*.006),uOptics.x*.8);
  if (uOptics.y > 0.) {
    vec4 halo = blur(uv,.006+uOptics.y*.022);
    // Red/orange scattering around bright emulsion, confined to source coverage.
    vec3 light = max(halo.rgb-vec3(.12)*halo.a,0.);
    src.rgb += light*vec3(1.,.27,.075)*uOptics.y*.45*src.a;
  }
  vec3 faded = src.rgb*.78+vec3(.105,.068,.035)*src.a;
  src.rgb = mix(src.rgb,faded,uOptics.w);
  vec2 q = (uv-.5)*vec2(1.15,1.);
  float falloff = smoothstep(.08,.64,dot(q,q));
  src.rgb *= 1.-falloff*uOptics.z*.75;

  // A broad, breathing orange flare enters the film edge, rather than a moving
  // coloured rectangle. Its path and exposure close over the project loop.
  float breath = .5+.5*sin(phase*2.+1.4);
  vec2 leakCenter = vec2(-.08+.04*sin(phase),.45+.25*sin(phase+seed));
  vec2 leakQ = (uv-leakCenter)*vec2(2.2,1.);
  float leak = exp(-dot(leakQ,leakQ)*5.)*(.25+breath*.75);
  float second = exp(-dot((uv-vec2(1.05,.65+.2*cos(phase)))*vec2(3.,1.),
    (uv-vec2(1.05,.65+.2*cos(phase)))*vec2(3.,1.))*5.);
  src.rgb += (vec3(1.,.22,.035)*leak+vec3(.7,.035,.012)*second*.6)*uWear.y*src.a;

  float strip = uv.y-uTransport.x-uTransport.y;
  float lineDistance = min(fract(strip),1.-fract(strip));
  float frameLine = 1.-smoothstep(.004,.009+1./uResolution.y,lineDistance);
  src.rgb *= 1.-frameLine*uWear.z*.94;
  float hair = 0.;
  for (int i=0; i<3; i++) {
    float id = float(i);
    float x = .12+hash(vec2(id,seed))*.76;
    float h = uv.y;
    if (i == 1) h = 1.-h;
    float curl = x+sin(h*19.+id)*.012+h*h*.3;
    float thickness = max(.00065,.65/uResolution.x);
    float strand = 1.-smoothstep(thickness,thickness+1./uResolution.x,abs(uv.x-curl));
    strand *= 1.-smoothstep(.055+id*.035,.12+id*.035,h);
    hair = max(hair,strand);
  }
  src.rgb *= 1.-hair*uWear.x*.9;

  float edgePixel=uViewScale/uResolution.y;
  float aperture = 1.;
  if (uGate.x > .5) {
    vec2 p = (filmUV-.5-center)*vec2(uAspect,1.);
    vec2 b = halfSize*vec2(uAspect,1.);
    // A little irregular edge makes the stationary metal gate readable.
    float edge = sin(filmUV.y*173.+seed)*.00035*uWear.w;
    float d = roundedBox(p,b,max(.00001,min(b.x,b.y)*.16*uGate.z))+edge;
    aperture = 1.-smoothstep(-edgePixel,edgePixel,d);
  }
  src *= aperture;
  if (uGate.x > 1.5) {
    float railMask = step(filmUV.x,inset+rail)*step(inset,filmUV.x);
    railMask *= step(inset,filmUV.y)*step(filmUV.y,1.-inset);
    float x = filmUV.x-(inset+rail*.48);
    float y = (fract(strip+.5)-.5)*(1.-2.*inset);
    float hole = 1.-smoothstep(-1./uResolution.y,1./uResolution.y,
      roundedBox(vec2(x*uAspect,y),vec2(rail*.27*uAspect,.053),.008));
    vec3 stock = mix(vec3(.035,.012,.005),vec3(.78,.62,.36),hole*uGate.w);
    // Rail is part of the film only with an opaque substrate. Cutout output
    // keeps a genuinely transparent background and uses aperture as a mask.
    if (uSubstrate > .5) src = vec4(src.rgb+stock*railMask*(1.-src.a),max(src.a,railMask));
  }
  src.rgb *= uTransport.z;
  if (uSubstrate > .5) src.a = 1.;
  gl_FragColor = vec4(max(src.rgb,0.),src.a);
}
`;
