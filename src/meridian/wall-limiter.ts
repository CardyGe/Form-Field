/**
 * The wall's flash limiter, as a rule. The GPU runs this same update on 4 px blocks (480 x 270) in the frame being drawn (src/map/gpu.ts);
 * this model exists so the rule can be checked quickly and exactly. There is no prediction and no readback.
 *
 * The limiter can only take light away, so a fall always follows the picture. What it bounds is the rise: after a cell's light
 * has fallen, it may come back by less than one threshold at once, and may cross the threshold only after `hold` seconds. Every
 * counted rise is therefore at least `hold` after the fall before it, which allows at most six counted changes in any second.
 * A partial fall can neither raise a cell's low nor restart its hold. The flash area is judged from the input's own changes over
 * a rolling second. On the wall each pixel's gain stays within `softEdge` below its own cell's, so no neighbour can lend it light.
 *
 * A block is measured by its brightest pixel, and by the largest fall and rise of any one of its pixels since the last frame. So
 * light that swaps places inside a block, which leaves the brightest pixel unchanged, still counts as a fall and then a rise.
 * It is a safety limiter, not a certified photosensitivity test.
 */
/** The side of a measured block, in stage pixels. */
export const LIMITER_BLOCK = 4;

export const LIMITER = {
  band: 0.09,          // Light a cell may regain at once: under the 0.1 that counts as a change.
  hold: 0.36,          // Seconds from a fall before a cell may cross the threshold. Three of these exceed one second.
  climb: 3,            // Light per second once the hold has passed.
  redBand: 0.055,      // The same for saturated red, whose threshold is 0.0625.
  redHold: 0.55,       // Two of these exceed one second, so at most two red flashes.
  redClimb: 1.5,
  trigger: 0.2,        // Share of the wall trying to change before anything is limited. The flash area is 0.25.
  window: 1,           // Seconds a cell counts as flashing after it has changed both ways, so regions taking turns add up.
  lightStep: 0.1,      // The input change that counts for the flash area.
  redStep: 0.0625,
  atLow: 0.002,        // A fall to within this of the low has come all the way back, and starts the hold again.
  softEdge: 0.9,       // The lowest share of its own cell's gain a pixel may take from a neighbour, to soften cell edges.
  over: 0.001,         // How far past the band a cell must have climbed before a fall may set a new low.
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

/** One channel of every block: what it may show, its low and high, the time since that low, and the input's own changes. */
class Channel {
  readonly value: Float32Array; readonly low: Float32Array; readonly high: Float32Array; readonly age: Float32Array;
  readonly anchor: Float32Array; readonly way: Int8Array; readonly pixelWay: Int8Array; readonly up: Float32Array; readonly before: Float32Array; readonly older: Float32Array;
  private readonly last: Float32Array;
  private readonly edge: number;
  scale = 1;
  constructor(count: number, private readonly rule: ChannelRule, private readonly step: number) {
    this.value = new Float32Array(count); this.low = new Float32Array(count); this.high = new Float32Array(count); this.age = new Float32Array(count);
    this.anchor = new Float32Array(count); this.way = new Int8Array(count); this.pixelWay = new Int8Array(count); this.up = new Float32Array(count); this.before = new Float32Array(count); this.older = new Float32Array(count);
    this.last = new Float32Array(count); this.edge = rule.band * FALL_SHARE;
  }

  init(input: Float32Array): void {
    this.value.set(input); this.low.set(input); this.high.set(input); this.age.fill(0); this.last.set(input);
    this.anchor.set(input); this.way.fill(0); this.pixelWay.fill(0); this.up.fill(2); this.before.fill(2); this.older.fill(2);
  }

  private cap(i: number, dt: number): number {
    const { band, hold, climb } = this.rule, first = this.low[i] + band;
    return this.age[i] >= hold * this.scale ? Math.max(first, this.value[i] + climb * Math.min(dt, LIMITER.longestClimb)) : first;
  }

  /** Follows the input's own changes, whatever is being shown. A rise counts once per frame, from the peak or from any one pixel. */
  track(input: Float32Array, dt: number, fall: Float32Array | null, rise: Float32Array | null): void {
    const { anchor, way, pixelWay, up, before, older, step, edge, last } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i], f = fall ? fall[i] : Math.max(0, last[i] - x), r = rise ? rise[i] : Math.max(0, x - last[i]);
      let rose = false;
      if (way[i] === 1 && x > anchor[i]) anchor[i] = x;
      else if (way[i] === -1 && x < anchor[i]) anchor[i] = x;
      up[i] = Math.min(2, up[i] + dt); before[i] = Math.min(2, before[i] + dt); older[i] = Math.min(2, older[i] + dt);
      if (way[i] >= 0 && x <= anchor[i] - step) { way[i] = -1; anchor[i] = x; }
      else if (way[i] <= 0 && x >= anchor[i] + step) { way[i] = 1; anchor[i] = x; rose = true; }
      if (r >= edge) { if (pixelWay[i] < 0) rose = true; pixelWay[i] = 1; }
      if (f >= edge) pixelWay[i] = -1;
      if (rose) { older[i] = before[i]; before[i] = up[i]; up[i] = 0; }
    }
  }

  /** The share of blocks trying to rise past what they may show now, or that have risen three times in the last second. */
  area(input: Float32Array, dt: number): number {
    let n = 0;
    for (let i = 0; i < input.length; i++) if (input[i] > Math.max(this.value[i], this.cap(i, dt)) + 1e-4 || (this.up[i] < LIMITER.window && this.before[i] < LIMITER.window && this.older[i] < LIMITER.window)) n++;
    return n / input.length;
  }

  private move(i: number, v: number): void {
    const { value, low, high, age, rule } = this, was = value[i];
    value[i] = v;
    if (v > high[i]) high[i] = v;
    if (v < low[i]) { low[i] = v; high[i] = v; age[i] = 0; }
    else if (was > low[i] + LIMITER.atLow && v <= low[i] + LIMITER.atLow) { high[i] = v; age[i] = 0; }
    else if (high[i] > low[i] + rule.band + LIMITER.over && high[i] - v >= rule.band * FALL_SHARE) { low[i] = v; high[i] = v; age[i] = 0; }
  }

  update(input: Float32Array, dt: number, engaged: boolean, fall: Float32Array | null, drop: Float32Array | null): void {
    const { value, age, edge, last } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i], f = fall ? fall[i] : Math.max(0, last[i] - x);
      // A pixel that fell is a fall for the block, even when another pixel keeps the block's peak up.
      const reached = drop ? drop[i] : x;
      if (f >= edge && reached < value[i]) this.move(i, reached);
      const was = value[i];
      this.move(i, x <= was || !engaged ? x : Math.min(x, Math.max(was, this.cap(i, dt))));
      age[i] = Math.min(MOST_AGE, age[i] + dt);
      last[i] = x;
    }
  }
}

/**
 * Per-block pixel changes since the last frame: the largest fall and rise of any one pixel, and the lowest value a fallen pixel
 * reached. A frame in which half the block or less trades light, each risen pixel lit from right beside it, is an edge moving through, and carries no fall or rise.
 * Left out, a block is taken to be one even field.
 */
export interface LimiterDetail { lightFall: Float32Array; lightRise: Float32Array; lightDrop: Float32Array; redFall: Float32Array; redRise: Float32Array; redDrop: Float32Array }

/**
 * How far the limit has eased away, 0 to 1, after `dt` seconds. Off, it eases out; back on part-way, it returns at the same pace
 * rather than snapping on in one frame. Null once it has finished either way.
 */
export function stepLimiterFade(fade: number, dt: number, guardOn: boolean): number | null {
  const next = Math.max(0, Math.min(1, fade + (guardOn ? -dt : dt) / LIMITER.fadeSeconds));
  return (guardOn && next <= 0) || (!guardOn && next >= 1) ? null : next;
}

export class WallLimiter {
  /** What each cell may show. */
  readonly light: Float32Array;
  readonly red: Float32Array;
  /** The light each cell shows: what it may show, as the wall's gain delivers it. */
  get shown(): Float32Array { return this.light; }
  private readonly lightChannel: Channel;
  private readonly redChannel: Channel;
  private started = false;

  constructor(readonly count: number) {
    this.light = new Float32Array(count); this.red = new Float32Array(count);
    this.lightChannel = new Channel(count, LIGHT_RULE, LIMITER.lightStep); this.redChannel = new Channel(count, RED_RULE, LIMITER.redStep);
  }

  reset(): void { this.started = false; }

  /** Applies the show's Max flashes and Red limit. */
  setScales(scales: { light: number; red: number }): void { this.lightChannel.scale = scales.light; this.redChannel.scale = scales.red; }

  /** One drawn frame: each block's brightest light and saturated red, and optionally its pixels' own falls and rises. */
  step(dt: number, inputLight: Float32Array, inputRed: Float32Array, detail: LimiterDetail | null = null): void {
    const seconds = Number.isFinite(dt) && dt > 0 ? Math.min(dt, LIMITER.longestStep) : 0;
    if (!this.started) { this.lightChannel.init(inputLight); this.redChannel.init(inputRed); this.started = true; }
    else {
      this.lightChannel.track(inputLight, seconds, detail?.lightFall ?? null, detail?.lightRise ?? null);
      this.redChannel.track(inputRed, seconds, detail?.redFall ?? null, detail?.redRise ?? null);
      const lit = this.lightChannel.area(inputLight, seconds) >= LIMITER.trigger, red = this.redChannel.area(inputRed, seconds) >= LIMITER.trigger;
      this.lightChannel.update(inputLight, seconds, lit, detail?.lightFall ?? null, detail?.lightDrop ?? null);
      this.redChannel.update(inputRed, seconds, red, detail?.redFall ?? null, detail?.redDrop ?? null);
    }
    this.light.set(this.lightChannel.value); this.red.set(this.redChannel.value);
  }
}
