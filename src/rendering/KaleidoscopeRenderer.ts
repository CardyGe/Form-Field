import * as THREE from 'three';
import { KALEIDOSCOPE_INPUT } from '../core/project';
import type { Layer } from '../shared/types';
import { kaleidoscopeInput, persistence } from './feedback';
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
  /** Defaults to what the textures imply: image, then feedback, then motif. */
  mode?: KaleidoscopeInputMode;
  imageFit?: ImageFit;
};

export type KaleidoscopeInputMode = 'motif' | 'image' | 'below' | 'empty' | 'feedback';
type ImageFit = NonNullable<Layer['image']>['fit'];

/** What this layer shows now. A missing or loading input is a calm fallback, never an error. */
export function kaleidoscopeInputMode(layer: Layer, ready: { image: boolean; hasBelow: boolean }): KaleidoscopeInputMode {
  const input = kaleidoscopeInput(layer.params);
  if (input === KALEIDOSCOPE_INPUT.image) return ready.image ? 'image' : 'motif';
  if (input === KALEIDOSCOPE_INPUT.below) return ready.hasBelow ? 'below' : 'empty';
  if (input === KALEIDOSCOPE_INPUT.feedback) return (layer.params.echo ?? 0) > 0 ? 'feedback' : 'motif';
  return 'motif';
}

/** How much of the picture one square tile spans. Above 1, that axis has empty bars. */
export function kaleidoscopeImageFit(aspect: number, fit: ImageFit): { x: number; y: number } {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (fit === 'contain') return ratio > 1 ? { x: 1, y: ratio } : { x: 1 / ratio, y: 1 };
  return ratio > 1 ? { x: 1 / ratio, y: 1 } : { x: 1, y: ratio };
}

const TAU = Math.PI * 2;
const FALLBACK_PALETTE = ['#26cfee', '#adfc35', '#ec72dd', '#7535c0', '#ff805f', '#152043'];

/** The material is built on first draw, so a project without this instrument pays nothing. */
export class KaleidoscopeRenderer {
  private material: THREE.ShaderMaterial | null = null;

  private build(layer: Layer): THREE.ShaderMaterial {
    const uniforms: Record<string, THREE.IUniform> = {
      uView: { value: new THREE.Matrix3() }, uAspect: { value: 1 },
      uKHasImage: { value: 0 }, uKImage: { value: null }, uKImageFit: { value: new THREE.Vector2(1, 1) },
      uKHistory: { value: null }, uKAssociated: { value: 0 }, uKEmpty: { value: 0 }, uKFeedback: { value: 0 }, uKGain: { value: 0 },
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

  draw({ layer, phase, width, height, target, draw, input, history, imageAspect, mode, imageFit = 'cover' }: KaleidoscopeDraw): void {
    const material = this.material ??= this.build(layer);
    const u = material.uniforms;
    for (const [key, value] of Object.entries(kaleidoscopeUniforms(layer, phase / TAU))) u[key].value = value;
    const aspect = width / height;
    u.uAspect.value = aspect;
    (u.uView.value as THREE.Matrix3).copy(sourceViewMatrix(layer.transform, aspect));
    const colors = u.uKPalette.value as THREE.Color[];
    for (let i = 0; i < 6; i++) colors[i].set(layer.palette[i] ?? FALLBACK_PALETTE[i]);
    const wanted = mode ?? (input ? 'image' : history ? 'feedback' : 'motif');
    // A mode whose texture is absent shows the motif rather than sampling nothing.
    const shown = (wanted === 'image' || wanted === 'below') && !input || wanted === 'feedback' && !history ? 'motif' : wanted;
    const picture = shown === 'image' || shown === 'below';
    u.uKHasImage.value = picture ? 1 : 0;
    u.uKImage.value = picture ? input : null;
    u.uKAssociated.value = shown === 'below' ? 1 : 0;
    u.uKEmpty.value = shown === 'empty' ? 1 : 0;
    u.uKFeedback.value = shown === 'feedback' ? 1 : 0;
    u.uKHistory.value = shown === 'feedback' ? history : null;
    const gain = persistence(layer);
    u.uKGain.value = Number.isFinite(gain) ? gain : 0;
    const fit = kaleidoscopeImageFit(imageAspect, shown === 'image' ? imageFit : 'cover');
    (u.uKImageFit.value as THREE.Vector2).set(fit.x, fit.y);
    draw(material, target);
  }

  dispose(): void {
    this.material?.dispose();
    this.material = null;
  }
}
