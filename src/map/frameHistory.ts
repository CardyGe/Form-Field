/**
 * Map stage 7, Stagger: the last second of a source's pictures, so each shape of a staggered group can show it a
 * little later than the one before. Copies are kept 30 a second, at most 960 pixels a side, and only while a
 * staggered group plays the source.
 */
import type { Gpu, Texture } from './gpu';

export const HISTORY_FPS = 30;
/** One second, plus the newest. */
export const HISTORY_SIZE = HISTORY_FPS + 1;
const MAX_SIDE = 960;

/** Which kept copy shows `delayS` seconds ago: `newest` is the last written, `written` how many have been kept. */
export function historyIndex(ringSize: number, newest: number, delayS: number, fps: number, written: number): number {
  const back = Math.min(Math.round(Math.max(0, delayS) * fps), ringSize - 1, Math.max(0, written - 1));
  return ((newest - back) % ringSize + ringSize) % ringSize;
}

export class FrameHistory {
  private readonly ring: (Texture | null)[] = new Array(HISTORY_SIZE).fill(null);
  private newest = -1;
  private written = 0;
  private lastAt = -Infinity;

  constructor(private readonly gpu: Gpu) {}

  /** Keeps a copy of the picture if a thirtieth of a second has passed on the show's clock. */
  push(source: Texture, clockMs: number): void {
    if (clockMs - this.lastAt < 1000 / HISTORY_FPS - 1 && clockMs >= this.lastAt) return;
    this.lastAt = clockMs;
    const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
    this.newest = (this.newest + 1) % HISTORY_SIZE;
    this.ring[this.newest] = this.gpu.scaledCopy(source, this.ring[this.newest], w, h);
    this.written = Math.min(HISTORY_SIZE, this.written + 1);
  }

  /** The copy from `delayS` seconds ago (or the oldest kept); null before anything is kept. */
  at(delayS: number): Texture | null {
    if (this.written === 0) return null;
    return this.ring[historyIndex(HISTORY_SIZE, this.newest, delayS, HISTORY_FPS, this.written)];
  }

  dispose(): void { for (const t of this.ring) this.gpu.free(t); this.ring.fill(null); this.written = 0; this.newest = -1; }
}
