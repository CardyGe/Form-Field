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
import type { MaskProvider } from './MaskProvider';
import { WorkerMaskProvider } from './WorkerMaskProvider';

export class Stage {
  readonly renderer: LiveRenderer;
  onState: (state: SourceState) => void = () => {};
  private readonly camera = new LiveSource();
  private pattern: TestSource | null = null;
  private active: FrameSource | null = null;
  private key = '';
  private raf = 0;
  private last = performance.now();
  /** Person finding, only while the look needs people. */
  private provider: MaskProvider | null = null;
  private submitted = -1;
  private masks = 0;
  private lastMask: unknown = null;

  constructor(canvas: HTMLCanvasElement) {
    const stage = this;
    this.renderer = new LiveRenderer(canvas, { get element() { return stage.active?.element ?? null; }, get frameId() { return stage.active?.frameId ?? 0; } });
    this.camera.onState = state => { if (this.active === this.camera || state.status !== 'idle') this.onState(state); };
    const tick = (now: number) => {
      this.pattern?.advance(Math.min(.1, (now - this.last) / 1000)); this.last = now;
      this.feedPeople();
      this.raf = requestAnimationFrame(tick);
    };
    // Read-only status for the scripted checks and for support: never any picture.
    window.__studioTest = { ...window.__studioTest, livePeople: () => ({ status: this.provider?.status ?? null, delegate: (this.provider as WorkerMaskProvider | null)?.delegate ?? '', ready: this.provider?.ready ?? false, masks: this.masks }) };
    this.raf = requestAnimationFrame(tick);
    this.renderer.start();
  }

  /** Follows the settings. The source is reopened only when the choice of source changes. */
  apply(settings: LiveSettings, file: File | null = null): void {
    this.renderer.settings = settings;
    const wantsPeople = settings.look === 'smoke';
    if (wantsPeople && !this.provider) { this.provider = new WorkerMaskProvider(); this.masks = 0; this.lastMask = null; }
    if (!wantsPeople && this.provider) { this.provider.dispose(); this.provider = null; }
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

  /** Offers each new camera frame to person finding. */
  private feedPeople(): void {
    const provider = this.provider, active = this.active;
    if (!provider || !active?.element) return;
    if (active.frameId !== this.submitted) { this.submitted = active.frameId; provider.submit(active.element, active.frameId); }
    const mask = provider.latest();
    if (mask && mask !== this.lastMask) { this.lastMask = mask; this.masks++; }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.provider?.dispose(); this.provider = null;
    this.camera.onState = () => {};
    this.camera.close();
    this.renderer.dispose();
  }
}
