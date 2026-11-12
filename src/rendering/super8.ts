import { sourceViewGLSL } from './source-view';
import { SUPER8_HISTORY } from './super8-motion';

// Associated linear RGBA, like every other source in StudioRenderer. Paint and
// film detail are procedural; footprints filter against the output pixel size.
export const super8Fragment = /* glsl */`
precision highp float;
varying vec2 vUv;
${sourceViewGLSL}
uniform vec3 uPalette[6];
uniform vec2 uResolution;
uniform float uAspect, uSeed, uMode, uSubstrate;
uniform vec4 uShape[${SUPER8_HISTORY * 2}]; // scale, steps, coverage, erosion
uniform vec4 uPaint[${SUPER8_HISTORY * 2}]; // texture, texture scale, dry brush, bleed
uniform vec4 uMotion[${SUPER8_HISTORY * 2}]; // travel, rotation, cycles, phase
uniform vec2 uEmulsion[${SUPER8_HISTORY * 2}]; // movement, film frame
uniform vec2 uTransport; // intermittent pull-down, continuous reel travel
uniform float uDust;
uniform vec4 uRoll; // rolling shutter amount, bands, from centre, smear
uniform vec4 uFilm; // scratches, grain, flicker, weave
uniform vec4 uFeedback; // decay, zoom, rotation, current film frame
const float TAU = 6.28318530718;
// Phase delay between the first and last exposed band at full Rolling shutter.
const float ROLL_SPAN = TAU * .22;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
    mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
mat2 rotate(float a) { float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
vec3 pigment(float index) {
  float i = mod(floor(index),4.);
  if (i < .5) return uPalette[0];
  if (i < 1.5) return uPalette[1];
  if (i < 2.5) return uPalette[2];
  return uPalette[3];
}
float box(vec2 p, vec2 b) {
  vec2 d = abs(p)-b;
  return length(max(d,0.)) + min(max(d.x,d.y),0.);
}

vec4 painted(vec2 uv, vec4 shape, vec4 paint, vec4 motion, vec2 emulsion) {
  float t = motion.w*motion.z;
  vec2 orbit = vec2(sin(t),cos(t)-1.)*motion.x;
  vec2 p = rotate(motion.y + sin(t)*motion.x*.28) * ((uv-.5)*vec2(uAspect,1.));
  p = p * shape.x + orbit*.22;
  vec2 seed = vec2(mod(uSeed,997.), mod(floor(uSeed/997.),997.));
  vec2 tex = p * (18.*paint.y) + seed;
  // Advected pigment follows the paint while the fine grain belongs to the film.
  float coarse = noise(tex*.36+orbit*.6);
  float medium = noise(tex*1.7);
  float fibres = noise(tex*vec2(1.1,13.));
  // Frame-by-frame pigment boiling, broad fluid distortion and ragged pools.
  // This changes the emulsion itself instead of moving rigid rectangles.
  vec2 boil = vec2(noise(p*7.+seed+emulsion.y*.73),noise(p*7.+seed+19.+emulsion.y*.57))-.5;
  vec2 flow = vec2(noise(p*2.7+seed+orbit),noise(p*3.1+seed+vec2(cos(t),sin(t))))-.5;
  vec2 warped = p + paint.w*.035*vec2(coarse-.5,medium-.5)
    + emulsion.x*(flow*.24+boil*.045);
  warped.y += emulsion.x*.07*sin(warped.x*9.+t+coarse*3.);
  float pixel = max(shape.x*uViewScale/uResolution.y, .00001);
  float edge = pixel*1.2 + paint.w*.004;
  float alpha = 0.;
  vec3 color = uPalette[0];

  if (uMode < .5 || (uMode > 1.5 && uMode < 2.5)) {
    // A diagonal staircase border quantized on both axes; each terrace carries
    // a separate plate of flat pigment rather than a smooth palette gradient.
    float x = warped.x + .5;
    float terrace = floor(x*shape.y)/shape.y;
    float y = warped.y + terrace*.65 + orbit.x*.18;
    float band = floor(y*shape.y);
    float line = abs(fract(y*shape.y)-.5);
    float gap = (1.-shape.z)*.48;
    alpha = 1.-smoothstep(.5-gap-edge*shape.y,.5-gap+edge*shape.y,line);
    color = pigment(band+floor(x*2.)+floor(mod(uSeed,4.)));
    float stairCut = abs(warped.y - floor((warped.x+.8)*shape.y)/shape.y*.55);
    alpha *= 1.-smoothstep(.54,.54+edge,stairCut);
  } else if (uMode < 1.5) {
    // Broad irregular brush swathes with a jagged, stepped crest and wet islands.
    vec2 q = warped*vec2(1.05,2.3);
    float lane = floor(q.y+1.5);
    float crest = floor((noise(vec2(q.x*2.4+seed.x,lane+seed.y))-.5)*shape.y)/shape.y;
    float d = abs(fract(q.y+1.5)-.5) - shape.z*.48;
    d += crest*.4 + (coarse-.5)*.18;
    alpha = 1.-smoothstep(-edge,edge,d);
    color = pigment(lane+floor(q.x*1.5+2.)+floor(mod(uSeed,4.)));
  } else if (uMode > 3.5) {
    // Painted tunnel: nested arches of flat paint rush outward past a column of
    // stepping stones, mirrored about the horizon. Rings move in log-radius, so
    // R rings per cycle pass each point; ring identity repeats every loop.
    float R = max(1., floor(motion.x*4.+.5));
    float period = R*max(motion.z,1.);
    float flow = motion.w/TAU*motion.z*R;
    vec2 base = rotate(motion.y)*((uv-.5)*vec2(uAspect,1.))*shape.x;
    vec2 q = base + (warped - p);
    q.y = abs(q.y);
    float spacing = 6./shape.y;
    float rho = length(q*vec2(.74,1.))+1e-5;
    float z = log(rho)/spacing - flow;
    float id = floor(z), ring = fract(z);
    float key = mod(id, period);
    float zPixel = pixel/(rho*spacing);
    // Ring paint with a ragged gap of paper between rings.
    float gap = 1.-shape.z;
    float ragged = (noise(vec2(atan(q.x,q.y)*9.,key*7.)+seed)-.5)*.08*paint.x;
    float ringEdge = max(zPixel*1.2, .002);
    alpha = smoothstep(gap*.5-ringEdge, gap*.5+ringEdge, ring+ragged) * (1.-smoothstep(1.-gap*.5-ringEdge, 1.-gap*.5+ringEdge, ring-ragged));
    // Fade unresolvable rings near the vanishing point into an even tone.
    alpha = mix(alpha, 1., smoothstep(.1, .35, zPixel));
    color = pigment(key + floor(mod(uSeed,4.)));
    // Stepping stones: rounded tiles on a ground plane, receding to the horizon.
    float v = .35/max(q.y,1e-4), u = q.x/max(q.y,1e-4);
    float s = v*.9 - flow;
    float sid = mod(floor(s), period), fs = fract(s);
    float sPixel = pixel*.9*.35/max(q.y*q.y,1e-6);
    float stone = box(vec2(u*1.1, fs-.5), vec2(.24, .28)) - .1;
    float stoneEdge = max(sPixel*1.5, pixel*.55/max(q.y,1e-4));
    float stoneMask = (1.-smoothstep(-stoneEdge, stoneEdge, stone)) * step(.25, hash(vec2(sid, seed.x+11.)));
    stoneMask *= 1.-smoothstep(.12, .45, sPixel);
    // Only the receding stretch of path: stones closer than this have passed the camera.
    float stoneY = .35*.9/(floor(s)+.5+flow);
    stoneMask *= step(0., stoneY)*step(stoneY, .24);
    // Stones are bare paper cut through the paint, as in scanned frame cut-outs.
    alpha *= 1.-stoneMask;
    // Pigment texture belongs to the moving ring, not to the screen.
    vec2 ringTex = vec2(atan(q.x,q.y)*3.2, mod(z, period)*4.)*paint.y + seed;
    coarse = noise(ringTex*.5);
    medium = noise(ringTex*2.1);
    fibres = noise(ringTex*vec2(.7,14.));
    // Dark pigment specks and pale cracks, as in scanned paint.
    float speck = smoothstep(.80, .84, noise(ringTex*3.3+17.));
    color *= 1.-speck*paint.x*.55;
    float crack = 1.-smoothstep(.0, .035, abs(noise(ringTex*vec2(.9,6.)+41.)-.5));
    color = mix(color, uPalette[5], crack*paint.x*.28);
  } else {
    // Overlapping torn paper pieces. Each has its own pivot, stepped edge and
    // flat color; the cutouts retain real alpha when the substrate is disabled.
    for (int piece = 0; piece < 7; piece++) {
      float id = float(piece);
      vec2 center = vec2(hash(vec2(id,seed.x)),hash(vec2(id+9.,seed.y)))-.5;
      center *= vec2(1.35,.82);
      center += motion.x*.12*vec2(sin(t+id*1.7),cos(t+id*1.3));
      vec2 q = rotate((hash(vec2(id+2.,seed.x))-.5)*1.8 + sin(t+id)*motion.x*.2)*(warped-center);
      float stepEdge = floor((q.y+.6)*shape.y)/shape.y*.16;
      float torn = (noise(q*paint.y*50.+id+seed)-.5)*.018*paint.x;
      float d = box(q+vec2(stepEdge,0),vec2(.10+shape.z*.17,.12+shape.z*.17))+torn;
      float a = (1.-smoothstep(-edge,edge,d))*step(.001,shape.z);
      color = mix(color,pigment(id+floor(mod(uSeed,4.))),a);
      alpha = a+alpha*(1.-a);
    }
  }

  alpha *= step(.0001,shape.z);

  // Texture changes pigment density; destruction removes real coverage.
  float grainFootprint = clamp(1.-pixel*paint.y*140.,0.,1.);
  float dry = mix(medium,fibres,paint.z)*grainFootprint + .5*(1.-grainFootprint);
  float holes = smoothstep(.1+shape.w*.74-edge*5.,.15+shape.w*.74+edge*5.,coarse*.65+dry*.35);
  alpha *= mix(1.,holes,shape.w);
  alpha *= mix(1.,smoothstep(.04,.42,dry),paint.x*paint.z*.65);
  float density = 1.-paint.x*(.18+.38*paint.z)*(1.-dry);
  color = mix(color,uPalette[4],paint.x*max(0.,.45-medium)*.38)*density;
  float pool = noise(warped*8.+seed+orbit);
  color = mix(color, mix(pigment(floor(pool*4.)+1.),color,.45),
    emulsion.x*smoothstep(.35,.8,pool)*.48);
  color *= 1.-emulsion.x*.2*pow(1.-coarse,2.);
  if (uMode > 1.5 && uMode < 2.5) color = mix(vec3(1.)-color,uPalette[2],.13);
  return vec4(max(color,0.)*alpha,alpha);
}

void main() {
  float frame = uFeedback.w;
  vec2 filmSeed = vec2(mod(uSeed,997.),frame);
  vec2 jitter = vec2(hash(filmSeed),hash(filmSeed+17.))-.5;
  vec2 filmUV=sourceUV(vUv);
  vec2 uv = filmUV+jitter*uFilm.w*.012;
  float stripY = uv.y-uTransport.x-uTransport.y;
  int bank = uTransport.x+uTransport.y > 0. && stripY < 0. ? ${SUPER8_HISTORY} : 0;
  if (uTransport.x+uTransport.y > 0.) uv.y = fract(stripY);
  // Rolling shutter: fixed horizontal bands are exposed one after another, so
  // each shows the paint a little later. Smear holds each band near one scan
  // line (horizontal streaks), slips some bands sideways and tears their edges.
  float rollDelay = 0., tear = 0.;
  if (uRoll.x > 0. || uRoll.w > 0.) {
    float bands = max(uRoll.y, 1.);
    float band = floor(uv.y*bands);
    float centreY = (band+.5)/bands;
    float order = mix(1.-centreY, abs(centreY-.5)*2., uRoll.z);
    rollDelay = uRoll.x*ROLL_SPAN*order;
    if (uRoll.w > 0.) {
      vec2 key = vec2(band, mod(uSeed,997.)+floor(frame/2.));
      float hold = smoothstep(0., .7, uRoll.w);
      uv.y = centreY + (uv.y-centreY)*(1.-hold*.92);
      uv.x += (hash(key)-.5)*uRoll.w*.035*step(.55, hash(key+3.));
      float row = floor(filmUV.y*540.);
      vec2 rowKey = vec2(row, mod(uSeed,997.)+floor(frame/3.));
      if (hash(rowKey) < uRoll.w*.14) {
        float anchor = hash(rowKey+5.);
        uv.x = anchor + (uv.x-anchor)*mix(.05, .5, hash(rowKey+9.));
      }
      float edgeDistance = abs(fract(filmUV.y*bands+.5)-.5)/bands;
      float lineWidth = 1.1/uResolution.y;
      tear = (1.-smoothstep(lineWidth*.5, lineWidth*1.5, edgeDistance))
        * step(hash(vec2(floor(filmUV.y*bands+.5), mod(uSeed,997.)+7.)), uRoll.w*.45)
        * smoothstep(.35, .6, noise(vec2(filmUV.x*14., band+frame*.3)));
    }
  }
  vec4 result = vec4(0.);
  // Repeated source-over is a finite feedback expansion. History is reconstructed
  // in one pass, so no render target can leak between layers, projects or seeks.
  for (int tap = ${SUPER8_HISTORY - 1}; tap >= 0; tap--) {
    if (tap > 0 && uFeedback.x <= 0.) continue;
    float age = float(tap);
    vec2 sampleUV = .5 + rotate(age*uFeedback.z)*(uv-.5)*exp(-age*uFeedback.y);
    int index = tap+bank;
    vec4 src = painted(sampleUV,uShape[index],uPaint[index],uMotion[index]-vec4(0.,0.,0.,rollDelay),uEmulsion[index]);
    float weight = tap == 0 ? 1. : pow(uFeedback.x,age);
    src *= weight;
    result = src+result*(1.-src.a);
  }
  vec3 paper = uMode > 1.5 && uMode < 2.5 ? uPalette[4] : uPalette[5];
  if (uSubstrate > .5) result = vec4(result.rgb+paper*(1.-result.a),1.);
  result.rgb = mix(result.rgb, uPalette[5]*result.a, tear*.85);

  float px = 1./uResolution.x;
  float scratch = 0.;
  for (int i = 0; i < 12; i++) {
    float id = float(i);
    vec2 key = vec2(id+mod(uSeed,997.),floor(frame/6.));
    float enabled = step(hash(key+12.),uFilm.x);
    float x = hash(key)+sin(uv.y*7.+id)*.0015;
    float width = max(.0003,px*.7)*(1.+hash(key+8.)*1.4);
    float line = 1.-smoothstep(width,width+px,abs(uv.x-x));
    float broken = smoothstep(.25,.55,noise(vec2(uv.y*28.+frame*.7,id)));
    scratch = max(scratch,line*broken*enabled);
  }
  vec3 scratchColor = uMode > 1.5 && uMode < 2.5 ? uPalette[5] : uPalette[4];
  result.rgb = mix(result.rgb,scratchColor*result.a,scratch*uFilm.x);
  // Sparse, irregular flecks stick to each exposed piece of film.
  vec2 dustUV = uv*vec2(uAspect,1.)*24.;
  vec2 cell = floor(dustUV), local = fract(dustUV)-.5;
  vec2 dustKey = cell+vec2(mod(uSeed,997.),floor(frame/3.));
  vec2 center = (vec2(hash(dustKey),hash(dustKey+51.))-.5)*.6;
  float radius = mix(.025,.19,hash(dustKey+11.));
  float speck = (1.-smoothstep(radius,radius+24./uResolution.y,length((local-center)*vec2(1.,1.6))))
    *step(hash(dustKey+23.),uDust*.23);
  result.rgb *= 1.-speck*uDust*.85;
  float grain = (hash(floor(filmUV*uResolution)+filmSeed*13.)-.5)*uFilm.y*.18;
  float flicker = 1.+(hash(filmSeed+37.)-.5)*uFilm.z*.65;
  // Film markings are confined to existing pigment for transparent output.
  result.rgb = max(result.rgb*flicker+grain*result.a,vec3(0.));
  gl_FragColor = result;
}
`;
