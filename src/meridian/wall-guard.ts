/**
 * Wall Flash Guard. Reads the finished wall as 48 x 27 cells of real pixels, so it covers every instrument, mask and overlap,
 * and gives one master dim and one saturation limit. The transition rules are FlashGuard's. The dim is slewed here because a
 * reading of the wall arrives a frame or two late. It is a safety limiter, not a certified photosensitivity test.
 */
import { FlashGuard, type GuardCells } from './flash-guard';

export const WALL_COLS = 48;
export const WALL_ROWS = 27;
export const WALL_CELLS = WALL_COLS * WALL_ROWS;

const DIM_RATE = 15;           // Gain per second on the way down: about four frames from full to dark.
const RISE_RATE = 2.5;         // Gain per second on the way back.
const SATURATION_DOWN = 10;    // Saturation per second on the way down.
const SATURATION_UP = 1;       // Saturation per second on the way back.
const FREE_SATURATION = 2;     // The control's maximum: at or above this the wall is not limited.
const SHOWN_FOR = 1.5;         // Seconds the operator's status stays on after the last limiting, so a brief dip is seen.
const LONGEST_STEP = 0.25;
const WALL_LEAD = 0.17;        // Seconds from a transition to the dim landing: up to three frames of readback, then the slew.

export interface WallGuardSettings { safetyFlashGuard: number; safetyMaxFlashes: number; safetyRedLimit: number; safetyFullField: number }
export interface WallGuardPolicy {
  /** A visible Meridian layer is in the show. */
  present: boolean;
  /** At least one of them has Flash Guard on, so the wall is guarded. */
  on: boolean;
  /** At least one of them has Flash Guard off, so the operator is warned. */
  warn: boolean;
  settings: WallGuardSettings;
}
interface GuardLayer { kind: string; visible: boolean; params: Readonly<Record<string, number>> }

const setting = (value: number | undefined, fallback: number): number => (Number.isFinite(value) ? value as number : fallback);

/** What the show asks of the wall guard: the strictest settings among its guarded Meridian layers. */
export function wallGuardPolicy(projects: Iterable<{ layers: readonly GuardLayer[] }>): WallGuardPolicy {
  const settings: WallGuardSettings = { safetyFlashGuard: 0, safetyMaxFlashes: 3, safetyRedLimit: 1, safetyFullField: 1 };
  let present = false, on = false, warn = false;
  for (const project of projects) for (const layer of project.layers) {
    if (!layer.visible || layer.kind !== 'meridian') continue;
    present = true;
    if (setting(layer.params.safetyFlashGuard, 1) < 0.5) { warn = true; continue; }
    on = true;
    settings.safetyMaxFlashes = Math.min(settings.safetyMaxFlashes, setting(layer.params.safetyMaxFlashes, 3));
    settings.safetyRedLimit = Math.min(settings.safetyRedLimit, setting(layer.params.safetyRedLimit, 0.5));
    settings.safetyFullField = Math.min(settings.safetyFullField, setting(layer.params.safetyFullField, 0.5));
  }
  settings.safetyFlashGuard = on ? 1 : 0;
  return { present, on, warn, settings };
}

/** Bytes hold the square root of linear light, which keeps precision in the dark. */
const LIGHT = Float32Array.from({ length: 256 }, (_, i) => (i / 255) * (i / 255));

export class WallFlashGuard {
  private readonly guard = new FlashGuard({ lead: WALL_LEAD, predictiveOnly: true });
  private readonly cells: GuardCells & { redLight: Float32Array } = { count: WALL_CELLS, guarded: new Float32Array(WALL_CELLS), fixed: new Float32Array(WALL_CELLS), red: new Float32Array(WALL_CELLS), redLight: new Float32Array(WALL_CELLS) };
  private shownFor = 0;
  /** The master dim for the wall, 0 to 1. Exactly 1 on a calm wall. */
  gain = 1;
  /** The highest saturation the wall may show. Infinity limits nothing. */
  saturation = Infinity;

  /** True while the wall is being limited, and briefly after, so the operator can see that it happened. */
  get limiting(): boolean { return this.shownFor > 0; }

  reset(): void { this.guard.reset(); this.gain = 1; this.saturation = Infinity; this.shownFor = 0; }

  /** The guard was switched off while dimming: the dim eases away, and only then is everything reset. True once it is gone. */
  easeOut(dt: number): boolean {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, LONGEST_STEP) : 0;
    this.gain = Math.min(1, this.gain + RISE_RATE * step);
    this.slewSaturation(Infinity, step);
    if (this.gain < 1 || this.saturation !== Infinity) return false;
    this.reset();
    return true;
  }

  /**
   * One reading of the wall, rgba from the graphics card. `applied` is the gain that reading's frame was shown with.
   * Allocates nothing.
   */
  step(dt: number, rgba: Uint8Array, settings: Readonly<WallGuardSettings>, applied: number = this.gain): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    const step = Math.min(dt, LONGEST_STEP), { guarded, red, redLight } = this.cells;
    for (let i = 0, at = 0; i < WALL_CELLS; i++, at += 4) {
      const r = LIGHT[rgba[at]], g = LIGHT[rgba[at + 1]], b = LIGHT[rgba[at + 2]], sum = r + g + b;
      guarded[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const saturated = sum > 1e-6 && r / sum >= 0.8;
      redLight[i] = saturated ? r - g - b : 0;
      red[i] = saturated ? Math.max(0, (r - g - b) / r) : 0;
    }
    const wanted = this.guard.step(step, this.cells, settings, applied);
    this.gain = wanted < this.gain ? Math.max(wanted, this.gain - DIM_RATE * step) : Math.min(wanted, this.gain + RISE_RATE * step);
    if (this.gain > 1 - 1e-6 && wanted >= 1) this.gain = 1;
    this.slewSaturation(this.guard.saturationLimit, step);
    if (this.gain < 0.999 || this.saturation < FREE_SATURATION) this.shownFor = SHOWN_FOR;
    else this.shownFor = Math.max(0, this.shownFor - step);
  }

  private slewSaturation(limit: number, dt: number): void {
    const from = Math.min(this.saturation, FREE_SATURATION), to = Math.min(limit, FREE_SATURATION);
    const next = to < from ? Math.max(to, from - SATURATION_DOWN * dt) : Math.min(to, from + SATURATION_UP * dt);
    this.saturation = next >= FREE_SATURATION ? Infinity : next;
  }
}
