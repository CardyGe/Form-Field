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
import type { MaskProvider } from './MaskProvider';
import { Tracking, FLOW_SIZE } from './Tracking';
import { Paint } from './Paint';
import { Signal } from './Signal';
import { Smoke } from './Smoke';
import { Relief } from './Relief';
import { Meridian } from './Meridian';
import { WallLimiterGl } from '../map/wall-limiter-gl';
import { LIMITER, limiterScales } from '../meridian/wall-limiter';
import { MERIDIAN_DEFAULTS } from '../meridian/parameters';
import type { Look } from './look';
import { trackingViewFragment } from './tracking-shaders';
import { LiveModulator } from './modulate';
import type { Signals } from '../react/signals';

const looks = { paint: Paint, smoke: Smoke, relief: Relief, signal: Signal, meridian: Meridian };
/** Meridian on the Live output keeps to the same flash rule as the wall in Map, at Flash Guard's default strictness. */
const MERIDIAN_HOLDS = limiterScales({ safetyMaxFlashes: MERIDIAN_DEFAULTS.safetyMaxFlashes, safetyRedLimit: MERIDIAN_DEFAULTS.safetyRedLimit });

/** Operator setup view: the camera dimmed, people in blue with a pink outline. Never shown in the artwork window. */
const peopleViewFragment = /* glsl */`
uniform sampler2D uCamera, uPeople; uniform vec2 uTexel; uniform float uRoomMissing;
void main() {
  vec3 camera = texture2D(uCamera, vUv).rgb;
  float p = texture2D(uPeople, vUv).r;
  vec2 e = uTexel * 3.;
  float edge = step(.3, abs(texture2D(uPeople, vUv + vec2(e.x, 0.)).r - texture2D(uPeople, vUv - vec2(e.x, 0.)).r)
    + abs(texture2D(uPeople, vUv + vec2(0., e.y)).r - texture2D(uPeople, vUv - vec2(0., e.y)).r));
  vec3 c = camera * .45 + vec3(.05, .75, .9) * p * .55;
  c = mix(c, vec3(1., .2, .75), edge);
  // Use empty room is on but nothing is captured: an amber corner.
  if (uRoomMissing > .5 && vUv.x > .94 && vUv.y > .9) c = vec3(.95, .7, .2);
  gl_FragColor = vec4(c, 1.);
}`;

const finalFragment = /* glsl */`
uniform sampler2D uImage; uniform float uBlackout, uEncode;
vec3 encode(vec3 c) { c = clamp(c, 0., 1.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
void main() {
  vec3 c = texture2D(uImage, vUv).rgb;
  gl_FragColor = vec4(mix(c, encode(c), uEncode) * (1. - uBlackout), 1.);
}`;

export class LiveRenderer {
  settings: LiveSettings = defaultLiveSettings();
  blackout = false;
  /** This frame's sound, beat, tempo and MIDI; the settings' links read them. */
  signals: Signals = {};
  private readonly modulator = new LiveModulator();
  /** The settings the last frame was drawn with (links applied), for the scripted checks. */
  drawn: LiveSettings = this.settings;
  /** 'tracking' and 'people' are the operator's setup views. The artwork window never uses them. */
  view: 'art' | 'tracking' | 'people' = 'art';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly passes: Passes;
  private readonly final: THREE.ShaderMaterial;
  private readonly trackingView: THREE.ShaderMaterial;
  private peopleView: THREE.ShaderMaterial | null = null;
  private readonly tracking: Tracking;
  private look: Look | null = null;
  private signalSource: FrameSource['element'] = null;
  private lookKind: LiveSettings['look'] | null = null;
  private readonly black: THREE.DataTexture;
  private scratch: THREE.WebGLRenderTarget;
  private width = 0;
  private height = 0;
  private time = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private counted = { frames: 0, since: 0, worst: 0 };
  /** The flash limiter for Meridian's output, its 8-bit input, and whether it must start again from the next picture. */
  private limiter: WallLimiterGl | null = null;
  private limitInput: THREE.WebGLRenderTarget | null = null;
  private limitFresh = true;
  private limitCost = 0;
  /** Why the limiter could not run on the last Meridian frame; null when it ran. The picture is shown unlimited meanwhile. */
  limiterError: string | null = null;
  /** Whether the last frame went through the limiter. */
  limited = false;
  /** For the scripted checks: the artwork is replaced by a full-field white flash on every other frame. */
  flashTest = false;
  private flashOn = false;
  private readonly white: THREE.DataTexture;

  /** `makeProvider` starts person finding when a look needs people. Without it, people are never found. */
  /** How many frames have been drawn: Map waits for one before it shows Live. */
  framesDrawn = 0;

  /** preserveDrawingBuffer: keep the picture after it is shown, so Map's compositor can copy this canvas (Live in Map). */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly source: FrameSource, makeProvider?: () => MaskProvider, options: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: options.preserveDrawingBuffer === true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    try { this.passes = new Passes(this.renderer); } catch (error) { this.renderer.dispose(); throw error; }
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.white.needsUpdate = true;
    this.final = this.passes.material(finalFragment, { uImage: { value: this.black }, uBlackout: { value: 0 }, uEncode: { value: 1 } });
    this.tracking = new Tracking(this.passes, makeProvider);
    this.trackingView = this.passes.material(trackingViewFragment, { uCamera: { value: null }, uFlow: { value: null }, uBox: { value: new THREE.Vector4(0, 1, 0, 1) } });
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
    // The settings as set, with this frame's links applied to a copy. Everything below draws from the copy.
    const settings = this.drawn = this.modulator.apply(this.settings, this.signals, step);
    this.tracking.update(this.source, settings, step);
    if (this.lookKind !== this.settings.look) {
      // Switching looks starts the new one fresh; each keeps its own settings.
      this.look?.dispose();
      this.look = new looks[this.settings.look](this.passes, this.width, this.height);
      this.lookKind = this.settings.look;
    }
    if (!this.look) return;
    if (this.settings.look === 'signal' && this.signalSource !== this.source.element) this.look.clear();
    this.signalSource = this.source.element;
    if (this.look instanceof Meridian) this.look.signals = this.signals;
    this.look.step(step, this.time, this.tracking, settings);
    let image: THREE.Texture = this.look.output, encode = 1;
    if (this.flashTest) { this.flashOn = !this.flashOn; image = this.flashOn ? this.white : this.black; }
    if (this.view === 'tracking') {
      const u = this.trackingView.uniforms, box = this.settings.box;
      u.uCamera.value = this.tracking.camera; u.uFlow.value = this.tracking.flow;
      (u.uBox.value as THREE.Vector4).set(box.left, box.right, box.bottom, box.top);
      this.passes.draw(this.trackingView, this.scratch);
      image = this.scratch.texture; encode = 0;
    } else if (this.view === 'people') {
      this.peopleView ??= this.passes.material(peopleViewFragment, { uCamera: { value: null }, uPeople: { value: null }, uTexel: { value: new THREE.Vector2(1 / 640, 1 / 360) }, uRoomMissing: { value: 0 } });
      const u = this.peopleView.uniforms;
      u.uCamera.value = this.tracking.camera; u.uPeople.value = this.tracking.people;
      u.uRoomMissing.value = this.settings.people.useEmptyRoom && !this.tracking.roomCaptured ? 1 : 0;
      this.passes.draw(this.peopleView, this.scratch);
      image = this.scratch.texture; encode = 0;
    }
    this.final.uniforms.uImage.value = image;
    this.final.uniforms.uEncode.value = encode;
    this.final.uniforms.uBlackout.value = this.blackout ? 1 : 0;
    // Meridian's artwork goes through the wall's flash limiter. The setup views are the operator's only, so they never do.
    const guarded = this.settings.look === 'meridian' && this.view === 'art';
    if (!guarded || !this.limitOutput(seconds)) { this.passes.draw(this.final, null); this.limitFresh = true; this.limited = false; }
    this.framesDrawn++;
    this.counted.frames++;
  }

  /**
   * Draws the finished picture through the flash limiter onto the canvas, in the frame it limits, with no readback. Returns
   * false, having drawn nothing, if the limiter cannot run: the caller then shows the picture as it is and the warning stands.
   */
  private limitOutput(seconds: number): boolean {
    const started = performance.now(), gl = this.renderer.getContext() as WebGL2RenderingContext;
    try {
      if (!this.limiter || this.limiter.width !== this.width || this.limiter.height !== this.height) {
        this.limiter?.dispose(); this.limitInput?.dispose();
        this.limiter = new WallLimiterGl(gl, this.width, this.height);
        this.limitInput = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
        this.limitInput.texture.colorSpace = THREE.NoColorSpace;
        this.limitFresh = true;
      }
      this.passes.draw(this.final, this.limitInput!);
      const texture = (this.renderer.properties.get(this.limitInput!.texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
      if (!texture) throw new Error('the picture to limit could not be found');
      const dt = Number.isFinite(seconds) ? Math.min(LIMITER.longestStep, Math.max(0, seconds)) : 0;
      const done = this.limiter.limit(texture, null, this.limitFresh ? 0 : dt, 0, this.limitFresh, MERIDIAN_HOLDS);
      this.renderer.resetState();
      if (!done) { this.limiterError = this.limiter.error ?? 'the flash limiter could not start'; return false; }
      this.limitFresh = false; this.limiterError = null; this.limited = true;
      this.limitCost = this.limitCost * .95 + (performance.now() - started) * .05;
      return true;
    } catch (error) {
      this.renderer.resetState();
      this.limiterError = String((error as Error)?.message ?? error);
      return false;
    }
  }

  /** Meridian's own state and the limiter's, for the operator and the scripted checks: numbers and words, never a picture. */
  meridianReport(): (ReturnType<Meridian['diagnostics']> & { limiter: { on: boolean; error: string | null; area: number; cpuMs: number } }) | null {
    if (!(this.look instanceof Meridian)) return null;
    return { ...this.look.diagnostics(), limiter: { on: this.limited, error: this.limiterError, area: this.limiter?.limitedArea ?? 0, cpuMs: this.limitCost } };
  }

  /** For the scripted checks: how many bytes of the canvas differ from the picture the limiter was given. Call after a frame, in the same task. */
  probeLimiter(): { changedBytes: number; bytes: number; brightest: number } | null {
    if (!this.limitInput || !this.limited) return null;
    const gl = this.renderer.getContext(), w = this.width, h = this.height, input = new Uint8Array(w * h * 4), shown = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this.limitInput, 0, 0, w, h, input);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, shown); this.renderer.resetState();
    let changedBytes = 0, brightest = 0;
    for (let i = 0; i < input.length; i++) { if (input[i] !== shown[i]) changedBytes++; if ((i & 3) !== 3 && shown[i] > brightest) brightest = shown[i]; }
    return { changedBytes, bytes: input.length, brightest };
  }

  /** For the scripted checks: what one limiter frame costs the graphics card in ms, net of an empty round trip. The limiter then starts afresh. */
  probeLimiterCost(): { medianMs: number; worstMs: number } | null {
    if (!this.limiter || !this.limitInput || !this.limited) return null;
    const gl = this.renderer.getContext() as WebGL2RenderingContext, pixel = new Uint8Array(4), costs: number[] = [];
    const texture = (this.renderer.properties.get(this.limitInput.texture) as { __webglTexture?: WebGLTexture }).__webglTexture!;
    for (let i = 0; i < 40; i++) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const a = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const b = performance.now();
      this.limiter.limit(texture, null, 0, 0, false, MERIDIAN_HOLDS);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      costs.push(Math.max(0, performance.now() - b - (b - a)));
    }
    this.renderer.resetState(); this.limitFresh = true;
    costs.sort((x, y) => x - y);
    return { medianMs: costs[costs.length >> 1], worstMs: costs[costs.length - 1] };
  }

  /** For the scripted checks: makes the limiter unavailable, as on a graphics card that cannot run it. */
  breakLimiter(): void { this.limiter?.dispose(); this.limiter = { width: this.width, height: this.height, error: 'switched off for a check', limitedArea: 0, limit: () => false, dispose() {}, ready: () => false } as unknown as WallLimiterGl; }

  /** Wipes the artwork back to its ground. */
  clear(): void { this.look?.clear(); }
  /** Gives the graphics context back at once, for a canvas that will not be used again (Map's Live). */
  loseContext(): void { this.renderer.forceContextLoss(); }

  /** Frame rate and the longest gap between frames since the last call. */
  stats(): { fps: number; worstMs: number; frames: number } {
    const now = performance.now(), seconds = Math.max(1e-3, (now - this.counted.since) / 1000);
    const result = { fps: this.counted.frames / seconds, worstMs: this.counted.worst, frames: this.counted.frames };
    this.counted = { frames: 0, since: now, worst: 0 };
    return result;
  }

  /** People and the still timers as floats, row 0 at the bottom. For the scripted checks. */
  readPeople(): { people: { data: Float32Array; width: number; height: number }; still: { data: Float32Array; width: number; height: number } } {
    const read = (target: THREE.WebGLRenderTarget) => {
      const { width, height } = target;
      if (target.texture.type === THREE.FloatType) { const data = new Float32Array(width * height * 4); this.renderer.readRenderTargetPixels(target, 0, 0, width, height, data); return { data, width, height }; }
      const half = new Uint16Array(width * height * 4); this.renderer.readRenderTargetPixels(target, 0, 0, width, height, half);
      return { data: Float32Array.from(half, THREE.DataUtils.fromHalfFloat), width, height };
    };
    const { people, still } = this.tracking.peopleTargets;
    return { people: read(people), still: read(still) };
  }

  /** Read-only person-finding state: never any picture. */
  peopleDiagnostics(): { status: unknown; ready: boolean; masks: number; delegate: string; roomCaptured: boolean } {
    const t = this.tracking.peopleTargets;
    return { status: this.tracking.peopleStatus, ready: this.tracking.peopleReady, masks: t.masks, delegate: (t.provider as { delegate?: string } | null)?.delegate ?? '', roomCaptured: this.tracking.roomCaptured };
  }

  signalInteraction(): {energy:number;charge:number;burst:number} | null { return this.look instanceof Signal ? this.look.readGesture() : null; }

  captureRoom(): void { this.tracking.captureRoom(); }
  get roomCaptured(): boolean { return this.tracking.roomCaptured; }

  /** The movement field as floats, row 0 at the bottom. For the scripted checks. */
  readFlow(): { data: Float32Array; width: number; height: number } {
    const [width, height] = FLOW_SIZE, half = new Uint16Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.tracking.flowTarget, 0, 0, width, height, half);
    return { data: Float32Array.from(half, THREE.DataUtils.fromHalfFloat), width, height };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop(); this.disposed = true;
    for (const item of [this.final, this.trackingView, this.tracking, this.black, this.scratch]) item.dispose();
    this.limiter?.dispose(); this.limitInput?.dispose(); this.white.dispose();
    this.peopleView?.dispose();
    this.look?.dispose();
    this.passes.dispose(); this.renderer.dispose();
  }

  private resize(): void {
    const height = this.settings.quality === 720 ? 720 : 1080, width = height * 16 / 9;
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.scratch.setSize(width, height);
    this.look?.resize(width, height);
  }
}
