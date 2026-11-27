/** Live-only transition clock. Export always renders the saved shape. */
export interface FoldTransitionSettings {
  shape: number;
  duration: number;
  hold: number;
  angle: number;
  nextBeat: boolean;
}

export interface FoldTransitionFrame {
  from: number;
  to: number;
  mix: number;
  angle: number;
}

const STILL = { mix: 1, angle: 0 };

export class FoldTransition {
  private shape: number;
  private active: { to: number; start: number; duration: number; hold: number; angle: number } | null = null;
  private queued: { shape: number; beat: number | null; fallback: number } | null = null;
  private holdUntil = 0;

  constructor(shape: number) { this.shape = shape; }

  update(settings: FoldTransitionSettings, now: number, beat: number | null): FoldTransitionFrame {
    if (this.active && now >= this.active.start + this.active.duration) {
      this.shape = this.active.to;
      this.holdUntil = this.active.start + this.active.duration + this.active.hold;
      this.active = null;
    }

    const destination = this.active?.to ?? this.shape;
    if (settings.shape === destination) this.queued = null;
    else if (this.queued?.shape !== settings.shape) {
      this.queued = { shape: settings.shape, beat: null, fallback: 0 };
    }

    if (!this.active && this.queued && now >= this.holdUntil) {
      const queued = this.queued;
      if (settings.nextBeat && queued.fallback === 0) {
        queued.beat = beat === null ? null : Math.floor(beat) + 1;
        queued.fallback = now + (beat === null ? 500 - now%500 : 1500);
      }
      if (!settings.nextBeat || (beat !== null && queued.beat !== null && beat >= queued.beat)
          || ((beat === null || queued.beat === null) && now >= queued.fallback)) {
        this.queued = null;
        if (settings.duration > 0) {
          this.active = { to: queued.shape, start: now, duration: settings.duration*1000,
            hold: settings.hold*1000, angle: settings.angle };
        } else {
          this.shape = queued.shape;
          this.holdUntil = now + settings.hold*1000;
        }
      }
    }

    if (!this.active) return { from: this.shape, to: this.shape, ...STILL };
    return { from: this.shape, to: this.active.to,
      mix: Math.max(0, Math.min(1, (now - this.active.start)/this.active.duration)), angle: this.active.angle };
  }

  get pending(): boolean { return this.active !== null || this.queued !== null; }
}
