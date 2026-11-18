import { emberPhrase } from './scope-ember';

const TAU = Math.PI * 2;
const SOURCES = [
  { beat: .94, life: .81, angle: 2.58, strength: .63 },
  { beat: .18, life: .66, angle: -.84, strength: .83 },
  { beat: .43, life: .74, angle: 1.31, strength: .77 },
  { beat: .69, life: .87, angle: -2.01, strength: 1 },
  { beat: .72, life: .63, angle: .26, strength: .83 },
];

export const EMBER_SMOKE_SOURCES = SOURCES.length;
const fract = (x: number) => x - Math.floor(x);
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Reconstruct the surviving puffs and their launch directions at any point in the loop. */
export function emberSmokeFrame(phase: number, phrases: number, seed: number) {
  const turn = fract(phase / TAU);
  const clock = turn * TAU;
  const { bar, body, opening } = emberPhrase(clock, phrases);
  const angleSeed = (seed >>> 0) / 4294967296 * TAU + (seed % 257) * .095;
  const puffs = SOURCES.map(source => {
    const elapsed = fract(bar - source.beat);
    const age = Math.min(1, elapsed / source.life);
    const launch = clock - elapsed * TAU / phrases;
    const angle = source.angle + .35 * Math.sin(angleSeed)
      + .45 * Math.sin(2 * launch + source.angle)
      + .22 * Math.sin(3 * launch + angleSeed - source.angle);
    const gain = source.strength * smooth(age / .115) * (1 - smooth((age - .26) / .74));
    return { x: Math.cos(angle), y: Math.sin(angle), age, gain };
  });
  return { puffs, body, opening, clock };
}

export const emberSmokeFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform mat3 uView;
uniform vec2 uClock;
uniform float uAspect, uRadius, uSpread, uOpening, uSeed;
uniform vec4 uPuffs[${EMBER_SMOKE_SOURCES}];

float smokeHash(vec2 p) {
  vec3 s=fract(vec3(p.xyx)*.1031);
  s+=dot(s,s.yzx+33.33);
  return fract((s.x+s.y)*s.z);
}

float smokeNoise(vec2 p) {
  vec2 cell=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(smokeHash(cell),smokeHash(cell+vec2(1.,0.)),f.x),
    mix(smokeHash(cell+vec2(0.,1.)),smokeHash(cell+1.),f.x),f.y);
}

void main() {
  // Work in bloom-radius units so the smoke follows the beam through layer pan, zoom and rotate.
  vec2 p=((uView*vec3(vUv,1.)).xy-.5)*vec2(uAspect,1.)/max(uRadius,.0001);
  if (dot(p,p)>7.29) { gl_FragColor=vec4(0.); return; }

  vec2 noiseUV=p*3.4+uClock*.59+uSeed;
  vec2 bend=vec2(smokeNoise(noiseUV),smokeNoise(noiseUV+vec2(7.9,19.7)))-.5;
  vec2 q=p+.19*bend;
  float density=0., veins=0.;

  for (int i=0; i<${EMBER_SMOKE_SOURCES}; ++i) {
    vec4 puff=uPuffs[i];
    if (puff.w<=0.) continue;
    float age=puff.z;
    vec2 axis=puff.xy, side=vec2(-axis.y,axis.x);
    vec2 local=vec2(dot(q,axis),dot(q,side));
    // As the puff moves off the bloom, it spreads, curls sideways and leaves a narrow wake.
    float reach=.37+mix(.64,1.27,uSpread)*age;
    vec2 size=vec2(.55+.22*age,.23+.37*age);
    if (abs(local.x-reach)>size.x*1.07 || abs(local.y)>size.y*1.07+.16) continue;
    local.y-=.16*sin(4.5*local.x-5.5*age+float(i)*1.8)*smoothstep(0.,.45,age);
    local.x-=reach;
    vec2 shape=local/size;
    float envelope=1.-smoothstep(.20,1.14,dot(shape,shape));
    if (envelope<=0.) continue;

    vec2 flow=local*vec2(7.,11.)+bend*vec2(2.9,4.4)+vec2(-2.9*age,1.8*age+float(i)*6.1);
    float curl=smokeNoise(flow*.55+uClock*.57);
    flow.y+=2.*(curl-.5);
    float grain=smokeNoise(flow*4.1+2.*age);
    float folds=.88*smokeNoise(flow)+.48*smokeNoise(flow*2.11+curl)+.25*grain;
    float cloud=smoothstep(.38,1.12,folds)*mix(.46,1.,smoothstep(.16,.82,grain));
    float ridges=smoothstep(.55,.75,folds)*(1.-smoothstep(.78,.97,folds));
    float mass=puff.w*envelope;
    density+=mass*cloud;
    veins+=mass*ridges*cloud;
  }

  // Leave the cavity readable as it opens. This sink tracks the same pulse as the filaments.
  float cavity=mix(1.,smoothstep(.18,.49,length(p)),uOpening);
  gl_FragColor=vec4(vec2(density,veins)*cavity,0.,1.);
}
`;
