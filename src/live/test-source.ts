/**
 * A synthetic camera for development, scripted checks, and the Signal demo.
 */
import type { FrameSource } from './look';
import { READY_MS, type Mask, type MaskProvider, type PeopleStatus } from './MaskProvider';

export const TEST_FPS = 30;
export interface Disc { x: number; y: number; radius: number; vx: number }
/** One person of a crowd scene: centre in uv (origin bottom-left), height in uv, arm lift 0 (down) to 1 (overhead), stride phase. */
export interface CrowdFigure { x: number; y: number; height: number; arms: number; stride: number }
/**
 * Meridian's rehearsal scenes. `demo` loops a minute: an empty room, one person walking in, standing still, bursting into
 * motion, three people crossing, eight people moving together, and the room emptying again. `proof` is the same story in 30 s.
 * The others hold one situation for the checks.
 */
export const CROWD_SCENES = ['demo', 'proof', 'one', 'three', 'eight', 'cross', 'still', 'empty'] as const;
export type CrowdScene = typeof CROWD_SCENES[number];

// Lateral position, crouch depth, shoulder angles, elbow bend, and foot spread.
const DEMO_POSES = [
  [0, 0, .15, .15, .35, .35, .07],
  [-.16, .015, 1.3, -.55, .4, -.35, .19],
  [-.06, .075, .65, .8, .7, .7, .14],
  [.08, 0, 1.45, 1.65, .45, .35, .085],
  [.18, .045, -.55, 1.25, -.45, .55, .225],
  [.025, .02, -.8, .35, 1.35, .95, .105],
];

function demoPose(time: number): number[] {
  const beat = time / .67;
  const index = Math.floor(beat) % DEMO_POSES.length;
  const progress = Math.max(0, (beat % 1 - .18) / .82);
  const blend = progress * progress * (3 - 2 * progress);
  return DEMO_POSES[index].map((value, joint) => value + (DEMO_POSES[(index + 1) % DEMO_POSES.length][joint] - value) * blend);
}

export class TestSource implements FrameSource {
  readonly element: HTMLCanvasElement;
  frameId = 0;
  /** False holds the discs still while frames keep arriving, like people standing still. */
  moving = true;
  /** Draws a person-shaped figure (and a poster on the wall) instead of the discs. */
  figure = false;
  /** Two performers for the Relief rehearsal pattern. */
  audience = false;
  /** Opposing sweeps on one row for the Ricochet rehearsal. */
  volley = false;
  /** The public Signal demo uses moving arms and a clean synthetic person mask. */
  signalDemo = false;
  /** Holds the figure in place with a slight sway, like a person standing still. */
  standing = false;
  /** For checks: bright stripes scrolling across the whole frame, so everything moves. */
  field = false;
  /** For checks: added to the whole picture, like a lighting change or a camera re-exposing. 0..1. */
  brightness = 0;
  /** Meridian's crowd scenes: people-shaped figures that walk, cross, stand still and dance. */
  crowd: CrowdScene | null = null;
  private time = 0;
  private clock = 0;
  private swayTime = 0;
  private standX = -1;
  private manualPose: number[] | null = null;
  private targetPose: number[] | null = null;
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
    if (this.volley) {
      const advance = .19*(1-Math.cos(1.9*t))*.5;
      const velocity = .19*.95*Math.sin(1.9*t);
      return [
        { x: .21+advance, y: .54, radius: .085, vx: velocity },
        { x: .79-advance, y: .54, radius: .085, vx: -velocity },
      ];
    }
    return [
      { x: .5 + .32 * Math.sin(t * 1.7), y: .7, radius: .11, vx: .32 * 1.7 * Math.cos(t * 1.7) },
      { x: .5 - .32 * Math.sin(t * 1.3), y: .3, radius: .11, vx: -.32 * 1.3 * Math.cos(t * 1.3) },
    ];
  }

  /** Simulated seconds since the source started. */
  get seconds(): number { return this.clock; }

  /** Screen coordinates, 0–1 from the top left. Raising the pointer raises the arms. */
  aim(x: number, y: number): void {
    this.manualPose ??= demoPose(this.time);
    const side = 2 * x - 1;
    const arms = 1.6 - 2.4 * y;
    this.targetPose = [side * .34, Math.max(0, y - .55) * .18,
      arms + side * .38, arms - side * .38, .45 + side * .4, .45 - side * .4, .08 + .1 * y];
  }

  private currentPose(): number[] { return this.manualPose ?? demoPose(this.time); }

  /** The figure's centre in uv (origin bottom-left, not mirrored) and its height in uv. */
  figurePlace(): { x: number; y: number; height: number } {
    if (this.signalDemo) {
      const [offset, crouch] = this.currentPose();
      return { x: .5 + offset, y: .48 - crouch, height: .7 };
    }
    const sway = this.standing ? Math.sin(this.swayTime * 2.4) * SWAY_PX / this.element.width : 0;
    return { x: (this.standing ? this.standX : .5 + .2 * Math.sin(this.time * 1.2)) + sway, y: .45, height: .7 };
  }

  /** The poster: a fixed rectangle on the wall in uv (origin bottom-left), which the stand-in model wrongly calls a person. */
  static readonly POSTER = { left: .86, right: .97, bottom: .6, top: .85 };

  /** Fills the figure's silhouette, and optionally the poster, in the current fill style, at canvas size w × h (row 0 at the top). */
  drawPeople(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, poster: boolean): void {
    if (this.audience) { this.drawAudience(c, w, h); return; }
    if (this.crowd) { for (const f of this.crowdFigures()) drawFigure(c, f, w, h); return; }
    const f = this.figurePlace(), cx = f.x * w, cy = (1 - f.y) * h, u = f.height * h;
    c.beginPath(); c.arc(cx, cy - u * .36, u * .09, 0, Math.PI * 2); c.fill();                       // head
    c.beginPath(); c.roundRect(cx - u * .13, cy - u * .26, u * .26, u * .42, u * .06); c.fill();      // body
    if (this.signalDemo) {
      const [, crouch, leftAngle, rightAngle, leftBend, rightBend, spread] = this.currentPose();
      c.save();
      c.strokeStyle = c.fillStyle;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const side of [-1, 1]) {
        const shoulderX = cx + side * u * .09, shoulderY = cy - u * .21;
        const angle = side < 0 ? leftAngle : rightAngle;
        const forearm = angle + (side < 0 ? leftBend : rightBend);
        const elbowX = shoulderX + side * Math.cos(angle) * u * .15;
        const elbowY = shoulderY - Math.sin(angle) * u * .15;
        c.lineWidth = u * .061;
        c.beginPath();
        c.moveTo(shoulderX, shoulderY);
        c.lineTo(elbowX, elbowY);
        c.lineTo(elbowX + side * Math.cos(forearm) * u * .15, elbowY - Math.sin(forearm) * u * .15);
        c.stroke();

        c.lineWidth = u * .08;
        c.beginPath();
        c.moveTo(cx + side * u * .065, cy + u * .125);
        c.lineTo(cx + side * u * (spread + crouch), cy + u * .27);
        c.lineTo(cx + side * u * spread, cy + u * (.44 - crouch / .7));
        c.stroke();
      }
      c.restore();
    } else {
      c.beginPath(); c.roundRect(cx - u * .3, cy - u * .24, u * .19, u * .06, u * .03); c.fill();
      c.beginPath(); c.roundRect(cx + u * .11, cy - u * .24, u * .19, u * .06, u * .03); c.fill();
      c.beginPath(); c.roundRect(cx - u * .11, cy + u * .14, u * .09, u * .3, u * .03); c.fill();
      c.beginPath(); c.roundRect(cx + u * .02, cy + u * .14, u * .09, u * .3, u * .03); c.fill();
    }
    if (poster) { const p = TestSource.POSTER; c.fillRect(p.left * w, (1 - p.top) * h, (p.right - p.left) * w, (p.top - p.bottom) * h); }
  }

  private drawAudience(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number): void {
    const phase = (this.time % 5) / 5;
    const reach = Math.sin(Math.PI * phase) ** 6;
    for (const side of [-1,1]) {
      const x = w * (.5 + side * (.255 - .075 * reach));
      const shoulder = h * (side < 0 ? .4 : .42);
      c.beginPath(); c.ellipse(x, shoulder-h*.115, h*.050, h*.066, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.roundRect(x-h*.074, shoulder-h*.045, h*.148, h*.29, h*.045); c.fill();
      for (const leg of [-1,1]) {
        c.beginPath(); c.roundRect(x+leg*h*.045-h*.031, shoulder+h*.185, h*.063, h*.26, h*.027); c.fill();
      }
      const inward = -side;
      const arm = new Path2D();
      arm.moveTo(x+inward*h*.041, shoulder);
      arm.quadraticCurveTo(x+inward*h*.16, shoulder+h*.12*(1-reach), x+inward*h*(.08+.29*reach), shoulder+h*(.19-.23*reach));
      arm.moveTo(x+side*h*.045, shoulder);
      arm.quadraticCurveTo(x+side*h*.105, shoulder+h*.08, x+side*h*.12, shoulder+h*.19);
      c.save();
      c.strokeStyle = c.fillStyle; c.lineWidth = h*.056; c.lineCap = 'round';
      c.stroke(arm); c.restore();
    }
  }

  advance(seconds: number): void {
    this.clock += seconds;
    const frame = Math.floor(this.clock * TEST_FPS + 1e-6);
    if (frame === this.frameId) return;
    const elapsed = (frame - this.frameId) / TEST_FPS;
    const { manualPose, targetPose } = this;
    if (manualPose && targetPose) {
      const follow = 1 - Math.exp(-elapsed / .055);
      this.manualPose = manualPose.map((joint, index) => joint + (targetPose[index] - joint) * follow);
    }
    if (this.figure && this.standing) { if (this.standX === -1) this.standX = .5 + .2 * Math.sin(this.time * 1.2); this.swayTime += elapsed; }
    else { this.standX = -1; if (this.moving) this.time += elapsed; }
    this.frameId = frame;
    this.paint();
  }

  private paint(): void {
    const c = this.context, w = this.element.width, h = this.element.height;
    c.fillStyle = '#16181c'; c.fillRect(0, 0, w, h);
    if (this.audience) {
      const cloth = c.createLinearGradient(0,0,w,h);
      cloth.addColorStop(0,'#eadac1'); cloth.addColorStop(1,'#887db5');
      c.fillStyle = cloth; this.drawAudience(c,w,h);
      return;
    }
    if (this.crowd) { this.paintCrowd(w, h); return; }
    if (this.figure) this.paintFigure(w, h);
    if (this.field) {
      for (let x = -80; x < w + 80; x += 40) { c.fillStyle = (x / 40) % 2 ? '#fff4d0' : '#ffe0f0'; c.fillRect(x + (this.time * 120) % 80, 0, 20, h); }
    }
    if (this.brightness > 0) { c.fillStyle = `rgba(255,255,255,${this.brightness})`; c.fillRect(0, 0, w, h); }
    if (this.figure || this.field) return;
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

  /** The people of the current crowd scene at this moment. */
  crowdFigures(): CrowdFigure[] { return this.crowd ? crowdAt(this.crowd, this.time) : []; }

  private paintCrowd(w: number, h: number): void {
    const c = this.context;
    for (const [index, f] of this.crowdFigures().entries()) {
      const cx = f.x * w, cy = (1 - f.y) * h, u = f.height * h;
      const light = c.createLinearGradient(cx - u * .3, cy - u * .45, cx + u * .3, cy + u * .45);
      light.addColorStop(0, index % 2 ? '#e8dcf2' : '#f2e6d8'); light.addColorStop(.5, index % 2 ? '#7d6ea0' : '#a07a62'); light.addColorStop(1, '#2e2a33');
      c.fillStyle = light; drawFigure(c, f, w, h);
      // Stripes on the clothes give movement something to hold on to.
      c.strokeStyle = 'rgba(20,16,14,.55)'; c.lineWidth = Math.max(1, u * .015);
      for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(cx - u * .12, cy - u * .2 + k * u * .07); c.lineTo(cx + u * .12, cy - u * .16 + k * u * .07); c.stroke(); }
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
  /** For checks: like a real camera, the stand-in model reads a faint trace of a person (0..1) across the whole room. */
  faintRoom = 0;
  /** For checks: the stand-in model stops answering, as if it had fallen behind, until this is cleared. */
  paused = false;
  constructor(private readonly source: () => TestSource) {}
  get status(): PeopleStatus { return this.disposed ? { state: 'failed', reason: 'stopped' } : { state: 'running', ms: 1 }; }
  get ready(): boolean { return !this.disposed && (this.source().seconds * 1000 - this.lastAt) <= READY_MS; }
  submit(_frame: HTMLVideoElement | HTMLCanvasElement, frameId: number): void {
    if (this.disposed || this.paused) return;
    const c = this.context, { width: w, height: h } = this.canvas, source = this.source();
    c.clearRect(0, 0, w, h); c.fillStyle = '#fff'; source.drawPeople(c, w, h, !source.signalDemo);
    if (this.coverAll) c.fillRect(w * .05, 0, w * .9, h);
    const rgba = c.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
    const faint = Math.round(this.faintRoom * 255);
    for (let i = 0; i < data.length; i++) data[i] = Math.max(faint, rgba[i * 4 + 3]);
    this.mask = { data, width: w, height: h, frameId };
    this.lastAt = source.seconds * 1000;
  }
  latest(): Mask | null { return this.mask; }
  dispose(): void { this.disposed = true; }
}

/** A person-shaped silhouette in the current fill style. */
function drawFigure(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, f: CrowdFigure, w: number, h: number): void {
  const cx = f.x * w, cy = (1 - f.y) * h, u = f.height * h;
  c.beginPath(); c.arc(cx, cy - u * .36, u * .09, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.roundRect(cx - u * .13, cy - u * .26, u * .26, u * .42, u * .06); c.fill();
  c.save(); c.strokeStyle = c.fillStyle; c.lineCap = 'round';
  for (const side of [-1, 1]) {
    // Arms swing from hanging down to raised overhead; legs follow the stride.
    const lift = Math.PI * (.08 + .82 * f.arms) + side * .12 * Math.sin(f.stride), sx = cx + side * u * .12, sy = cy - u * .22;
    c.lineWidth = u * .06; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + side * Math.sin(lift) * u * .3, sy + Math.cos(lift) * u * .3); c.stroke();
    const step = Math.sin(f.stride + (side > 0 ? Math.PI : 0)) * u * .07;
    c.lineWidth = u * .08; c.beginPath(); c.moveTo(cx + side * u * .06, cy + u * .14); c.lineTo(cx + side * u * .07 + step, cy + u * .45); c.stroke();
  }
  c.restore();
}

const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
/** Walks from a to b between t0 and t1, striding while it moves. */
function walk(t: number, t0: number, t1: number, a: number, b: number): { x: number; moving: boolean } {
  const k = ease((t - t0) / (t1 - t0));
  return { x: a + (b - a) * k, moving: t > t0 && t < t1 };
}
const person = (x: number, y: number, height: number, arms: number, stride: number): CrowdFigure => ({ x, y, height, arms, stride });

/** Where everyone is in a scene at time t (seconds of the source's own clock). */
export function crowdAt(scene: CrowdScene, time: number): CrowdFigure[] {
  if (scene === 'empty') return [];
  if (scene === 'one') { const x = .5 + .25 * Math.sin(time * .5); return [person(x, .42, .62, .15 + .1 * Math.sin(time * 3), time * 5)]; }
  if (scene === 'still') return [person(.42 + .002 * Math.sin(time * 2.4), .42, .62, .12, 0)];
  if (scene === 'cross') {
    const t = time % 10, a = walk(t, 1, 8, .12, .88), b = walk(t, 1, 8, .88, .12);
    return [person(a.x, .42, .6, .15, a.moving ? time * 6 : 0), person(b.x, .4, .56, .15, b.moving ? time * 6 : 0)];
  }
  if (scene === 'three') return [0, 1, 2].map(i => person(.18 + i * .32 + .05 * Math.sin(time * (.45 + i * .17) + i * 2), .41, .5 + i * .04, .2 + .15 * Math.sin(time * 2 + i), time * 5 + i));
  if (scene === 'eight') return Array.from({ length: 8 }, (_, i) => {
    const beat = Math.sin(time * Math.PI * 2 * 1.05 + i * .8);
    return person(.08 + i * .12 + .025 * Math.sin(time * 1.3 + i), (i % 2 ? .36 : .46) + .02 * Math.abs(beat), .4 + (i % 3) * .04, .5 + .45 * beat, time * 6 + i);
  });
  const proof = scene === 'proof', length = proof ? 30 : 60, t = time % length, k = proof ? .5 : 1, at = (s: number) => s * k;
  const out: CrowdFigure[] = [];
  // One person walks in, stands still, then bursts into motion.
  if (t >= at(5) && t < at(46)) {
    const enter = walk(t, at(5), at(13), -.12, .36), burst = t >= at(19) && t < at(21);
    const x = t < at(19) ? enter.x : t < at(21) ? .36 + .2 * ease((t - at(19)) / at(2)) : t < at(40) ? .56 + .05 * Math.sin(t * .8) : walk(t, at(40), at(46), .56, 1.12).x;
    const arms = burst ? .5 + .5 * Math.sin((t - at(19)) * 14) : t >= at(13) && t < at(19) ? .1 : t >= at(34) ? .5 + .45 * Math.sin(t * 6.6) : .15;
    const still = t >= at(13) && t < at(19);
    out.push(person(x + (still ? .002 * Math.sin(t * 2.4) : 0), .42, .62, arms, still ? 0 : t * (burst ? 14 : 5)));
  }
  // Two more arrive and cross each other.
  if (t >= at(21) && t < at(47)) {
    const a = walk(t, at(21), at(29), 1.12, .18), b = walk(t, at(22), at(30), -.12, .8);
    const dance = t >= at(34), x1 = t < at(40) ? a.x : walk(t, at(40), at(47), .18, -.15).x, x2 = t < at(40) ? b.x : walk(t, at(40), at(47), .8, 1.15).x;
    out.push(person(x1, .38, .54, dance ? .5 + .45 * Math.sin(t * 6.6 + 1) : .15, t * 5));
    out.push(person(x2, .4, .5, dance ? .5 + .45 * Math.sin(t * 6.6 + 2) : .15, t * 5 + 1));
  }
  // Five more join, and all eight move together.
  if (t >= at(33) && t < at(46)) for (let i = 0; i < 5; i++) {
    const home = [.06, .3, .44, .7, .92][i], from = i % 2 ? 1.15 : -.15, enter = walk(t, at(33) + i * at(.3), at(36), from, home), leave = walk(t, at(41), at(46), home, from);
    const x = t < at(41) ? enter.x : leave.x, beat = Math.sin(t * Math.PI * 2 * 1.05 + i);
    out.push(person(x, (i % 2 ? .34 : .47) + .02 * Math.abs(beat), .38 + (i % 3) * .04, .5 + .45 * beat, t * 6 + i));
  }
  return out;
}
