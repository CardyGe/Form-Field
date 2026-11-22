/**
 * Kaleidoscope in Live: folds the camera or a playing video through the Studio's shader.
 *
 * The newest frame is kept, in linear colour with a mip chain, in a target only this look
 * writes. Tracking blanks its own copy when a source goes away, so this one is what holds the
 * picture until frames return.
 */
import * as THREE from 'three';
import { parameterDefinitions } from '../core/project';
import { kaleidoscopeImageFit } from '../rendering/KaleidoscopeRenderer';
import { kaleidoscopeFragment, kaleidoscopeUniforms } from '../rendering/kaleidoscope-glsl';
import type { Layer } from '../shared/types';
import type { Look, TrackingFeed } from './look';
import type { Passes } from './passes';
import type { LiveSettings } from './settings';

const TAU = Math.PI * 2;
/** Spin and Zoom are measured per this many seconds. */
const RATE_SECONDS = 8;

const linearFragment = /* glsl */`
uniform sampler2D uImage;
void main() {
  vec3 c = clamp(texture2D(uImage, vUv).rgb, 0., 1.);
  gl_FragColor = vec4(mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)), 1.);
}`;

/**
 * One step of a motion that repeats every 1. Keeping it inside 0..1 holds float precision over
 * hours, and integrating the rate means a change of speed never moves the picture.
 */
export function advancePhase(phase: number, perEightSeconds: number, seconds: number): number {
  const next = phase + perEightSeconds * seconds / RATE_SECONDS;
  if (!Number.isFinite(next)) return phase;
  const wrapped = next - Math.floor(next);
  // A tiny negative value rounds up to exactly 1.
  return wrapped >= 1 ? 0 : wrapped;
}

const BASE_PARAMS = Object.fromEntries(parameterDefinitions('kaleidoscope').map(d => [d.key, d.default]));

/** The Studio's uniforms for these controls, with Live's own unlooped spin and zoom. */
export function liveKaleidoscopeUniforms(k: LiveSettings['kaleidoscope'], spinPhase: number, zoomPhase: number): Record<string, unknown> {
  const params = { ...BASE_PARAMS, group: k.group, sectors: k.sectors, cell: k.cell, spiral: k.spiral ? 1 : 0, sourceDrift: 0 };
  // The uniforms read only a layer's params.
  return { ...kaleidoscopeUniforms({ params } as unknown as Layer, 0), uKSourceTurn: spinPhase * TAU, uKZoom: zoomPhase };
}

export class Kaleidoscope implements Look {
  private readonly picture: THREE.WebGLRenderTarget;
  private readonly held: THREE.WebGLRenderTarget;
  private readonly linear: THREE.ShaderMaterial;
  private readonly material: THREE.ShaderMaterial;
  private hasFrame = false;
  private spin = 0;
  private zoom = 0;

  constructor(private readonly passes: Passes, width: number, height: number) {
    this.picture = passes.target(width, height);
    this.held = new THREE.WebGLRenderTarget(1280, 720, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    });
    this.held.texture.colorSpace = THREE.NoColorSpace;
    this.linear = passes.material(linearFragment, { uImage: { value: null } });
    const uniforms: Record<string, THREE.IUniform> = {
      uView: { value: new THREE.Matrix3() }, uAspect: { value: width / height },
      uKHasImage: { value: 0 }, uKImage: { value: null }, uKImageFit: { value: new THREE.Vector2(1, 1) },
      uKHistory: { value: null }, uKAssociated: { value: 1 }, uKEmpty: { value: 1 }, uKFeedback: { value: 0 }, uKGain: { value: 0 },
      uKPalette: { value: Array.from({ length: 6 }, () => new THREE.Color(0, 0, 0)) },
    };
    for (const [key, value] of Object.entries(liveKaleidoscopeUniforms({ group: 0, sectors: 6, cell: 1, spiral: false, spin: 0, zoom: 0 }, 0, 0))) uniforms[key] = { value };
    this.material = passes.material(kaleidoscopeFragment, uniforms);
  }

  get output(): THREE.Texture { return this.picture.texture; }

  step(seconds: number, _time: number, feed: TrackingFeed, settings: LiveSettings): void {
    const k = settings.kaleidoscope;
    this.spin = advancePhase(this.spin, k.spin, seconds);
    this.zoom = advancePhase(this.zoom, k.zoom, seconds);
    // Not `fresh`: that needs two close frames to compare, so a slow source would never appear.
    if (feed.newImage) this.capture(feed.camera);
    const u = this.material.uniforms;
    for (const [key, value] of Object.entries(liveKaleidoscopeUniforms(k, this.spin, this.zoom))) u[key].value = value;
    u.uAspect.value = this.picture.width / this.picture.height;
    u.uKEmpty.value = this.hasFrame ? 0 : 1;
    u.uKHasImage.value = this.hasFrame ? 1 : 0;
    u.uKImage.value = this.hasFrame ? this.held.texture : null;
    const fit = kaleidoscopeImageFit(this.held.width / this.held.height, 'cover');
    (u.uKImageFit.value as THREE.Vector2).set(fit.x, fit.y);
    this.passes.draw(this.material, this.picture);
  }

  /** The feed's texture changes every frame and can change size when a source reopens. */
  private capture(camera: THREE.Texture): void {
    const { width, height } = camera.image as { width: number; height: number };
    if (width > 0 && height > 0 && (width !== this.held.width || height !== this.held.height)) this.held.setSize(width, height);
    this.linear.uniforms.uImage.value = camera;
    this.passes.draw(this.linear, this.held);
    this.hasFrame = true;
  }

  resize(width: number, height: number): void { this.picture.setSize(width, height); }

  /** Drops the held frame: the look is dark until the next new one. Motion carries on. */
  clear(): void { this.hasFrame = false; }

  dispose(): void {
    for (const item of [this.picture, this.held, this.linear, this.material]) item.dispose();
  }
}
