import * as THREE from 'three';
import type { Look, TrackingFeed } from './look';
import type { LiveSettings } from './settings';
import { Passes, type Pair } from './passes';

const columns = 44;
const rows = 72;

// Four travelling crests, in +x, -x, +y and -y. Each transports its own
// height, so opposed gestures can cross without changing each other's course.
const advance = /* glsl */`
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

const bladeVertex = /* glsl */`
attribute float aCentre, aFinish;
uniform sampler2D uState;
uniform float uDepth;
varying vec3 vWorld, vNormal;
varying float vFinish, vTurn;
vec3 bend(vec2 panel, out float angle, out float turn) {
  vec2 st = panel / vec2(16., 9.) + .5;
  // Gather a small neighbourhood so even a narrow moving edge bends a whole section.
  vec2 blur = vec2(.012, .023);
  vec4 f = .4 * texture2D(uState, st)
    + .15 * (texture2D(uState, st + vec2(blur.x, 0.)) + texture2D(uState, st - vec2(blur.x, 0.))
    + texture2D(uState, st + vec2(0., blur.y)) + texture2D(uState, st - vec2(0., blur.y)));
  turn = tanh(1.8 * (f.r - f.g) + 1.5 * (f.b - f.a)) * uDepth;
  float lift = min(1., dot(f, vec4(1.))) * uDepth;
  float spine = panel.y - .24 * panel.x - .8 * sin(panel.x * .55);
  float rest = .19 * exp(-.60 * spine * spine) - .075;
  angle = rest + 1.18 * turn;
  float c = cos(angle), s = sin(angle);
  return vec3(panel.x + position.x*c + position.z*s + .20*turn,
    panel.y, -position.x*s + position.z*c + .80*lift + rest*.5);
}
void main() {
  vec2 panel = vec2(aCentre, position.y);
  float angle, turn, unusedAngle, unusedTurn;
  vWorld = bend(panel, angle, turn);
  vec3 along = bend(panel + vec2(0.,.075), unusedAngle, unusedTurn)
             - bend(panel - vec2(0.,.075), unusedAngle, unusedTurn);
  vec3 across = vec3(normal.z*cos(angle) - normal.x*sin(angle), 0.,
                     -normal.z*sin(angle) - normal.x*cos(angle));
  vNormal = normalize(cross(across, along));
  vFinish = aFinish; vTurn = turn;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vWorld, 1.);
}`;

const bladeFragment = /* glsl */`
varying vec3 vWorld, vNormal;
varying float vFinish, vTurn;
float square(float x) { return x*x; }
void main() {
  vec3 n = normalize(vNormal);
  vec3 r = reflect(vec3(0., 0., -1.), n);
  // Two fixed studio strips. Their reflected shapes follow the actual bent normals.
  float card = r.x + .06*vWorld.x - .033*vWorld.y;
  float softbox = exp(-6.*square(card - .28 + .22*r.y));
  float strip = exp(-110.*square(card + .38 - .35*r.y));
  float warm = exp(-18.*square(card + .72 + .13*r.y));
  float grain = .008*sin(vWorld.x*185.) * (1.-smoothstep(.5, 2., fwidth(vWorld.x)*185.));
  vec3 metal = vec3(.028,.054,.083) + softbox*vec3(.18,.29,.36)
    + strip*vec3(.72,.77,.74) + warm*vec3(.25,.15,.085) + grain;
  vec3 edge = vec3(.11,.14,.17) + (.16 + softbox*.30 + strip*.42) * vec3(.84,.90,.93);
  vec3 enamel = vec3(.40,.040,.013) * (.55 + .45*abs(n.x)) + strip*.16;
  vec3 surface = vFinish < .5 ? metal : (vFinish < 1.5 ? edge : enamel);
  float lip = smoothstep(.18,.82,abs(vTurn));
  if(vFinish < .5) surface += lip * vec3(.23,.044,.009) * (.35 + warm);
  gl_FragColor = vec4(surface, 1.);
}`;

// One instanced extrusion. The crown, chamfers and enamel returns are real
// faces; the camera can see into the gaps when adjacent blades turn apart.
function makeBlades() {
  const pitch = 16 / columns;
  const profile = [[-.49,-.20],[-.49,.015],[-.45,.065],[0,.088],[.45,.065],[.49,.015],[.49,-.20]];
  const finishes = [2, 1, 0, 0, 1, 2];
  const positions: number[] = [], normals: number[] = [], finish: number[] = [], indices: number[] = [];
  for (let face = 0; face < finishes.length; face++) {
    const start = positions.length / 3;
    const [x0,z0] = profile[face], [x1,z1] = profile[face+1];
    for (let row = 0; row <= rows; row++) {
      for (const [x,z] of profile.slice(face, face + 2)) {
        positions.push(x * pitch, 9 * (row / rows - .5), z * pitch);
        // Smooth the crowned front across its centre, keep the bevel edges crisp.
        normals.push(finishes[face] === 0 && x === 0 ? 0 : z0-z1, 0, x1-x0);
        finish.push(finishes[face]);
      }
      if (row < rows) {
        const i = start + 2 * row;
        indices.push(i, i+1, i+2, i+2, i+1, i+3);
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aFinish', new THREE.Float32BufferAttribute(finish, 1));
  g.setAttribute('aCentre', new THREE.InstancedBufferAttribute(Float32Array.from({ length: columns }, (_, i) => (i + .5) * pitch - 8), 1));
  g.setIndex(indices);
  g.instanceCount = columns;
  return g;
}

export class Relief implements Look {
  private readonly field: Pair;
  private readonly advance: THREE.ShaderMaterial;
  private readonly zero: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, .1, 25);
  private readonly geometry = makeBlades();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: bladeVertex, fragmentShader: bladeFragment,
    uniforms: { uState: { value: null }, uDepth: { value: 1 } },
  });
  private readonly target: THREE.WebGLRenderTarget;

  constructor(private readonly passes: Passes, width: number, height: number) {
    this.field = passes.pair(160, 90);
    this.advance = passes.material(advance, { uState: { value: null }, uFlow: { value: null }, uStep: { value: 0 },
      uReach: { value: 0 }, uSettle: { value: 1 }, uFresh: { value: 0 } });
    this.zero = passes.material('void main(){gl_FragColor = vec4(0.);}', {});
    this.target = passes.target(width, height);
    this.target.depthBuffer = true;
    this.target.samples = Math.min(4, passes.renderer.capabilities.maxSamples);
    this.scene.background = new THREE.Color(0x15202c);
    this.camera.position.z = 10;
    const blades = new THREE.Mesh(this.geometry, this.material);
    blades.frustumCulled = false;
    this.scene.add(blades);
    this.clear();
  }

  get output() { return this.target.texture; }

  step(seconds: number, _time: number, feed: TrackingFeed, settings: LiveSettings) {
    const u = this.advance.uniforms;
    u.uState.value = this.field.read.texture;
    u.uFlow.value = feed.flow;
    u.uFresh.value = feed.fresh ? 1 : 0;
    u.uStep.value = seconds;
    u.uReach.value = settings.relief.reach;
    u.uSettle.value = settings.relief.settle;
    this.passes.draw(this.advance, this.field.write);
    this.field.swap();
    this.material.uniforms.uState.value = this.field.read.texture;
    this.material.uniforms.uDepth.value = settings.relief.depth;
    const renderer = this.passes.renderer;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera); // A solid Scene.background clears depth as well as colour.
  }

  resize(width: number, height: number) { this.target.setSize(width, height); }
  clear() { this.passes.draw(this.zero, this.field.read); this.passes.draw(this.zero, this.field.write); }
  dispose() {
    this.field.dispose(); this.advance.dispose(); this.zero.dispose();
    this.material.dispose(); this.geometry.dispose(); this.target.dispose();
  }
}
