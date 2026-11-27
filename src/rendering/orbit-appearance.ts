import { Color } from 'three';
import { orbitEase } from './orbit-motion';

const colours = () => Array.from({ length: 6 }, () => new Color());
const finishes = (finish: number) => Array.from({ length: 4 }, (_, index) => Number(index === finish));

/** Retarget from the colours and finish currently on screen. The snapshot survives rapid preset recall. */
export class OrbitAppearance {
  readonly palette = colours();
  readonly weights: number[];
  private readonly from = colours();
  private readonly to = colours();
  private readonly parsed = Array<string>(6);
  private readonly weightsFrom: number[];
  private finish: number;
  private start: number;
  private duration = 0;

  constructor(palette: readonly string[], finish: number, now: number) {
    this.finish = finish;
    this.start = now;
    this.weights = finishes(finish);
    this.weightsFrom = finishes(finish);
    this.readPalette(palette);
    this.sample(now);
  }

  private readPalette(palette: readonly string[]): void {
    for (let i = 0; i < this.parsed.length; i++) {
      this.to[i].set(palette[i]);
      this.parsed[i] = palette[i];
    }
  }

  private sample(now: number): void {
    const t = this.duration > 0 ? orbitEase((now - this.start) / this.duration) : 1;
    for (let i = 0; i < this.palette.length; i++) this.palette[i].lerpColors(this.from[i], this.to[i], t);
    for (let i = 0; i < this.weights.length; i++) this.weights[i] = this.weightsFrom[i] * (1 - t) + Number(i === this.finish) * t;
  }

  update(palette: readonly string[], finish: number, now: number, duration: number): void {
    if (finish !== this.finish || this.parsed.some((hex, i) => hex !== palette[i])) {
      // Snapshot the last displayed picture. A new cue starts from it even when the previous blend is in flight.
      for (let i = 0; i < this.palette.length; i++) this.from[i].copy(this.palette[i]);
      for (let i = 0; i < this.weights.length; i++) this.weightsFrom[i] = this.weights[i];
      this.readPalette(palette);
      this.finish = finish;
      this.start = now;
      this.duration = duration;
    }
    if (duration === 0) this.duration = 0;
    this.sample(now);
  }
}
