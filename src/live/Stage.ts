/**
 * One canvas showing Live: it owns the renderer and whichever source the
 * settings ask for. The operator preview and the artwork window each run one,
 * never both at once.
 */
import { LiveRenderer } from './LiveRenderer';
import { LiveSource, type SourceState } from './source';
import { TestSource, TestMaskProvider } from './test-source';
import type { FrameSource } from './look';
import { usesPeople, type LiveSettings } from './settings';
import type { PeopleStatus } from './MaskProvider';
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
  /** Gaps between display frames since the last mark, for the performance check. */
  private gaps: number[] = [];

  constructor(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}) {
    const stage = this;
    this.renderer = new LiveRenderer(canvas, { get element() { return stage.active?.element ?? null; }, get frameId() { return stage.active?.frameId ?? 0; } }, () => {
      const pattern = stage.pattern;
      // The synthetic people of the rehearsal patterns are found by the stand-in model, which knows their shapes.
      return pattern?.audience || pattern?.crowd ? new TestMaskProvider(() => pattern) : new WorkerMaskProvider();
    }, options);
    this.camera.onState = state => { if (this.active === this.camera || state.status !== 'idle') this.onState(state); };
    const tick = (now: number) => {
      if (this.gaps.length < 100000) this.gaps.push(now - this.last);
      if (this.pattern) this.pattern.moving = !this.pattern.signalDemo || this.pattern.seconds % 7 >= 3;
      this.pattern?.advance(Math.min(.1, (now - this.last) / 1000)); this.last = now;
      this.raf = requestAnimationFrame(tick);
    };
    // Read-only status for the scripted checks and for support: never any picture.
    window.__studioTest = { ...window.__studioTest, livePeople: () => this.renderer.peopleDiagnostics(), liveDrawn: () => this.renderer.drawn, liveMeridian: () => this.renderer.meridianReport(),
      liveFrames: { mark: () => { this.gaps = []; }, read: () => frameStats(this.gaps) } };
    this.raf = requestAnimationFrame(tick);
    this.renderer.start();
  }

  /** Follows the settings. The source is reopened only when the choice of source changes. */
  apply(settings: LiveSettings, file: File | null = null): void {
    this.renderer.settings = settings;
    const { kind, deviceId } = settings.source;
    const key = kind === 'camera' ? `camera:${deviceId ?? ''}` : kind === 'file' ? `file:${file ? `${file.name}:${file.size}:${file.lastModified}` : ''}` : 'test';
    if (this.pattern) this.setTestPattern(this.pattern, settings);
    if (key === this.key) return;
    this.key = key;
    if (kind === 'test') {
      this.camera.close();
      this.pattern = new TestSource();
      this.setTestPattern(this.pattern, settings);
      this.active = this.pattern;
      this.onState({ status: 'running', label: 'Test pattern', width: 640, height: 360 });
      return;
    }
    this.pattern = null; this.active = this.camera;
    if (kind === 'camera') void this.camera.openCamera(deviceId);
    else if (file) void this.camera.openFile(file);
    else { this.camera.close(); this.onState({ status: 'error', message: 'Choose a video file to play.' }); }
  }

  private setTestPattern(pattern: TestSource, settings: LiveSettings): void {
    const relief = settings.look === 'relief';
    pattern.volley = relief && settings.relief.motion === 'ricochet' && !settings.reliefPresence;
    pattern.audience = relief && !pattern.volley;
    pattern.figure = settings.look === 'signal' || settings.look === 'smoke';
    pattern.signalDemo = settings.look === 'signal';
    // Meridian rehearses with a crowd: people walking in, standing still, crossing and moving together.
    if (settings.look === 'meridian') pattern.crowd ??= 'demo'; else pattern.crowd = null;
  }

  /** Opens the current source again, for example after a camera was reconnected. */
  retry(settings: LiveSettings, file: File | null = null): void { this.key = ''; this.apply(settings, file); }

  listCameras() { return this.camera.listCameras(); }

  /** Person finding as the operator sees it: status and whether the empty room is captured. */
  peopleReport(): { people: PeopleStatus | null; roomCaptured: boolean } {
    const d = this.renderer.peopleDiagnostics();
    return { people: usesPeople(this.renderer.settings) ? d.status as PeopleStatus : null, roomCaptured: this.renderer.roomCaptured };
  }

  /** Meridian's word for the operator: who is there, the camera, and the flash limiter. Null for other looks. */
  meridianReadout(): { status: string; bodies: number; limiterOn: boolean; limiterError: string | null } | null {
    const r = this.renderer.meridianReport();
    return r ? { status: r.status, bodies: r.bodies, limiterOn: r.limiter.on, limiterError: r.limiter.error } : null;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.camera.onState = () => {};
    this.camera.close();
    this.renderer.dispose();
  }
}

/** Frame-rate summary of display-frame gaps in milliseconds. */
function frameStats(gaps: number[]): { frames: number; fps: number; worstMs: number; p99Ms: number; over25ms: number } {
  const sorted = [...gaps].sort((a, b) => a - b), total = gaps.reduce((a, b) => a + b, 0);
  return { frames: gaps.length, fps: total ? gaps.length / (total / 1000) : 0, worstMs: sorted[sorted.length - 1] ?? 0,
    p99Ms: sorted[Math.floor(sorted.length * .99)] ?? 0, over25ms: gaps.filter(g => g > 25).length };
}
