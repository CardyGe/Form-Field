/**
 * Stage 6: one video playing on the projector (or the operator screen), for every shape that plays it, so those shapes
 * are always on the same frame. Looping and muted. Its frames are uploaded only when a new one has arrived. Until it
 * plays, and when its file is missing or cannot be played, it gives no picture: its shapes play their own fill.
 * After an error it does not try again until retry(), or a new path.
 */
import type { Signals } from '../react/signals';
import type { Gpu, Texture } from './gpu';
import type { VideoSource } from './show';
import { videoClock, videoLoop, videoRate } from './videoRate';
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
  /** Perform: the speed and bar offset last played at, and whether a speed of 0 is holding it on its frame. */
  private pace = 1;
  private offset = 0;
  private held = false;
  /** Bumped on every load, so a late answer about an older load is ignored. */
  private generation = 0;
  private watching = false;
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
    if (on) { this.video.pause(); return; }
    // Unfrozen: a video that loaded while frozen starts now; a tempo loop joins the beat where it is.
    this.loop = -1;
    if (!this.held && (this.state === 'playing' || this.state === 'loading')) void this.video.play().catch(() => {});
  }

  /**
   * The picture to draw: the latest frame, or null until it plays. `speed`: the Speed links leave it at this frame.
   * Perform: `pace` is the zone's speed (a tempo loop of n beats plays as n / pace beats; 0 holds the video on its
   * frame) and `offset` the beats taken off the count, so the loop starts on the corrected bar. Map leaves them at 1 and 0.
   */
  frame(signals: Signals, speed = this.source.speed, pace = 1, offset = 0): Texture | null {
    this.fresh = false;
    if (this.state !== 'playing') return null;
    const v = this.video;
    if (!this.frozen) {
      // A speed of 0 holds the video where it is, locked to the tempo or not; let go, it joins the beat where it is.
      const hold = !(pace > 0);
      if (hold !== this.held) { this.held = hold; this.loop = -1; if (hold) v.pause(); else void v.play().catch(() => {}); }
      // A new speed or bar moves every loop boundary: the video joins the new loop where the beat is, not at its start.
      if (pace !== this.pace || offset !== this.offset) { this.pace = pace; this.offset = offset; this.loop = -1; }
    }
    if (!this.frozen && !this.held) {
      const clock = videoClock(signals, pace, offset);
      const { rate, beats } = videoRate(Number.isFinite(v.duration) ? v.duration : null, speed, this.source.tempoSync, clock.bpm);
      this.playsAs = beats;
      if (Math.abs(v.playbackRate - rate) > 0.005) v.playbackRate = rate;
      // A tempo loop starts again on its beat.
      if (beats !== null && clock.count !== undefined) {
        const { loop, into } = videoLoop(clock.count, beats);
        if (loop !== this.loop) {
          // Joining mid-loop, it starts where the beat is; after that, each loop starts at its beginning.
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
    this.generation++;
    this.state = 'loading'; this.loop = -1;
    this.video.src = videoUrl(this.source.path);
    // Frozen, it loads but waits; it starts when unfrozen.
    if (!this.frozen) void this.video.play().catch(() => { /* an error event says why */ });
    else this.video.load();
  }
  private watchFrames(): void {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (!v.requestVideoFrameCallback) { this.newFrame = true; return; }
    // One chain of frame callbacks per video, however often it starts playing again.
    if (this.watching) return;
    this.watching = true;
    const next = () => { this.newFrame = true; if (this.state === 'playing') v.requestVideoFrameCallback!(next); else this.watching = false; };
    v.requestVideoFrameCallback(next);
  }
  /** Missing (the file is gone or not allowed) or unplayable (a format the player cannot decode). */
  private async failed(): Promise<void> {
    const url = this.video.currentSrc || videoUrl(this.source.path), generation = this.generation;
    let state: VideoState;
    try { const res = await fetch(url, { method: 'HEAD' }); state = res.status === 404 || res.status === 403 ? 'missing' : 'unplayable'; }
    catch { state = 'missing'; }
    if (generation === this.generation) this.state = state;
  }
}
