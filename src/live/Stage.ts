/**
 * One canvas showing Live: it owns the renderer and whichever source the
 * settings ask for. The operator preview and the artwork window each run one,
 * never both at once.
 */
import { LiveRenderer } from './LiveRenderer';
import { LiveSource, type SourceState } from './source';
import { TestSource } from './test-source';
import type { FrameSource } from './look';
import type { LiveSettings } from './settings';

export class Stage {
  readonly renderer: LiveRenderer;
  onState: (state: SourceState) => void = () => {};
  private readonly camera = new LiveSource();
  private pattern: TestSource | null = null;
  private active: FrameSource | null = null;
  private key = '';
  private raf = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    const stage = this;
    this.renderer = new LiveRenderer(canvas, { get element() { return stage.active?.element ?? null; }, get frameId() { return stage.active?.frameId ?? 0; } });
    this.camera.onState = state => { if (this.active === this.camera || state.status !== 'idle') this.onState(state); };
    const tick = (now: number) => { this.pattern?.advance(Math.min(.1, (now - this.last) / 1000)); this.last = now; this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
    this.renderer.start();
  }

  /** Follows the settings. The source is reopened only when the choice of source changes. */
  apply(settings: LiveSettings, file: File | null = null): void {
    this.renderer.settings = settings;
    const { kind, deviceId } = settings.source;
    const key = kind === 'camera' ? `camera:${deviceId ?? ''}` : kind === 'file' ? `file:${file ? `${file.name}:${file.size}:${file.lastModified}` : ''}` : 'test';
    if (key === this.key) return;
    this.key = key;
    if (kind === 'test') {
      this.camera.close();
      this.pattern = new TestSource(); this.active = this.pattern;
      this.onState({ status: 'running', label: 'Test pattern', width: 640, height: 360 });
      return;
    }
    this.pattern = null; this.active = this.camera;
    if (kind === 'camera') void this.camera.openCamera(deviceId);
    else if (file) void this.camera.openFile(file);
    else { this.camera.close(); this.onState({ status: 'error', message: 'Choose a video file to play.' }); }
  }

  /** Opens the current source again, for example after a camera was reconnected. */
  retry(settings: LiveSettings, file: File | null = null): void { this.key = ''; this.apply(settings, file); }

  listCameras() { return this.camera.listCameras(); }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.camera.onState = () => {};
    this.camera.close();
    this.renderer.dispose();
  }
}
