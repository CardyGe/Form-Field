import * as THREE from 'three';
import type { Layer } from '../shared/types';
import { kaleidoscopeFragment, kaleidoscopeUniforms } from './kaleidoscope-glsl';
import { fullscreenVertex } from './shaders';
import { sourceViewMatrix } from './source-view';

type Draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => void;

export type KaleidoscopeDraw = {
  layer: Layer;
  phase: number;
  width: number;
  height: number;
  target: THREE.WebGLRenderTarget;
  draw: Draw;
  input: THREE.Texture | null;
  history: THREE.Texture | null;
  imageAspect: number;
};

const TAU = Math.PI * 2;
const FALLBACK_PALETTE = ['#26cfee', '#adfc35', '#ec72dd', '#7535c0', '#ff805f', '#152043'];

/** The material is built on first draw, so a project without this instrument pays nothing. */
export class KaleidoscopeRenderer {
  private material: THREE.ShaderMaterial | null = null;

  private build(layer: Layer): THREE.ShaderMaterial {
    const uniforms: Record<string, THREE.IUniform> = {
      uView: { value: new THREE.Matrix3() }, uAspect: { value: 1 },
      uKHasImage: { value: 0 }, uKImage: { value: null }, uKImageFit: { value: new THREE.Vector2(1, 1) },
      uKPalette: { value: FALLBACK_PALETTE.map(hex => new THREE.Color(hex)) },
    };
    for (const [key, value] of Object.entries(kaleidoscopeUniforms(layer, 0))) uniforms[key] = { value };
    const material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex, fragmentShader: kaleidoscopeFragment, uniforms,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    material.name = 'kaleidoscope';
    return material;
  }

  draw({ layer, phase, width, height, target, draw, input, imageAspect }: KaleidoscopeDraw): void {
    const material = this.material ??= this.build(layer);
    const u = material.uniforms;
    for (const [key, value] of Object.entries(kaleidoscopeUniforms(layer, phase / TAU))) u[key].value = value;
    const aspect = width / height;
    u.uAspect.value = aspect;
    (u.uView.value as THREE.Matrix3).copy(sourceViewMatrix(layer.transform, aspect));
    const colors = u.uKPalette.value as THREE.Color[];
    for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? FALLBACK_PALETTE[i]);
    u.uKHasImage.value = input ? 1 : 0;
    u.uKImage.value = input;
    // Cover: crop the long side of the image so it is not stretched.
    const ratio = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
    (u.uKImageFit.value as THREE.Vector2).set(ratio > 1 ? 1 / ratio : 1, ratio > 1 ? 1 : ratio);
    draw(material, target);
  }

  dispose(): void {
    this.material?.dispose();
    this.material = null;
  }
}
