export const STRIDE = 12; // kind,x,y,p0,p1,p2,width,glow,colour,alpha,tear,seed
const DEFAULT_CAPACITY = 20000;

/**
 * Fixed instance buffer. Positions are centred, in units of frame height. `width` is in output pixels.
 * ring: x,y centre, p0 radius.
 * arc: x,y centre, p0 radius, p1 start angle, p2 sweep.
 * segment: x,y start, p0,p1 end.
 * square, dot: x,y centre, p0 half size, p1 rotation. `width` is unused.
 */
export class DisplayList {
  readonly data: Float32Array;
  count = 0;
  dropped = 0;
  private readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : DEFAULT_CAPACITY;
    this.data = new Float32Array(this.capacity * STRIDE);
  }

  clear(): void {
    this.count = 0;
    this.dropped = 0;
  }

  push(kind: number, x: number, y: number, p0: number, p1: number, p2: number, width: number, glow: number, colour: number, alpha: number, tear: number, seed: number): void {
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const data = this.data;
    const at = this.count++ * STRIDE;
    data[at] = kind;
    data[at + 1] = x;
    data[at + 2] = y;
    data[at + 3] = p0;
    data[at + 4] = p1;
    data[at + 5] = p2;
    data[at + 6] = width;
    data[at + 7] = glow;
    data[at + 8] = colour;
    data[at + 9] = alpha;
    data[at + 10] = tear;
    data[at + 11] = seed;
  }
}
