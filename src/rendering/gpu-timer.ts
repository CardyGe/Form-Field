interface DisjointTimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface Query { pass: string; query: WebGLQuery }

/**
 * Per-pass GPU timing through EXT_disjoint_timer_query_webgl2. Queries are
 * never nested; results arrive a few frames late, so call poll() each frame.
 */
export class GpuTimer {
  readonly available: boolean;
  private readonly ext: DisjointTimerExtension | null;
  private open: Query | null = null;
  private pending: Query[] = [];
  private readonly samples: Record<string, number[]> = {};

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerExtension | null;
    this.available = this.ext !== null;
  }

  begin(pass: string): void {
    if (!this.ext || this.open) return;
    const query = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.open = { pass, query };
  }

  end(): void {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open); this.open = null;
  }

  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT));
    const waiting: Query[] = [];
    for (const item of this.pending) {
      if (!disjoint && !gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) { waiting.push(item); continue; }
      if (!disjoint) (this.samples[item.pass] ??= []).push(Number(gl.getQueryParameter(item.query, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(item.query);
    }
    this.pending = waiting;
  }

  /** Forgets collected samples; queries still in flight are kept and will land afterwards. */
  reset(): void {
    for (const key of Object.keys(this.samples)) delete this.samples[key];
  }

  /** Milliseconds per sample, keyed by pass label. */
  results(): Record<string, number[]> {
    return Object.fromEntries(Object.entries(this.samples).map(([k, v]) => [k, [...v]]));
  }

  dispose(): void {
    if (this.open && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const item of [...this.pending, ...(this.open ? [this.open] : [])]) this.gl.deleteQuery(item.query);
    this.open = null; this.pending = [];
  }
}
