/**
 * Movement tracking: turns camera frames into the textures looks read.
 * Analysis runs only when a new camera frame has arrived.
 */
import * as THREE from 'three';
import type { Passes, Pair } from './passes';
import type { FrameSource, TrackingFeed } from './look';
import type { LiveSettings } from './settings';
import { cameraFragment, flowFragment, smoothFragment } from './tracking-shaders';

export const CAMERA_SIZE = [1280, 720] as const;
export const FLOW_SIZE = [320, 180] as const;
/** Without a new camera frame for this long, movement is dropped: a camera that went away must not keep painting. */
const STALE_MS = 500;

export class Tracking implements TrackingFeed {
  fresh = false;
  private readonly sourceTexture = new THREE.Texture();
  private readonly frames: Pair;
  private readonly flows: Pair;
  private readonly raw: THREE.WebGLRenderTarget;
  private readonly copy: THREE.ShaderMaterial;
  private readonly measure: THREE.ShaderMaterial;
  private readonly smooth: THREE.ShaderMaterial;
  private readonly zero: THREE.ShaderMaterial;
  private element: FrameSource['element'] = null;
  private frameId = -1;
  private primed = false;
  private moving = false;
  private lastFrameAt = 0;

  constructor(private readonly passes: Passes) {
    this.sourceTexture.colorSpace = THREE.NoColorSpace;
    this.sourceTexture.minFilter = this.sourceTexture.magFilter = THREE.LinearFilter;
    this.sourceTexture.generateMipmaps = false;
    this.frames = passes.pair(...CAMERA_SIZE);
    this.flows = passes.pair(...FLOW_SIZE);
    this.raw = passes.target(...FLOW_SIZE);
    this.copy = passes.material(cameraFragment, { uImage: { value: this.sourceTexture }, uMirror: { value: 1 }, uCrop: { value: new THREE.Vector2(1, 1) } });
    this.measure = passes.material(flowFragment, { uNow: { value: null }, uBefore: { value: null }, uNoise: { value: 0 }, uSensitivity: { value: 1 }, uBox: { value: new THREE.Vector4(0, 1, 0, 1) } });
    this.smooth = passes.material(smoothFragment, { uOld: { value: null }, uNew: { value: this.raw.texture } });
    this.zero = passes.material('void main(){gl_FragColor=vec4(0.);}', {});
    this.reset();
  }

  get camera(): THREE.Texture { return this.frames.read.texture; }
  get flow(): THREE.Texture { return this.flows.read.texture; }
  get flowTarget(): THREE.WebGLRenderTarget { return this.flows.read; }

  update(source: FrameSource, settings: LiveSettings): void {
    this.fresh = false;
    const element = source.element, now = performance.now();
    const ready = element && !(element instanceof HTMLVideoElement && (element.readyState < 2 || !element.videoWidth));
    if (!ready || element !== this.element) {
      // No camera, or a different one: the last frame and its movement no longer mean anything.
      if (this.primed || this.moving) this.reset();
      this.element = ready ? element : null;
      this.frameId = -1;
      if (!ready) return;
    }
    if (source.frameId === this.frameId) {
      if (this.moving && now - this.lastFrameAt > STALE_MS) this.stillFlow();
      return;
    }
    this.frameId = source.frameId; this.lastFrameAt = now;
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.width, height = element instanceof HTMLVideoElement ? element.videoHeight : element.height;
    const aspect = width / height, wide = 16 / 9;
    (this.copy.uniforms.uCrop.value as THREE.Vector2).set(Math.min(1, wide / aspect), Math.min(1, aspect / wide));
    this.copy.uniforms.uMirror.value = settings.mirror ? 1 : 0;
    this.sourceTexture.image = element; this.sourceTexture.needsUpdate = true;
    this.passes.draw(this.copy, this.frames.write);
    this.frames.swap();
    if (!this.primed) {
      // The first frame has nothing to compare with: hold it as its own "before".
      this.passes.draw(this.copy, this.frames.write);
      this.primed = true;
      return;
    }
    const u = this.measure.uniforms, box = settings.box;
    u.uNow.value = this.frames.read.texture; u.uBefore.value = this.frames.write.texture;
    u.uNoise.value = settings.noiseFloor; u.uSensitivity.value = settings.sensitivity;
    (u.uBox.value as THREE.Vector4).set(box.left, box.right, box.bottom, box.top);
    this.passes.draw(this.measure, this.raw);
    this.smooth.uniforms.uOld.value = this.flows.read.texture;
    this.passes.draw(this.smooth, this.flows.write);
    this.flows.swap();
    this.fresh = true; this.moving = true;
  }

  dispose(): void {
    for (const item of [this.sourceTexture, this.frames, this.flows, this.raw, this.copy, this.measure, this.smooth, this.zero]) item.dispose();
  }

  private stillFlow(): void {
    this.passes.draw(this.zero, this.flows.read); this.passes.draw(this.zero, this.flows.write);
    this.moving = false;
  }

  private reset(): void {
    this.stillFlow();
    this.passes.draw(this.zero, this.frames.read); this.passes.draw(this.zero, this.frames.write);
    this.primed = false;
  }
}
