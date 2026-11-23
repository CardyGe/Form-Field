import { STRIDE, type DisplayList } from './display-list';
import { PRIMITIVE } from './types';

/** Where a layer's list lands: list units to frame heights about the frame's centre, with the light its layer passes. */
export interface LightPlacement { aspect: number; a: number; b: number; c: number; d: number; x: number; y: number; level: number; /** List units per output pixel. */ pixel: number; /** The thinnest line drawn, in output pixels. */ minWidth: number }

const TAU = Math.PI * 2;
const TARGET_CELLS = 48 * 27, CAPACITY = 1600, MAX_SIDE = 96;
const PITCH = 0.7, MOST_SAMPLES = 4096;       // Samples sit closer than a cell, so a solid shape leaves no holes; one mark takes at most this many.
const FIXED = 65536;                         // Layers add in whole units, so swapping two layers cannot change a bit.
const MOST = 4;                              // The most light one layer can put in a cell before the frame's limit.
const SOLID = 0.8;                           // Sampling leaves a solid shape between this and full cover. It reads as full, so light is never under-counted.
const BLOOM_MARGIN = 1.35;                   // Partly covered cells render this much brighter than their marks once bloom is added (measured on rendered frames). A solid cell stays at its own light.
const GLOW_WIDTH = 0.02, FILL_LIGHT = 0.5;   // A line's glow as extra width, and a soft fill's average light.
const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

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
  private readonly sumGuarded = new Int32Array(CAPACITY);
  private readonly sumFixed = new Int32Array(CAPACITY);
  private readonly sumRed = new Int32Array(CAPACITY);
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
  }

  private stamp(x: number, y: number, amount: number, alpha: number): void {
    if (x < -this.halfW || x >= this.halfW || y < -0.5 || y >= 0.5) return;
    const col = Math.min(this.cols - 1, Math.floor((x + this.halfW) * this.toCol)), row = Math.min(this.rows - 1, Math.floor((y + 0.5) * this.toRow)), at = row * this.cols + col;
    this.cover[at] += amount; this.energy[at] += amount * alpha;
  }

  /** Adds one layer. Returns the share of the frame its marks cover, lit or not. */
  addLayer(list: DisplayList, place: LightPlacement, red: number, guarded: boolean): number {
    const { cover, energy, count } = this;
    cover.fill(0, 0, count); energy.fill(0, 0, count);
    const d = list.data, { a, b, c, d: e, x: tx, y: ty, pixel, minWidth } = place;
    const frameArea = Math.abs(a * e - b * c), scale = Math.sqrt(frameArea), cell = Math.max(1e-6, Math.max(place.aspect / this.cols, 1 / this.rows)), perCell = this.cols * this.rows / place.aspect;
    const unit = Math.max(1e-6, PITCH * cell / Math.max(scale, 1e-6)); // The distance between samples, in list units.
    for (let i = 0; i < list.count; i++) {
      const at = i * STRIDE, kind = d[at], alpha = d[at + 9];
      if (!(alpha > 1e-3)) continue;
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
    for (let i = 0; i < count; i++) {
      const lit = cover[i];
      if (lit <= 0) continue;
      const held = Math.min(1, lit / SOLID);
      covered += held;
      const light = Math.min(MOST, Math.min(1, held * BLOOM_MARGIN) * (energy[i] / lit) * level), units = Math.round(light * FIXED);
      into[i] += units; this.sumRed[i] += Math.round(units * redShare);
    }
    return covered / count;
  }

  /** Settles the sums into cell values, ready for Flash Guard. */
  finish(): void {
    for (let i = 0; i < this.count; i++) {
      const g = this.sumGuarded[i], f = this.sumFixed[i], total = g + f;
      this.guarded[i] = g / FIXED; this.fixed[i] = f / FIXED; this.red[i] = total > 0 ? this.sumRed[i] / total : 0;
    }
  }
}
