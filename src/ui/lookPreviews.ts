/**
 * Previews of Library presets for Map's look browser, made with one StudioRenderer: a still of each preset, made the
 * first time it is asked for and kept while the app is open, and a moving preview of one preset at a time (on hover).
 * The renderer, and its graphics context, is given back when the browser closes.
 */
import { StudioRenderer } from '../rendering/StudioRenderer';
import { presetComposition } from '../map/editor';
import { advancePhase } from '../map/playout';
import type { Project } from '../shared/types';

const SIZE = { width: 192, height: 108 };
const stills = new Map<string, string>();
const PREVIEW_SEED = 4242;

export class LookPreviews {
  private canvas = document.createElement('canvas');
  private renderer: StudioRenderer | null = null;
  private queue: { id: string; done: (url: string | null) => void }[] = [];
  private busy = false;
  private moving: { id: string; target: HTMLCanvasElement; project: Project | null; phase: number; last: number } | null = null;
  private raf = 0;
  private disposed = false;

  private get studio(): StudioRenderer | null {
    if (!this.renderer && !this.disposed) { try { this.renderer = new StudioRenderer(this.canvas); } catch { this.renderer = null; } }
    return this.renderer;
  }

  /** A still of the preset, as an image URL; from memory when it has been made before. */
  still(id: string): Promise<string | null> {
    const held = stills.get(id);
    if (held) return Promise.resolve(held);
    return new Promise(done => { this.queue.push({ id, done }); void this.next(); });
  }
  static known(id: string): string | undefined { return stills.get(id); }

  private async next(): Promise<void> {
    if (this.busy || this.moving) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      const project = presetComposition(job.id, PREVIEW_SEED), studio = this.studio;
      if (!project || !studio || this.disposed) { job.done(null); return; }
      await studio.prepare(project);
      if (this.disposed) { job.done(null); return; }
      // A little way into the loop, where most looks have something on screen.
      studio.render(project, Math.PI * 0.6, SIZE.width, SIZE.height);
      const copy = document.createElement('canvas'); copy.width = SIZE.width; copy.height = SIZE.height;
      copy.getContext('2d')!.drawImage(this.canvas, 0, 0, SIZE.width, SIZE.height);
      const url = copy.toDataURL('image/jpeg', 0.82);
      stills.set(job.id, url);
      job.done(url);
    } catch { job.done(null); }
    finally { this.busy = false; if (!this.disposed) void this.next(); }
  }

  /** Plays the preset into `target` until stop() (stills wait meanwhile). */
  play(id: string, target: HTMLCanvasElement): void {
    this.stop();
    const project = presetComposition(id, PREVIEW_SEED), studio = this.studio;
    if (!project || !studio) return;
    const moving = { id, target, project: null as Project | null, phase: Math.PI * 0.6, last: performance.now() };
    this.moving = moving;
    void studio.prepare(project).then(() => { if (this.moving === moving) moving.project = project; }).catch(() => {});
    const loop = (now: number) => {
      if (this.moving !== moving) return;
      this.raf = requestAnimationFrame(loop);
      if (!moving.project) return;
      moving.phase = advancePhase(moving.phase, (now - moving.last) / 1000, moving.project, 1);
      moving.last = now;
      try {
        studio.render(moving.project, moving.phase, SIZE.width, SIZE.height);
        target.getContext('2d')?.drawImage(this.canvas, 0, 0, target.width, target.height);
      } catch { /* a preview that cannot draw just stays still */ }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    if (this.moving) { this.moving = null; void this.next(); }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const job of this.queue.splice(0)) job.done(null);
    this.renderer?.dispose();
    (this.canvas.getContext('webgl2') ?? this.canvas.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
    this.renderer = null;
  }
}
