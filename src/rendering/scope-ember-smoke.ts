import { EMBER_LIVE_PUFFS, type SmokeAudioFrame } from '../react/ember-smoke';
import { emberPhrase } from './scope-ember';

const TAU = Math.PI * 2;
const SOURCES = [
  { beat: .94, life: .81, angle: 2.58, strength: .63 },
  { beat: .18, life: .66, angle: -.84, strength: .83 },
  { beat: .43, life: .74, angle: 1.31, strength: .77 },
  { beat: .69, life: .87, angle: -2.01, strength: 1 },
  { beat: .72, life: .63, angle: .26, strength: .83 },
];

export const EMBER_SMOKE_SOURCES = SOURCES.length + EMBER_LIVE_PUFFS;
const fract = (x: number) => x - Math.floor(x);
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Birth positions are fixed per event, including across the authored loop seam. */
export function emberSmokeFrame(phase: number, phrases: number, seed: number, persistence = .55, audio?: SmokeAudioFrame, response = .72) {
  const clock = fract(phase / TAU) * TAU;
  const { bar, body, opening } = emberPhrase(clock, phrases);
  const angleSeed = (seed >>> 0) / 4294967296 * TAU + (seed % 257) * .095;
  const puff = (angle: number, age: number, strength: number) => ({
    x: Math.cos(angle), y: Math.sin(angle), age,
    gain: strength * smooth(age / .088) * (1 - smooth((age - .19) / .81)),
  });
  const puffs = SOURCES.map(source => {
    const elapsed = fract(bar - source.beat);
    const lifetime = source.life * (.68 + .43 * persistence);
    const age = Math.min(1, elapsed / lifetime);
    const launch = clock - elapsed * TAU / phrases;
    const angle = source.angle + .35 * Math.sin(angleSeed)
      + .45 * Math.sin(2 * launch + source.angle)
      + .22 * Math.sin(3 * launch + angleSeed - source.angle);
    return puff(angle, age, source.strength);
  });
  if (audio && response > 0) {
    for (const beat of audio.beats) puffs.push(puff(beat.id * 2.39996 + angleSeed,
      Math.min(1, beat.age / (.65 + 1.55 * persistence)), beat.strength * response * 1.5));
  }
  return { puffs, body, opening, clock };
}

export const emberSmokeFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform mat3 uView;
uniform vec2 uClock;
uniform float uAspect,uRadius,uSpread,uOpening,uSeed,uCurl,uLift,uDetail,uBass;
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

// Each vortex is a radial rotation. Backtracing through two opposing vortices
// rolls the density field with no radial compression at the centre of either roll.
vec2 backtraceRoll(vec2 p,vec2 centre,float twist) {
  vec2 d=p-centre;
  float core=1./(1.+dot(d,d)*7.5);
  float angle=twist*core*core;
  float c=cos(angle),s=sin(angle);
  return centre+mat2(c,s,-s,c)*d;
}

void main() {
  vec2 p=((uView*vec3(vUv,1.)).xy-.5)*vec2(uAspect,1.)/max(uRadius,.0001);
  if (dot(p,p)>10.24) { gl_FragColor=vec4(0.); return; }

  vec2 noiseUV=p*3.65+uClock*.48+uSeed;
  vec2 drift=vec2(smokeNoise(noiseUV),smokeNoise(noiseUV+vec2(7.9,19.7)))-.5;
  vec2 q=p+.14*drift;
  vec3 density=vec3(0.);

  for (int i=0; i<${EMBER_SMOKE_SOURCES}; ++i) {
    vec4 puff=uPuffs[i];
    if (puff.w<=0.) continue;
    float age=puff.z;
    vec2 axis=puff.xy, side=vec2(-axis.y,axis.x);
    vec2 origin=q-vec2(.035*sin(float(i)*2.4),uLift*age*age*.85);
    vec2 local=vec2(dot(origin,axis),dot(origin,side));
    float reach=.33+mix(.56,1.42,uSpread)*age;
    vec2 size=vec2(.52+.28*age,.24+.33*age)*(1.+.25*uBass);
    vec2 shape=(local-vec2(reach,0.))/size;
    float radius2=dot(shape,shape);
    if (radius2>1.62) continue;
    float rim=smoothstep(.27,1.38,radius2);
    float mass=puff.w*(1.-smoothstep(.30,1.62,radius2));

    // The jet rolls up at its shear edges, then relaxes as it travels away.
    float turn=uCurl*mix(.27,1.27,smoothstep(.05,.53,age))*(1.-.31*smoothstep(.62,1.,age));
    float shear=sin(float(i)*2.399+uSeed);
    vec2 roll=backtraceRoll(shape,vec2(-.22+.16*shear,.45),4.2*turn);
    roll=backtraceRoll(roll,vec2(.22,-.34-.14*shear),-3.58*turn);
    vec2 flow=roll*vec2(2.85,3.4)+drift*1.2+vec2(-2.1*age, float(i)*8.3);
    float large=smokeNoise(flow);
    float middle=smokeNoise(flow*2.12+large);
    float fine=smokeNoise(flow*4.57+vec2(.7,-2.6)*age);
    float body=.72*large+.46*middle+(.12+.18*uDetail)*fine;
    float erosion=rim*(.14+.10*age);
    float front=smoothstep(.39+erosion,1.01,body);
    // The rear slab has its own folds so the thicker parts can overlap.
    float behind=.74*smokeNoise(flow*.84+vec2(1.42,4.13))+.38*middle+.16*fine;
    float rear=smoothstep(.34+erosion,1.0,behind);
    float edges=smoothstep(.43+erosion,.68+erosion,body)*(1.-smoothstep(.73,.98,body));
    float strands=mix(.65,1.28,smoothstep(.20,.79,fine));
    density+=mass*vec3(front*strands,rear,edges*mix(.30,1.,uDetail)*fine);
  }

  float cavity=mix(1.,smoothstep(.16,.46,length(p)),uOpening);
  gl_FragColor=vec4(density*cavity,1.);
}
`;
