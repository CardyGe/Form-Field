const PALETTE_SECONDS = 1.2, FORM_SECONDS = .35;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Crossfades palette colours, so a look change never cuts the whole wall to a new colour. */
export class StopFader {
  private from: number[][];
  private to: number[][];
  private current: number[][];
  private progress = 1;

  constructor(stops: number[][]) {
    this.from = stops.map(s => [...s]); this.to = stops.map(s => [...s]); this.current = stops.map(s => [...s]);
  }

  set(stops: number[][]): void {
    this.from = this.current.map(s => [...s]); this.to = stops.map(s => [...s]); this.progress = 0;
  }

  advance(seconds: number): number[][] {
    if (this.progress >= 1) return this.current;
    this.progress = Math.min(1, this.progress + seconds / PALETTE_SECONDS);
    if (this.progress >= 1) { this.current = this.to.map(s => [...s]); return this.current; }
    const t = smooth(this.progress);
    this.current = this.from.map((stop, i) => stop.map((v, c) => v + (this.to[i][c] - v) * t));
    return this.current;
  }
}

/** Changes form by shrinking the old one away and growing the new one, because two shapes cannot be blended. */
export class FormFader {
  private type: number;
  private target: number;
  private strength: number;

  constructor(type: number) { this.type = type; this.target = type; this.strength = type === 0 ? 0 : 1; }

  set(type: number): void { this.target = type; }

  advance(seconds: number): { type: number; strength: number } {
    let left = seconds / FORM_SECONDS;
    if (this.type !== this.target) {
      const down = Math.min(this.strength, left);
      this.strength -= down; left -= down;
      if (this.strength > 0) return { type: this.type, strength: this.strength };
      this.type = this.target;
    }
    if (this.type !== 0) this.strength = Math.min(1, this.strength + left);
    return { type: this.type, strength: this.strength };
  }
}
