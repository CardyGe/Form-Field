/**
 * People in tracking: turns the model's masks into the `people` and `still`
 * textures looks read. Masks are lined up with the camera, smoothed, and
 * filtered by the area box, by how long nothing has moved there, and
 * optionally by agreement with a captured empty room.
 */
import * as THREE from 'three';
import type { Passes, Pair } from './passes';
import type { Mask, MaskProvider, PeopleStatus } from './MaskProvider';
import type { LiveSettings } from './settings';
import { alignFragment, copyFragment, fillFragment, globalFragment, memoryFragment, peopleFragment, stillFragment } from './people-shaders';

export const PEOPLE_SIZE = [640, 360] as const;
export const STILL_SIZE = [160, 90] as const;
/** Timers start here: "never moved". */
export const NEVER_MOVED = 1e4;
/** Brightness drift from the slow memory above which anything nearby counts as movement, sway included. Raised to the camera noise floor if that is higher. */
const ANY_MOVEMENT = .015;
/** How slowly the memory follows the picture: its time constant in seconds. */
const MEMORY_SECONDS = 1.5;
/** After a source starts, nothing counts as moved for this long: a camera settling its exposure must not mark the wall as moved. */
export const WARM_UP_SECONDS = 2;
/** How long the person takes to fade out when people stop being found, and back in when they are found again. */
export const PRESENCE_SECONDS = 1;
/** Movement per camera frame (uv) above which it counts as deliberate rather than sway: about 1.3 px a frame at 640 wide. */
const DELIBERATE_MOVEMENT = .002;

export class People {
  private readonly smoothed: Pair;
  private readonly timers: Pair;
  private readonly memory: Pair;
  private readonly remember: THREE.ShaderMaterial;
  private readonly globalTarget: THREE.WebGLRenderTarget;
  private readonly global: THREE.ShaderMaterial;
  private memoryPrimed = false;
  private lastFrameSeconds = 0;
  private startedAt: number | null = null;
  private readonly output: THREE.WebGLRenderTarget;
  private readonly room: THREE.WebGLRenderTarget;
  private readonly align: THREE.ShaderMaterial;
  private readonly time: THREE.ShaderMaterial;
  private readonly filter: THREE.ShaderMaterial;
  private readonly fill: THREE.ShaderMaterial;
  private readonly copy: THREE.ShaderMaterial;
  private raw: THREE.DataTexture | null = null;
  private lastMask: Mask | null = null;
  private haveMask = false;
  private captured = false;
  private captureNext = false;
  /** Masks taken since start, for diagnostics. */
  masks = 0;
  ready = false;
  /** 0..1: eases towards `ready`, so the person fades rather than popping in and out. */
  presence = 0;

  constructor(private readonly passes: Passes, flowSize: readonly [number, number], lumaSize: readonly [number, number]) {
    this.smoothed = passes.pair(...PEOPLE_SIZE);
    this.timers = passes.pair(...STILL_SIZE, { float: true, nearest: true });
    this.memory = passes.pair(...lumaSize);
    this.globalTarget = passes.target(1, 1, { float: true, nearest: true });
    this.global = passes.material(globalFragment, { uLuma: { value: null }, uMemory: { value: null }, uMask: { value: null }, uAny: { value: ANY_MOVEMENT } });
    this.remember = passes.material(memoryFragment, { uMemory: { value: null }, uLuma: { value: null }, uGlobal: { value: this.globalTarget.texture }, uRate: { value: 1 } });
    this.output = passes.target(...PEOPLE_SIZE);
    this.room = passes.target(...PEOPLE_SIZE);
    this.align = passes.material(alignFragment, { uRaw: { value: null }, uPrevious: { value: null }, uMirror: { value: 1 }, uCrop: { value: new THREE.Vector2(1, 1) } });
    this.time = passes.material(stillFragment, { uStill: { value: null }, uFlow: { value: null }, uLuma: { value: null }, uMemory: { value: null }, uMask: { value: null }, uGlobal: { value: this.globalTarget.texture }, uStep: { value: 0 }, uStillTexel: { value: new THREE.Vector2(1 / STILL_SIZE[0], 1 / STILL_SIZE[1]) },
      uTexel: { value: new THREE.Vector2(2 / flowSize[0], 2 / flowSize[1]) }, uLumaTexel: { value: new THREE.Vector2(1 / lumaSize[0], 1 / lumaSize[1]) },
      uAny: { value: ANY_MOVEMENT }, uDeliberate: { value: DELIBERATE_MOVEMENT } });
    this.filter = passes.material(peopleFragment, { uSmoothed: { value: null }, uStill: { value: null }, uCamera: { value: null }, uRoom: { value: this.room.texture },
      uBox: { value: new THREE.Vector4(0, 1, 0, 1) }, uIgnore: { value: 30 }, uUseRoom: { value: 0 }, uCaptured: { value: 0 }, uReady: { value: 0 },
      uTexel: { value: new THREE.Vector2(1 / PEOPLE_SIZE[0], 1 / PEOPLE_SIZE[1]) } });
    this.fill = passes.material(fillFragment, { uValue: { value: new THREE.Vector4() } });
    this.copy = passes.material(copyFragment, { uImage: { value: null } });
    this.reset();
  }

  get people(): THREE.Texture { return this.output.texture; }
  get still(): THREE.Texture { return this.timers.read.texture; }
  get peopleTarget(): THREE.WebGLRenderTarget { return this.output; }
  get stillTarget(): THREE.WebGLRenderTarget { return this.timers.read; }
  get roomCaptured(): boolean { return this.captured; }

  captureRoom(): void { this.captureNext = true; }

  /**
   * One display frame. `firstFrameId` is the lowest frame id that belongs to the current source:
   * a mask from before a source change is never used.
   */
  update(step: number, inputs: { camera: THREE.Texture; flow: THREE.Texture; luma: THREE.Texture; crop: THREE.Vector2; fresh: boolean; seconds: number; restarted?: boolean }, provider: MaskProvider, firstFrameId: number, settings: LiveSettings): void {
    const mask = provider.latest();
    if (mask && mask !== this.lastMask && mask.frameId >= firstFrameId) {
      this.lastMask = mask;
      this.upload(mask);
      const u = this.align.uniforms;
      u.uRaw.value = this.raw; u.uPrevious.value = this.smoothed.read.texture;
      u.uMirror.value = settings.mirror ? 1 : 0; (u.uCrop.value as THREE.Vector2).copy(inputs.crop);
      this.passes.draw(this.align, this.smoothed.write);
      this.smoothed.swap();
      this.haveMask = true; this.masks++;
    }
    this.ready = this.haveMask && provider.ready;
    const wasPresent = this.presence > 0;
    this.presence = Math.min(1, Math.max(0, this.presence + (this.ready ? 1 : -1) * step / PRESENCE_SECONDS));
    // Once faded right out, the old mask is forgotten, so the next person found does not start from a ghost of the last.
    if (wasPresent && this.presence === 0 && !this.ready) {
      (this.fill.uniforms.uValue.value as THREE.Vector4).set(0, 0, 0, 1);
      this.passes.draw(this.fill, this.smoothed.read); this.passes.draw(this.fill, this.smoothed.write);
    }

    // After a stall the camera may have changed a lot: settle again, as at start, keeping the timers.
    if (inputs.restarted) this.startedAt = null;
    this.startedAt ??= inputs.seconds;
    const warming = inputs.seconds - this.startedAt < WARM_UP_SECONDS;
    // An empty-room capture waits for a settled camera: it is taken from the first frame after warm-up.
    if (this.captureNext && inputs.fresh && !warming) {
      this.copy.uniforms.uImage.value = inputs.camera;
      this.passes.draw(this.copy, this.room);
      this.captured = true; this.captureNext = false;
    }
    // How much of the picture changed at once, measured before the memory moves on.
    const g = this.global.uniforms;
    g.uLuma.value = inputs.luma; g.uMemory.value = this.memory.read.texture; g.uMask.value = this.smoothed.read.texture; g.uAny.value = Math.max(ANY_MOVEMENT, settings.noiseFloor);
    this.passes.draw(this.global, this.globalTarget);
    if (inputs.fresh) {
      // While warming up the memory simply follows the picture, so nothing reads as moved at start.
      const r = this.remember.uniforms, elapsed = inputs.seconds - this.lastFrameSeconds;
      r.uMemory.value = this.memory.read.texture; r.uLuma.value = inputs.luma;
      r.uRate.value = this.memoryPrimed && !warming ? 1 - Math.exp(-Math.max(0, elapsed) / MEMORY_SECONDS) : 1;
      this.passes.draw(this.remember, this.memory.write); this.memory.swap();
      this.memoryPrimed = true; this.lastFrameSeconds = inputs.seconds;
    }
    const t = this.time.uniforms;
    t.uStill.value = this.timers.read.texture; t.uFlow.value = inputs.flow; t.uStep.value = this.memoryPrimed ? step : 0;
    t.uLuma.value = inputs.luma; t.uMemory.value = this.memory.read.texture; t.uMask.value = this.smoothed.read.texture;
    t.uAny.value = warming ? 1e9 : Math.max(ANY_MOVEMENT, settings.noiseFloor); t.uDeliberate.value = warming ? 1e9 : DELIBERATE_MOVEMENT;
    this.passes.draw(this.time, this.timers.write);
    this.timers.swap();

    const f = this.filter.uniforms, box = settings.box;
    f.uSmoothed.value = this.smoothed.read.texture; f.uStill.value = this.timers.read.texture; f.uCamera.value = inputs.camera;
    (f.uBox.value as THREE.Vector4).set(box.left, box.right, box.bottom, box.top);
    f.uIgnore.value = settings.people.ignoreStillSeconds ?? -1;
    f.uUseRoom.value = settings.people.useEmptyRoom ? 1 : 0; f.uCaptured.value = this.captured ? 1 : 0; f.uReady.value = this.presence;
    this.passes.draw(this.filter, this.output);
  }

  /** A new source or no source: nothing carries over, and every point starts as never moved. */
  reset(): void {
    const value = this.fill.uniforms.uValue.value as THREE.Vector4;
    value.set(0, 0, 0, 1);
    for (const target of [this.smoothed.read, this.smoothed.write, this.output, this.room]) this.passes.draw(this.fill, target);
    value.set(NEVER_MOVED, NEVER_MOVED, 0, 1);
    this.passes.draw(this.fill, this.timers.read); this.passes.draw(this.fill, this.timers.write);
    this.memoryPrimed = false; this.startedAt = null;
    // A capture asked for while a source is starting is kept, and taken once that source has settled.
    this.haveMask = false; this.ready = false; this.presence = 0; this.captured = false; this.lastMask = null;
  }

  dispose(): void {
    this.raw?.dispose();
    for (const item of [this.smoothed, this.timers, this.memory, this.remember, this.globalTarget, this.global, this.output, this.room, this.align, this.time, this.filter, this.fill, this.copy]) item.dispose();
  }

  private upload(mask: Mask): void {
    if (!this.raw || this.raw.image.width !== mask.width || this.raw.image.height !== mask.height) {
      this.raw?.dispose();
      this.raw = new THREE.DataTexture(new Uint8Array(mask.width * mask.height), mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
      this.raw.minFilter = this.raw.magFilter = THREE.LinearFilter;
    }
    (this.raw.image.data as Uint8Array).set(mask.data);
    this.raw.needsUpdate = true;
  }
}

export type { PeopleStatus };
