/**
 * The wall's flash limiter, as a rule. The GPU runs this same update on 48 x 27 cells in the frame being drawn (src/map/gpu.ts);
 * this model exists so the rule can be checked quickly and exactly. There is no prediction and no readback.
 *
 * The limiter can only take light away, so a fall always follows the picture. What it bounds is the rise: after a cell's light
 * has fallen, it may come back by less than one threshold at once, and may cross the threshold only after `hold` seconds. Every
 * counted rise is therefore at least `hold` after the fall before it, which allows at most six counted changes in any second.
 * It is a safety limiter, not a certified photosensitivity test.
 */
export const LIMITER = {
  band: 0.09,          // Light a cell may regain at once: under the 0.1 that counts as a change.
  hold: 0.36,          // Seconds from a fall before a cell may cross the threshold. Three of these exceed one second.
  climb: 3,            // Light per second once the hold has passed.
  redBand: 0.055,      // The same for saturated red, whose threshold is 0.0625.
  redHold: 0.55,       // Two of these exceed one second, so at most two red flashes.
  redClimb: 1.5,
  trigger: 0.2,        // Share of the wall trying to change before anything is limited. The flash area is 0.25.
  moment: 0.05,        // Seconds a cell that rose freely still counts, so a change spread over a few frames is one change.
  fadeSeconds: 4,      // How long the limit takes to ease away when the guard is switched off.
  longestStep: 1,      // The most time one frame may count for.
  longestClimb: 1 / 30, // The most time one frame's climb may count for, so a stalled frame cannot arrive as one large jump.
} as const;

/** The oldest a cell's low is remembered as, in seconds: longer than the longest hold. */
export const MOST_AGE = 4;

/** A fall of this share of the band starts a new low. Under one band, so rounding can never hide a real fall. */
export const FALL_SHARE = 0.9;

export interface ChannelRule { band: number; hold: number; climb: number }
export const LIGHT_RULE: ChannelRule = { band: LIMITER.band, hold: LIMITER.hold, climb: LIMITER.climb };
export const RED_RULE: ChannelRule = { band: LIMITER.redBand, hold: LIMITER.redHold, climb: LIMITER.redClimb };

/**
 * How much longer than the default a cell must wait, from the show's Flash Guard settings: fewer allowed flashes, longer holds.
 * Light allows up to three flashes a second and saturated red up to two, each lowered by the Max flashes and Red limit controls.
 */
export function limiterScales(settings: { safetyMaxFlashes: number; safetyRedLimit: number }): { light: number; red: number } {
  const flashes = Math.max(1, Math.min(3, Math.round(Number.isFinite(settings.safetyMaxFlashes) ? settings.safetyMaxFlashes : 3)));
  const share = Number.isFinite(settings.safetyRedLimit) ? Math.max(0, Math.min(1, settings.safetyRedLimit)) : 0.5;
  return { light: 3 / flashes, red: 2 / Math.max(1, Math.min(2, Math.floor(flashes * share))) };
}

/** One channel of every cell: what it was allowed to show, its low and high since the last fall, and the time since that low. */
class Channel {
  readonly value: Float32Array; readonly low: Float32Array; readonly high: Float32Array; readonly age: Float32Array; readonly crossed: Float32Array;
  scale = 1;
  constructor(count: number, private readonly rule: ChannelRule) {
    this.value = new Float32Array(count); this.low = new Float32Array(count); this.high = new Float32Array(count); this.age = new Float32Array(count); this.crossed = new Float32Array(count);
  }

  init(input: Float32Array): void {
    this.value.set(input); this.low.set(input); this.high.set(input); this.age.fill(0); this.crossed.fill(1);
  }

  private cap(i: number, dt: number): number {
    const { band, hold, climb } = this.rule, first = this.low[i] + band;
    return this.age[i] >= hold * this.scale ? Math.max(first, this.value[i] + climb * Math.min(dt, LIMITER.longestClimb)) : first;
  }

  /** The share of cells trying to rise past what they may show now, or that rose freely a moment ago. */
  area(input: Float32Array, dt: number): number {
    let n = 0;
    for (let i = 0; i < input.length; i++) if (input[i] > this.cap(i, dt) + 1e-4 || this.crossed[i] < LIMITER.moment) n++;
    return n / input.length;
  }

  update(input: Float32Array, dt: number, engaged: boolean): void {
    const { value, low, high, age, crossed, rule } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i], was = value[i];
      let v = was;
      if (x <= was || !engaged) v = x;
      else v = Math.min(x, Math.max(was, this.cap(i, dt)));
      crossed[i] = !engaged && was <= low[i] + rule.band && v > low[i] + rule.band ? 0 : Math.min(1, crossed[i] + dt);
      value[i] = v;
      if (v > high[i]) high[i] = v;
      if (high[i] - v >= rule.band * FALL_SHARE) { low[i] = v; high[i] = v; age[i] = 0; }
      else if (v < low[i]) { low[i] = v; age[i] = 0; }
      age[i] = Math.min(MOST_AGE, age[i] + dt);
    }
  }
}

export class WallLimiter {
  readonly light: Float32Array;
  readonly red: Float32Array;
  private readonly lightChannel: Channel;
  private readonly redChannel: Channel;
  private started = false;

  constructor(readonly count: number) {
    this.light = new Float32Array(count); this.red = new Float32Array(count);
    this.lightChannel = new Channel(count, LIGHT_RULE); this.redChannel = new Channel(count, RED_RULE);
  }

  reset(): void { this.started = false; }

  /** Applies the show's Max flashes and Red limit. */
  setScales(scales: { light: number; red: number }): void { this.lightChannel.scale = scales.light; this.redChannel.scale = scales.red; }

  /** One drawn frame: the input's light and saturated red per cell. `light` and `red` then hold what may be shown. */
  step(dt: number, inputLight: Float32Array, inputRed: Float32Array): void {
    const seconds = Number.isFinite(dt) && dt > 0 ? Math.min(dt, LIMITER.longestStep) : 0;
    if (!this.started) { this.lightChannel.init(inputLight); this.redChannel.init(inputRed); this.started = true; }
    else {
      const lit = this.lightChannel.area(inputLight, seconds) >= LIMITER.trigger, red = this.redChannel.area(inputRed, seconds) >= LIMITER.trigger;
      this.lightChannel.update(inputLight, seconds, lit);
      this.redChannel.update(inputRed, seconds, red);
    }
    this.light.set(this.lightChannel.value); this.red.set(this.redChannel.value);
  }
}
