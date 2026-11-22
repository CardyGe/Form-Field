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

/** Glow cannot run on tiled patterns (the source is a tile, not the frame);
 * the Oscilloscope and Meridian have their own bloom. */
export function supportsGlow(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic' && layer.kind !== 'scope' && layer.kind !== 'meridian';
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
