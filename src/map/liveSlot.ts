/**
 * Live in Map: the one Live a show plays, on the projector (or on the operator screen while the output is closed).
 * It runs the Live screen's look with its own camera on its own canvas, at Live's own 16:9 size; the compositor
 * uploads that canvas once a frame and lays it on every shape that plays Live. Until it has a picture made with the
 * camera running, it gives none, and those shapes play their own fill: never black while the camera or people-finding
 * starts. A camera that cannot play (refused, missing, lost) also leaves the shapes on their fill.
 */
import { Stage } from '../live/Stage';
import { usesCamera, usesPeople, type LiveSettings } from '../live/settings';
import type { SourceState } from '../live/source';
import type { Signals } from '../react/signals';
import type { Gpu, Texture } from './gpu';
import { liveReadiness, type LiveReadiness } from './liveReady';

/** Live draws at this shape whatever its quality. */
export const LIVE_ASPECT = 16 / 9;

export class LiveSlot {
  state: SourceState = { status: 'idle' };
  /** Its own graphics context was lost: the compositor makes a new Live. */
  broken = false;
  private readonly canvas = document.createElement('canvas');
  private readonly stage: Stage;
  private texture: Texture | null = null;
  private uploaded = -1;
  /** framesDrawn when the camera last came up: only frames drawn after it carry the camera's picture. */
  private runningSince = Number.POSITIVE_INFINITY;
  private frozen = false;
  private fileChosen = false;
  /** Whether the last frame() uploaded a new picture (the stage must be drawn again). */
  fresh = false;

  constructor(private readonly gpu: Gpu, settings: LiveSettings) {
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.broken = true; });
    this.stage = new Stage(this.canvas, { preserveDrawingBuffer: true });
    this.stage.onState = state => {
      if (state.status === 'running' && this.state.status !== 'running') this.runningSince = this.stage.renderer.framesDrawn;
      if (state.status !== 'running') this.runningSince = Number.POSITIVE_INFINITY;
      this.state = state;
    };
    this.setSettings(settings);
  }

  setSettings(settings: LiveSettings): void {
    // The Live screen's Blackout and setup views never reach Map's projector.
    this.stage.renderer.view = 'art';
    this.stage.renderer.blackout = false;
    // A video file plays on the Live screen only. Here Live waits on the test pattern, unseen; its shapes play their fill.
    this.fileChosen = settings.source.kind === 'file';
    this.stage.apply(this.fileChosen ? { ...settings, source: { kind: 'test', deviceId: settings.source.deviceId } } : settings);
  }

  setSignals(signals: Signals): void { if (!this.frozen) this.stage.renderer.signals = signals; }
  /** Freeze holds Live's picture where it is. */
  setFrozen(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    if (on) this.stage.renderer.stop(); else this.stage.renderer.start();
  }
  clear(): void { this.stage.renderer.clear(); }
  captureRoom(): void { this.stage.renderer.captureRoom(); }
  retry(settings: LiveSettings): void { this.stage.retry(settings.source.kind === 'file' ? { ...settings, source: { kind: 'test', deviceId: settings.source.deviceId } } : settings); }

  /** Morphogen mode on the MIDImix, for the operator's screen. */
  get midimix(): { active: boolean; look: number | null; queued: number | null } | null { return this.stage.renderer.midimix; }

  get readiness(): LiveReadiness {
    const settings = this.stage.renderer.settings, people = this.stage.renderer.peopleDiagnostics();
    return liveReadiness(this.state, { file: this.fileChosen, needsCamera: usesCamera(settings), warming: !this.stage.renderer.lookReady, needsPeople: usesPeople(settings), peopleLoading: people.status === 'loading' || (people.status as { state?: string } | null)?.state === 'loading',
      drawnSinceRunning: this.stage.renderer.framesDrawn - this.runningSince, hasPicture: this.texture !== null });
  }

  /** The picture to draw this frame: uploaded when Live has drawn a new one, else the last; null until Live can play. */
  frame(): Texture | null {
    this.fresh = false;
    const readiness = this.broken ? 'cannot' : this.readiness;
    if (readiness === 'hold') return this.texture;
    if (readiness !== 'play') return null;
    const drawn = this.stage.renderer.framesDrawn;
    if (drawn !== this.uploaded && this.canvas.width > 0) {
      this.texture = this.gpu.upload(this.canvas, this.texture);
      this.uploaded = drawn;
      this.fresh = true;
    }
    return this.texture;
  }
  /** The picture on the wall now, for a fade away from Live. */
  get current(): Texture | null { const r = this.readiness; return r === 'play' || r === 'hold' ? this.texture : null; }

  dispose(): void {
    // Its canvas is never used again: the context goes back now, not when collected, so making Live again later never
    // pushes the projector's own context out.
    this.broken = true;
    this.stage.dispose();
    try { this.stage.renderer.loseContext(); } catch { /* already gone */ }
    if (this.texture) this.gpu.free(this.texture);
    this.texture = null;
  }
}
