import * as THREE from 'three';

/**
 * A torus has two periodic coordinates. Encoding them explicitly avoids the
 * pinched poles that result from trying to turn the existing sphere into a ring.
 * The colour and shadow vertices both run the same deformation below.
 */
export function createSculptureTorusGeometry(): THREE.BufferGeometry {
  const rings = 320;
  const sides = 192;
  const vertices = new Float32Array((rings + 1) * (sides + 1) * 3);
  const normals = new Float32Array(vertices.length);
  const uv = new Float32Array((rings + 1) * (sides + 1) * 2);
  const indices = new Uint32Array(rings * sides * 6);
  let index = 0;
  for (let ring = 0; ring <= rings; ring++) {
    for (let side = 0; side <= sides; side++) {
      const vertex = ring * (sides + 1) + side;
      vertices[vertex * 3] = ring / rings * Math.PI * 2;
      vertices[vertex * 3 + 1] = side / sides * Math.PI * 2;
      normals[vertex * 3 + 2] = 1;
      // The film texture has a vertical colour gradient, so wrapping plain UVs
      // would introduce a material seam even though the surface itself closes.
      uv[vertex * 2] = .5 + .5 * Math.cos(ring / rings * Math.PI * 2);
      uv[vertex * 2 + 1] = .5 + .5 * Math.cos(side / sides * Math.PI * 2);
      if (ring < rings && side < sides) {
        const a = vertex, b = vertex + sides + 1, c = b + 1, d = a + 1;
        // du cross dv points outwards for both the ribbon and trefoil frames.
        indices.set([a, b, d, b, c, d], index);
        index += 6;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

export const sculptureDeformation = /* glsl */`
uniform float studioPhase, studioFold, studioRidges, studioBreath, studioSeed;
uniform float studioOpening, studioTwist;
uniform float studioForm, studioLobes, studioThickness, studioStretch;
uniform float studioCurl, studioFoldFrequency, studioAsymmetry, studioRidgeScale;
const float STUDIO_TAU = 6.283185307179586;

vec3 studioSafeNormal(vec3 v, vec3 fallback) {
  float size=dot(v,v);
  return size>1.e-16?v*inversesqrt(size):fallback;
}

// Blending adjacent integer harmonics keeps the toroidal seams closed even
// while a continuous frequency control is being animated.
float studioWave(float angle, float frequency, float offset) {
  float base=floor(frequency);
  float blend=smoothstep(0.,1.,fract(frequency));
  return mix(sin(base*angle+offset),sin((base+1.)*angle+offset),blend);
}

float studioCosine(float angle, float frequency, float offset) {
  float base=floor(frequency);
  float blend=smoothstep(0.,1.,fract(frequency));
  return mix(cos(base*angle+offset),cos((base+1.)*angle+offset),blend);
}

vec3 studioShell(vec3 n, float seed, float breathing, float opening) {
  vec2 uv=n.xy;
  float r2=dot(uv,uv);
  float angle=atan(uv.y,uv.x+.000001);
  float edge;
  // The default is the original shell, including its existing authored presets.
  if(abs(studioLobes-6.)<.0001) {
    edge=1.+pow(r2,1.8)*(.13*cos(3.*angle+seed*.18)+.065*sin(5.*angle-.7));
  } else {
    edge=1.+pow(r2,1.8)*(.13*studioCosine(angle,studioLobes*.5,seed*.18)
      +.065*studioWave(angle,studioLobes*5./6.,-.7));
  }
  float spread=mix(.76,1.15,opening);
  float curl=mix(1.43,.32,opening)*exp((studioCurl-.5)*1.2);
  float u=uv.x*edge;
  float v=uv.y*edge;
  vec3 p=vec3(sin(u*curl)/curl*spread, v*1.08,
    (1.-cos(u*curl))/curl*.85+n.z*.105*(.35+studioThickness*1.3));
  float fold=u*(9.2+1.35*v)*studioFoldFrequency+1.45*sin(v*2.2+seed)+.28*v*v;
  float pleat=sin(fold)+.22*sin(2.*fold+.3);
  float envelope=.66+.34*sqrt(max(0.,1.-n.y*n.y));
  p.z+=studioFold*(.45+.13*opening)*pleat*envelope;
  p.z+=studioFold*.18*sin(u*3.4+v*4.1+seed*.45);
  p.z+=.26*(u*u-v*v)+.14*v;
  p.y+=studioFold*.06*sin(u*4.2+seed)*(1.-uv.y*uv.y);
  p.z+=studioRidges*.005*sin((u*49.+v*12.+1.7*sin(v*4.+seed))*studioRidgeScale);
  float twist=studioTwist*(v*.85+.18*sin(u*2.)) + breathing*.18*sin(v*1.6+studioPhase);
  p.xz=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*p.xz;
  p*=1.+breathing*.07;
  return p;
}

vec3 studioBloom(vec3 n, float seed, float breathing, float opening) {
  float r=length(n.xy), r2=r*r;
  float angle=atan(n.y,n.x+.000001);
  float petal=cos(studioLobes*angle+seed*.12);
  // R=r*(1+a*r^3*cos(lobes*angle)) stays strictly increasing in r:
  // its smallest radial derivative is 1-4a, at least .04 here.
  float scallop=1.+(.12+.12*studioFold)*pow(r2,1.5)*petal;
  float spread=.78+.24*opening;
  vec3 p=vec3(n.xy*scallop*spread,
    n.z*(.055+.19*studioThickness));
  // A closed bowl rises into overlapping-looking petals without open edges.
  p.z+=(.48-.45*opening)*r2;
  p.z+=(.065+.16*studioCurl)*r2*petal;
  p.z+=studioFold*.11*r2*sin(r*(12.+3.*sin(angle*studioLobes+seed))*studioFoldFrequency
    +.7*petal+seed*.35);
  p.z+=studioRidges*.0035*r2*sin(r*64.*studioRidgeScale+2.*petal);
  // Twist the already scalloped disc by its own radius. A radial rotation is
  // invertible; twisting by the original sphere radius can fold narrow petals
  // over each other. Both faces must share XY and differ only by thickness.
  float shapedRadius2=dot(p.xy,p.xy)/(spread*spread);
  float twist=(studioTwist*.9+(.5-studioCurl)*.22)*shapedRadius2;
  p.xy=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*p.xy;
  p.z+=breathing*.035*r2*(.4+petal);
  p*=1.+breathing*.07;
  return p;
}

vec3 studioRibbon(vec2 uv, float seed, float breathing, float opening) {
  float u=uv.x, v=uv.y;
  float lobes=studioCosine(u,studioLobes,seed*.1);
  float ripple=studioWave(u,6.*studioFoldFrequency,seed*.4);
  float broad=studioWave(u,3.,seed*.2);
  float radius=.69+.13*opening+studioFold*.04*lobes;
  float width=.19+.065*(1.-opening);
  // Roll the ribbon across its width, then use a genuinely closed cross-section.
  float roll=studioTwist*.55*studioWave(u,2.,seed*.1)+(studioCurl-.5)*1.5
    +breathing*.11*broad;
  float radial=width*cos(v);
  float vertical=(.025+.115*studioThickness)*sin(v);
  vec2 section=mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*vec2(radial,vertical);
  float corrugation=studioFold*.065*ripple*(.45+.55*cos(v)*cos(v));
  float radialRidge=studioRidges*.0025*studioWave(u,36.*studioRidgeScale,1.2*sin(v)+seed);
  vec3 p=vec3((radius+section.x+radialRidge)*cos(u),
    (radius+section.x+radialRidge)*sin(u),section.y+corrugation);
  p.z+=(.025+.09*studioCurl)*broad;
  p*=1.+breathing*.055;
  return p;
}

vec3 studioKnotCenter(float u, float opening) {
  float minor=.18+.06*(1.-opening);
  float radius=.58+minor*cos(3.*u);
  return vec3(radius*cos(2.*u),radius*sin(2.*u),minor*1.3*sin(3.*u));
}

vec3 studioKnot(vec2 uv, float seed, float breathing, float opening) {
  float u=uv.x, v=uv.y;
  vec3 center=studioKnotCenter(u,opening);
  float minor=.18+.06*(1.-opening);
  float radius=.58+minor*cos(3.*u);
  vec3 tangent=studioSafeNormal(vec3(-3.*minor*sin(3.*u)*cos(2.*u)-2.*radius*sin(2.*u),
    -3.*minor*sin(3.*u)*sin(2.*u)+2.*radius*cos(2.*u),3.9*minor*cos(3.*u)),vec3(0,1,0));
  // The radial vector is never parallel to the tangent. Its periodic frame has
  // no Frenet flips, and closes exactly after one trip around the trefoil.
  vec3 radial=vec3(cos(2.*u),sin(2.*u),0.);
  vec3 axis=studioSafeNormal(radial-tangent*dot(radial,tangent),radial);
  vec3 across=cross(axis,tangent);
  float roll=studioTwist*studioWave(u,studioLobes,seed*.1)*.65+(studioCurl-.5)*1.4;
  float sectionAngle=v+roll;
  float radiusTube=(.06+.085*studioThickness)*(1.+studioFold*.16*studioWave(u,6.*studioFoldFrequency,seed*.4));
  float ribs=1.+studioRidges*.015*studioWave(u,42.*studioRidgeScale,2.*sin(v)+seed);
  float ellipse=1.15+(studioCurl-.5)*.55;
  // Keep opposite knot strands apart even with maximum thickness, curl and
  // fold. Authored middle-range shapes do not reach this safety envelope.
  radiusTube=min(radiusTube*ribs,minor*.82/max(ellipse,1./ellipse));
  vec3 p=center+radiusTube*(cos(sectionAngle)*axis*ellipse+sin(sectionAngle)*across/ellipse);
  p.z+=breathing*.025*sin(3.*u);
  p*=1.+breathing*.045;
  return p;
}

vec3 studioDeform(vec3 source) {
  float seed=mod(studioSeed,97.)*.17;
  float breathing=studioBreath*sin(studioPhase);
  float opening=studioOpening+breathing*.35*min(studioOpening,1.-studioOpening);
  vec3 p;
  if(studioForm<.5) p=studioShell(normalize(source),seed,breathing,opening);
  else if(studioForm<1.5) p=studioBloom(normalize(source),seed,breathing,opening);
  else if(studioForm<2.5) p=studioRibbon(source.xy,seed,breathing,opening);
  else p=studioKnot(source.xy,seed,breathing,opening);
  p.y*=studioStretch;
  // A low-frequency shear changes the silhouette without breaking either seam.
  p.x+=studioAsymmetry*.2*(p.y*p.y-.24);
  p.z+=studioAsymmetry*.12*p.y*(.5+sin(seed));
  return p;
}

vec3 studioSourceCoordinates(vec3 source) {
  if(studioForm<1.5) return normalize(source);
  return vec3(cos(source.x),sin(source.x),cos(source.y));
}

vec3 studioNormal(vec3 source) {
  float epsilon=.0006;
  if(studioForm>1.5) {
    vec3 a=studioDeform(source+vec3(epsilon,0,0))-studioDeform(source-vec3(epsilon,0,0));
    vec3 b=studioDeform(source+vec3(0,epsilon,0))-studioDeform(source-vec3(0,epsilon,0));
    return studioSafeNormal(cross(a,b),vec3(cos(source.x)*cos(source.y),sin(source.x)*cos(source.y),sin(source.y)));
  }
  vec3 n=normalize(source);
  vec3 tangent=normalize(cross(abs(n.y)>.98?vec3(1,0,0):vec3(0,1,0),n));
  vec3 bitangent=cross(n,tangent);
  vec3 a=studioDeform(normalize(n+tangent*epsilon))-studioDeform(normalize(n-tangent*epsilon));
  vec3 b=studioDeform(normalize(n+bitangent*epsilon))-studioDeform(normalize(n-bitangent*epsilon));
  return studioSafeNormal(cross(a,b),n);
}
`;

export const sculptureDetail = /* glsl */`
varying vec3 studioSource;
uniform float studioRidges, studioSeed, studioRidgeScale;
vec3 studioDetailNormal(vec3 position, vec3 normal) {
  float seed=mod(studioSeed,97.)*.17;
  float ridge=(studioSource.x*138.+studioSource.y*27.+2.4*sin(studioSource.y*5.+seed))*studioRidgeScale;
  float bandlimit=1.-smoothstep(.45,1.4,fwidth(ridge));
  float slope=studioRidges*.00085*cos(ridge)*bandlimit;
  vec2 dh=slope*vec2(dFdx(ridge),dFdy(ridge));
  vec3 dx=dFdx(position), dy=dFdy(position);
  vec3 r1=cross(dy,normal), r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=(dh.x*r1+dh.y*r2)*sign(det)/max(abs(det),1.e-10);
  return normalize(normal-gradient);
}
`;
