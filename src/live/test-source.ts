/**
 * A synthetic camera for development and the scripted checks: two bright,
 * textured discs sweeping left and right on fixed rows over a dark room.
 * Never shown to an audience.
 */
import type { FrameSource } from './look';
import { READY_MS, type Mask, type MaskProvider, type PeopleStatus } from './MaskProvider';

export const TEST_FPS = 30;
export interface Disc { x: number; y: number; radius: number; vx: number }

export class TestSource implements FrameSource {
  readonly element: HTMLCanvasElement;
  frameId = 0;
  /** False holds the discs still while frames keep arriving, like people standing still. */
  moving = true;
  /** Draws a person-shaped figure (and a poster on the wall) instead of the discs. */
  figure = false;
  /** Holds the figure in place with a slight sway, like a person standing still. */
  standing = false;
  private time = 0;
  private clock = 0;
  private swayTime = 0;
  private standX = -1;
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

  /** Simulated seconds since the source started. */
  get seconds(): number { return this.clock; }

  /** The figure's centre in uv (origin bottom-left, not mirrored) and its height in uv. */
  figurePlace(): { x: number; y: number; height: number } {
    const sway = this.standing ? Math.sin(this.swayTime * 2.4) * SWAY_PX / this.element.width : 0;
    return { x: (this.standing ? this.standX : .5 + .2 * Math.sin(this.time * 1.2)) + sway, y: .45, height: .7 };
  }

  /** The poster: a fixed rectangle on the wall in uv (origin bottom-left), which the stand-in model wrongly calls a person. */
  static readonly POSTER = { left: .86, right: .97, bottom: .6, top: .85 };

  /** Fills the figure's silhouette, and optionally the poster, in the current fill style, at canvas size w × h (row 0 at the top). */
  drawPeople(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, poster: boolean): void {
    const f = this.figurePlace(), cx = f.x * w, cy = (1 - f.y) * h, u = f.height * h;
    c.beginPath(); c.arc(cx, cy - u * .36, u * .09, 0, Math.PI * 2); c.fill();                       // head
    c.beginPath(); c.roundRect(cx - u * .13, cy - u * .26, u * .26, u * .42, u * .06); c.fill();      // body
    c.beginPath(); c.roundRect(cx - u * .3, cy - u * .24, u * .19, u * .06, u * .03); c.fill();       // arms
    c.beginPath(); c.roundRect(cx + u * .11, cy - u * .24, u * .19, u * .06, u * .03); c.fill();
    c.beginPath(); c.roundRect(cx - u * .11, cy + u * .14, u * .09, u * .3, u * .03); c.fill();       // legs
    c.beginPath(); c.roundRect(cx + u * .02, cy + u * .14, u * .09, u * .3, u * .03); c.fill();
    if (poster) { const p = TestSource.POSTER; c.fillRect(p.left * w, (1 - p.top) * h, (p.right - p.left) * w, (p.top - p.bottom) * h); }
  }

  advance(seconds: number): void {
    this.clock += seconds;
    const frame = Math.floor(this.clock * TEST_FPS + 1e-6);
    if (frame === this.frameId) return;
    const elapsed = (frame - this.frameId) / TEST_FPS;
    if (this.figure && this.standing) { if (this.standX === -1) this.standX = .5 + .2 * Math.sin(this.time * 1.2); this.swayTime += elapsed; }
    else { this.standX = -1; if (this.moving) this.time += elapsed; }
    this.frameId = frame;
    this.paint();
  }

  private paint(): void {
    const c = this.context, w = this.element.width, h = this.element.height;
    c.fillStyle = '#16181c'; c.fillRect(0, 0, w, h);
    if (this.figure) { this.paintFigure(w, h); return; }
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

  private paintFigure(w: number, h: number): void {
    const c = this.context;
    // The poster: a picture on the wall, never moving.
    const p = TestSource.POSTER;
    c.fillStyle = '#c9a463'; c.fillRect(p.left * w, (1 - p.top) * h, (p.right - p.left) * w, (p.top - p.bottom) * h);
    // The figure: a lit body with some detail, so brightness varies across it.
    const f = this.figurePlace(), cx = f.x * w, cy = (1 - f.y) * h, u = f.height * h;
    const light = c.createLinearGradient(cx - u * .3, cy - u * .45, cx + u * .3, cy + u * .45);
    light.addColorStop(0, '#f2e6d8'); light.addColorStop(.5, '#a07a62'); light.addColorStop(1, '#3a2c26');
    c.fillStyle = light; this.drawPeople(c, w, h, false);
    c.strokeStyle = 'rgba(20,16,14,.6)'; c.lineWidth = u * .015;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(cx - u * .12, cy - u * .2 + k * u * .07); c.lineTo(cx + u * .12, cy - u * .16 + k * u * .07); c.stroke(); }
  }
}

/** Sway of a standing figure, in source pixels each way. */
export const SWAY_PX = 2;

/** A stand-in for the model: the figure's known shape, plus the poster it gets wrong. Uses the source's simulated clock. */
export class TestMaskProvider implements MaskProvider {
  private mask: Mask | null = null;
  private lastAt = -Infinity;
  private disposed = false;
  private readonly canvas = new OffscreenCanvas(256, 144);
  private readonly context = this.canvas.getContext('2d', { willReadFrequently: true })!;
  /** For checks: the stand-in model calls 90% of the frame a person. */
  coverAll = false;
  constructor(private readonly source: () => TestSource) {}
  get status(): PeopleStatus { return this.disposed ? { state: 'failed', reason: 'stopped' } : { state: 'running', ms: 1 }; }
  get ready(): boolean { return !this.disposed && (this.source().seconds * 1000 - this.lastAt) <= READY_MS; }
  submit(_frame: HTMLVideoElement | HTMLCanvasElement, frameId: number): void {
    if (this.disposed) return;
    const c = this.context, { width: w, height: h } = this.canvas, source = this.source();
    c.clearRect(0, 0, w, h); c.fillStyle = '#fff'; source.drawPeople(c, w, h, true);
    if (this.coverAll) c.fillRect(w * .05, 0, w * .9, h);
    const rgba = c.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
    this.mask = { data, width: w, height: h, frameId };
    this.lastAt = source.seconds * 1000;
  }
  latest(): Mask | null { return this.mask; }
  dispose(): void { this.disposed = true; }
}
