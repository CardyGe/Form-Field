/**
 * GPU time per render pass, for the benchmark harness.
 *
 * The renderer calls mark('composite') before each pass. Each mark ends the
 * section before it and starts a new one, so a frame is covered by sections
 * that sit back to back: WebGL allows only one timer query at a time, and
 * back-to-back sections need no nesting. end() closes the last section.
 *
 * Results arrive a few frames late, in the order the queries were issued;
 * poll() collects whatever is ready. When the GPU reports a disjoint event
 * (clock change, context switch) every query in flight is unreliable, so the
 * frames they belong to are reported as incomplete and left out of totals.
 *
 * Without EXT_disjoint_timer_query_webgl2, create() returns null and the
 * harness falls back to CPU wall time with a readback fence.
 */
import type { PassSample } from '../core/bench-stats';

/** What StudioRenderer needs: a way to name the pass that starts now, and to close the last one. */
export interface PassTimer { mark(pass: string): void; end(): void }

interface Ext { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface Pending { query: WebGLQuery; pass: string; frame: number }

export class GpuTimer implements PassTimer {
  /** Frames that lost at least one section to a disjoint event. */
  readonly incomplete = new Set<number>();
  private frame = 0;
  private active: Pending | null = null;
  private pending: Pending[] = [];
  private readonly free: WebGLQuery[] = [];

  private constructor(private readonly gl: WebGL2RenderingContext, private readonly ext: Ext) {}

  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as Ext | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  /** Sections marked from now on belong to this frame. */
  beginFrame(frame: number): void { this.stop(); this.frame = frame; }

  mark(pass: string): void {
    this.stop();
    const query = this.free.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { query, pass, frame: this.frame };
  }

  end(): void { this.stop(); }

  /** Results ready so far, oldest first. */
  poll(): PassSample[] {
    const gl = this.gl, out: PassSample[] = [];
    // Reading the flag also clears it, so read it once and apply it to this batch.
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    if (disjoint) {
      for (const p of this.pending) { this.incomplete.add(p.frame); this.free.push(p.query); }
      if (this.active) this.incomplete.add(this.active.frame);
      this.pending = [];
      return out;
    }
    let ready = 0;
    for (const p of this.pending) {
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) break;
      out.push({ frame: p.frame, pass: p.pass, ms: (gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number) / 1e6 });
      this.free.push(p.query);
      ready++;
    }
    this.pending.splice(0, ready);
    return out;
  }

  /** Queries still waiting for the GPU. */
  get waiting(): number { return this.pending.length + (this.active ? 1 : 0); }

  dispose(): void {
    this.stop();
    for (const p of this.pending) this.gl.deleteQuery(p.query);
    for (const q of this.free) this.gl.deleteQuery(q);
    this.pending = []; this.free.length = 0;
  }

  private stop(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
}
