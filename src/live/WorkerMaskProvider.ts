/** The real mask provider: MediaPipe Multiclass in an inline Web Worker, restarted if it fails or stops answering. */
import PeopleWorker from './people-worker?worker&inline';
import { MaskGate, RestartPolicy, type Mask, type MaskProvider, type PeopleStatus } from './MaskProvider';

type Reply =
  | { data: Uint8Array; width: number; height: number; frameId: number; ms: number }
  | { skipped: true }
  | { error: string }
  | { loaded: true; delegate: string };

export class WorkerMaskProvider implements MaskProvider {
  status: PeopleStatus = { state: 'loading' };
  /** 'GPU' or 'CPU', once loaded. */
  delegate = '';
  private worker: Worker | null = null;
  private readonly gate = new MaskGate(() => performance.now());
  private readonly policy = new RestartPolicy();
  private mask: Mask | null = null;
  private loaded = false;
  private failed = false;
  private disposed = false;
  private readonly timings: number[] = [];

  constructor() { this.start(false); }

  get ready(): boolean { return !this.failed && this.gate.ready; }

  submit(frame: HTMLVideoElement | HTMLCanvasElement, frameId: number): void {
    if (this.failed || this.disposed) return;
    if (this.gate.behind) { this.trouble('People finding stopped answering.'); return; }
    if (!this.loaded || !this.worker) return;
    if (frame instanceof HTMLVideoElement && (frame.readyState < 2 || !frame.videoWidth)) return;
    if (!this.gate.offer()) return;
    const worker = this.worker;
    createImageBitmap(frame).then(bitmap => {
      if (this.disposed || worker !== this.worker) { bitmap.close(); return; }
      worker.postMessage({ bitmap, frameId, timestamp: performance.now() }, [bitmap]);
    }, () => this.gate.cancelled());
  }

  latest(): Mask | null { return this.mask; }

  dispose(): void { this.disposed = true; this.worker?.terminate(); this.worker = null; }

  private start(cpu: boolean): void {
    this.worker?.terminate();
    this.loaded = false; this.gate.reset();
    const worker = new PeopleWorker();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<Reply>) => { if (worker === this.worker) this.reply(event.data); };
    worker.onerror = event => { if (worker === this.worker) this.trouble(event.message || 'The person finder stopped.'); };
    worker.postMessage({ base: new URL('mediapipe', location.href).href, cpu });
  }

  private reply(reply: Reply): void {
    if (this.disposed) return;
    if ('error' in reply) { this.trouble(reply.error); return; }
    if ('loaded' in reply) { this.loaded = true; this.delegate = reply.delegate; if (this.status.state !== 'behind') this.status = { state: 'running', ms: 0 }; return; }
    if ('skipped' in reply) { this.gate.cancelled(); return; }
    this.gate.received(); this.policy.succeeded();
    this.mask = { data: reply.data, width: reply.width, height: reply.height, frameId: reply.frameId };
    this.timings.push(reply.ms); if (this.timings.length > 30) this.timings.shift();
    const sorted = [...this.timings].sort((a, b) => a - b);
    this.status = { state: 'running', ms: sorted[sorted.length >> 1] };
  }

  /** Something went wrong: restart the model, then restart it on the CPU, then give up and say why. */
  private trouble(reason: string): void {
    if (this.failed || this.disposed) return;
    const next = this.policy.failed();
    if (next === 'give-up') { this.failed = true; this.worker?.terminate(); this.worker = null; this.status = { state: 'failed', reason }; return; }
    this.status = { state: 'behind' };
    this.start(next === 'restart-cpu');
  }
}
