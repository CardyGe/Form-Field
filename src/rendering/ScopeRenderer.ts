import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { sourceViewMatrix } from './source-view';
import { fullscreenVertex } from './shaders';
import { BLOOM_HEIGHTS, BloomPyramid, bloomWeights, lightTarget } from './bloom';
import { emberPhrase, SCOPE_POINT_STRIDE as STRIDE } from './scope-ember';
import { EMBER_MAX_POINTS, writeEmberBurst } from './scope-ember-burst';
import { EmberFluid } from './EmberFluid';
import { emberFluidSettings } from './ember-fluid-model';
import type { SmokeAudioFrame } from '../react/ember-smoke';
import { SCOPE_WAVE, scopeDash, scopeLine, scopePerspective, scopeWave, type ScopeMotion, type ScopeShape } from './scope-curve';

type Draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;
export interface ScopeTiming { exact: boolean; playing: boolean; duration: number }
/** Line segments in the figure, and in the ring around it. */
const SEGMENTS = 4096, RING = 256;
const POINTS = SEGMENTS + 1 + RING + 1;
/** Afterglow: fainter copies of the line where it was a moment ago. */
const GHOSTS = 8, GHOST_SEGMENTS = 1536;
const ALL_POINTS = POINTS + GHOSTS * (GHOST_SEGMENTS + 1);
const TAU = Math.PI * 2;
const DEFAULT_PALETTE = ['#ff2a8a', '#ff2060', '#ff8a00', '#ffffff', '#20e0ff', '#000000'];


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
  private readonly points = new Float32Array(Math.max(ALL_POINTS, EMBER_MAX_POINTS) * STRIDE);
  private readonly sphere = new Float32Array((SEGMENTS + 1) * 3);
  private readonly wave = new Float32Array(SCOPE_WAVE);
  private readonly ghostWave = new Float32Array(SCOPE_WAVE / 2);
  private readonly buffer = new THREE.InstancedInterleavedBuffer(this.points, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly light = lightTarget(true);
  private readonly bloom = new BloomPyramid();
  private readonly smokeTarget = lightTarget();
  private readonly fluids = new Map<string, EmberFluid>();
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
  private readonly resolve = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv;
      uniform sampler2D uLight, uBloom0, uBloom1, uBloom2, uBloom3, uBloom4, uSmoke;
      uniform vec3 uLine, uSecond, uHaloTint, uBloomTint, uHot, uSmokeTint;
      uniform float uWeights[5];
      uniform vec2 uCentre; uniform float uAspect, uRadius, uFringe, uEmber, uHeat, uSmokeGain, uSmokeBody, uSmokeLighting;
      float glow(sampler2D level) { vec3 b=texture2D(level,vUv).rgb; return b.r+b.g*.6; }
      void main() {
        // Red and blue are read a little apart, more so towards the edge of the sphere.
        vec2 from=(vUv-uCentre)*vec2(uAspect,1.);
        vec2 shift=from/max(uRadius,1e-4)*uFringe*.0045/vec2(uAspect,1.);
        vec3 light=texture2D(uLight,vUv).rgb;
        vec3 core=vec3(texture2D(uLight,vUv-shift).r,light.r,texture2D(uLight,vUv+shift).r);
        vec3 line=mix(uLine,uSecond,light.r>1e-5?clamp(light.b/light.r,0.,1.):0.);
        float tight=glow(uBloom1), mids=glow(uBloom2), broad=glow(uBloom3);
        float bloom=uWeights[0]*glow(uBloom0)+uWeights[1]*tight+uWeights[2]*mids+uWeights[3]*broad+uWeights[4]*glow(uBloom4);
        vec3 sum=core*(line+uHot*.5)+uHaloTint*light.g+uBloomTint*bloom;
        if (uEmber > .5) {
          float ridge=clamp(light.b/max(light.r,1e-5),0.,1.);
          float heat=uHeat*smoothstep(.12,.75,light.r)*(.38+.62*ridge);
          vec3 ember=mix(uLine,uSecond,.7*ridge);
          sum=light.r*(ember+uHot*heat)+uHaloTint*light.g+uBloomTint*bloom;
          if (uSmokeGain > 0.) {
            vec3 smoke=texture2D(uSmoke,vUv).rgb*uSmokeGain;
            float nearby=1.-exp(-(.62*tight+1.45*mids+.50*broad+.13*light.r));
            float lightLevel=uSmokeLighting*nearby;
            float transmission=exp(-smoke.x*mix(.2,2.7,uSmokeBody));
            // Smoke shows only where light reaches it, so smoke drifting into the dark fades out instead of forming a flat sheet.
            vec3 scattered=uSmokeTint*(.06*smoothstep(.03,.2,nearby)+lightLevel*1.3)+uHot*(.15*lightLevel*uHeat);
            vec3 behind=(1.-exp(-smoke.y*1.24))*scattered*.51;
            vec3 inFront=(1.-transmission)*scattered;
            sum=(sum+behind)*transmission+inFront+smoke.z*scattered*(.27+.42*lightLevel);
          }
          // The faintest tail of the glow is lifted black on a wall, so Ember's blacks stay black.
          sum=max(sum-vec3(.0016),vec3(0.));
        }
        // Roll off towards 1 per channel: bright light loses its colour and burns white.
        vec3 c=1.-exp(-max(sum,0.));
        gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));
      }`,
    uniforms: {
      uLight: { value: null }, ...Object.fromEntries(BLOOM_HEIGHTS.map((_, i) => [`uBloom${i}`, { value: null }])),
      uLine: { value: new THREE.Color() }, uSecond: { value: new THREE.Color() }, uHaloTint: { value: new THREE.Color() },
      uBloomTint: { value: new THREE.Color() }, uHot: { value: new THREE.Color() },
      uWeights: { value: [0, 0, 0, 0, 0] }, uCentre: { value: new THREE.Vector2(.5, .5) }, uAspect: { value: 1 }, uRadius: { value: .3 }, uFringe: { value: 0 },
      uEmber: { value: 0 }, uHeat: { value: 0 }, uSmoke: { value: null }, uSmokeGain: { value: 0 },
      uSmokeTint: { value: new THREE.Color() }, uSmokeBody: { value: 0 }, uSmokeLighting: { value: 0 },
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

  private writeClassic(p: Layer['params'], phase: number, radius: number): number {
    const points = this.points;
    const motion: ScopeMotion = { tilt: p.tilt, tumbleX: p.tumbleX, tumbleY: p.tumbleY, float: p.float ?? 0 };
    const shape: ScopeShape = { figure: p.figure, figureB: p.figureB ?? 0, morph: p.morph ?? 0, hold: p.hold ?? 0, drift: p.drift ?? 1, overtones: p.overtones ?? 0, sway: p.sway ?? 0,
      wiggle: p.wiggle ?? 0, wiggleFrequency: p.wiggleFrequency ?? 36, wiggleBursts: p.wiggleBursts ?? 0 };
    const dash = p.dash ?? 0, dashCount = p.dashCount ?? 12, dashLength = p.dashLength ?? .3, dashSpeed = p.dashSpeed ?? 2, afterglow = p.afterglow ?? 0;
    // The wave is worked out here, apart from the line, so that sound can be mixed into it later.
    scopeLine(shape, motion, phase, SEGMENTS, this.sphere, scopeWave(shape, phase, this.wave));
    let length = 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      const z = Math.max(-1, Math.min(1, this.sphere[i * 3 + 2])), k = radius * scopePerspective(z), at = i * STRIDE;
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
      // Close enough together to run into one smear rather than read as separate lines.
      const then = phase - (j + 1) * afterglow * .016, first = POINTS + j * (GHOST_SEGMENTS + 1);
      scopeLine(shape, motion, then, GHOST_SEGMENTS, this.sphere, scopeWave(shape, then, this.ghostWave));
      // A copy has fewer, longer segments, and longer segments are dimmer; make that up.
      const gain = afterglow * .5 * Math.pow(.74, j) * SEGMENTS / GHOST_SEGMENTS;
      for (let i = 0; i <= GHOST_SEGMENTS; i++) {
        const z = Math.max(-1, Math.min(1, this.sphere[i * 3 + 2])), k = radius * scopePerspective(z), at = (first + i) * STRIDE, s = i / GHOST_SEGMENTS;
        points[at] = this.sphere[i * 3] * k; points[at + 1] = this.sphere[i * 3 + 1] * k; points[at + 2] = z;
        points[at + 3] = i === GHOST_SEGMENTS ? 0 : gain * scopeDash(s, then, dash, dashCount, dashLength, dashSpeed);
        points[at + 4] = p.hueDrift * (.5 + .5 * Math.sin(TAU * s + then));
      }
    }
    this.geometry.instanceCount = (afterglow > 0 ? ALL_POINTS : POINTS) - 1;
    this.buffer.needsUpdate = true;

    return length / SEGMENTS;
  }

  private drawSmoke(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, view: THREE.Matrix3, radius: number, width: number, height: number, audio: SmokeAudioFrame | undefined, timing: ScopeTiming): number {
    const p = layer.params, aspect = width / height;
    let fluid = this.fluids.get(layer.id);
    if (fluid && Math.abs(fluid.aspect - aspect) > .001) { fluid.dispose(); this.fluids.delete(layer.id); fluid = undefined; }
    if (!fluid) { fluid = new EmberFluid(renderer, aspect); this.fluids.set(layer.id, fluid); }
    // The broad density field needs fewer samples than the fine beam geometry.
    const scale = Math.min(.5, 528 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.smokeTarget.width !== w || this.smokeTarget.height !== h) this.smokeTarget.setSize(w, h);
    const clock = ((phase % TAU) + TAU) % TAU;
    fluid.sample({ params: p, seconds: clock / TAU * timing.duration, loopSeconds: timing.duration, exact: timing.exact, playing: timing.playing, audio, view, radius, aspect }, this.smokeTarget);
    const { body } = emberPhrase(clock, p.emberPhrases);
    const exposure = 1 - p.emberPulse * (1 - body) * (1 - p.emberRest);
    return (.62 + .3 * p.intensity) * (.45 + .55 * exposure * exposure);
  }

  /** A paused seek is still walking the smoke to its frame. */
  needsRefresh(): boolean { for (const fluid of this.fluids.values()) if (fluid.pending) return true; return false; }

  /** Frees the smoke of layers that are gone. */
  keepEmberLayers(ids: ReadonlySet<string>): void { for (const [id, fluid] of this.fluids) if (!ids.has(id)) { fluid.dispose(); this.fluids.delete(id); } }

  /** After a lost GPU context: the smoke was on it, so it starts again. */
  resetGpuHistory(): void { for (const fluid of this.fluids.values()) fluid.dispose(); this.fluids.clear(); }

  draw(renderer: THREE.WebGLRenderer, layer: Layer, phase: number, width: number, height: number, target: THREE.WebGLRenderTarget, draw: Draw, audio?: SmokeAudioFrame, timing: ScopeTiming = { exact: true, playing: false, duration: 10 }): void {
    const p = layer.params, aspect = width / height;
    const ember = p.scopeMode === 1 ? writeEmberBurst(this.points, p, phase, aspect) : null;
    const radius = ember?.radius ?? p.radius;
    let gain = p.intensity;
    if (ember) {
      this.geometry.instanceCount = ember.points - 1;
      this.buffer.needsUpdate = true;
    } else {
      // An average segment peaks at Intensity; slower ones are brighter.
      gain *= this.writeClassic(p, phase, radius);
    }

    const u = this.beam.uniforms, view = sourceViewMatrix(layer.transform, aspect), inverse = u.uInverse.value as THREE.Matrix3;
    // Never thinner than about two thirds of a pixel, or the line would shimmer.
    const sigma = Math.max(p.beamWidth * .0013, .65 / height * layer.transform.scale);
    u.uSigma.value = sigma; u.uReach.value = sigma * 4.5 * 3;
    u.uHalo.value = p.halo; u.uDepthFade.value = p.depthFade;
    u.uGain.value = gain;
    (u.uField.value as THREE.Vector2).set(aspect, 1);
    inverse.copy(view).invert();

    if (this.light.width !== width || this.light.height !== height) this.light.setSize(width, height);
    renderer.setRenderTarget(this.light);
    renderer.render(this.scene, this.camera);

    const levels = this.bloom.render(this.light.texture, width, height, draw);

    const r = this.resolve.uniforms, color = (key: string, index: number) => (r[key].value as THREE.Color).set(layer.palette[index] ?? DEFAULT_PALETTE[index]);
    color('uLine', 0); color('uHaloTint', 1); color('uBloomTint', 2); color('uHot', 3); color('uSecond', 4);
    r.uLight.value = this.light.texture;
    levels.forEach((level, i) => { r[`uBloom${i}`].value = level; });
    // Bloom size moves the glow from the tight levels to the wide ones.
    r.uWeights.value = bloomWeights(p.bloom, p.bloomSize);
    // Where the sphere's centre lands on screen, for the fringe.
    const centre = new THREE.Vector3(.5, .5, 1).applyMatrix3(inverse);
    (r.uCentre.value as THREE.Vector2).set(centre.x, centre.y);
    r.uAspect.value = aspect; r.uRadius.value = radius * layer.transform.scale; r.uFringe.value = ember ? 0 : p.fringe;
    r.uEmber.value = Number(!!ember); r.uHeat.value = ember?.heat ?? 0;
    r.uSmokeGain.value = ember && p.emberSmoke > 0 ? this.drawSmoke(renderer, layer, phase, view, radius, width, height, audio, timing) : 0;
    r.uSmoke.value = r.uSmokeGain.value > 0 ? this.smokeTarget.texture : null;
    if (r.uSmokeGain.value > 0) {
      const tint = r.uSmokeTint.value as THREE.Color;
      // Black in an older palette was the unused sixth swatch.
      if (layer.palette[5] === '#000000') tint.copy(r.uHaloTint.value).lerp(r.uLine.value, .74);
      else tint.set(layer.palette[5]);
      r.uSmokeBody.value = p.emberSmokeBody;
      r.uSmokeLighting.value = emberFluidSettings(p).lighting;
    }
    draw(this.resolve, target);
  }

  dispose(): void {
    this.geometry.dispose(); this.beam.dispose(); this.bloom.dispose(); this.resolve.dispose(); this.light.dispose();
    this.smokeTarget.dispose(); this.resetGpuHistory();
  }
}
