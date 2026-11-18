/**
 * Live in Map: the one Live a show plays, on the projector (or on the operator screen while the output is closed).
 * It runs the Live screen's look with its own camera on its own canvas, at Live's own 16:9 size; the compositor
 * uploads that canvas once a frame and lays it on every shape that plays Live. Until it has a picture, it gives none,
 * and those shapes play their own fill: never black while the camera or people-finding starts.
 */
import { Stage } from '../live/Stage';
import type { LiveSettings } from '../live/settings';
import type { SourceState } from '../live/source';
import type { Signals } from '../react/signals';
import type { Gpu, Texture } from './gpu';

/** Live draws at this shape whatever its quality. */
export const LIVE_ASPECT = 16 / 9;

export class LiveSlot {
  state: SourceState = { status: 'idle' };
  private readonly canvas = document.createElement('canvas');
  private readonly stage: Stage;
  private texture: Texture | null = null;
  private uploaded = -1;
  private frozen = false;

  constructor(private readonly gpu: Gpu, settings: LiveSettings) {
    this.stage = new Stage(this.canvas, { preserveDrawingBuffer: true });
    this.stage.onState = state => { this.state = state; };
    this.setSettings(settings);
  }

  /** A video file plays on the Live screen only: here Live waits, and its shapes play their own fill. */
  get playable(): boolean { return this.stage.renderer.settings.source.kind !== 'file'; }

  setSettings(settings: LiveSettings): void {
    // The Live screen's Blackout and setup views never reach Map's projector.
    this.stage.renderer.view = 'art';
    this.stage.renderer.blackout = false;
    if (settings.source.kind === 'file') { this.stage.apply({ ...settings, source: { kind: 'test', deviceId: settings.source.deviceId } }); this.fileChosen = true; return; }
    this.fileChosen = false;
    this.stage.apply(settings);
  }
  private fileChosen = false;

  setSignals(signals: Signals): void { if (!this.frozen) this.stage.renderer.signals = signals; }
  /** Freeze holds Live's picture where it is. */
  setFrozen(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    if (on) this.stage.renderer.stop(); else this.stage.renderer.start();
  }
  clear(): void { this.stage.renderer.clear(); }
  captureRoom(): void { this.stage.renderer.captureRoom(); }
  retry(settings: LiveSettings): void { this.stage.retry(settings); }

  /**
   * The picture to draw this frame: uploaded when Live has drawn a new one, else the last; null until the source runs
   * and Live has drawn, or when a video file is chosen.
   */
  frame(): Texture | null {
    if (this.fileChosen) return null;
    const running = this.state.status === 'running';
    const drawn = this.stage.renderer.framesDrawn;
    if (running && drawn > 0 && drawn !== this.uploaded && this.canvas.width > 0) {
      this.texture = this.gpu.upload(this.canvas, this.texture);
      this.uploaded = drawn;
    }
    // The camera lost or refused: the shapes go back to their own fill until it returns.
    return running ? this.texture : null;
  }
  /** True when the picture changed since the last frame (so the stage must be drawn again). */
  get fresh(): boolean { return this.stage.renderer.framesDrawn !== this.uploaded; }
  get current(): Texture | null { return this.state.status === 'running' && !this.fileChosen ? this.texture : null; }

  dispose(): void {
    this.stage.dispose();
    if (this.texture) this.gpu.free(this.texture);
    this.texture = null;
  }
}
