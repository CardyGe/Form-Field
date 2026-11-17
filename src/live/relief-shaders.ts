// Four travelling crests, in +x, -x, +y and -y. Each transports its own
// height, so opposed gestures can cross without changing each other's course.
export const sweepFragment = /* glsl */`
uniform sampler2D uState, uFlow;
uniform float uStep, uReach, uSettle, uFresh;
void main() {
  vec2 travel = uStep * uReach * vec2(.32, .57);
  vec4 wave = vec4(
    texture2D(uState, vUv - vec2(travel.x, 0.)).r,
    texture2D(uState, vUv + vec2(travel.x, 0.)).g,
    texture2D(uState, vUv - vec2(0., travel.y)).b,
    texture2D(uState, vUv + vec2(0., travel.y)).a
  ) * exp(-3.5 * uStep / uSettle);
  if (uFresh > .5) {
    vec3 flow = texture2D(uFlow, vUv).rgb;
    vec2 shift = flow.xy * vec2(160., 90.);
    float strength = smoothstep(.018, .55, flow.b) * smoothstep(.025, .65, length(shift));
    vec2 dir = shift / max(.001, abs(shift.x) + abs(shift.y));
    vec4 push = max(vec4(dir.x, -dir.x, dir.y, -dir.y), vec4(0.)) * strength;
    wave += (1. - wave) * push * .7;
  }
  gl_FragColor = wave;
}`;

// A damped membrane. R carries height and G carries velocity in units per second.
// The renderer splits long frames so a wave travels less than .65 cells per step.
export const rippleFragment = /* glsl */`
uniform sampler2D uState, uFlow;
uniform float uStep, uReach, uSettle, uFresh;
void main() {
  vec2 cell = vec2(1./160., 1./90.);
  vec2 prev = texture2D(uState,vUv).rg;
  float lap = texture2D(uState,vUv+vec2(cell.x,0.)).r + texture2D(uState,vUv-vec2(cell.x,0.)).r
    + texture2D(uState,vUv+vec2(0.,cell.y)).r + texture2D(uState,vUv-vec2(0.,cell.y)).r - 4.*prev.x;
  float speed = 52.*uReach;
  float v = prev.y + (speed*speed*lap - 86.*prev.x)*uStep;
  if (uFresh > .5) {
    vec3 flow = texture2D(uFlow,vUv).rgb;
    v += 2.8*smoothstep(.018,.55,flow.b)*smoothstep(.025,.65,length(flow.xy*vec2(160.,90.)));
  }
  float damp = exp(-3.5*uStep/uSettle);
  v *= damp;
  gl_FragColor = vec4((prev.x + uStep*v)*damp, v, 0., 0.);
}`;

// Local spring-loaded shutters. A deliberate gesture holds the shutter open,
// then the spring returns it with a small overshoot when the timer expires.
export const latchFragment = /* glsl */`
uniform sampler2D uState, uFlow;
uniform float uStep, uReach, uSettle, uFresh;
void main() {
  vec4 shutter = texture2D(uState,vUv);
  float hold = max(0.,shutter.b-uStep);
  float side = shutter.a;
  if (uFresh > .5) {
    vec2 span = vec2(.035,.062)*uReach;
    vec3 best = texture2D(uFlow,vUv).rgb;
    for(int i=0; i<4; i++) {
      vec2 offset = i<2 ? vec2(i==0 ? span.x : -span.x,0.) : vec2(0.,i==2 ? span.y : -span.y);
      vec3 f = texture2D(uFlow,vUv+offset).rgb;
      if(f.b > best.b) best = f;
    }
    vec2 direction = best.xy*vec2(160.,90.);
    if(best.b>.11 && length(direction)>.12) {
      if(hold<=0.) side = dot(direction,vec2(1.,.75))<0. ? -1. : 1.;
      hold = uSettle;
    }
  }
  float target = hold>0. ? side : 0.;
  float velocity = (shutter.g + (target-shutter.r)*480.*uStep)*exp(-16.*uStep);
  gl_FragColor = vec4(shutter.r+velocity*uStep,velocity,hold,side);
}`;

export const reliefVertex = /* glsl */`
attribute vec3 aInstance;
attribute float aFinish;
uniform sampler2D uState;
uniform float uDepth, uPitch;
uniform int uSurface, uMotion;
varying vec3 vWorld, vNormal;
varying float vFinish, vTurn, vEnergy;

vec3 movement(vec2 panel) {
  vec2 st = panel / vec2(16.,9.) + .5, blur = vec2(.012,.023);
  vec4 f = .4*texture2D(uState,st) + .15*(
    texture2D(uState,st+vec2(blur.x,0.)) + texture2D(uState,st-vec2(blur.x,0.)) +
    texture2D(uState,st+vec2(0.,blur.y)) + texture2D(uState,st-vec2(0.,blur.y)));
  if (uMotion == 2) return vec3(f.x,abs(f.x),abs(f.x))*uDepth;
  if (uMotion == 1) {
    float crest = tanh(f.x*2.8)*uDepth;
    return vec3(crest, crest, abs(crest));
  }
  float turn = tanh(1.8*(f.r-f.g) + 1.5*(f.b-f.a))*uDepth;
  float lift = min(1.,dot(f,vec4(1.)))*uDepth;
  return vec3(turn,lift,lift);
}
float restAngle(vec2 p) {
  float spine = p.y - .24*p.x - .8*sin(p.x*.55);
  return .19*exp(-.60*spine*spine)-.075;
}

// Local ribbon axes rotate together, keeping the horizontal weft front-facing.
vec2 orient(vec2 p) { return aInstance.z > .5 ? vec2(-p.y,p.x) : p; }
vec3 ribbon(float along, out float angle, out vec3 motion) {
  vec2 panel = aInstance.xy + orient(vec2(0.,along));
  motion = movement(panel);
  float rest = restAngle(panel);
  angle = rest + 1.18*motion.x;
  float c=cos(angle), s=sin(angle);
  vec2 face = panel + orient(vec2(position.x*c + position.z*s + .20*motion.x,0.));
  float rise = -position.x*s + position.z*c + .80*motion.y + rest*.5;
  if (uSurface == 2) {
    vec2 crossingPhase = 3.14159265*((panel+vec2(8.,4.5))/uPitch-.5);
    float crossings = cos(crossingPhase.x)*cos(crossingPhase.y);
    rise += uPitch*mix(.16,-.16,aInstance.z)*crossings;
  }
  return vec3(face,rise);
}
vec3 hinge(vec3 p, float tilt, float yaw) {
  vec3 q = vec3(p.x, cos(tilt)*p.y-sin(tilt)*p.z, sin(tilt)*p.y+cos(tilt)*p.z);
  return vec3(cos(yaw)*q.x+sin(yaw)*q.z, q.y, -sin(yaw)*q.x+cos(yaw)*q.z);
}
void main() {
  vec3 motion;
  if (uSurface == 1) {
    vec2 centre = aInstance.xy;
    motion = movement(centre);
    float yaw = restAngle(centre) + .14*sin(1.2*centre.x+.65*centre.y) + .82*motion.x;
    float tilt = .16*sin(.53*centre.x-.77*centre.y) - .96*motion.y;
    vec3 pin = vec3(0.,.77*aInstance.z,0.);
    vWorld = vec3(centre, .32*motion.y) + pin + hinge(position-pin,tilt,yaw);
    vNormal = hinge(normal,tilt,yaw);
  } else {
    float along = position.y * mix(9.,16.,aInstance.z);
    float angle, unusedAngle;
    vec3 unusedMotion;
    vWorld = ribbon(along,angle,motion);
    vec3 dy = ribbon(along+.06,unusedAngle,unusedMotion)-ribbon(along-.06,unusedAngle,unusedMotion);
    vec3 dx = vec3(orient(vec2(normal.z*cos(angle)-normal.x*sin(angle),0.)), -normal.z*sin(angle)-normal.x*cos(angle));
    vNormal = normalize(cross(dx,dy));
  }
  vFinish = aFinish; vTurn = motion.x; vEnergy = motion.z;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(vWorld,1.);
}`;

export const reliefFragment = /* glsl */`
varying vec3 vWorld, vNormal;
varying float vFinish, vTurn, vEnergy;
uniform int uFinish;
uniform float uEdgeLight;
uniform vec2 uLight;
float square(float x) { return x*x; }
void main() {
  vec3 n = normalize(vNormal);
  vec3 r = reflect(vec3(0.,0.,-1.),n);
  float card = dot(r.xy + vWorld.xy*vec2(.06,.045),uLight) - .033*vWorld.y;
  float softbox = exp(-6.*square(card-.28+.22*r.y));
  float strip = exp(-110.*square(card+.38-.35*r.y));
  float warm = exp(-18.*square(card+.72+.13*r.y));
  float grain = .008*sin(vWorld.x*185.)*(1.-smoothstep(.5,2.,fwidth(vWorld.x)*185.));
  vec3 metal = vec3(.028,.054,.083)+softbox*vec3(.18,.29,.36)+strip*vec3(.72,.77,.74)+warm*vec3(.25,.15,.085)+grain;
  vec3 edge = vec3(.11,.14,.17)+(.16+softbox*.30+strip*.42)*vec3(.84,.90,.93);
  vec3 accent = vec3(.40,.040,.013);
  if (uFinish == 1) {
    float hammer = sin(34.*vWorld.x + 1.2*sin(23.*vWorld.y))*sin(37.*vWorld.y);
    float glint = exp(-52.*square(card+.27+.047*hammer));
    metal = vec3(.083,.031,.008) + vec3(.63,.34,.084)*softbox + vec3(.82,.68,.34)*glint + .014*hammer;
    edge = vec3(.63,.36,.12)*(.42+softbox+strip);
    accent = vec3(.018,.30,.21);
  } else if (uFinish == 2) {
    float glaze = exp(-190.*square(card-.18));
    metal = vec3(.32,.43,.48)+vec3(.33,.23,.20)*softbox+vec3(.50,.53,.56)*glaze;
    metal += vec3(.055,.02,.075)*(1.-abs(n.z));
    edge = vec3(.32,.61,.68)*(.45+.65*softbox);
    accent = vec3(.028,.13,.34);
  } else if (uFinish == 3) {
    // Thin-film colour shifts with the surface normal and the strip light.
    float phase = 3.8*card + 1.4*(1.-n.z) + .72*r.y + .28*vWorld.y;
    float petrol = .5+.5*cos(phase);
    vec3 film = mix(vec3(.22,.035,.38),vec3(.012,.37,.38),petrol);
    film = mix(film,vec3(.77,.20,.27),.82*smoothstep(.63,.98,sin(phase))*softbox);
    metal = vec3(.012,.014,.032)+film*(.36+.72*softbox)+strip*vec3(.56,.72,.75);
    edge = vec3(.11,.15,.21)+.70*film;
    accent = mix(vec3(.92,.12,.25), vec3(.03,.72,.59), petrol);
  }
  vec3 enamel = accent*(.55+.45*abs(n.x))+strip*.16;
  vec3 surface = vFinish < .5 ? metal : (vFinish < 1.5 ? edge : enamel);
  if (vFinish < .5) surface += smoothstep(.18,.82,abs(vTurn))*accent*.56*(.35+warm);
  float light = uEdgeLight*smoothstep(.015,.8,vEnergy);
  surface += light*mix(.06,.98,step(.5,vFinish))*(.18+accent);
  gl_FragColor = vec4(surface,1.);
}`;
