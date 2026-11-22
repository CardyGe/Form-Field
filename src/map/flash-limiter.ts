/**
 * Reduces photosensitive risk at the final wall output, after every shape, link and fade. It follows the WCAG 2.3.1
 * definitions of general and red flashes, and acts once a picture is on course to exceed three flashes in a second.
 * This lowers risk. It is not a certified photosensitive test.
 */
export interface FlashCorrection { gain: number; redScale: number }

const COLUMNS = 32, ROWS = 18, CELLS = COLUMNS * ROWS;
/** Deliberately stricter than WCAG's 25%, because the viewing distance in a room is unknown. */
const AREA = Math.ceil(CELLS * .1);
const LUMINANCE_STEP = .1, DARKER_BELOW = .8, RED_STEP = 20;
/** Five opposing transitions in a second means a fourth flash is close. */
const ENGAGE_AT = 5;
const SAFE_SWING = .09, RED_SAFE = .5, HOLD_SECONDS = 1, RELEASE_PER_SECOND = 1.2;

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });

/** Follows one value per cell, and reports each reversal large enough to count as a transition. */
class Transitions {
  private readonly extreme = new Float64Array(CELLS);
  private readonly direction = new Int8Array(CELLS);
  private ready = false;
  private last = 0;
  private readonly events: number[] = [];
  swing = 0;

  constructor(private readonly step: number, private readonly darkerBelow: number) {}

  reset(): void { this.ready = false; this.direction.fill(0); this.events.length = 0; this.last = 0; this.swing = 0; }

  /** Adds this frame and returns how many frame-wide transitions fall in the last second. */
  update(values: Float64Array, t: number): number {
    if (!this.ready) { this.extreme.set(values); this.ready = true; return 0; }
    let up = 0, down = 0, largest = 0;
    for (let i = 0; i < CELLS; i++) {
      const v = values[i], d = this.direction[i];
      if ((d > 0 && v > this.extreme[i]) || (d < 0 && v < this.extreme[i])) this.extreme[i] = v;
      const change = v - this.extreme[i];
      if (Math.abs(change) < this.step || Math.min(v, this.extreme[i]) >= this.darkerBelow) continue;
      const next = change > 0 ? 1 : -1;
      if (next !== d) { if (next > 0) up++; else down++; largest = Math.max(largest, Math.abs(change)); }
      this.direction[i] = next; this.extreme[i] = v;
    }
    const event = up >= AREA && up >= down ? 1 : down >= AREA ? -1 : 0;
    if (event && event !== this.last) { this.events.push(t); this.last = event; this.swing = Math.max(this.swing, largest); }
    while (this.events.length && t - this.events[0] >= 1 - 1e-9) this.events.shift();
    return this.events.length;
  }
}

export class FlashLimiter {
  private readonly luminance = new Float64Array(CELLS);
  private readonly red = new Float64Array(CELLS);
  private readonly general = new Transitions(LUMINANCE_STEP, DARKER_BELOW);
  private readonly saturated = new Transitions(RED_STEP, Number.POSITIVE_INFINITY);
  private gain = 1;
  private redScale = 1;
  private generalUntil = -1;
  private redUntil = -1;
  private time: number | null = null;
  /** How many times the limiter has stepped in. */
  flagged = 0;

  constructor(private readonly enabled = true) {}

  private reset(): void {
    this.general.reset(); this.saturated.reset();
    this.gain = 1; this.redScale = 1; this.generalUntil = -1; this.redUntil = -1;
  }

  push(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, tSeconds: number): FlashCorrection {
    if (!this.enabled) return { gain: 1, redScale: 1 };
    if (this.time !== null && tSeconds < this.time) { this.reset(); this.time = null; }
    const seconds = this.time === null ? 0 : Math.min(.1, tSeconds - this.time);
    this.time = tSeconds;
    this.measure(rgba, width, height);

    if (this.general.update(this.luminance, tSeconds) >= ENGAGE_AT) { if (tSeconds >= this.generalUntil) this.flagged++; this.generalUntil = tSeconds + HOLD_SECONDS; }
    if (this.saturated.update(this.red, tSeconds) >= ENGAGE_AT) { if (tSeconds >= this.redUntil) this.flagged++; this.redUntil = tSeconds + HOLD_SECONDS; }

    const dimming = tSeconds < this.generalUntil, desaturating = tSeconds < this.redUntil;
    if (!dimming) this.general.swing = 0;
    if (!desaturating) this.saturated.swing = 0;
    const gainTarget = dimming ? Math.min(1, SAFE_SWING / Math.max(this.general.swing, SAFE_SWING)) : 1;
    this.gain = gainTarget < this.gain ? gainTarget : Math.min(gainTarget, this.gain + RELEASE_PER_SECOND * seconds);
    const redTarget = desaturating ? RED_SAFE : 1;
    this.redScale = redTarget < this.redScale ? redTarget : Math.min(redTarget, this.redScale + RELEASE_PER_SECOND * seconds);
    return { gain: this.gain, redScale: this.redScale };
  }

  /** Averages the picture into cells, in linear light. */
  private measure(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): void {
    const r = new Float64Array(CELLS), g = new Float64Array(CELLS), b = new Float64Array(CELLS), count = new Uint32Array(CELLS);
    for (let y = 0; y < height; y++) {
      const row = Math.min(ROWS - 1, Math.floor(y * ROWS / height));
      for (let x = 0; x < width; x++) {
        const cell = row * COLUMNS + Math.min(COLUMNS - 1, Math.floor(x * COLUMNS / width)), i = (y * width + x) * 4;
        r[cell] += LINEAR[rgba[i]]; g[cell] += LINEAR[rgba[i + 1]]; b[cell] += LINEAR[rgba[i + 2]]; count[cell]++;
      }
    }
    for (let i = 0; i < CELLS; i++) {
      const n = count[i] || 1, red = r[i] / n, green = g[i] / n, blue = b[i] / n, sum = red + green + blue;
      this.luminance[i] = .2126 * red + .7152 * green + .0722 * blue;
      this.red[i] = sum > 0 && red / sum >= .8 ? Math.max(0, (red - green - blue) * 320) : 0;
    }
  }
}
