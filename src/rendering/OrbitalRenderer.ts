import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ORBIT_CHOICES, ORBIT_CAPACITY, ORBIT_TAU, orbitFade, type OrbitalClock } from '../core/orbital';
import type { Layer } from '../shared/types';
import { advanceOrbitPhase, blendOrbit, makeOrbitPose, orbitEase, orbitLoopPhase, orbitMorphProgress, sampleOrbit, waveOrder, type OrbitPhase, type OrbitPose } from './orbit-motion';
import { OrbitAppearance } from './orbit-appearance';
import { blendOrbitView, orbitDetailGain, orbitView, ORBIT_FOV, ORBIT_TAN_HALF_FOV, type OrbitView } from './orbit-projection';
import { sourceViewMatrix } from './source-view';

const fullscreen = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;
const backdropFragment = /* glsl */ `
varying vec2 vUv;
uniform mat3 uView;
uniform vec3 uGround, uLight, uDark, uFace;
uniform float uAspect, uDensity, uContrast, uRotation, uPhase, uLinkedPhase, uLink, uOpacity;
uniform float uModes[10];
uniform float uFocus, uFocusRadius, uDetail;

float mark(float d, float radius, float aa) {
  return 1. - smoothstep(radius-aa, radius+aa, d);
}
vec3 pattern(int mode, vec2 cell, float aa, float phase) {
  vec2 q = fract(cell) - .5;
  float r = length(q);
  float diamond = abs(q.x) + abs(q.y);
  if (mode == 1 || mode == 7) return uGround;
  if (mode == 2) {
    vec3 ink = mix(uDark, uLight, mark(r, .42, aa));
    ink = mix(ink, uDark, mark(r, .34, aa));
    ink = mix(ink, uLight, mark(r, .25, aa));
    return mix(ink, uFace, mark(r, .15, aa));
  }
  if (mode == 3) return mix(uLight, uFace, mark(r, .415, aa));
  if (mode == 4) {
    vec3 ink = mix(uGround, uLight, mark(diamond, .225, aa));
    return mix(ink, uDark, mark(diamond, .08, aa));
  }
  if (mode == 5) {
    vec2 f = smoothstep(vec2(.5-aa), vec2(.5+aa), fract(cell*.5));
    return mix(uLight, uDark, f.x+f.y-2.*f.x*f.y);
  }
  if (mode == 6) return mix(uGround, uDark, smoothstep(.1, .86, length((vUv-.5)*vec2(uAspect, 1.))));
  if (mode == 8) {
    float sweep = cell.y*.62 + .93*sin(cell.x*.28+sin(phase)*.7) + .27*cos(cell.x*.56 - phase);
    float line = mark(abs(fract(sweep) - .5), .082, aa);
    return mix(uGround, uLight, line*.62);
  }
  if (mode == 9) {
    vec2 strand = abs(fract(cell + vec2(.16*sin(phase), .16*cos(phase))) - .5);
    float crossing = mod(floor(cell.x)+floor(cell.y), 2.);
    float threads = mix(mark(strand.x, .14, aa), mark(strand.y, .14, aa), crossing);
    return mix(uGround, mix(uDark,uLight,crossing), threads*.78);
  }
  float stage = fract(phase / 6.28318530718) * 4.;
  float travel = stage + .42 * sin(cell.x*.3 + cell.y*.25 + phase) * sin(phase);
  float cycle = mod(travel, 4.);
  float fill = .5+.5*cos(phase);
  float outer = mix(.19, .445, fill);
  vec3 rings = mix(uDark, uLight, mark(r, outer, aa));
  rings = mix(rings, uDark, mark(r, outer*.77, aa));
  rings = mix(rings, uFace, mark(r, outer*.54, aa));
  rings = mix(rings, uLight, mark(r, outer*.25, aa));
  vec3 dots = mix(uLight, uFace, mark(r, mix(.23, .46, fill), aa));
  vec3 small = mix(uGround, uDark, mark(diamond, mix(.034, .2, fill), aa));
  small = mix(small, uLight, mark(diamond, .1*fill, aa));
  if (cycle < 1.) return mix(rings, dots, smoothstep(.2, .86, cycle));
  if (cycle < 2.) return mix(dots, small, smoothstep(1.17, 1.87, cycle));
  if (cycle < 3.) return mix(small, uGround, smoothstep(2.12, 2.7, cycle));
  return mix(uGround, rings, smoothstep(3.18, 3.94, cycle));
}
void main() {
  vec2 p = ((uView * vec3(vUv, 1.)).xy-.5)*vec2(uAspect, 1.);
  float c = cos(uRotation), s = sin(uRotation);
  vec2 cell = mat2(c,-s,s,c)*p*uDensity+.5;
  vec2 footprint = fwidth(cell);
  float spacing = max(footprint.x, footprint.y);
  float aa = clamp(spacing * mix(.7, 1.18, uDetail), .002, .24);
  vec3 ink = vec3(0.);
  for (int i = 0; i < 10; i++) {
    if (i != 7 && uModes[i] > .00001) {
      vec3 free = pattern(i, cell, aa, uPhase);
      if ((i == 0 || i >= 8) && uLink > .00001) free = mix(free, pattern(i, cell, aa, uLinkedPhase), uLink);
      ink += free * uModes[i];
    }
  }
  float opaque = 1. - uModes[7];
  ink = mix(uGround * opaque, ink, uContrast * (1. - smoothstep(.13, .38, spacing)));
  gl_FragColor = vec4(ink*uOpacity, opaque*uOpacity);
}
`;
const pieceVertex = /* glsl */ `
attribute float orbitBand;
varying vec3 vLocal, vNormal, vEye;
varying float vBand;
void main() {
  mat3 model = mat3(instanceMatrix);
  vec3 corrected = vec3(normal.x/max(.0000001,dot(model[0],model[0])), normal.y/max(.0000001,dot(model[1],model[1])), normal.z/max(.0000001,dot(model[2],model[2])));
  vec4 view = modelViewMatrix * instanceMatrix * vec4(position, 1.);
  vNormal = normalize(normalMatrix * model * corrected);
  vEye = -view.xyz;
  vLocal = vec3(position.xy, position.z * 1.7);
  vBand = orbitBand;
  gl_Position = projectionMatrix * view;
}
`;
const pieceFragment = /* glsl */ `
varying vec3 vLocal, vNormal, vEye;
varying float vBand;
uniform vec3 uFace, uCap, uInk, uLightDirection;
uniform float uCapSize, uRim, uPhase, uBlend, uDetail;
uniform float uFinish[4];
vec3 colour(float offset) {
  float value = mod(vBand + offset + uPhase, 3.);
  vec3 a = value < 1. ? uFace : value < 2. ? uCap : uInk;
  vec3 b = value < 1. ? uCap : value < 2. ? uInk : uFace;
  float blend = max(.03, uBlend);
  return mix(a, b, smoothstep(1.-blend,1.,fract(value)));
}
void main() {
  vec3 n = normalize(vNormal), eye = normalize(vEye);
  vec3 local = normalize(vLocal+vec3(.00001));
  float plane = dot(local, normalize(vec3(.8,.2,.88)));
  float cap = mix(.97, -.28, uCapSize);
  float capEdge = max(.004, fwidth(plane));
  vec3 pigment = mix(colour(0.), colour(1.), smoothstep(cap-capEdge, cap+capEdge, plane));
  float spot = smoothstep(.94-fwidth(plane),.94+fwidth(plane),plane);
  pigment = mix(pigment, colour(2.), spot * .9);
  float facing = max(0., dot(n, eye));
  float rimWidth = uRim * 2.;
  float edge = fwidth(facing) * uDetail;
  float rim = (1. - smoothstep(rimWidth*.65-edge, rimWidth+.015+edge, facing)) * smoothstep(0., .03, uRim);
  pigment = mix(pigment, uInk, rim);
  float diffuse = .68+.32*max(0., dot(n, uLightDirection));
  float specular = pow(max(0.,dot(n,normalize(uLightDirection+eye))), 33.);
  float longSpec = pow(max(0.,dot(n,normalize(vec3(-.55,.24,1.)+eye))), 8.);
  float base = (uFinish[0]+uFinish[2])*diffuse + uFinish[1]*(.81+.19*smoothstep(.81,.85,diffuse))
    + uFinish[3]*(.48+.5*diffuse+.24*longSpec);
  float shine = specular * (.25*uFinish[0]+.48*uFinish[3]) + longSpec*(.045*uFinish[0]+.16*uFinish[2]+.27*uFinish[3]);
  gl_FragColor = vec4(pigment*base+shine*(1.-rim), 1.);
}
`;

const contactVertex = /* glsl */ `
attribute float shadowOpacity;
varying vec2 vUv;
varying float vOpacity;
void main() {
  vUv = uv; vOpacity = shadowOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}
`;
const contactFragment = /* glsl */ `
varying vec2 vUv;
varying float vOpacity;
uniform vec3 uTint;
void main() {
  vec2 p = (vUv-.5)*2.;
  float r = dot(p,p);
  float a = vOpacity * exp(-2.9*r) * (1.-smoothstep(.58,1.,r));
  gl_FragColor = vec4(uTint*a,a);
}
`;
const BACKDROPS = ORBIT_CHOICES.orbitBackdrop.length;

interface FrameState {
  elapsed: number;
  transition: number;
  phase: OrbitPhase;
  cueStart: number;
  playback: number;
  signature: string;
  count: number;
  poses: OrbitPose[];
  from: OrbitPose[];
  morphStart: number;
  morphEnd: number;
  outgoing: Record<string, number> | null;
  previous: Record<string, number>;
  appearance: OrbitAppearance;
  shownView: OrbitView;
  viewFrom: OrbitView;
  viewStart: number;
  aspect: number;
  shapeWeights: number[];
  shapesFrom: number[];
  piece: number;
  pieceStart: number;
  backdropWeights: number[];
  backdropFrom: number[];
  backdrop: number;
  backdropStart: number;
}
const weights = (length: number, at: number) => Array.from({ length }, (_, index) => Number(index === at));
function moveWeights(out: number[], from: number[], at: number, t: number): void {
  for (let i = 0; i < out.length; i++) out[i] = from[i] * (1 - t) + Number(i === at) * t;
}

export class OrbitalRenderer {
  private readonly camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, .1, 10);
  private readonly screen = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly backdropScene = new THREE.Scene();
  private readonly overScene = new THREE.Scene();
  private readonly screenGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly groundGeometry = new THREE.PlaneGeometry(256, 256);
  private readonly groundMaterial = new THREE.ShadowMaterial({ color: '#10182e', opacity: .56, depthWrite: false });
  private readonly light = new THREE.DirectionalLight(0xffffff, 1);
  private readonly view = new THREE.Matrix3();
  private readonly inverseView = new THREE.Matrix3();
  private readonly clip = new THREE.Matrix4();
  private readonly object = new THREE.Object3D();
  private readonly pose = makeOrbitPose();
  private readonly outgoingPose = makeOrbitPose();
  private readonly swatch = new THREE.Color();
  private readonly contactGeometry = new THREE.PlaneGeometry(2,2);
  private readonly contactOpacity = new THREE.InstancedBufferAttribute(new Float32Array(ORBIT_CAPACITY), 1);
  private readonly contactMaterial = new THREE.ShaderMaterial({
    name: 'Orbital soft contact shadows', vertexShader: contactVertex, fragmentShader: contactFragment,
    transparent: true, premultipliedAlpha: true, depthWrite: false, uniforms: { uTint: { value: new THREE.Color('#10182e') } },
  });
  private readonly contact = new THREE.InstancedMesh(this.contactGeometry, this.contactMaterial, ORBIT_CAPACITY);
  private readonly layers = new Map<string, FrameState>();
  private isolation: THREE.WebGLRenderTarget | null = null;
  private readonly backdropMaterial = new THREE.ShaderMaterial({
    name: 'Orbital backdrop',
    vertexShader: fullscreen, fragmentShader: backdropFragment,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: {
      uView: { value: this.view }, uAspect: { value: 1 }, uDensity: { value: 21 }, uContrast: { value: .9 },
      uRotation: { value: 0 }, uPhase: { value: 0 }, uLinkedPhase: { value: 0 }, uLink: { value: 0 }, uOpacity: { value: 1 },
      uModes: { value: weights(BACKDROPS, 0) },
      uFocus: { value: 0 }, uFocusRadius: { value: .2 }, uDetail: { value: 0 },
      uGround: { value: new THREE.Color() }, uLight: { value: new THREE.Color() }, uDark: { value: new THREE.Color() }, uFace: { value: new THREE.Color() },
    },
  });
  private readonly over = new THREE.ShaderMaterial({
    name: 'Orbital fade',
    vertexShader: fullscreen, fragmentShader: 'varying vec2 vUv; uniform sampler2D uImage; uniform float uGain; void main() { gl_FragColor = texture2D(uImage,vUv)*uGain; }',
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
    uniforms: { uImage: { value: null }, uGain: { value: 1 } },
  });
  private readonly material = new THREE.ShaderMaterial({
    name: 'Orbital pieces',
    vertexShader: pieceVertex, fragmentShader: pieceFragment,
    uniforms: {
      uFace: { value: new THREE.Color() }, uCap: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
      uLightDirection: { value: new THREE.Vector3() }, uCapSize: { value: .42 }, uRim: { value: .11 },
      uPhase: { value: 0 }, uBlend: { value: .08 }, uFinish: { value: weights(4, 0) }, uDetail: { value: 0 },
    },
  });
  private readonly batches: THREE.InstancedMesh[];

  constructor() {
    const disc = new THREE.SphereGeometry(1, 32, 16).scale(1, 1, .34);
    const dome = new THREE.SphereGeometry(1, 32, 16).scale(1, 1, .59);
    const ball = new THREE.SphereGeometry(1, 28, 18);
    const ring = new THREE.TorusGeometry(.73, .24, 12, 32);
    const tile = new RoundedBoxGeometry(1.7, 1.7, .66, 3, .29);
    const capsule = new THREE.CapsuleGeometry(.56, .84, 8, 24).scale(1, 1, .85);
    const satellite = new THREE.SphereGeometry(1, 16, 10);
    this.batches = [disc, dome, ball, ring, tile, capsule, satellite].map(geometry => {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(ORBIT_CAPACITY), 1);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('orbitBand', attribute);
      const mesh = new THREE.InstancedMesh(geometry, this.material, ORBIT_CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      return mesh;
    });
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    Object.assign(this.light.shadow.camera, { left: -1.05, right: 1.05, top: 1.05, bottom: -1.05, near: .1, far: 5 });
    this.light.shadow.camera.updateProjectionMatrix();
    this.light.shadow.bias = -.0004;
    const ground = new THREE.Mesh(this.groundGeometry, this.groundMaterial);
    ground.receiveShadow = true;
    this.contactGeometry.setAttribute('shadowOpacity', this.contactOpacity.setUsage(THREE.DynamicDrawUsage));
    this.contact.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.contact.frustumCulled = false;
    this.contact.count = 0;
    this.scene.add(this.light, ground, this.contact);
    this.backdropScene.add(new THREE.Mesh(this.screenGeometry, this.backdropMaterial));
    this.overScene.add(new THREE.Mesh(this.screenGeometry, this.over));
  }

  reset(): void { this.layers.clear(); }

  keep(ids: ReadonlySet<string>): void {
    for (const id of this.layers.keys()) if (!ids.has(id)) this.layers.delete(id);
  }

  private animate(layer: Layer, phase: number, view: OrbitView, aspect: number, clock?: OrbitalClock): FrameState | undefined {
    if (!clock) return undefined;
    const { motion: elapsed, transition } = clock;
    const p = layer.params, signature = [p.orbitLayout, p.orbitMotion, p.orbitCount, p.orbitArms, p.orbitOrder, p.orbitColourMode, p.orbitRecall].join(':');
    let state = this.layers.get(layer.id);
    if (!state || elapsed < state.elapsed || transition < state.transition) {
      // A seek reconstructs the phase from a known origin. Subsequent speed changes integrate from here.
      state = {
        elapsed, transition, phase: advanceOrbitPhase(orbitLoopPhase(p, 0), p, elapsed), cueStart: 0, playback: p.orbitPlayback,
        signature, count: p.orbitCount, poses: Array.from({ length: ORBIT_CAPACITY }, makeOrbitPose),
        from: Array.from({ length: ORBIT_CAPACITY }, makeOrbitPose), morphStart: -Infinity, morphEnd: -Infinity, outgoing: null, previous: p,
        appearance: new OrbitAppearance(layer.palette, p.orbitFinish, transition),
        shownView: view, viewFrom: view, viewStart: -Infinity, aspect,
        shapeWeights: weights(6, p.orbitPiece), shapesFrom: weights(6, p.orbitPiece), piece: p.orbitPiece, pieceStart: -Infinity,
        backdropWeights: weights(BACKDROPS, p.orbitBackdrop), backdropFrom: weights(BACKDROPS, p.orbitBackdrop), backdrop: p.orbitBackdrop, backdropStart: -Infinity,
      };
      this.layers.set(layer.id, state);
      return state;
    }
    if (state.playback !== p.orbitPlayback) {
      if (p.orbitPlayback === 2) state.cueStart = elapsed;
      if (state.playback === 1) state.phase = orbitLoopPhase(p, phase);
      state.playback = p.orbitPlayback;
    }
    if (signature !== state.signature || state.piece !== p.orbitPiece || state.backdrop !== p.orbitBackdrop) {
      state.viewFrom = state.shownView;
      state.viewStart = transition;
    }
    if (signature !== state.signature) {
      state.signature = signature;
      state.outgoing = transition >= state.morphEnd ? state.previous : null;
      state.morphStart = transition;
      state.morphEnd = transition + p.orbitMorph;
      for (let i = 0; i < ORBIT_CAPACITY; i++) Object.assign(state.from[i], state.poses[i]);
      state.count = Math.max(state.count, p.orbitCount);
    }
    if (state.piece !== p.orbitPiece) {
      state.piece = p.orbitPiece;
      state.pieceStart = transition;
      state.shapesFrom.splice(0, 6, ...state.shapeWeights);
    }
    if (state.backdrop !== p.orbitBackdrop) {
      state.backdrop = p.orbitBackdrop;
      state.backdropStart = transition;
      state.backdropFrom.splice(0, BACKDROPS, ...state.backdropWeights);
    }
    state.phase = advanceOrbitPhase(state.phase, p, elapsed - state.elapsed);
    state.elapsed = elapsed;
    state.transition = transition;
    state.previous = p;
    return state;
  }

  private stamp(mesh: THREE.InstancedMesh, pose: OrbitPose, size: number, aspect: number, satellite = false): void {
    if (size < .0004) return;
    this.object.position.set(pose.x, pose.y, pose.z);
    if (satellite) {
      this.object.position.x += Math.cos(pose.angle + .8) * pose.size * 1.42;
      this.object.position.y += Math.sin(pose.angle + .8) * pose.size * 1.42;
      this.object.position.z += pose.size * .36;
    }
    this.object.rotation.set(pose.roll, pose.tilt, pose.angle, 'ZYX');
    this.object.scale.set(size * aspect, size, size);
    this.object.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.object.matrix);
    (mesh.geometry.getAttribute('orbitBand') as THREE.InstancedBufferAttribute).setX(mesh.count++, pose.band + Number(satellite));
  }

  private stampContact(pose: OrbitPose, params: Record<string, number>): void {
    if (pose.size < .001) return;
    const offset = pose.z * (.44 + .2 * params.orbitSoftness);
    const radius = pose.size * (1 + .4 * params.orbitAspect) + pose.z * (.12 + .55 * params.orbitSoftness);
    this.object.position.set(pose.x - offset * Math.cos(params.orbitLight), pose.y - offset * Math.sin(params.orbitLight), .003);
    this.object.rotation.set(0, 0, params.orbitLight);
    this.object.scale.set(radius * (1.12 + .24 * params.orbitSoftness), radius, 1);
    this.object.updateMatrix();
    this.contact.setMatrixAt(this.contact.count, this.object.matrix);
    const density = Math.min(1, pose.size / (radius * .55));
    this.contactOpacity.setX(this.contact.count++, density * params.orbitShadows * .56);
  }

  draw(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, layer: Layer, phase: number, duration: number, width: number, height: number, clock?: OrbitalClock, playing = true): void {
    const p = layer.params, aspect = width / height;
    const authoredView = orbitView(p, aspect);
    const softContact = p.orbitShadowModel === 1 && p.orbitShadows > 0;
    const state = this.animate(layer, phase, authoredView, aspect, clock);
    const time = p.orbitPlayback === 1 ? orbitLoopPhase(p, phase)
      : state?.phase ?? advanceOrbitPhase(orbitLoopPhase(p, 0), p, phase / ORBIT_TAU * duration);
    const seconds = clock && clock.motion - (state?.cueStart ?? 0);
    const gain = orbitFade(layer, phase, duration, seconds);
    const backgroundGain = p.orbitFadeTarget === 2 ? 1 : gain;
    const pieceGain = p.orbitFadeTarget === 1 ? 1 : gain;
    const progress = (start: number) => !playing || p.orbitMorph <= 0 ? 1 : ((clock?.transition ?? 0) - start) / p.orbitMorph;
    const morph = state ? Math.min(1, progress(state.morphStart)) : 1;
    const frame = state && progress(state.viewStart) < 1
      ? blendOrbitView(state.viewFrom, authoredView, orbitEase(progress(state.viewStart)), state.aspect === aspect)
      : authoredView;
    const { distance, tilt } = frame;
    const pixelsPerUnit = height / (2 * distance * ORBIT_TAN_HALF_FOV);
    const shapeWeights = state?.shapeWeights ?? weights(6, p.orbitPiece);
    const backdropWeights = state?.backdropWeights ?? weights(BACKDROPS, p.orbitBackdrop);
    if (state) {
      if (state.aspect !== aspect) state.viewFrom = {...state.viewFrom, distance: authoredView.distance};
      state.aspect = aspect;
      state.shownView = frame;
      moveWeights(shapeWeights, state.shapesFrom, p.orbitPiece, orbitEase(progress(state.pieceStart)));
      moveWeights(backdropWeights, state.backdropFrom, p.orbitBackdrop, orbitEase(progress(state.backdropStart)));
      if (morph === 1) { state.count = p.orbitCount; state.outgoing = null; }
      state.appearance.update(layer.palette, p.orbitFinish, state.transition, playing ? p.orbitPaletteTime : 0);
    }
    for (const mesh of this.batches) mesh.count = 0;
    this.contact.count = 0;
    if (pieceGain > .00001) for (let i = 0; i < (state?.count ?? p.orbitCount); i++) {
      sampleOrbit(this.pose, i, p, time);
      const pose = state?.poses[i] ?? this.pose;
      if (state) {
        const step = Math.floor(i / p.orbitArms);
        const order = waveOrder(p.orbitOrder, Math.min(1, step / Math.max(1, Math.ceil(state.count / p.orbitArms) - 1)), i / state.count);
        const progress = orbitMorphProgress(morph, order, p.orbitMorphStagger);
        const outgoing = state.outgoing && progress < 1 ? state.outgoing : null;
        if (outgoing) sampleOrbit(this.outgoingPose, i, outgoing, time);
        blendOrbit(pose, outgoing ? this.outgoingPose : state.from[i], this.pose, progress);
      }
      for (let shape = 0; shape < shapeWeights.length; shape++) {
        if (shapeWeights[shape] > .0001) this.stamp(this.batches[shape], pose, pose.size * Math.sqrt(shapeWeights[shape]), p.orbitAspect);
      }
      if (i % 3 !== 1) {
        const accent = pose.size * .37 * p.orbitAccent;
        this.stamp(this.batches[6], pose, accent * orbitDetailGain(accent * pixelsPerUnit, p.orbitCleanDetail), 1, true);
      }
      if (softContact) this.stampContact(pose, p);
    }
    for (const mesh of this.batches) if (mesh.count) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute('orbitBand').needsUpdate = true;
    }

    if (this.contact.count) { this.contact.instanceMatrix.needsUpdate = true; this.contactOpacity.needsUpdate = true; }

    sourceViewMatrix(layer.transform, aspect, this.view);
    const e = this.inverseView.copy(this.view).invert().elements;
    this.clip.set(
      e[0], e[3], 0, 2*e[6]+e[0]+e[3]-1,
      e[1], e[4], 0, 2*e[7]+e[1]+e[4]-1,
      0, 0, 1, 0, 0, 0, 0, 1,
    );
    this.camera.aspect = aspect;
    this.camera.far = Math.max(10, distance + 6);
    this.camera.position.set(0, -Math.sin(tilt) * distance, Math.cos(tilt) * distance);
    this.camera.lookAt(0, 0, .12);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.premultiply(this.clip);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.light.position.set(Math.cos(p.orbitLight) * 1.8, Math.sin(p.orbitLight) * 1.8, 2.45);
    this.light.castShadow = p.orbitShadows > 0 && !softContact;
    this.light.shadow.radius = 1 + 9 * p.orbitSoftness;
    this.groundMaterial.opacity = p.orbitShadows;
    this.groundMaterial.visible = this.light.castShadow;
    const u = this.material.uniforms, b = this.backdropMaterial.uniforms;
    const swatch = (index: number) => state?.appearance.palette[index] ?? this.swatch.set(layer.palette[index]);
    u.uFace.value.copy(swatch(0)); u.uCap.value.copy(swatch(1)); u.uInk.value.copy(swatch(2));
    u.uCapSize.value = p.orbitCap; u.uRim.value = p.orbitRim; u.uFinish.value = state?.appearance.weights ?? weights(4, p.orbitFinish);
    u.uDetail.value = p.orbitCleanDetail;
    u.uPhase.value = p.orbitColourOffset * 3 + time.colour / ORBIT_TAU * 3;
    u.uBlend.value = p.orbitColourBlend;
    u.uLightDirection.value.copy(this.light.position).transformDirection(this.camera.matrixWorldInverse);
    b.uGround.value.copy(swatch(3));
    b.uFace.value.copy(b.uGround.value).lerp(u.uFace.value, p.orbitPaletteLink);
    b.uLight.value.copy(swatch(4)).lerp(u.uCap.value, p.orbitPaletteLink);
    b.uDark.value.copy(swatch(5)).lerp(u.uInk.value, p.orbitPaletteLink);
    b.uAspect.value = aspect; b.uDensity.value = frame.density; b.uContrast.value = frame.contrast;
    b.uRotation.value = frame.rotation; b.uPhase.value = time.background;
    b.uLinkedPhase.value = time.wave; b.uLink.value = p.orbitPatternLink;
    b.uFocus.value = frame.focus;
    b.uFocusRadius.value = (p.orbitRadius + p.orbitSize * 2) * pixelsPerUnit / height;
    b.uDetail.value = p.orbitCleanDetail;
    b.uOpacity.value = p.orbitBackgroundMix * backgroundGain; b.uModes.value = backdropWeights;

    const previousClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(target);
      renderer.autoClear = true;
      renderer.render(this.backdropScene, this.screen);
      if (pieceGain >= .99999) {
        renderer.autoClear = false;
        renderer.render(this.scene, this.camera);
      } else if (pieceGain > .00001) {
        this.isolation ??= new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: true, samples: target.samples });
        this.isolation.texture.colorSpace = THREE.LinearSRGBColorSpace;
        if (this.isolation.width !== width || this.isolation.height !== height) this.isolation.setSize(width, height);
        renderer.setRenderTarget(this.isolation);
        renderer.render(this.scene, this.camera);
        this.over.uniforms.uImage.value = this.isolation.texture;
        this.over.uniforms.uGain.value = pieceGain;
        renderer.setRenderTarget(target);
        renderer.autoClear = false;
        renderer.render(this.overScene, this.screen);
      }
    } finally {
      renderer.autoClear = previousClear;
    }
  }

  dispose(): void {
    for (const mesh of this.batches) { mesh.geometry.dispose(); mesh.dispose(); }
    this.contact.dispose(); this.contactGeometry.dispose(); this.contactMaterial.dispose();
    this.light.shadow.dispose();
    this.groundGeometry.dispose(); this.groundMaterial.dispose(); this.screenGeometry.dispose();
    this.material.dispose(); this.backdropMaterial.dispose(); this.over.dispose();
    this.isolation?.dispose(); this.layers.clear();
  }
}
