/**
 * The real-time renderer for Live mode.
 *
 * It has its own clock: each display frame it measures the step, caps it, and
 * advances tracking and the current look. Nothing here loops or can be seeked,
 * which is why it does not share StudioRenderer.
 */
import * as THREE from 'three';
import { Passes } from './passes';
import { capStep } from './maths';
import { defaultLiveSettings, type LiveSettings } from './settings';
import type { FrameSource } from './look';

const finalFragment = /* glsl */`
uniform sampler2D uImage; uniform float uBlackout, uEncode;
vec3 encode(vec3 c) { c = clamp(c, 0., 1.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
void main() {
  vec3 c = texture2D(uImage, vUv).rgb;
  gl_FragColor = vec4(mix(c, encode(c), uEncode) * (1. - uBlackout), 1.);
}`;
const cameraFragment = /* glsl */`
uniform sampler2D uImage; uniform float uMirror;
void main() { gl_FragColor = vec4(texture2D(uImage, vec2(mix(vUv.x, 1. - vUv.x, uMirror), vUv.y)).rgb, 1.); }`;

export class LiveRenderer {
  settings: LiveSettings = defaultLiveSettings();
  blackout = false;
  /** 'tracking' is the operator's setup view. The artwork window never uses it. */
  view: 'art' | 'tracking' = 'art';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly passes: Passes;
  private readonly final: THREE.ShaderMaterial;
  private readonly cameraView: THREE.ShaderMaterial;
  private readonly sourceTexture = new THREE.Texture();
  private readonly black: THREE.DataTexture;
  private scratch: THREE.WebGLRenderTarget;
  private sourceFrame = -1;
  private width = 0;
  private height = 0;
  private time = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private counted = { frames: 0, since: 0, worst: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly source: FrameSource) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    try { this.passes = new Passes(this.renderer); } catch (error) { this.renderer.dispose(); throw error; }
    this.sourceTexture.colorSpace = THREE.NoColorSpace;
    this.sourceTexture.minFilter = this.sourceTexture.magFilter = THREE.LinearFilter;
    this.sourceTexture.generateMipmaps = false;
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    this.final = this.passes.material(finalFragment, { uImage: { value: this.black }, uBlackout: { value: 0 }, uEncode: { value: 1 } });
    this.cameraView = this.passes.material(cameraFragment, { uImage: { value: this.black }, uMirror: { value: 1 } });
    this.scratch = this.passes.target(1, 1);
    this.counted.since = performance.now();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const elapsed = now - this.last; this.last = now;
      if (elapsed > this.counted.worst) this.counted.worst = elapsed;
      this.frame(elapsed / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }

  /** One display frame. `seconds` is the time since the last one; it is capped so a stall cannot fling the picture. */
  frame(seconds: number): void {
    if (this.disposed) return;
    const step = capStep(seconds);
    this.time += step;
    this.resize();
    this.readSource();
    let image: THREE.Texture = this.black, encode = 1;
    if (this.view === 'tracking') {
      this.cameraView.uniforms.uImage.value = this.source.element ? this.sourceTexture : this.black;
      this.cameraView.uniforms.uMirror.value = this.settings.mirror ? 1 : 0;
      this.passes.draw(this.cameraView, this.scratch);
      image = this.scratch.texture; encode = 0;
    }
    this.final.uniforms.uImage.value = image;
    this.final.uniforms.uEncode.value = encode;
    this.final.uniforms.uBlackout.value = this.blackout ? 1 : 0;
    this.passes.draw(this.final, null);
    this.counted.frames++;
  }

  clear(): void { /* Nothing holds history yet. */ }

  /** Frame rate and the longest gap between frames since the last call. */
  stats(): { fps: number; worstMs: number; frames: number } {
    const now = performance.now(), seconds = Math.max(1e-3, (now - this.counted.since) / 1000);
    const result = { fps: this.counted.frames / seconds, worstMs: this.counted.worst, frames: this.counted.frames };
    this.counted = { frames: 0, since: now, worst: 0 };
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop(); this.disposed = true;
    for (const item of [this.final, this.cameraView, this.sourceTexture, this.black, this.scratch]) item.dispose();
    this.passes.dispose(); this.renderer.dispose();
  }

  private resize(): void {
    const height = this.settings.quality === 720 ? 720 : 1080, width = height * 16 / 9;
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.scratch.setSize(width, height);
  }

  private readSource(): void {
    const element = this.source.element;
    if (!element || this.source.frameId === this.sourceFrame) return;
    if (element instanceof HTMLVideoElement && element.readyState < 2) return;
    this.sourceFrame = this.source.frameId;
    this.sourceTexture.image = element;
    this.sourceTexture.needsUpdate = true;
  }
}
