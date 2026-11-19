/**
 * Stage 6: one video playing on the projector (or the operator screen), for every shape that plays it, so those shapes
 * are always on the same frame. Looping and muted. Its frames are uploaded only when a new one has arrived. Until it
 * plays, and when its file is missing or cannot be played, it gives no picture: its shapes play their own fill.
 * After an error it does not try again until retry(), or a new path.
 */
import type { Signals } from '../react/signals';
import type { Gpu, Texture } from './gpu';
import type { VideoSource } from './show';
import { videoRate } from './videoRate';
import { videoUrl } from './videoUrl';

export type VideoState = 'loading' | 'playing' | 'missing' | 'unplayable';

export class VideoSlot {
  state: VideoState = 'loading';
  /** The beats a tempo loop plays as (it may differ from the chosen beats when the clip cannot fit them). */
  playsAs: number | null = null;
  /** Whether the last frame() uploaded a new picture. */
  fresh = false;
  private readonly video = document.createElement('video');
  private texture: Texture | null = null;
  private newFrame = false;
  private frozen = false;
  private loop = -1;
  private source: VideoSource;

  constructor(private readonly gpu: Gpu, source: VideoSource) {
    this.source = source;
    const v = this.video;
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.addEventListener('loadedmetadata', () => { v.width = v.videoWidth; v.height = v.videoHeight; });
    v.addEventListener('playing', () => { this.state = 'playing'; this.watchFrames(); });
    v.addEventListener('error', () => { void this.failed(); });
    this.load();
  }

  get aspect(): number { return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9; }

  update(source: VideoSource): void {
    const moved = source.path !== this.source.path;
    this.source = source;
    if (moved) this.load();
  }
  retry(): void { this.load(); }
  setFrozen(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    if (on) this.video.pause(); else if (this.state === 'playing') void this.video.play().catch(() => {});
  }

  /** The picture to draw: the latest frame, or null until it plays. `speed`: the Speed links leave it at this frame. */
  frame(signals: Signals, speed = this.source.speed): Texture | null {
    this.fresh = false;
    if (this.state !== 'playing') return null;
    const v = this.video;
    if (!this.frozen) {
      const { rate, beats } = videoRate(Number.isFinite(v.duration) ? v.duration : null, speed, this.source.tempoSync, signals['tempo.bpm'] ?? 120);
      this.playsAs = beats;
      if (Math.abs(v.playbackRate - rate) > 0.005) v.playbackRate = rate;
      // A tempo loop starts again on its beat.
      if (beats !== null && signals['tempo.beat'] !== undefined) {
        const loop = Math.floor(signals['tempo.beat'] / beats);
        if (loop !== this.loop) {
          // Joining mid-loop, it starts where the beat is; after that, each loop starts at its beginning.
          const into = (signals['tempo.beat'] - loop * beats) / beats;
          v.currentTime = this.loop === -1 ? Math.max(0, into * (v.duration || 0)) : 0;
          this.loop = loop;
        }
      } else this.loop = -1;
    }
    if (this.newFrame && v.videoWidth > 0) {
      this.newFrame = false;
      try { this.texture = this.gpu.upload(v, this.texture); this.fresh = true; } catch { this.state = 'unplayable'; return null; }
    }
    return this.texture;
  }
  /** The picture on screen now, for a fade away from this video. */
  get current(): Texture | null { return this.state === 'playing' ? this.texture : null; }

  dispose(): void {
    const v = this.video;
    v.pause(); v.removeAttribute('src'); v.load();
    if (this.texture) this.gpu.free(this.texture);
    this.texture = null;
  }

  private load(): void {
    this.state = 'loading'; this.loop = -1;
    this.video.src = videoUrl(this.source.path);
    void this.video.play().catch(() => { /* an error event says why */ });
  }
  private watchFrames(): void {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (!v.requestVideoFrameCallback) { this.newFrame = true; return; }
    const next = () => { this.newFrame = true; if (this.state === 'playing') v.requestVideoFrameCallback!(next); };
    v.requestVideoFrameCallback(next);
  }
  /** Missing (the file is gone or not allowed) or unplayable (a format the player cannot decode). */
  private async failed(): Promise<void> {
    const url = this.video.currentSrc || videoUrl(this.source.path);
    try { const res = await fetch(url, { method: 'HEAD' }); this.state = res.status === 404 || res.status === 403 ? 'missing' : 'unplayable'; }
    catch { this.state = 'missing'; }
  }
}
