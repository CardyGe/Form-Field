/**
 * Flash Guard. It reads a coarse grid of the composition's light. A transition is a large part of the frame changing a large
 * amount in one direction within a moment; a flash is an opposing pair of them over more than 25% of the frame. When the
 * rhythm of transitions would break the limit, one gain eases down until the swing is too small to count, then eases back.
 * The gain never steps harder than the picture already does. It limits light, never geometry. Not a compliance test.
 */
export const FLASH_STEP = 0.1;  // The smallest change of light in a cell that counts as half a flash.
const DARKER_LIMIT = 0.8;       // A change whose darker side is brighter than this is not counted.
const HOLD = 0.8;               // A limited swing is held to this share of the smallest counted change.
const WINDOW = 1;
const MOMENT = 0.05;            // Cells that turn within this time belong to one transition.
const SLOTS = 64;               // More transitions than any second can hold at one per moment.
const MAX_AREA = 0.25;
const RELEASE_DARK = 15;        // Gain per second on the way back up while the picture is in the dark half of its swing, where a rise barely shows.
const RELEASE = 2;              // Gain per second on the way back up.
const RECOVER = 3;              // Light per second any change of gain may move a cell, when the picture itself is still.
const SWING_FADE = 0.5;         // Light per second a cell's remembered swing fades.
const STEP_FADE = 2;            // Seconds over which the picture's remembered largest step fades.
const LOOP_PASSES = 8;          // Passes over a loop allowed for its gains to settle into one repeating pattern.
const GAPS = 4;                 // Gaps between transitions averaged to read the rhythm.
const LEAD = 0.1;               // Seconds the gain needs to come down, so a very fast rhythm is acted on this far ahead.
const SAME_FRAME_LEAD = 0.12;   // How far ahead a burst is read when the dim is applied in the frame it is computed.
const RED_STEP = 0.0625;        // The change in saturated red that counts, from the WCAG red-flash measure (20 of 320).
const RED_DARKER = 2;           // Saturated red has no "too bright to count" limit.
/** At this saturation a pure red cell measures about 63% red on rendered pixels, well under the 80% that makes it saturated red. */
export const SAFE_SATURATION = 0.2;
const CHROMA_RELEASE = 1;       // Saturation per second on the way back.
const FREE_SATURATION = 2;      // The control's maximum: above this the limit no longer applies.
const BINS = 64, CAPACITY = 1600;

/** The composition's light, cell by cell: what the guard may dim, what it may not, and how red each cell is. */
export interface GuardCells { count: number; readonly guarded: Float32Array; readonly fixed: Float32Array; readonly red: Float32Array; readonly redLight?: Float32Array }

const areaLimit = (params: Readonly<Record<string, number>>): number => Math.min(MAX_AREA, 0.05 + 0.4 * (Number.isFinite(params.safetyFullField) ? params.safetyFullField : 0.5));
function allowedTurns(red: number, params: Readonly<Record<string, number>>): number {
  const redLimit = Number.isFinite(params.safetyRedLimit) ? Math.min(1, Math.max(0, params.safetyRedLimit)) : 0.5;
  const flashes = Math.max(1, Math.min(3, Math.round(params.safetyMaxFlashes ?? 3)));
  return 2 * Math.max(1, Math.floor(flashes * (1 - Math.min(1, Math.max(0, red)) * (1 - redLimit))));
}

/** Follows every cell's direction of travel and says when enough of them have turned together. */
class Turns {
  private readonly anchor = new Float32Array(CAPACITY);
  private readonly way = new Int8Array(CAPACITY);
  private readonly at = new Float64Array(CAPACITY);
  private last = 0; private quietUntil = -1; private started = false;
  /** The direction of the last transition: 1 up, -1 down, 0 both at once. */
  get direction(): number { return this.last; }
  /** How red the cells that just turned are. */
  redness = 0;

  constructor(private readonly size = FLASH_STEP, private readonly darker = DARKER_LIMIT) {}

  reset(): void { this.way.fill(0); this.at.fill(-1e9); this.last = 0; this.quietUntil = -1; this.started = false; this.redness = 0; }

  see(values: Float32Array, red: Float32Array, n: number, now: number, limit: number): boolean {
    const { anchor, way, at } = this;
    if (!this.started) { anchor.set(values.subarray(0, n)); way.fill(0, 0, n); at.fill(-1e9, 0, n); this.started = true; return false; }
    let up = 0, down = 0, redSum = 0, freshUp = 0, freshDown = 0;
    const size = this.size, darker = this.darker;
    const since = now - MOMENT;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (way[i] === 1 && v > anchor[i]) anchor[i] = v;
      else if (way[i] === -1 && v < anchor[i]) anchor[i] = v;
      if (way[i] >= 0 && v <= anchor[i] - size && v < darker) { way[i] = -1; anchor[i] = v; at[i] = now; freshDown++; }
      else if (way[i] <= 0 && v >= anchor[i] + size && anchor[i] < darker) { way[i] = 1; anchor[i] = v; at[i] = now; freshUp++; }
      if (at[i] > since) { if (way[i] > 0) up++; else down++; redSum += red[i]; }
    }
    const turned = up + down;
    this.redness = turned ? redSum / turned : 0;
    if (this.last === 0 && now < this.quietUntil && freshUp <= limit * n && freshDown <= limit * n) return false; // Both directions at once are one transition, but a fresh swing of the frame is always a new one.
    const rose = up > limit * n, fell = down > limit * n;
    if (rose && fell) { this.last = 0; this.quietUntil = now + MOMENT; return true; }
    if (rose && this.last !== 1) { this.last = 1; this.quietUntil = now + MOMENT; return true; }
    if (fell && this.last !== -1) { this.last = -1; this.quietUntil = now + MOMENT; return true; }
    return false;
  }
}

export interface FlashGuardOptions {
  /** Seconds between a transition happening and the dim having landed: a late reading, plus any slew. */
  lead?: number;
  /** Act only on the predicted count, for a caller whose dim lands late and must not fire on a legal beat. */
  predictiveOnly?: boolean;
  /** False for a closed loop's table, which is judged whole by its own verdict and must keep its exact gains. */
  holdThrough?: boolean;
}

export class FlashGuard {
  private readonly lead: number;
  private readonly predictiveOnly: boolean;
  private readonly holdThrough: boolean;
  private readonly inTimes = new Float64Array(SLOTS);
  private inHead = 0; private inHeld = 0;
  /** The picture went over the limit: the dim stays until a full clear second has passed since its last transition. */
  private latched = false;

  constructor(options: FlashGuardOptions = {}) {
    this.lead = options.lead ?? SAME_FRAME_LEAD;
    this.predictiveOnly = options.predictiveOnly === true;
    this.holdThrough = options.holdThrough !== false;
  }

  private readonly input = new Turns();
  private readonly output = new Turns();
  private readonly seen = new Float32Array(CAPACITY);
  private readonly lit = new Float32Array(CAPACITY);
  private readonly before = new Float32Array(CAPACITY);
  private readonly beforeGuarded = new Float32Array(CAPACITY);
  private readonly high = new Float32Array(CAPACITY);
  private readonly low = new Float32Array(CAPACITY);
  private readonly bins = new Uint16Array(BINS);
  private readonly stepBins = new Uint16Array(BINS);
  private readonly events = new Float64Array(SLOTS);
  private readonly single = { count: 100, guarded: new Float32Array(100), fixed: new Float32Array(100), red: new Float32Array(100) };
  private head = 0; private held = 0; private now = 0; private gain = 1; private started = false;
  private lastIn = -1e9; private spacing = 0; private redness = 0; private largest = 0; private wideStep = 0;
  private wideArea = 0; private wideUntil = -1; private peak = 0;
  private readonly heardTimes = new Float64Array(GAPS + 1); private heardAt = 0; private heard = 0;
  private readonly redInput = new Turns(RED_STEP, RED_DARKER);
  private readonly redEvents = new Float64Array(SLOTS);
  private redHead = 0; private redHeld = 0; private redGap = 0; private redLast = -1e9; private redUntil = -1;
  /** The highest saturation this frame may show. Above the control's range it limits nothing. */
  saturationLimit = Infinity;

  reset(): void {
    this.input.reset(); this.output.reset(); this.inHead = this.inHeld = 0; this.latched = false;
    this.head = this.held = 0; this.now = 0; this.gain = 1; this.started = false;
    this.lastIn = -1e9; this.spacing = 0; this.redness = this.largest = this.wideStep = 0; this.wideArea = 0; this.wideUntil = -1; this.peak = 0; this.heardAt = this.heard = 0;
    this.redInput.reset(); this.redHead = this.redHeld = 0; this.redGap = 0; this.redLast = -1e9; this.redUntil = -1; this.saturationLimit = Infinity;
  }

  /** One uniform patch of light, for a caller without a grid: `area` of the frame at `light`, the rest dark. */
  update(dt: number, light: number, area: number, red: number, params: Readonly<Record<string, number>>): number {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(light)) return this.gain;
    // A lit area can be read a frame late, so the largest one is kept through the flash.
    if (area >= this.wideArea || this.now + dt >= this.wideUntil) { this.wideArea = area; this.wideUntil = this.now + dt + WINDOW; }
    const cells = this.single, on = Math.round(Math.min(1, Math.max(0, this.wideArea)) * cells.count);
    cells.guarded.fill(light, 0, on); cells.guarded.fill(0, on); cells.red.fill(red);
    return this.step(dt, cells, params);
  }

  private countSince(time: number): number {
    let n = 0;
    for (let k = 1; k <= this.held; k++) { if (this.events[(this.head - k + SLOTS) % SLOTS] > time) n++; else break; }
    return n;
  }

  /** The transitions a window will hold if the rhythm carries on for k more. */
  private ahead(k: number, dt: number): number { return this.countSince(this.lastIn + k * this.spacing - WINDOW + dt) + k; }

  /** The value at which a share of the cells in a histogram of 0 to 1 is at or above it. */
  private quantile(bins: Uint16Array, cells: number): number {
    let above = 0;
    for (let b = BINS - 1; b >= 0; b--) { above += bins[b]; if (above > cells) return (b + 1) / BINS; }
    return 0;
  }

  /**
   * Whether the picture's transitions will break the limit before a dim started now could land. The recent gaps are repeated,
   * so a burst is read as a burst and a short pulse on a slow beat as a slow beat.
   */
  private burstRisk(allowed: number, dt: number): boolean {
    const { inTimes, inHead, inHeld } = this;
    if (inHeld > allowed) return true;
    let period = Math.min(4, inHeld - 1);
    if (period < 1) return false;
    if (period > 1) period -= period % 2;
    const at = (back: number) => inTimes[(inHead - 1 - back + SLOTS * 2) % SLOTS];
    let ahead = 0;
    for (let k = 1; k <= SLOTS; k++) {
      const back = period - 1 - ((k - 1) % period);
      const gap = at(back) - at(back + 1);
      ahead += gap;
      if (ahead > this.lead) return false;
      let still = 0;
      for (let i = 0; i < inHeld; i++) if (at(i) > this.now + ahead - WINDOW + dt) still++;
      // Dimming a picture that has just risen is itself a change, so a rhythm over the limit keeps one in hand for it.
      if (still + k + (gap * allowed < WINDOW * 0.97 ? 1 : 0) > allowed) return true;
    }
    return false;
  }

  /**
   * The gain for this frame, from the composition's light grid. `applied` is the gain the measured picture was really shown
   * with, when that is not the gain just returned, so flashes are counted from what reached the screen.
   */
  step(dt: number, cells: GuardCells, params: Readonly<Record<string, number>>, applied?: number): number {
    if (!Number.isFinite(dt) || dt < 0) return this.gain;
    const n = Math.min(cells.count, CAPACITY), { guarded, fixed, red } = cells, { seen, lit, before, beforeGuarded, high, low, bins, stepBins } = this;
    if ((params.safetyFlashGuard ?? 1) < 0.5) { if (this.started || this.gain !== 1) this.reset(); return this.gain = 1; }
    this.now += dt;
    const limit = areaLimit(params), first = !this.started, fade = SWING_FADE * dt;
    bins.fill(0); stepBins.fill(0);
    let biggest = 0, brightest = 0;
    for (let i = 0; i < n; i++) {
      const l = guarded[i], v = Math.min(1, fixed[i] + l);
      seen[i] = v;
      if (first) { high[i] = low[i] = l; before[i] = v; beforeGuarded[i] = l; }
      else { high[i] = Math.max(l, high[i] - fade); low[i] = Math.min(l, low[i] + fade); }
      const change = Math.abs(v - before[i]);
      if (change > biggest) biggest = change;
      if (l > brightest) brightest = l;
      stepBins[Math.min(BINS - 1, Math.floor(change * BINS))]++;
      bins[Math.min(BINS - 1, Math.floor(Math.min(1, high[i] - low[i]) * BINS))]++;
    }
    this.started = true;
    const keep = Math.exp(-dt / STEP_FADE);
    this.largest = Math.max(this.largest * keep, biggest);
    this.peak = Math.max(this.peak * keep, brightest);
    this.wideStep = Math.max(this.wideStep * keep, this.quantile(stepBins, limit * n));

    const turned = this.input.see(seen, red, n, this.now, limit);
    this.redness = Math.max(this.redness * Math.exp(-dt / WINDOW), this.input.redness);
    const allowed = allowedTurns(this.redness, params);
    if (turned) {
      // The rhythm is the average of the last few gaps, so one frame's rounding cannot make a steady pulse look fast. The first
      // turn may be cut short by where the picture happened to start, so it is left out unless the budget is too small to wait.
      const usable = Math.min(allowed > 2 ? this.heard - 1 : this.heard, GAPS), oldest = this.heardTimes[(this.heardAt - usable + GAPS + 1) % (GAPS + 1)];
      this.heardTimes[this.heardAt] = this.now; this.heardAt = (this.heardAt + 1) % (GAPS + 1); this.heard++;
      this.spacing = usable > 0 ? (this.now - oldest) / usable : 0;
      this.lastIn = this.now;
    }

    while (this.held > 0 && this.now - this.events[(this.head - this.held + SLOTS) % SLOTS] >= WINDOW) this.held--;
    if (turned) { this.inTimes[this.inHead] = this.now; this.inHead = (this.inHead + 1) % SLOTS; this.inHeld = Math.min(SLOTS, this.inHeld + 1); }
    while (this.inHeld > 0 && this.now - this.inTimes[(this.inHead - this.inHeld + SLOTS) % SLOTS] >= WINDOW) this.inHeld--;
    if (turned && this.holdThrough && this.burstRisk(allowed, dt)) this.latched = true;
    if (this.latched && this.now - this.lastIn >= WINDOW) this.latched = false;

    // What the rhythm so far says the count will be, k turns from the last one. One frame of slack keeps a steady pulse at exactly the limit from reading as over it.
    const rhythm = this.spacing > 0 && this.spacing < WINDOW && this.now - this.lastIn <= this.spacing * 2.5;
    let deadline = -1;
    // A rhythm clearly over the limit stops one turn sooner, because uneven frames can bring the last one inside the window.
    const over = !this.predictiveOnly && rhythm && this.spacing * allowed < WINDOW * 0.97, budget = over ? allowed - 1 : allowed;
    const reach = over ? Math.min(6, Math.max(2, Math.ceil(LEAD / this.spacing) + 1)) : 0;
    for (let k = 1; k <= reach && deadline < 0; k++) if (this.ahead(k, dt) > budget) deadline = this.lastIn + k * this.spacing;

    // A rise with no room left for the fall after it is met in the same frame: lowering the gain as the light climbs adds no step.
    const refused = this.latched || (!this.predictiveOnly && turned && rhythm && this.spacing * allowed < WINDOW && this.input.direction >= 0 && this.ahead(1, dt) + 1 > budget);
    let gain = this.gain;
    if (refused || deadline >= 0) {
      const swing = this.quantile(bins, limit * n), target = swing > FLASH_STEP * HOLD ? FLASH_STEP * HOLD / swing : 1;
      if (gain > target) gain = refused ? target : Math.max(target, gain - (gain - target) / Math.max(1, (deadline - this.now) / Math.max(dt, 1e-6)));
    } else if (gain < 1 && !(rhythm && this.countSince(this.now - WINDOW) > 0)) gain = Math.min(1, gain + (brightest < this.peak * 0.6 ? RELEASE_DARK : RELEASE) * dt); // While the strobe lasts, it waits for a clear second.

    if (gain !== this.gain) {
      // However the gain moves, no cell may step harder than the picture itself has been stepping, and a wide area no harder than a wide area has.
      const still = RECOVER * dt, most = Math.max(this.largest, still), wide = Math.max(this.wideStep, still);
      if (brightest > 1e-6) gain = this.gain + clamp(gain - this.gain, -wide / brightest, wide / brightest);
      if (gain < this.gain) { for (let i = 0; i < n; i++) if (guarded[i] > 1e-6) gain = Math.max(gain, (this.gain * beforeGuarded[i] - most) / guarded[i]); gain = Math.min(gain, this.gain); }
      else for (let i = 0; i < n; i++) if (guarded[i] > 1e-6) gain = Math.min(gain, (this.gain * beforeGuarded[i] + most) / guarded[i]);
      gain = gain < this.gain ? gain : Math.max(gain, this.gain);
      if (gain > 1 - 1e-9) gain = 1;
    }
    this.gain = gain;

    const shownGain = applied ?? gain;
    for (let i = 0; i < n; i++) { lit[i] = Math.min(1, fixed[i] + shownGain * guarded[i]); before[i] = seen[i]; beforeGuarded[i] = guarded[i]; }
    if (this.output.see(lit, red, n, this.now, limit)) {
      this.events[this.head] = this.now; this.head = (this.head + 1) % SLOTS; this.held = Math.min(SLOTS, this.held + 1);
    }
    if (cells.redLight) this.limitRed(dt, cells.redLight, red, n, limit, params);
    return gain;
  }

  /**
   * Saturated red can flash with no change of luminance, so a gain is the wrong tool. When its rhythm would break the stricter
   * limit, saturation is held where no pixel counts as saturated red, on the frame the red would have come back.
   */
  private limitRed(dt: number, redLight: Float32Array, red: Float32Array, n: number, limit: number, params: Readonly<Record<string, number>>): void {
    const allowed = allowedTurns(1, params), turned = this.redInput.see(redLight, red, n, this.now, limit);
    while (this.redHeld > 0 && this.now - this.redEvents[(this.redHead - this.redHeld + SLOTS) % SLOTS] >= WINDOW) this.redHeld--;
    if (turned) {
      if (this.redLast > -1e8) this.redGap = this.now - this.redLast;
      if (this.redInput.direction >= 0 && this.redGap > 0 && this.redGap < WINDOW) {
        let room = 0;
        for (let k = 1; k <= this.redHeld; k++) { if (this.redEvents[(this.redHead - k + SLOTS) % SLOTS] > this.now + this.redGap - WINDOW + dt) room++; else break; }
        if (room + 2 > allowed) this.saturationLimit = SAFE_SATURATION;
      }
      this.redEvents[this.redHead] = this.now; this.redHead = (this.redHead + 1) % SLOTS; this.redHeld = Math.min(SLOTS, this.redHeld + 1); this.redLast = this.now;
      if (this.saturationLimit < FREE_SATURATION) this.redUntil = this.now + WINDOW;
    } else if (this.saturationLimit < FREE_SATURATION && this.now >= this.redUntil) {
      const next = this.saturationLimit + CHROMA_RELEASE * dt;
      this.saturationLimit = next >= FREE_SATURATION ? Infinity : next;
    }
  }
}

const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

/** The most transitions in any second of a loop played round three times, and its largest cell step, at the given gains. */
function loopVerdict(frames: number, n: number, read: (frame: number) => number, guarded: Float32Array, fixed: Float32Array | null, reds: Float32Array, gains: Float32Array | null, span: number, limit: number): { worst: number; step: number; red: number } {
  const turns = new Turns(), value = new Float32Array(n), last = new Float32Array(n), times: number[] = [];
  turns.reset();
  let step = 0, red = 0;
  for (let lap = 0, i = 0; lap < 3; lap++) for (let f = 0; f < frames; f++, i++) {
    const from = read(f), gain = gains ? gains[f] : 1;
    for (let c = 0; c < n; c++) value[c] = Math.min(1, (fixed ? fixed[from + c] : 0) + gain * guarded[from + c]);
    if (i) for (let c = 0; c < n; c++) step = Math.max(step, Math.abs(value[c] - last[c]));
    last.set(value);
    if (turns.see(value, reds.subarray(from, from + n), n, i / span, limit)) times.push(i);
    red = Math.max(red, turns.redness);
  }
  let worst = 0;
  for (let i = 0, k = 0; i < times.length; i++) { while (times[i] - times[k] >= span) k++; worst = Math.max(worst, i - k + 1); }
  return { worst, step, red };
}

/** The most saturated-red transitions in any second of a loop played round three times. */
function redTurnsInLoop(shown: Float32Array, frames: number, n: number, reds: Float32Array, span: number, limit: number): number {
  const turns = new Turns(RED_STEP, RED_DARKER), times: number[] = [];
  turns.reset();
  // The first lap only warms the counter: its first turn is measured from wherever the loop happens to start.
  for (let lap = 0, i = 0; lap < 3; lap++) for (let f = 0; f < frames; f++, i++) if (turns.see(shown.subarray(f * n, (f + 1) * n), reds.subarray(f * n, (f + 1) * n), n, i / span, limit) && lap > 0) times.push(i);
  let worst = 0;
  for (let i = 0, k = 0; i < times.length; i++) { while (times[i] - times[k] >= span) k++; worst = Math.max(worst, i - k + 1); }
  return worst;
}

/**
 * The gain of every frame of a closed loop, from each frame's light grid, so the limit holds across the loop point and a
 * frame's gain never depends on which frames were rendered before it. A loop already inside the limit is left at exactly 1.
 */
export function guardLoopCells(fill: (frame: number) => GuardCells, frames: number, fps: number, params: Readonly<Record<string, number>>, result?: { saturation: number }): Float32Array {
  const count = Math.max(1, Math.round(frames)), rate = fps > 0 ? fps : 30, dt = 1 / rate, table = new Float32Array(count).fill(1);
  if ((params.safetyFlashGuard ?? 1) < 0.5) return table;
  const firstCells = fill(0), n = Math.min(firstCells.count, CAPACITY), guarded = new Float32Array(count * n), reds = new Float32Array(count * n);
  let fixed: Float32Array | null = null, shownRed: Float32Array | null = null;
  const store = (f: number, cells: GuardCells) => {
    if (cells.redLight) { for (let c = 0; c < n && !shownRed; c++) if (cells.redLight[c] !== 0) shownRed = new Float32Array(count * n); if (shownRed) shownRed.set(cells.redLight.subarray(0, n), f * n); }
    guarded.set(cells.guarded.subarray(0, n), f * n); reds.set(cells.red.subarray(0, n), f * n);
    for (let c = 0; c < n && !fixed; c++) if (cells.fixed[c] !== 0) fixed = new Float32Array(count * n);
    if (fixed) fixed.set(cells.fixed.subarray(0, n), f * n);
  };
  store(0, firstCells);
  for (let f = 1; f < count; f++) store(f, fill(f));
  const limit = areaLimit(params), span = Math.max(1, Math.round(WINDOW * rate)), at = (f: number) => f * n;
  // A loop whose saturated red would break its limit holds saturation below it throughout, which is closed by construction.
  if (result) result.saturation = shownRed && redTurnsInLoop(shownRed, count, n, reds, span, limit) > allowedTurns(1, params) ? SAFE_SATURATION : Infinity;
  const plain = loopVerdict(count, n, at, guarded, fixed, reds, null, span, limit), allowed = allowedTurns(plain.red, params);
  if (plain.worst <= allowed) return table;

  const guard = new FlashGuard({ holdThrough: false }), replay: GuardCells = { count: n, guarded: new Float32Array(n), fixed: new Float32Array(n), red: new Float32Array(n) };
  const load = (f: number) => { replay.guarded.set(guarded.subarray(f * n, (f + 1) * n)); replay.red.set(reds.subarray(f * n, (f + 1) * n)); if (fixed) replay.fixed.set((fixed as Float32Array).subarray(f * n, (f + 1) * n)); };
  const gains = new Float32Array(count);
  for (let f = Math.max(0, count - Math.ceil(rate)); f < count; f++) { load(f); guard.step(dt, replay, params); }
  let settled = false;
  for (let pass = 0; pass < LOOP_PASSES && !settled; pass++) {
    settled = pass > 0;
    for (let f = 0; f < count; f++) { load(f); const g = Math.fround(guard.step(dt, replay, params)); if (g !== gains[f]) settled = false; gains[f] = g; }
  }
  if (settled) {
    const verdict = loopVerdict(count, n, at, guarded, fixed, reds, gains, span, limit);
    if (verdict.worst <= allowed && verdict.step <= plain.step + 1e-3) { table.set(gains); return table; }
  }
  // Otherwise the loop is cut into phrases of at least two seconds, each starting on a rise. A phrase spends its budget, holds,
  // and climbs back to full only through its final dark moment, where the climb barely shows.
  const means = new Float32Array(count);
  let dimmest = Infinity, brightest = -Infinity;
  for (let f = 0; f < count; f++) { let sum = 0; for (let c = 0; c < n; c++) sum += guarded[f * n + c]; means[f] = sum / n; dimmest = Math.min(dimmest, means[f]); brightest = Math.max(brightest, means[f]); }
  const middle = (dimmest + brightest) / 2, dark = (f: number) => means[(f + count) % count] < middle;
  const riseFrom = (f: number) => { for (let k = 0; k < count; k++) { const at = (f + k) % count; if (dark(at - 1) && !dark(at)) return at; } return -1; };
  for (let phrases = Math.max(1, Math.floor(count / (2 * rate))); phrases >= 1 && brightest - dimmest > 1e-3; phrases--) {
    const starts: number[] = [];
    for (let p = 0; p < phrases; p++) { const at = riseFrom(Math.floor(p * count / phrases)); if (at >= 0 && !starts.includes(at)) starts.push(at); }
    if (!starts.length) break;
    starts.sort((x, y) => x - y);
    for (let p = 0; p < starts.length; p++) {
      const from = starts[p], length = ((starts[(p + 1) % starts.length] - from + count - 1) % count) + 1, fresh = new FlashGuard({ holdThrough: false });
      let lowest = 1;
      for (let k = 0; k < length; k++) { const f = (from + k) % count; load(f); gains[f] = Math.fround(fresh.step(dt, replay, params)); lowest = Math.min(lowest, gains[f]); }
      // Once down, it stays down: a gain creeping up inside the strobe would only spend the budget on faint flickers.
      for (let k = 0, down = false; k < length; k++) { const f = (from + k) % count; down = down || gains[f] <= lowest; if (down) gains[f] = lowest; }
      let run = 0;
      while (run < length - 1 && dark(from + length - 1 - run)) run++;
      const base = gains[(from + length - run - 1 + count) % count];
      for (let k = 0; k < run; k++) { const f = (from + length - run + k) % count; gains[f] = Math.fround(Math.max(gains[f], base + (1 - base) * (k + 1) / run)); }
    }
    const verdict = loopVerdict(count, n, at, guarded, fixed, reds, gains, span, limit);
    if (verdict.worst <= allowed && verdict.step <= plain.step + 1e-3) { table.set(gains); return table; }
  }

  // Nothing repeating kept the limit: one steady gain, small enough that the swing no longer counts, cannot add a change.
  const high = new Float32Array(n).fill(-Infinity), low = new Float32Array(n).fill(Infinity), bins = new Uint32Array(BINS);
  for (let f = 0; f < count; f++) for (let c = 0; c < n; c++) { const l = guarded[f * n + c]; if (l > high[c]) high[c] = l; if (l < low[c]) low[c] = l; }
  for (let c = 0; c < n; c++) bins[Math.min(BINS - 1, Math.floor(Math.min(1, high[c] - low[c]) * BINS))]++;
  let above = 0, swing = 0;
  for (let b = BINS - 1; b >= 0; b--) { above += bins[b]; if (above > limit * n) { swing = (b + 1) / BINS; break; } }
  return table.fill(swing > FLASH_STEP * HOLD ? Math.fround(FLASH_STEP * HOLD / swing) : 1);
}

export interface FlashSample { light: number; area: number; red: number }

/** The same table for a caller that knows only one uniform patch of light per frame. */
export function guardLoopTable(sample: (frame: number, out: FlashSample) => void, frames: number, fps: number, params: Readonly<Record<string, number>>): Float32Array {
  const one: FlashSample = { light: 0, area: 0, red: 0 }, cells: GuardCells = { count: 100, guarded: new Float32Array(100), fixed: new Float32Array(100), red: new Float32Array(100) };
  return guardLoopCells(frame => {
    sample(frame, one);
    const on = Math.round(Math.min(1, Math.max(0, one.area)) * cells.count);
    cells.guarded.fill(one.light, 0, on); cells.guarded.fill(0, on); cells.red.fill(one.red);
    return cells;
  }, frames, fps, params);
}
