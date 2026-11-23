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

export class FlashGuard {
  private readonly turns = new Float64Array(SLOTS);
  private head = 0; private count = 0; private now = 0; private anchor = 0; private way = 0; private started = false; private gain = 1;

  reset(): void { this.head = this.count = this.way = 0; this.now = this.anchor = 0; this.started = false; this.gain = 1; }

  /** `light` is the frame's changing light, `area` the share of the frame it covers, `red` how saturated red it is (0 to 1). */
  update(dt: number, light: number, area: number, red: number, params: Readonly<Record<string, number>>): number {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(light)) return this.gain;
    this.now += dt;
    if ((params.safetyFlashGuard ?? 1) < 0.5) { this.anchor = light; this.way = 0; this.started = true; return this.gain = 1; }
    const field = Number.isFinite(params.safetyFullField) ? params.safetyFullField : 0.5;
    if (!this.started || area <= Math.min(MAX_AREA, 0.05 + 0.4 * field)) { this.anchor = light; this.way = 0; this.started = true; return this.gain = 1; }

    while (this.count > 0 && this.now - this.turns[(this.head - this.count + SLOTS) % SLOTS] >= WINDOW) this.count--;
    const redLimit = Number.isFinite(params.safetyRedLimit) ? Math.min(1, Math.max(0, params.safetyRedLimit)) : 0.5;
    const flashes = Math.max(1, Math.min(3, Math.round(params.safetyMaxFlashes ?? 3)));
    const allowed = 2 * Math.max(1, Math.floor(flashes * (1 - Math.min(1, Math.max(0, red)) * (1 - redLimit))));

    let out = light;
    if (this.way >= 0 && out > this.anchor && this.way === 1) this.anchor = out;
    if (this.way <= 0 && out < this.anchor) { if (this.way === -1) this.anchor = out; }
    if (this.way >= 0 && out <= this.anchor - FLASH_STEP) { this.turn(-1, out); }
    else if (this.way <= 0 && out >= this.anchor + FLASH_STEP) {
      if (this.count + 2 <= allowed) this.turn(1, out);
      else out = this.anchor + FLASH_STEP * HOLD;
    }
    return this.gain = light > 1e-9 ? Math.min(1, out / light) : 1;
  }

  private turn(way: number, value: number): void {
    this.way = way; this.anchor = value;
    this.turns[this.head] = this.now; this.head = (this.head + 1) % SLOTS; this.count = Math.min(SLOTS, this.count + 1);
  }
}
