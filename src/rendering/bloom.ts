/**
 * Bloom shared by the Oscilloscope and the Glow finish.
 *
 * Light is blurred at fixed heights in lines, not at fractions of the render
 * size, so the glow is the same share of the frame in the preview and in a 4K
 * export. Each level is half the one before and so blurs twice as wide.
 */
import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { fullscreenVertex } from './shaders';

export const BLOOM_HEIGHTS = [540, 270, 135, 68, 34];

/** Level weights: size moves the glow from the tight levels to the wide ones. */
export function bloomWeights(amount: number, size: number): number[] {
  return BLOOM_HEIGHTS.map((_, i) => {
    const t = i / (BLOOM_HEIGHTS.length - 1);
    return amount * .9 * ((1 - size) * (1 - t) * (1 - t) + size * (.25 + .75 * t));
  });
}

/** Per-level weights for red, green and blue. Spread moves red toward the tight
 * levels and blue toward the wide ones; at 0 all three channels are the plain weights. */
export function bloomChannelWeights(amount: number, size: number, spread: number): [number, number, number][] {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const red = bloomWeights(amount, clamp(size - .35 * spread)), green = bloomWeights(amount, size), blue = bloomWeights(amount, clamp(size + .35 * spread));
  return green.map((g, i) => [red[i], g, blue[i]]);
}

/** Glow cannot run on tiled patterns (the source is a tile, not the frame);
 * the Oscilloscope has its own bloom. */
export function supportsGlow(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic' && layer.kind !== 'scope' && layer.kind !== 'smokecloud';
}

export function glowActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsGlow(layer) && ((layer.params.glowMix ?? 0) > 0 || !!layer.modulations.glowMix);
}

/** Size of a blur level. A small render has fewer lines than the level calls
 * for; its taps then move closer together by the same share (reach), so the
 * blur covers the same part of the frame. */
export function bloomLevelSize(index: number, width: number, height: number): { width: number; height: number; reach: number } {
  const h = Math.max(2, Math.min(BLOOM_HEIGHTS[index], height));
  return { width: Math.max(2, Math.round(h * width / height)), height: h, reach: h / BLOOM_HEIGHTS[index] };
}

/** A half-float colour target for light that is blurred or summed. */
export function lightTarget(mipmaps = false): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: mipmaps });
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

/** Keeps the light above the threshold, with a soft knee. The source is
 * premultiplied and is never divided by its alpha. Threshold 0 keeps everything. */
export const glowBrightFragment = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D uSource; uniform float uThreshold;
void main() {
  vec4 s=texture2D(uSource,vUv);
  float l=max(s.r,max(s.g,s.b));
  gl_FragColor=vec4(max(s.rgb,vec3(0.))*smoothstep(uThreshold*.8,uThreshold*1.2+1e-4,l),1.);
}`;

/** Wraps a target at the frame edges (Tile edges) or clamps it. A render
 * target's sampler state is set when its texture is created, so a change
 * recreates the texture on its next use; an unchanged wrap costs nothing. */
export function setWrap(target: THREE.WebGLRenderTarget, wrap: boolean): void {
  const mode = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (target.texture.wrapS === mode && target.texture.wrapT === mode) return;
  target.texture.wrapS = target.texture.wrapT = mode;
  target.dispose();
}

type Draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;

/** Five blurred copies of a light texture, each blurring the one before it at half the size. */
export class BloomPyramid {
  private readonly levels = BLOOM_HEIGHTS.map(() => [lightTarget(), lightTarget()] as const);
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

  /** Blurs the source and returns the five levels, tightest first. With wrap
   * the levels repeat at the frame edges, for a source that tiles.
   * Toggling the wrap reallocates the level targets (see setWrap). */
  render(source: THREE.Texture, width: number, height: number, draw: Draw, wrap = false): THREE.Texture[] {
    const blur = this.blur.uniforms;
    return this.levels.map(([across, down], i) => {
      setWrap(across, wrap); setWrap(down, wrap);
      const { width: w, height: h, reach } = bloomLevelSize(i, width, height);
      if (across.width !== w || across.height !== h) { across.setSize(w, h); down.setSize(w, h); }
      blur.uSource.value = source; (blur.uStep.value as THREE.Vector2).set(reach / w, 0); draw(this.blur, across);
      blur.uSource.value = across.texture; (blur.uStep.value as THREE.Vector2).set(0, reach / h); draw(this.blur, down);
      return source = down.texture;
    });
  }

  dispose(): void {
    this.blur.dispose();
    for (const [across, down] of this.levels) { across.dispose(); down.dispose(); }
  }
}

/** Streak length per pass, in pixels of a 1080-line frame. It doubles each pass. */
export const STREAK_STEPS = [6, 12, 24, 48];

/** The passes for a render height. Shorter steps lead in until the first is at most
 * one texel of the half-size bright pass, so a small point cannot fall between taps
 * and break into beads at 1080 and 4K. */
export function streakSteps(height: number): number[] {
  const texel = 1080 / Math.max(1, Math.ceil(height / 2)), steps = [...STREAK_STEPS];
  while (steps[0] > texel) steps.unshift(steps[0] / 2);
  return steps;
}

/**
 * Stretches bright light along one direction (and, with cross, along the one
 * at right angles). Each pass blurs across five taps at twice the step before
 * it, at a quarter of the render's size, and larger renders add shorter lead-in
 * passes (see streakSteps). Weights sum to 1, so one streak carries no more light
 * than the points it came from; Cross adds two streaks, so it can carry twice
 * that. The step is a share of the frame height, so the streak is the same in a
 * preview and a 4K export.
 */
export class StreakBlur {
  private targets: THREE.WebGLRenderTarget[] | null = null;
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; uniform sampler2D uSource; uniform vec2 uStep; uniform vec3 uTaps;
      void main() {
        vec3 sum=texture2D(uSource,vUv).rgb*uTaps.x;
        sum+=(texture2D(uSource,vUv+uStep).rgb+texture2D(uSource,vUv-uStep).rgb)*uTaps.y;
        sum+=(texture2D(uSource,vUv+uStep*2.).rgb+texture2D(uSource,vUv-uStep*2.).rgb)*uTaps.z;
        gl_FragColor=vec4(sum,1.);
      }`,
    uniforms: { uSource: { value: null }, uStep: { value: new THREE.Vector2() }, uTaps: { value: new THREE.Vector3() } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  private readonly add = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; uniform sampler2D uSource, uOther;
      void main() { gl_FragColor=vec4(texture2D(uSource,vUv).rgb+texture2D(uOther,vUv).rgb,1.); }`,
    uniforms: { uSource: { value: null }, uOther: { value: null } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });

  /** Streaks the source along angle (degrees from horizontal). Targets are made on first use. */
  render(source: THREE.Texture, width: number, height: number, angle: number, cross: boolean, draw: Draw, wrap = false): THREE.Texture {
    this.targets ??= [lightTarget(), lightTarget()];
    if (cross && this.targets.length < 4) this.targets.push(lightTarget(), lightTarget());
    const w = Math.max(2, Math.ceil(width / 4)), h = Math.max(2, Math.ceil(height / 4)), aspect = width / height;
    for (const t of this.targets) { setWrap(t, wrap); if (t.width !== w || t.height !== h) t.setSize(w, h); }
    const uniforms = this.material.uniforms, taps = uniforms.uTaps.value as THREE.Vector3;
    taps.set(.2042, .1802, .1238);
    const norm = taps.x + 2 * taps.y + 2 * taps.z; taps.divideScalar(norm);
    const chain = (first: number, theta: number): THREE.WebGLRenderTarget => {
      let from = source, last = this.targets![first];
      streakSteps(height).forEach((length, p) => {
        last = this.targets![first + (p % 2)];
        // The step is a share of the frame height, turned into texture units.
        const k = length / 1080;
        (uniforms.uStep.value as THREE.Vector2).set(Math.cos(theta) * k / aspect, Math.sin(theta) * k);
        uniforms.uSource.value = from; draw(this.material, last); from = last.texture;
      });
      return last;
    };
    const theta = angle * Math.PI / 180, one = chain(0, theta);
    if (!cross) return one.texture;
    const other = chain(2, theta + Math.PI / 2);
    this.add.uniforms.uSource.value = one.texture; this.add.uniforms.uOther.value = other.texture;
    // The pass count varies with height, so write to whichever target the first chain did not end on.
    const sum = one === this.targets[0] ? this.targets[1] : this.targets[0];
    draw(this.add, sum);
    return sum.texture;
  }

  dispose(): void {
    this.material.dispose(); this.add.dispose();
    for (const t of this.targets ?? []) t.dispose();
    this.targets = null;
  }
}
