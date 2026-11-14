import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { sourceViewMatrix } from './source-view';
import { fullscreenVertex } from './shaders';
import { scopeDash, scopeLine, scopePerspective, type ScopeMotion, type ScopeShape } from './scope-curve';

type Draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;
/** Line segments in the figure, and in the ring around it. */
const SEGMENTS = 4096, RING = 256;
const POINTS = SEGMENTS + 1 + RING + 1;
/** Afterglow: fainter copies of the line where it was a moment ago. */
const GHOSTS = 5, GHOST_SEGMENTS = 2048;
const ALL_POINTS = POINTS + GHOSTS * (GHOST_SEGMENTS + 1);
/** Values per point: x, y, depth, brightness, colour mix. */
const STRIDE = 5;
const TAU = Math.PI * 2;
/**
 * Bloom is blurred at fixed heights in lines, not at fractions of the render
 * size, so the glow is the same share of the frame in the preview and in a 4K
 * export. Each level is half the one before and so blurs twice as wide.
 */
const BLOOM_HEIGHTS = [540, 270, 135, 68, 34];
const DEFAULT_PALETTE = ['#ff2a8a', '#ff2060', '#ff8a00', '#ffffff', '#20e0ff', '#000000'];

function lightTarget(mipmaps = false): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: mipmaps });
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

/**
 * The Oscilloscope instrument: an electron beam drawing one closed line.
 *
 * 1. Beam. The line is a chain of short segments. Each is drawn as a quad
 *    shaded with the light a Gaussian beam leaves while it sweeps that segment,
 *    so joints are seamless and a segment the beam crosses slowly is brighter.
 *    Segments add up in a half-float target that holds light, not colour:
 *    red is the core, green the tight halo, blue the core weighted by its
 *    colour mix.
 * 2. Bloom. That light is blurred at five sizes for the wide glow.
 * 3. Resolve. Core, halo and bloom each take their own colour, the sum is
 *    rolled off so the core burns to white, and red and blue are read slightly
 *    apart for a colour fringe. Output is premultiplied.
 */
export class ScopeRenderer {
  private readonly points = new Float32Array(ALL_POINTS * STRIDE);
  private readonly sphere = new Float32Array((SEGMENTS + 1) * 3);
  private readonly buffer = new THREE.InstancedInterleavedBuffer(this.points, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly light = lightTarget(true);
  private readonly levels = BLOOM_HEIGHTS.map(() => [lightTarget(), lightTarget()] as const);
  private readonly beam = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec4 aStart, aEnd; attribute float aMix;
      uniform mat3 uInverse; uniform vec2 uField; uniform float uReach;
      varying vec2 vLocal; varying float vLength, vDepth, vGain, vMix;
      void main() {
        vec2 d=aEnd.xy-aStart.xy; float len=length(d);
        vec2 along=len>1e-7?d/len:vec2(1.,0.), across=vec2(-along.y,along.x);
        // The quad reaches past both ends and both sides by the width of the halo.
        vLocal=vec2(mix(-uReach,len+uReach,position.x),position.y*uReach);
        vLength=len; vDepth=mix(aStart.z,aEnd.z,position.x); vGain=aStart.w; vMix=aMix;
        vec2 uv=(aStart.xy+along*vLocal.x+across*vLocal.y)/uField+.5;
        gl_Position=vec4((uInverse*vec3(uv,1.)).xy*2.-1.,0.,1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform float uSigma, uHalo, uGain, uDepthFade;
      varying vec2 vLocal; varying float vLength, vDepth, vGain, vMix;
      float erf(float x) {
        float a=abs(x), t=1./(1.+.3275911*a);
        float y=1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a);
        return sign(x)*y;
      }
      // Light left by a beam of this width sweeping the segment in a fixed time:
      // the shorter the segment, the longer the beam dwells and the brighter it is.
      float sweep(float sigma) {
        float k=.70710678/sigma;
        float span=.5*(erf(vLocal.x*k)-erf((vLocal.x-vLength)*k));
        return span*exp(-vLocal.y*vLocal.y*k*k)/max(vLength,sigma*.5);
      }
      void main() {
        // The far side of the sphere is dimmer and thinner.
        float near=.5+.5*vDepth, fade=mix(1.-uDepthFade,1.,near);
        float sigma=uSigma*mix(1.-.45*uDepthFade,1.,near);
        float light=uGain*vGain*fade;
        float core=sweep(sigma)*light, halo=uHalo*.22*sweep(sigma*4.5)*light;
        gl_FragColor=vec4(core,halo,core*vMix,1.);
      }`,
    uniforms: {
      uInverse: { value: new THREE.Matrix3() }, uField: { value: new THREE.Vector2(1, 1) }, uReach: { value: .01 },
      uSigma: { value: .001 }, uHalo: { value: 1 }, uGain: { value: 1 }, uDepthFade: { value: .5 },
    },
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, transparent: true,
  });
  // One direction of a Gaussian blur; run across, then down.
  private readonly blur = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; uniform sampler2D uSource; uniform vec2 uStep;
      void main() {
        vec3 sum=texture2D(uSource,vUv).rgb*.2042;
        sum+=(texture2D(uSource,vUv+uStep).rgb+texture2D(uSource,vUv-uStep).rgb)*.1802;
        sum+=(texture2D(uSource,vUv+uStep*2.).rgb+texture2D(uSource,vUv-uStep*2.).rgb)*.1238;
        sum+=(texture2D(uSource,vUv+uStep*3.).rgb+texture2D(uSource,vUv-uStep*3.).rgb)*.0663;
        sum+=(texture2D(uSource,vUv+uStep*4.).rgb+texture2D(uSource,vUv-uStep*4.).rgb)*.0276;
        gl_FragColor=vec4(sum,1.);
      }`,
    uniforms: { uSource: { value: null }, uStep: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  private readonly resolve = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv;
      uniform sampler2D uLight, uBloom0, uBloom1, uBloom2, uBloom3, uBloom4;
      uniform vec3 uLine, uSecond, uHaloTint, uBloomTint, uHot;
      uniform float uWeights[5];
      uniform vec2 uCentre; uniform float uAspect, uRadius, uFringe;
      float glow(sampler2D level) { vec3 b=texture2D(level,vUv).rgb; return b.r+b.g*.6; }
      void main() {
        // Red and blue are read a little apart, more so towards the edge of the sphere.
        vec2 from=(vUv-uCentre)*vec2(uAspect,1.);
        vec2 shift=from/max(uRadius,1e-4)*uFringe*.0045/vec2(uAspect,1.);
        vec3 light=texture2D(uLight,vUv).rgb;
        vec3 core=vec3(texture2D(uLight,vUv-shift).r,light.r,texture2D(uLight,vUv+shift).r);
        vec3 line=mix(uLine,uSecond,light.r>1e-5?clamp(light.b/light.r,0.,1.):0.);
        float bloom=uWeights[0]*glow(uBloom0)+uWeights[1]*glow(uBloom1)+uWeights[2]*glow(uBloom2)+uWeights[3]*glow(uBloom3)+uWeights[4]*glow(uBloom4);
        vec3 sum=core*(line+uHot*.5)+uHaloTint*light.g+uBloomTint*bloom;
        // Roll off towards 1 per channel: bright light loses its colour and burns white.
        vec3 c=1.-exp(-max(sum,0.));
        gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));
      }`,
    uniforms: {
      uLight: { value: null }, ...Object.fromEntries(BLOOM_HEIGHTS.map((_, i) => [`uBloom${i}`, { value: null }])),
      uLine: { value: new THREE.Color() }, uSecond: { value: new THREE.Color() }, uHaloTint: { value: new THREE.Color() },
      uBloomTint: { value: new THREE.Color() }, uHot: { value: new THREE.Color() },
      uWeights: { value: [0, 0, 0, 0, 0] }, uCentre: { value: new THREE.Vector2(.5, .5) }, uAspect: { value: 1 }, uRadius: { value: .3 }, uFringe: { value: 0 },
    },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 2, 1, 3]);
    // Each segment reads two neighbouring points from the same buffer.
    this.geometry.setAttribute('aStart', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    this.geometry.setAttribute('aMix', new THREE.InterleavedBufferAttribute(this.buffer, 1, 4));
    this.geometry.setAttribute('aEnd', new THREE.InterleavedBufferAttribute(this.buffer, 4, STRIDE));
    this.geometry.instanceCount = POINTS - 1;
    const mesh = new THREE.Mesh(this.geometry, this.beam);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  draw(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw): void {
    const p = layer.params, aspect = width / height, radius = p.radius, points = this.points;
    const motion: ScopeMotion = { tilt: p.tilt, tumbleX: p.tumbleX, tumbleY: p.tumbleY };
    const shape: ScopeShape = { figure: p.figure, figureB: p.figureB ?? 0, morph: p.morph ?? 0, hold: p.hold ?? 0,
      wiggle: p.wiggle ?? 0, wiggleFrequency: p.wiggleFrequency ?? 36, wiggleBursts: p.wiggleBursts ?? 0 };
    const dash = p.dash ?? 0, dashCount = p.dashCount ?? 12, dashLength = p.dashLength ?? .3, dashSpeed = p.dashSpeed ?? 2, afterglow = p.afterglow ?? 0;
    scopeLine(shape, motion, phase, SEGMENTS, this.sphere);
    let length = 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      const z = this.sphere[i * 3 + 2], k = radius * scopePerspective(z), at = i * STRIDE;
      points[at] = this.sphere[i * 3] * k; points[at + 1] = this.sphere[i * 3 + 1] * k; points[at + 2] = z;
      // The last point only closes the line; the segment after it would jump to the ring.
      points[at + 3] = i === SEGMENTS ? 0 : scopeDash(i / SEGMENTS, phase, dash, dashCount, dashLength, dashSpeed);
      // The second colour travels once round the line per loop.
      points[at + 4] = p.hueDrift * (.5 + .5 * Math.sin(TAU * i / SEGMENTS + phase));
      if (i > 0) length += Math.hypot(points[at] - points[at - STRIDE], points[at + 1] - points[at - STRIDE + 1]);
    }
    // The ring is the sphere's outline: a circle facing the viewer.
    const ring = SEGMENTS + 1, ringLength = TAU * radius;
    for (let i = 0; i <= RING; i++) {
      const a = TAU * (i === RING ? 0 : i / RING), at = (ring + i) * STRIDE;
      points[at] = Math.cos(a) * radius; points[at + 1] = Math.sin(a) * radius; points[at + 2] = 0;
      // Scaled so the ring is as bright as an average part of the figure at Ring 1.
      points[at + 3] = i === RING ? 0 : p.ring * (ringLength / RING) / Math.max(length / SEGMENTS, 1e-6);
      points[at + 4] = p.hueDrift * (.5 + .5 * Math.sin(a - phase));
    }
    // Afterglow: the line as it was at earlier moments, each copy fainter than the last.
    if (afterglow > 0) for (let j = 0; j < GHOSTS; j++) {
      const then = phase - (j + 1) * afterglow * .035, first = POINTS + j * (GHOST_SEGMENTS + 1);
      scopeLine(shape, motion, then, GHOST_SEGMENTS, this.sphere);
      // A copy has half as many segments, each twice as long and so half as bright; make that up.
      const gain = afterglow * .55 * Math.pow(.62, j) * SEGMENTS / GHOST_SEGMENTS;
      for (let i = 0; i <= GHOST_SEGMENTS; i++) {
        const z = this.sphere[i * 3 + 2], k = radius * scopePerspective(z), at = (first + i) * STRIDE, s = i / GHOST_SEGMENTS;
        points[at] = this.sphere[i * 3] * k; points[at + 1] = this.sphere[i * 3 + 1] * k; points[at + 2] = z;
        points[at + 3] = i === GHOST_SEGMENTS ? 0 : gain * scopeDash(s, then, dash, dashCount, dashLength, dashSpeed);
        points[at + 4] = p.hueDrift * (.5 + .5 * Math.sin(TAU * s + then));
      }
    }
    this.geometry.instanceCount = (afterglow > 0 ? ALL_POINTS : POINTS) - 1;
    this.buffer.needsUpdate = true;

    const u = this.beam.uniforms, view = sourceViewMatrix(layer.transform, aspect), inverse = u.uInverse.value as THREE.Matrix3;
    // Never thinner than about two thirds of a pixel, or the line would shimmer.
    const sigma = Math.max(p.beamWidth * .0013, .65 / height * layer.transform.scale);
    u.uSigma.value = sigma; u.uReach.value = sigma * 4.5 * 3;
    u.uHalo.value = p.halo; u.uDepthFade.value = p.depthFade;
    // An average segment peaks at Intensity; slower ones are brighter.
    u.uGain.value = p.intensity * (length / SEGMENTS);
    (u.uField.value as THREE.Vector2).set(aspect, 1);
    inverse.copy(view).invert();

    if (this.light.width !== width || this.light.height !== height) this.light.setSize(width, height);
    renderer.setRenderTarget(this.light);
    renderer.render(this.scene, this.camera);

    // Bloom: each level blurs the one before it at half the size.
    const blur = this.blur.uniforms;
    let source: THREE.Texture = this.light.texture;
    this.levels.forEach(([across, down], i) => {
      const h = Math.max(2, Math.min(BLOOM_HEIGHTS[i], height)), w = Math.max(2, Math.round(h * aspect));
      if (across.width !== w || across.height !== h) { across.setSize(w, h); down.setSize(w, h); }
      // A small render has fewer lines than the level calls for. Its taps move
      // closer together by the same share, so the blur covers the same part of the frame.
      const reach = h / BLOOM_HEIGHTS[i];
      blur.uSource.value = source; (blur.uStep.value as THREE.Vector2).set(reach / w, 0); draw(this.blur, across);
      blur.uSource.value = across.texture; (blur.uStep.value as THREE.Vector2).set(0, reach / h); draw(this.blur, down);
      source = down.texture;
    });

    const r = this.resolve.uniforms, color = (key: string, index: number) => (r[key].value as THREE.Color).set(layer.palette[index] ?? DEFAULT_PALETTE[index]);
    color('uLine', 0); color('uHaloTint', 1); color('uBloomTint', 2); color('uHot', 3); color('uSecond', 4);
    r.uLight.value = this.light.texture;
    this.levels.forEach(([, down], i) => { r[`uBloom${i}`].value = down.texture; });
    // Bloom size moves the glow from the tight levels to the wide ones.
    const weights = r.uWeights.value as number[], size = p.bloomSize;
    for (let i = 0; i < weights.length; i++) {
      const t = i / (weights.length - 1);
      weights[i] = p.bloom * .9 * ((1 - size) * (1 - t) * (1 - t) + size * (.25 + .75 * t));
    }
    // Where the sphere's centre lands on screen, for the fringe.
    const centre = new THREE.Vector3(.5, .5, 1).applyMatrix3(inverse);
    (r.uCentre.value as THREE.Vector2).set(centre.x, centre.y);
    r.uAspect.value = aspect; r.uRadius.value = radius * layer.transform.scale; r.uFringe.value = p.fringe;
    draw(this.resolve, target);
  }

  dispose(): void {
    this.geometry.dispose(); this.beam.dispose(); this.blur.dispose(); this.resolve.dispose(); this.light.dispose();
    for (const [across, down] of this.levels) { across.dispose(); down.dispose(); }
  }
}
