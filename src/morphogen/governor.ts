export interface QualityState { steps: number; simHeight: 432 | 576 | 720; bloom: boolean }

const WINDOW = 30, DROP_AT = 12, LATE = 1.25, CALM_MS = 10_000, FAILED_RAISE_MS = 5_000, TRUSTED_RAISE_MS = 60_000, MAX_BACKOFF = 32;

/** Steps first, because they cost the most and show the least; then simulation size; bloom last. */
function ladder(base: QualityState['simHeight']): QualityState[] {
  const small = Math.min(base, 432) as QualityState['simHeight'];
  const rungs: QualityState[] = [{ steps: 12, simHeight: base, bloom: true }, { steps: 8, simHeight: base, bloom: true }, { steps: 5, simHeight: base, bloom: true }];
  if (small !== base) rungs.push({ steps: 5, simHeight: small, bloom: true });
  rungs.push({ steps: 5, simHeight: small, bloom: false });
  return rungs;
}

/** Lowers quality under sustained overload and raises it after sustained headroom, waiting longer each time a raise fails. */
export class QualityGovernor {
  private rungs: QualityState[];
  private level = 0;
  private readonly late: boolean[] = [];
  private calm = 0;
  private sinceRaise = 0;
  private raised = false;
  private backoff = 1;

  constructor(base: QualityState['simHeight'] = 576) { this.rungs = ladder(base); }

  get state(): QualityState { return this.rungs[this.level]; }

  /** A new quality choice from the operator. Starts again from the top of that ladder. */
  setBase(base: QualityState['simHeight']): void {
    if (this.rungs[0].simHeight === base) return;
    this.rungs = ladder(base); this.level = 0; this.late.length = 0; this.calm = 0; this.raised = false; this.backoff = 1;
  }

  update(frameMs: number, budgetMs: number): QualityState {
    const isLate = frameMs > budgetMs * LATE;
    this.late.push(isLate);
    if (this.late.length > WINDOW) this.late.shift();
    const lateFrames = this.late.reduce((n, v) => n + (v ? 1 : 0), 0);
    this.sinceRaise += frameMs;
    if (this.raised && this.sinceRaise > TRUSTED_RAISE_MS) { this.raised = false; this.backoff = 1; }
    if (lateFrames >= DROP_AT) {
      if (this.level < this.rungs.length - 1) this.level++;
      if (this.raised && this.sinceRaise < FAILED_RAISE_MS) this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2);
      this.raised = false; this.late.length = 0; this.calm = 0;
    } else if (lateFrames > 3) this.calm = 0;
    else if (!isLate) {
      this.calm += frameMs;
      if (this.level > 0 && this.calm >= CALM_MS * this.backoff) { this.level--; this.calm = 0; this.sinceRaise = 0; this.raised = true; }
    }
    return this.state;
  }
}

/** The display's frame time, from the steady low end of recent frames. Overload can never make it look like a slower display. */
export class DisplayBudget {
  private readonly samples: number[] = [];
  private budget = 16.7;
  private count = 0;

  estimate(frameMs: number): number {
    this.samples.push(frameMs);
    if (this.samples.length > 120) this.samples.shift();
    if (this.samples.length >= 30 && ++this.count % 15 === 0) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.budget = Math.min(16.7, Math.max(4, sorted[Math.floor(sorted.length * .1)]));
    }
    return this.budget;
  }
}
