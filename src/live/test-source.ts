/**
 * A synthetic camera for development and the scripted checks: two bright,
 * textured discs sweeping left and right on fixed rows over a dark room.
 * Never shown to an audience.
 */
import type { FrameSource } from './look';

export const TEST_FPS = 30;
export interface Disc { x: number; y: number; radius: number; vx: number }

export class TestSource implements FrameSource {
  readonly element: HTMLCanvasElement;
  frameId = 0;
  /** False holds the discs still while frames keep arriving, like people standing still. */
  moving = true;
  private time = 0;
  private clock = 0;
  private readonly context: CanvasRenderingContext2D;

  constructor(width = 640, height = 360) {
    this.element = document.createElement('canvas');
    this.element.width = width; this.element.height = height;
    this.context = this.element.getContext('2d')!;
    this.paint();
  }

  /** The discs in uv, origin bottom-left, x not mirrored. vx is uv per second. */
  discs(): Disc[] {
    const t = this.time;
    return [
      { x: .5 + .32 * Math.sin(t * 1.7), y: .7, radius: .11, vx: .32 * 1.7 * Math.cos(t * 1.7) },
      { x: .5 - .32 * Math.sin(t * 1.3), y: .3, radius: .11, vx: -.32 * 1.3 * Math.cos(t * 1.3) },
    ];
  }

  advance(seconds: number): void {
    this.clock += seconds;
    const frame = Math.floor(this.clock * TEST_FPS + 1e-6);
    if (frame === this.frameId) return;
    if (this.moving) this.time += (frame - this.frameId) / TEST_FPS;
    this.frameId = frame;
    this.paint();
  }

  private paint(): void {
    const c = this.context, w = this.element.width, h = this.element.height;
    c.fillStyle = '#16181c'; c.fillRect(0, 0, w, h);
    for (const [index, disc] of this.discs().entries()) {
      const x = disc.x * w, y = (1 - disc.y) * h, r = disc.radius * h;
      const fill = c.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
      fill.addColorStop(0, index ? '#ffe9c4' : '#d6f0ff'); fill.addColorStop(.6, index ? '#c98f52' : '#5f9fd0'); fill.addColorStop(1, '#30343c');
      c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      // Stripes give the tracker detail to hold on to inside the disc.
      c.save(); c.beginPath(); c.arc(x, y, r * .8, 0, Math.PI * 2); c.clip(); c.strokeStyle = 'rgba(10,12,16,.55)'; c.lineWidth = r * .09;
      for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(x + k * r * .27, y - r); c.lineTo(x + k * r * .27 + r * .3, y + r); c.stroke(); }
      c.restore();
    }
  }
}
