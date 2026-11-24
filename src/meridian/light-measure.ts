import { STRIDE, type DisplayList } from './display-list';
import { PRIMITIVE } from './types';

/** Where a layer's list lands: list units to frame heights about the frame's centre, with the light its layer passes. */
export interface LightPlacement { aspect: number; a: number; b: number; c: number; d: number; x: number; y: number; level: number; /** List units per output pixel. */ pixel: number; /** The thinnest line drawn, in output pixels. */ minWidth: number }

/** The resolve shader's settings for one moment: everything between a mark's light and the finished pixel. */
export interface ToneCurve { exposure: number; contrast: number; saturation: number; boost: number; black: number; lift: number }
/** A layer's light as it is now and as its saved values would draw it, so that Motion on any of these counts as a change of light. */
export interface LightTone { opacity: number; readonly inks: Float32Array; readonly ground: Float32Array; readonly now: ToneCurve; readonly base: ToneCurve }

const TAU = Math.PI * 2;
const TARGET_CELLS = 48 * 27, CAPACITY = 1600, MAX_SIDE = 96;
const PITCH = 0.7, MOST_SAMPLES = 4096;       // Samples sit closer than a cell, so a solid shape leaves no holes; one mark takes at most this many.
const FIXED = 65536;                         // Layers add in whole units, so swapping two layers cannot change a bit.
const MOST = 4;                              // The most light one layer can put in a cell before the frame's limit.
const SOLID = 0.8;                           // Sampling leaves a solid shape between this and full cover. It reads as full, so light is never under-counted.
const BLOOM_MARGIN = 1.35;                   // Partly covered cells render this much brighter than their marks once bloom is added (measured on rendered frames). A solid cell stays at its own light.
const GLOW_WIDTH = 0.02, FILL_LIGHT = 0.5;   // A line's glow as extra width, and a soft fill's average light.
const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);
const decoded = (v: number): number => { const c = clamp(v, 0, 1); return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

/**
 * A coarse picture of the composition's light, about 48x27 cells at 16:9 and the same number at any other shape. Each layer
 * adds what its own marks light in each cell, after its placement, opacity and the frame's edges. Thin lines are approximate.
 */
export class LightGrid {
  cols = 48; rows = 27; count = 48 * 27;
  /** Light from layers Flash Guard may dim, from those it may not, and how saturated red the light in each cell is. */
  readonly guarded = new Float32Array(CAPACITY);
  readonly fixed = new Float32Array(CAPACITY);
  readonly red = new Float32Array(CAPACITY);
  /** How much saturated red each cell shows on screen: red minus green and blue where red is at least 80% of the colour. */
  readonly redLight = new Float32Array(CAPACITY);
  private readonly sumGuarded = new Int32Array(CAPACITY);
  private readonly sumFixed = new Int32Array(CAPACITY);
  private readonly sumRed = new Int32Array(CAPACITY);
  private readonly shownR = new Int32Array(CAPACITY);
  private readonly shownG = new Int32Array(CAPACITY);
  private readonly shownB = new Int32Array(CAPACITY);
  private readonly inkR = new Float32Array(CAPACITY);
  private readonly inkG = new Float32Array(CAPACITY);
  private readonly inkB = new Float32Array(CAPACITY);
  private markR = 1; private markG = 1; private markB = 1; private outR = 0; private outG = 0; private outB = 0;
  private readonly cover = new Float32Array(CAPACITY);
  private readonly energy = new Float32Array(CAPACITY);
  private halfW = 0.5; private toCol = 1; private toRow = 1;

  reset(aspect: number): void {
    const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    this.cols = clamp(Math.round(Math.sqrt(TARGET_CELLS * shape)), 1, MAX_SIDE);
    this.rows = clamp(Math.round(TARGET_CELLS / this.cols), 1, MAX_SIDE);
    this.count = this.cols * this.rows;
    this.halfW = shape / 2; this.toCol = this.cols / shape; this.toRow = this.rows;
    this.sumGuarded.fill(0, 0, this.count); this.sumFixed.fill(0, 0, this.count); this.sumRed.fill(0, 0, this.count);
    this.shownR.fill(0, 0, this.count); this.shownG.fill(0, 0, this.count); this.shownB.fill(0, 0, this.count);
  }

  private stamp(x: number, y: number, amount: number, alpha: number): void {
    if (x < -this.halfW || x >= this.halfW || y < -0.5 || y >= 0.5) return;
    const col = Math.min(this.cols - 1, Math.floor((x + this.halfW) * this.toCol)), row = Math.min(this.rows - 1, Math.floor((y + 0.5) * this.toRow)), at = row * this.cols + col;
    const lit = amount * alpha;
    this.cover[at] += amount; this.energy[at] += lit;
    this.inkR[at] += lit * this.markR; this.inkG[at] += lit * this.markG; this.inkB[at] += lit * this.markB;
  }

  /** The resolve shader's arithmetic for one pixel of this light. The result is left in outR, outG and outB. */
  private shade(r: number, g: number, b: number, t: ToneCurve): void {
    const scale = t.boost * t.exposure, cr = Math.pow(1 - Math.exp(-Math.max(r, 0) * scale), t.contrast), cg = Math.pow(1 - Math.exp(-Math.max(g, 0) * scale), t.contrast), cb = Math.pow(1 - Math.exp(-Math.max(b, 0) * scale), t.contrast);
    const grey = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb, keep = 1 - t.black;
    this.outR = t.black + Math.max(0, grey + (cr - grey) * t.saturation) * keep;
    this.outG = t.black + Math.max(0, grey + (cg - grey) * t.saturation) * keep;
    this.outB = t.black + Math.max(0, grey + (cb - grey) * t.saturation) * keep;
  }

  /** The luminance of the unlit ground at this distance from the centre. */
  private groundLight(t: ToneCurve, ground: Float32Array, edge: number): number {
    const glow = t.lift * (0.35 + 0.65 * Math.exp(-edge * 2.6)), keep = 1 - t.black;
    return t.black + keep * (0.2126 * (ground[0] + glow * 0.32) + 0.7152 * (ground[1] + glow * 0.42) + 0.0722 * (ground[2] + glow * 0.62));
  }

  /** Adds one layer. Returns the share of the frame its marks cover, lit or not. */
  addLayer(list: DisplayList, place: LightPlacement, red: number, guarded: boolean, tone?: LightTone): number {
    const { cover, energy, count, inkR, inkG, inkB } = this;
    cover.fill(0, 0, count); energy.fill(0, 0, count); inkR.fill(0, 0, count); inkG.fill(0, 0, count); inkB.fill(0, 0, count);
    const d = list.data, { a, b, c, d: e, x: tx, y: ty, pixel, minWidth } = place;
    const frameArea = Math.abs(a * e - b * c), scale = Math.sqrt(frameArea), cell = Math.max(1e-6, Math.max(place.aspect / this.cols, 1 / this.rows)), perCell = this.cols * this.rows / place.aspect;
    const unit = Math.max(1e-6, PITCH * cell / Math.max(scale, 1e-6)); // The distance between samples, in list units.
    for (let i = 0; i < list.count; i++) {
      const at = i * STRIDE, kind = d[at], alpha = d[at + 9];
      if (!(alpha > 1e-3)) continue;
      if (tone) {
        const colour = d[at + 8], whole = Math.floor(colour), from = ((whole % 3) + 3) % 3, to = (from + 1) % 3, mix = colour - whole, inks = tone.inks;
        this.markR = inks[from * 3] + (inks[to * 3] - inks[from * 3]) * mix; this.markG = inks[from * 3 + 1] + (inks[to * 3 + 1] - inks[from * 3 + 1]) * mix; this.markB = inks[from * 3 + 2] + (inks[to * 3 + 2] - inks[from * 3 + 2]) * mix;
      }
      const x0 = d[at + 1], y0 = d[at + 2], p0 = d[at + 3];
      if (kind === PRIMITIVE.segment || kind === PRIMITIVE.ring || kind === PRIMITIVE.arc) {
        const raw = d[at + 6], width = (raw < 0 ? -raw : Math.max(raw, minWidth) * pixel) + Math.max(0, d[at + 7]) * GLOW_WIDTH;
        const segment = kind === PRIMITIVE.segment, x1 = d[at + 3], y1 = d[at + 4], radius = Math.abs(p0), start = kind === PRIMITIVE.arc ? d[at + 4] : 0, sweep = kind === PRIMITIVE.arc ? d[at + 5] : TAU;
        const length = segment ? Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) : radius * Math.abs(sweep);
        let along = Math.max(Math.ceil(length / unit), segment ? 1 : 4), across = Math.max(Math.ceil(width / unit), 1);
        if (along * across > MOST_SAMPLES) { const fit = Math.sqrt(MOST_SAMPLES / (along * across)); along = Math.max(1, Math.floor(along * fit)); across = Math.max(1, Math.floor(across * fit)); }
        const amount = Math.max(length, width) / along * (width / across) * frameArea * perCell;
        const ux = segment && length > 1e-7 ? (x1 - x0) / length : 1, uy = segment && length > 1e-7 ? (y1 - y0) / length : 0;
        for (let s = 0; s < along; s++) {
          const t = (s + 0.5) / along, angle = start + sweep * t, cos = Math.cos(angle), sin = Math.sin(angle);
          for (let k = 0; k < across; k++) {
            const off = ((k + 0.5) / across - 0.5) * width;
            const px = segment ? x0 + (x1 - x0) * t - uy * off : x0 + cos * (radius + off), py = segment ? y0 + (y1 - y0) * t + ux * off : y0 + sin * (radius + off);
            this.stamp(a * px + b * py + tx, c * px + e * py + ty, amount, alpha);
          }
        }
      } else {
        // A square, dot or soft fill, as a small patch of the same area.
        const fill = kind === PRIMITIVE.fill, half = Math.abs(p0) * (kind === PRIMITIVE.square ? 1 : Math.sqrt(Math.PI) / 2), angle = fill ? 0 : d[at + 4], cos = Math.cos(angle), sin = Math.sin(angle);
        const side = clamp(Math.ceil(half * 2 / unit), 1, Math.floor(Math.sqrt(MOST_SAMPLES))), amount = (half * 2 / side) * (half * 2 / side) * frameArea * perCell, light = fill ? alpha * FILL_LIGHT : alpha;
        for (let v = 0; v < side; v++) for (let u = 0; u < side; u++) {
          const lx = ((u + 0.5) / side - 0.5) * half * 2, ly = ((v + 0.5) / side - 0.5) * half * 2, px = x0 + cos * lx - sin * ly, py = y0 + sin * lx + cos * ly;
          this.stamp(a * px + b * py + tx, c * px + e * py + ty, amount, light);
        }
      }
    }
    const level = Math.max(0, place.level), into = guarded ? this.sumGuarded : this.sumFixed, redShare = clamp(red, 0, 1);
    let covered = 0;
    const now = tone?.now, was = tone?.base, moved = !!tone && !!now && !!was && (Math.abs(now.exposure - was.exposure) > 1e-6 || Math.abs(now.contrast - was.contrast) > 1e-6 || Math.abs(now.saturation - was.saturation) > 1e-6 || Math.abs(now.boost - was.boost) > 1e-6 || Math.abs(now.black - was.black) > 1e-6 || Math.abs(now.lift - was.lift) > 1e-6);
    const floorMoved = moved && (Math.abs(now!.black - was!.black) > 1e-6 || Math.abs(now!.lift - was!.lift) > 1e-6), opacity = tone ? Math.max(0, tone.opacity) : 0;
    for (let i = 0; i < count; i++) {
      const lit = cover[i];
      if (lit <= 0 && !floorMoved) continue;
      const held = lit > 0 ? Math.min(1, lit / SOLID) : 0, spread = Math.min(1, held * BLOOM_MARGIN);
      covered += held;
      let light = lit > 0 ? Math.min(MOST, spread * (energy[i] / lit) * level) : 0;
      if (tone && now && was) {
        const r = lit > 0 ? inkR[i] / lit : 0, g = lit > 0 ? inkG[i] / lit : 0, b = lit > 0 ? inkB[i] / lit : 0;
        this.shade(r, g, b, now);
        const shownR = this.outR, shownG = this.outG, shownB = this.outB;
        // The resolved picture is display-encoded, so the red share is judged after decoding it, as it reaches the screen.
        if (lit > 0) { this.shownR[i] += Math.round(spread * decoded(shownR) * opacity * FIXED); this.shownG[i] += Math.round(spread * decoded(shownG) * opacity * FIXED); this.shownB[i] += Math.round(spread * decoded(shownB) * opacity * FIXED); }
        if (moved) {
          // Motion on contrast, saturation, glow or the ground is measured as the change it makes to the finished pixel.
          const lumaNow = 0.2126 * shownR + 0.7152 * shownG + 0.0722 * shownB;
          this.shade(r, g, b, was);
          const lumaWas = 0.2126 * this.outR + 0.7152 * this.outG + 0.0722 * this.outB;
          let change = spread * (lumaNow - lumaWas);
          if (floorMoved) {
            const px = ((i % this.cols) + 0.5) / this.cols - 0.5, py = (Math.floor(i / this.cols) + 0.5) / this.rows - 0.5, wide = px * place.aspect, edge = wide * wide + py * py;
            change += (1 - spread) * (this.groundLight(now!, tone.ground, edge) - this.groundLight(was!, tone.ground, edge));
          }
          light = Math.max(0, light + change * opacity);
        }
      }
      const units = Math.round(Math.min(MOST, light) * FIXED);
      into[i] += units; this.sumRed[i] += Math.round(units * redShare);
    }
    return covered / count;
  }

  /** Settles the sums into cell values, ready for Flash Guard. */
  finish(): void {
    for (let i = 0; i < this.count; i++) {
      const g = this.sumGuarded[i], f = this.sumFixed[i], total = g + f;
      this.guarded[i] = g / FIXED; this.fixed[i] = f / FIXED; this.red[i] = total > 0 ? this.sumRed[i] / total : 0;
      const r = Math.min(1, this.shownR[i] / FIXED), green = Math.min(1, this.shownG[i] / FIXED), blue = Math.min(1, this.shownB[i] / FIXED), sum = r + green + blue;
      this.redLight[i] = sum > 1e-6 && r / sum >= 0.8 ? r - green - blue : 0;
    }
  }
}
