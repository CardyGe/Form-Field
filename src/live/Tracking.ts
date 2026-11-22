/**
 * Movement tracking: turns camera frames into the textures looks read.
 * Analysis runs only when a new camera frame has arrived.
 */
import * as THREE from 'three';
import type { Passes, Pair } from './passes';
import type { FrameSource, TrackingFeed } from './look';
import { wantsPeople, type LiveSettings } from './settings';
import { cameraFragment, flowFragment, lumaFragment, smoothFragment } from './tracking-shaders';
import type { MaskProvider, PeopleStatus } from './MaskProvider';
import { People } from './People';

export const CAMERA_SIZE = [1280, 720] as const;
export const FLOW_SIZE = [320, 180] as const;
/** The averaged brightness the tracker compares, frame to frame. */
const LUMA_SIZE = [160, 90] as const;
/** Without a new camera frame for this long, movement is dropped: a camera that went away must not keep painting. */
const STALE_MS = 500;
/** Frame ids sent to person finding are offset per source, so a mask from an earlier source is never mistaken for a new one. */
const EPOCH = 1e9;
const NOT_STARTED: PeopleStatus = { state: 'loading' };

export class Tracking implements TrackingFeed {
  fresh = false;
  newImage = false;
  /** One texture per source element: three sizes a texture once, and a camera and a file differ. */
  private sourceTexture: THREE.Texture | null = null;
  private readonly frames: Pair;
  private readonly flows: Pair;
  private readonly lumas: Pair;
  private readonly average: THREE.ShaderMaterial;
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
  private readonly peopleStage: People;
  private providerElement: FrameSource['element'] = null;
  private provider: MaskProvider | null = null;
  private epoch = 0;
  /** Counts restarts after a stalled camera, so people settle again. */
  private restarts = 0;
  /** Seconds of capped display time, for the slow memory. */
  private clock = 0;

  constructor(private readonly passes: Passes, private readonly makeProvider?: () => MaskProvider) {
    this.frames = passes.pair(...CAMERA_SIZE);
    this.flows = passes.pair(...FLOW_SIZE);
    this.lumas = passes.pair(...LUMA_SIZE);
    this.average = passes.material(lumaFragment, { uImage: { value: null } });
    this.raw = passes.target(...FLOW_SIZE);
    this.copy = passes.material(cameraFragment, { uImage: { value: null }, uMirror: { value: 1 }, uCrop: { value: new THREE.Vector2(1, 1) } });
    this.measure = passes.material(flowFragment, { uNow: { value: null }, uBefore: { value: null }, uNoise: { value: 0 }, uSensitivity: { value: 1 }, uBox: { value: new THREE.Vector4(0, 1, 0, 1) } });
    this.smooth = passes.material(smoothFragment, { uOld: { value: null }, uNew: { value: this.raw.texture } });
    this.zero = passes.material('void main(){gl_FragColor=vec4(0.);}', {});
    this.peopleStage = new People(passes, FLOW_SIZE, LUMA_SIZE);
    this.reset();
  }

  get people(): THREE.Texture { return this.peopleStage.people; }
  get still(): THREE.Texture { return this.peopleStage.still; }
  get peopleReady(): boolean { return this.provider !== null && this.peopleStage.ready; }
  get peopleStatus(): PeopleStatus { return this.provider?.status ?? NOT_STARTED; }
  get roomCaptured(): boolean { return this.peopleStage.roomCaptured; }
  /** For the scripted checks and diagnostics: the textures as targets, and how many masks were used. */
  get peopleTargets() { return { people: this.peopleStage.peopleTarget, still: this.peopleStage.stillTarget, masks: this.peopleStage.masks, provider: this.provider }; }
  captureRoom(): void { this.peopleStage.captureRoom(); }

  get camera(): THREE.Texture { return this.frames.read.texture; }
  get flow(): THREE.Texture { return this.flows.read.texture; }
  get flowTarget(): THREE.WebGLRenderTarget { return this.flows.read; }
  /** How the source is cropped to 16:9, so a mask made from the raw source lines up with `camera`. */
  get crop(): THREE.Vector2 { return this.copy.uniforms.uCrop.value as THREE.Vector2; }

  /** One display frame: movement from new camera frames, and people when the look wants them. `step` is the capped time step. */
  update(source: FrameSource, settings: LiveSettings, step = 0): void {
    const wants = wantsPeople(settings) && !!this.makeProvider;
    if (this.provider && this.providerElement !== source.element) {
      this.provider.dispose(); this.provider = null; this.peopleStage.reset();
    }
    this.providerElement = source.element;
    if (wants && !this.provider) {
      try { this.provider = this.makeProvider!(); }
      catch (error) { this.provider = new FailedProvider(error); }
    }
    if (!wants && this.provider) { this.provider.dispose(); this.provider = null; this.peopleStage.reset(); }
    const before = this.frameId, restartsBefore = this.restarts;
    this.analyse(source, settings);
    if (!this.provider) return;
    this.clock += step;
    const newFrame = this.frameId !== before && this.frameId >= 0;
    // Person finding must never stop Live: if it throws, it is marked failed and Live carries on without it.
    try {
      if (newFrame && this.element) this.provider.submit(this.element, this.epoch * EPOCH + this.frameId);
      this.peopleStage.update(step, { camera: this.camera, flow: this.flow, luma: this.lumas.read.texture, crop: this.crop, fresh: newFrame && this.primed,
        seconds: this.clock, restarted: this.restarts !== restartsBefore }, this.provider, this.epoch * EPOCH, settings);
    } catch (error) {
      this.provider.dispose(); this.provider = new FailedProvider(error);
    }
  }

  private analyse(source: FrameSource, settings: LiveSettings): void {
    this.fresh = false;
    this.newImage = false;
    const element = source.element, now = performance.now();
    const ready = element && !(element instanceof HTMLVideoElement && (element.readyState < 2 || !element.videoWidth));
    if (!ready || element !== this.element) {
      // No camera, or a different one: the last frame and its movement no longer mean anything.
      if (this.primed || this.moving) this.reset();
      // People from the old source never carry over.
      if ((ready ? element : null) !== this.element) { this.epoch++; this.peopleStage.reset(); }
      this.element = ready ? element : null;
      this.frameId = -1;
      this.sourceTexture?.dispose();
      this.sourceTexture = null;
      if (!ready) return;
      // A video needs VideoTexture: a plain texture would be sized from the element's (empty) width attribute.
      const texture = element instanceof HTMLVideoElement ? new THREE.VideoTexture(element) : new THREE.CanvasTexture(element);
      texture.colorSpace = THREE.NoColorSpace; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
      this.sourceTexture = texture; this.copy.uniforms.uImage.value = texture;
    }
    if (source.frameId === this.frameId) {
      if (this.moving && now - this.lastFrameAt > STALE_MS) this.stillFlow();
      return;
    }
    // After a gap (sleep, a stalled camera, a dragged window) the last frame is too old to compare with:
    // the difference would read as movement everywhere. Start again from this frame.
    if (this.primed && now - this.lastFrameAt > STALE_MS) { this.stillFlow(); this.primed = false; this.restarts++; }
    this.frameId = source.frameId; this.lastFrameAt = now;
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.width, height = element instanceof HTMLVideoElement ? element.videoHeight : element.height;
    const aspect = width / height, wide = 16 / 9;
    (this.copy.uniforms.uCrop.value as THREE.Vector2).set(Math.min(1, wide / aspect), Math.min(1, aspect / wide));
    this.copy.uniforms.uMirror.value = settings.mirror ? 1 : 0;
    this.sourceTexture!.needsUpdate = true;
    this.passes.draw(this.copy, this.frames.write);
    this.frames.swap();
    this.newImage = true;
    this.average.uniforms.uImage.value = this.frames.read.texture;
    this.passes.draw(this.average, this.lumas.write);
    this.lumas.swap();
    if (!this.primed) {
      // The first frame has nothing to compare with: hold it as its own "before".
      this.passes.draw(this.average, this.lumas.write);
      this.primed = true;
      return;
    }
    const u = this.measure.uniforms, box = settings.box;
    u.uNow.value = this.lumas.read.texture; u.uBefore.value = this.lumas.write.texture;
    u.uNoise.value = settings.noiseFloor; u.uSensitivity.value = settings.sensitivity;
    (u.uBox.value as THREE.Vector4).set(box.left, box.right, box.bottom, box.top);
    this.passes.draw(this.measure, this.raw);
    this.smooth.uniforms.uOld.value = this.flows.read.texture;
    this.passes.draw(this.smooth, this.flows.write);
    this.flows.swap();
    this.fresh = true; this.moving = true;
  }

  dispose(): void {
    this.sourceTexture?.dispose();
    this.provider?.dispose(); this.provider = null;
    this.peopleStage.dispose();
    for (const item of [this.frames, this.flows, this.lumas, this.average, this.raw, this.copy, this.measure, this.smooth, this.zero]) item.dispose();
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

/** Stands in for person finding that could not start or broke: says why, and finds nobody. */
class FailedProvider implements MaskProvider {
  readonly status: PeopleStatus;
  readonly ready = false;
  constructor(error: unknown) { this.status = { state: 'failed', reason: (error as Error)?.message ?? String(error) }; }
  submit(): void {}
  latest(): null { return null; }
  dispose(): void {}
}
