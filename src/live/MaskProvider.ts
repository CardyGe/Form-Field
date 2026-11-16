/**
 * Where person masks come from. The real one runs MediaPipe Multiclass in a
 * Web Worker so its ~40 ms per frame never blocks drawing. Frames that arrive
 * while the model is busy are dropped, never queued, so a mask is at most one
 * frame behind.
 */
/** Person likelihood 0..255, row 0 at the top of the source frame. */
export interface Mask { data: Uint8Array; width: number; height: number; frameId: number }
export type PeopleStatus = { state: 'loading' } | { state: 'running'; ms: number } | { state: 'failed'; reason: string } | { state: 'behind' };
export interface MaskProvider {
  /** Offers a frame. Ignored while the previous one is still being worked on. */
  submit(frame: HTMLVideoElement | HTMLCanvasElement, frameId: number): void;
  latest(): Mask | null;
  readonly status: PeopleStatus;
  /** A mask arrived within the last READY_MS. */
  readonly ready: boolean;
  dispose(): void;
}

/** Without a mask for this long, people count as not found. */
export const READY_MS = 2000;

/**
 * The scheduling rules, on their own so they can be tested with a fake clock.
 * One frame at a time: another is never sent while one is with the model, however long it takes.
 * A frame with the model for longer than READY_MS makes the model "behind"; the provider then restarts it.
 */
export class MaskGate {
  private sentAt: number | null = null;
  private lastAt: number | null = null;
  constructor(private readonly now: () => number) {}
  /** True if a frame may be sent now; the caller then sends it. */
  offer(): boolean {
    if (this.sentAt !== null) return false;
    this.sentAt = this.now();
    return true;
  }
  /** A mask came back. */
  received(): void { this.sentAt = null; this.lastAt = this.now(); }
  /** The frame never reached the model, or came back without a mask: free to send another, but it is not a mask. */
  cancelled(): void { this.sentAt = null; }
  /** Forget everything, as after restarting the model. */
  reset(): void { this.sentAt = null; this.lastAt = null; }
  get ready(): boolean { return this.lastAt !== null && this.now() - this.lastAt <= READY_MS; }
  get behind(): boolean { return this.sentAt !== null && this.now() - this.sentAt > READY_MS; }
}

/** What to do when person finding fails or stops answering: restart, then restart on the CPU, then give up until a mask arrives. */
export class RestartPolicy {
  private failures = 0;
  failed(): 'restart' | 'restart-cpu' | 'give-up' {
    this.failures++;
    return this.failures === 1 ? 'restart' : this.failures === 2 ? 'restart-cpu' : 'give-up';
  }
  succeeded(): void { this.failures = 0; }
}
