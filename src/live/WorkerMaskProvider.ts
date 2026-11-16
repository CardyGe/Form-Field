/** The real mask provider: MediaPipe Multiclass in an inline Web Worker. */
import PeopleWorker from './people-worker?worker&inline';
import { MaskGate, type Mask, type MaskProvider, type PeopleStatus } from './MaskProvider';

type Reply = { data: Uint8Array; width: number; height: number; frameId: number; ms: number } | { error: string } | { loaded: true; delegate: string };

export class WorkerMaskProvider implements MaskProvider {
  status: PeopleStatus = { state: 'loading' };
  /** 'GPU' or 'CPU', once loaded. */
  delegate = '';
  private readonly worker: Worker;
  private readonly gate = new MaskGate(() => performance.now());
  private mask: Mask | null = null;
  private loaded = false;
  private failed = false;
  private disposed = false;
  private readonly timings: number[] = [];

  constructor() {
    this.worker = new PeopleWorker();
    this.worker.onmessage = (event: MessageEvent<Reply>) => this.reply(event.data);
    this.worker.onerror = event => this.fail(event.message || 'The person finder stopped.');
    this.worker.postMessage({ base: new URL('mediapipe', location.href).href });
  }

  get ready(): boolean { return this.gate.ready; }

  submit(frame: HTMLVideoElement | HTMLCanvasElement, frameId: number): void {
    if (!this.loaded || this.failed || this.disposed) return;
    if (frame instanceof HTMLVideoElement && (frame.readyState < 2 || !frame.videoWidth)) return;
    if (this.gate.behind && this.status.state === 'running') this.status = { state: 'behind' };
    if (!this.gate.offer()) return;
    createImageBitmap(frame).then(bitmap => {
      if (this.disposed) { bitmap.close(); return; }
      this.worker.postMessage({ bitmap, frameId, timestamp: performance.now() }, [bitmap]);
    }, () => this.gate.received());
  }

  latest(): Mask | null { return this.mask; }

  dispose(): void { this.disposed = true; this.worker.terminate(); }

  private reply(reply: Reply): void {
    if (this.disposed) return;
    if ('error' in reply) { this.fail(reply.error); return; }
    if ('loaded' in reply) { this.loaded = true; this.delegate = reply.delegate; this.status = { state: 'running', ms: 0 }; return; }
    this.gate.received();
    this.mask = { data: reply.data, width: reply.width, height: reply.height, frameId: reply.frameId };
    this.timings.push(reply.ms); if (this.timings.length > 30) this.timings.shift();
    const sorted = [...this.timings].sort((a, b) => a - b);
    this.status = { state: 'running', ms: sorted[sorted.length >> 1] };
  }

  private fail(reason: string): void {
    this.failed = true;
    this.status = { state: 'failed', reason };
  }
}
