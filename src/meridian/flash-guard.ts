/**
 * Flash Guard. A flash is a pair of opposing luminance changes over more than 25% of the frame. A rise is let through only
 * if the budget also has room for the fall that must follow, so the light it returns stays inside the limit in every
 * one-second window. It returns a gain of at most 1 for light; it never touches geometry. Not a compliance test.
 */
export const FLASH_STEP = 0.1;  // The smallest change of light that counts as half a flash.
const HOLD = 0.9;               // A refused rise stops this share of the way to counting.
const WINDOW = 1;
const SLOTS = 32;               // More changes than any permitted second can hold.
const MAX_AREA = 0.25;
const RECOVER = 3;              // Light per second a limited picture may climb back, so a release is never a hard step.
const LOOP_PASSES = 8;          // Passes over a loop allowed for its gains to settle into one repeating pattern.

export class FlashGuard {
  private readonly turns = new Float64Array(SLOTS);
  private head = 0; private count = 0; private now = 0; private anchor = 0; private previous = 0; private way = 0; private started = false; private gain = 1; private heldUntil = -1; private lastLight = 0; private lastOut = 0;

  reset(): void { this.head = this.count = this.way = 0; this.now = this.anchor = this.previous = 0; this.started = false; this.gain = 1; this.heldUntil = -1; this.lastLight = this.lastOut = 0; }

  /** `light` is the frame's changing light, `area` the share of the frame it covers, `red` how saturated red it is (0 to 1). */
  update(dt: number, light: number, area: number, red: number, params: Readonly<Record<string, number>>): number {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(light)) return this.gain;
    this.now += dt;
    if ((params.safetyFlashGuard ?? 1) < 0.5) { this.anchor = this.previous = this.lastLight = this.lastOut = light; this.way = 0; this.started = true; this.heldUntil = -1; return this.gain = 1; }
    const field = Number.isFinite(params.safetyFullField) ? params.safetyFullField : 0.5;
    // Once a large area has been lit, the decision holds through the flash, so an area that rises and falls with the light cannot reset it.
    if (area > Math.min(MAX_AREA, 0.05 + 0.4 * field)) this.heldUntil = this.now + WINDOW;
    // A picture being held back climbs to its light at a limited rate, or as fast as the light itself is rising.
    const first = !this.started, held = !first && this.lastOut < this.lastLight - 1e-9;
    let out = held ? Math.min(light, this.lastOut + Math.max(light - this.lastLight, RECOVER * dt)) : light;
    if (first || this.now >= this.heldUntil) {
      // One frame behind, so a rise first seen on the frame before the area caught up is still measured from the dark.
      this.anchor = first ? out : this.previous; this.previous = out; this.way = 0; this.started = true;
      return this.finish(light, out);
    }

    while (this.count > 0 && this.now - this.turns[(this.head - this.count + SLOTS) % SLOTS] >= WINDOW) this.count--;
    const redLimit = Number.isFinite(params.safetyRedLimit) ? Math.min(1, Math.max(0, params.safetyRedLimit)) : 0.5;
    const flashes = Math.max(1, Math.min(3, Math.round(params.safetyMaxFlashes ?? 3)));
    const allowed = 2 * Math.max(1, Math.floor(flashes * (1 - Math.min(1, Math.max(0, red)) * (1 - redLimit))));

    if (this.way === 1 && out > this.anchor) this.anchor = out;
    if (this.way === -1 && out < this.anchor) this.anchor = out;
    if (this.way >= 0 && out <= this.anchor - FLASH_STEP) this.turn(-1, out);
    else if (this.way <= 0 && out >= this.anchor + FLASH_STEP) {
      if (this.count + 2 <= allowed) this.turn(1, out);
      else out = this.anchor + FLASH_STEP * HOLD;
    }
    this.previous = out;
    return this.finish(light, out);
  }

  private finish(light: number, out: number): number {
    this.lastLight = light; this.lastOut = out;
    return this.gain = light > 1e-9 ? Math.min(1, out / light) : 1;
  }

  private turn(way: number, value: number): void {
    this.way = way; this.anchor = value;
    this.turns[this.head] = this.now; this.head = (this.head + 1) % SLOTS; this.count = Math.min(SLOTS, this.count + 1);
  }
}

/** The most changes of light in any second of the loop played round three times, counting only frames over a large area. */
function loopTurns(lights: Float32Array, gains: Float32Array, areas: Float32Array, dt: number, params: Readonly<Record<string, number>>): number {
  const count = lights.length, field = Number.isFinite(params.safetyFullField) ? params.safetyFullField : 0.5, limit = Math.min(MAX_AREA, 0.05 + 0.4 * field), span = Math.max(1, Math.round(WINDOW / dt));
  let large = false;
  for (let f = 0; f < count; f++) if (areas[f] > limit) large = true;
  if (!large) return 0;
  const at = new Int32Array(count * 3);
  let n = 0, anchor = lights[0] * gains[0], way = 0;
  for (let i = 1; i < count * 3; i++) {
    const v = lights[i % count] * gains[i % count];
    if (way === 1 && v > anchor) anchor = v;
    if (way === -1 && v < anchor) anchor = v;
    if (way >= 0 && v <= anchor - FLASH_STEP) { way = -1; anchor = v; at[n++] = i; }
    else if (way <= 0 && v >= anchor + FLASH_STEP) { way = 1; anchor = v; at[n++] = i; }
  }
  let worst = 0;
  for (let i = 0, k = 0; i < n; i++) { while (at[i] - at[k] >= span) k++; worst = Math.max(worst, i - k + 1); }
  return worst;
}

/** Whether the step from the loop's last frame to its first is no harder than the light's own step or a limited recovery. */
function smoothSeam(lights: Float32Array, gains: Float32Array, dt: number): boolean {
  const end = lights.length - 1, step = Math.abs(lights[0] * gains[0] - lights[end] * gains[end]);
  return step <= Math.max(Math.abs(lights[0] - lights[end]), RECOVER * dt) + 1e-4;
}

/**
 * Gains that repeat exactly with the loop: the loop is cut into equal slots and each may hold one rise, early in the slot, so
 * rises stay far enough apart across every slot edge and the loop point. Returns false if the loop is too short for one.
 */
function slottedGains(lights: Float32Array, budget: number, dt: number, out: Float32Array): boolean {
  const count = lights.length, gap = Math.ceil(WINDOW / (budget - 0.5) / dt), slots = Math.floor(count / (gap * 2)) || (count >= gap ? 1 : 0);
  if (!slots) return false;
  const before = new Float32Array(count);
  let anchor = lights[0], way = 0, rose = -1, lastLight = lights[count - 1], lastOut = lights[count - 1];
  for (let lap = 0; lap < 5; lap++) {
    let same = lap > 0;
    rose = -1;
    for (let f = 0; f < count; f++) {
      const slot = Math.floor(f * slots / count), start = Math.ceil(slot * count / slots), end = Math.ceil((slot + 1) * count / slots), open = f - start < Math.max(1, end - start - gap);
      let value = lastOut < lastLight - 1e-9 ? Math.min(lights[f], lastOut + Math.max(lights[f] - lastLight, RECOVER * dt)) : lights[f];
      if (way === 1 && value > anchor) anchor = value;
      if (way === -1 && value < anchor) anchor = value;
      if (way >= 0 && value <= anchor - FLASH_STEP) { way = -1; anchor = value; }
      else if (way <= 0 && value >= anchor + FLASH_STEP) {
        if (open && rose !== slot) { way = 1; anchor = value; rose = slot; }
        else value = anchor + FLASH_STEP * HOLD;
      }
      lastLight = lights[f]; lastOut = value;
      const gain = Math.fround(lights[f] > 1e-9 ? Math.min(1, value / lights[f]) : 1);
      if (gain !== before[f]) same = false;
      before[f] = gain;
    }
    if (same) { out.set(before); return true; }
  }
  return false;
}

export interface FlashSample { light: number; area: number; red: number }

/**
 * The gain of every frame of a closed loop, played round until it repeats, so the limit holds across the loop point and a
 * frame's gain never depends on which frames were rendered before it. A loop that will not settle is held flat.
 */
export function guardLoopTable(sample: (frame: number, out: FlashSample) => void, frames: number, fps: number, params: Readonly<Record<string, number>>): Float32Array {
  const count = Math.max(1, Math.round(frames)), dt = 1 / (fps > 0 ? fps : 30), table = new Float32Array(count).fill(1);
  if ((params.safetyFlashGuard ?? 1) < 0.5) return table;
  const lights = new Float32Array(count), areas = new Float32Array(count), reds = new Float32Array(count), one: FlashSample = { light: 0, area: 0, red: 0 };
  for (let f = 0; f < count; f++) { sample(f, one); lights[f] = one.light; areas[f] = one.area; reds[f] = one.red; }
  const guard = new FlashGuard(), last = new Float32Array(count);
  // The first pass only warms the guard with the end of the loop.
  for (let f = Math.max(0, count - Math.ceil(fps)); f < count; f++) guard.update(dt, lights[f], areas[f], reds[f], params);
  for (let pass = 0; pass < LOOP_PASSES; pass++) {
    let same = pass > 0;
    for (let f = 0; f < count; f++) { const gain = Math.fround(guard.update(dt, lights[f], areas[f], reds[f], params)); if (gain !== last[f]) same = false; last[f] = gain; }
    if (same && smoothSeam(lights, last, dt)) { table.set(last); return table; }
  }
  // Still changing from pass to pass, which a budget of whole flashes often does. The last pass stands if it keeps the limit when it repeats.
  let reddest = 0;
  for (let f = 0; f < count; f++) reddest = Math.max(reddest, reds[f]);
  const redLimit = Number.isFinite(params.safetyRedLimit) ? Math.min(1, Math.max(0, params.safetyRedLimit)) : 0.5;
  const flashes = Math.max(1, Math.min(3, Math.round(params.safetyMaxFlashes ?? 3)));
  const budget = Math.max(1, Math.floor(flashes * (1 - Math.min(1, reddest) * (1 - redLimit))));
  if (smoothSeam(lights, last, dt) && loopTurns(lights, last, areas, dt, params) <= 2 * budget) { table.set(last); return table; }
  if (slottedGains(lights, budget, dt, last) && smoothSeam(lights, last, dt) && loopTurns(lights, last, areas, dt, params) <= 2 * budget) { table.set(last); return table; }
  let low = Infinity;
  for (let f = 0; f < count; f++) low = Math.min(low, lights[f]);
  const ceiling = low + FLASH_STEP * HOLD;
  for (let f = 0; f < count; f++) table[f] = lights[f] > ceiling ? ceiling / lights[f] : 1;
  return table;
}
