/**
 * Meridian's quality governor, for live output only (the Studio preview, the Map wall and Meridian Live). An export never
 * uses it.
 *
 * Only frame times that stay over budget make it act, and then it gives up cost in a fixed order: first bloom, then the
 * glitch tear, then the number of small marks. It never touches how sharp the lines are or the audience flash limiter.
 * Every change glides over about two seconds, so the picture never steps. Coming back needs about five calm seconds per
 * step; if the show goes slow again soon after coming back, the next return waits longer, so it does not see-saw.
 *
 * Pure and allocation-free: `update` returns the same object every frame.
 */

export const GOVERNOR = {
  /** A frame slower than this is over budget. */
  budgetMs: 20,
  /** A frame slower than this breaks a run of calm frames. Between the two, a frame neither helps nor hurts. */
  breaksCalmMs: 25,
  /** A gap this long is a stall (a hidden window, a dialog, a reset), not a measure of the show. */
  stallMs: 250,
  /** Most any one frame can add to the slow count, so a single hitch never reaches a step. */
  longestCountedSeconds: .1,
  /** Net slow time that makes the next step. */
  sustainSeconds: 1,
  /** Calm time before one step comes back. */
  recoverSeconds: 5,
  /** Longest wait before a step comes back, after repeated slowing. */
  longestRecoverSeconds: 60,
  /** Slowing again within this long of coming back doubles the next wait. */
  relapseSeconds: 10,
  /** A level held this long without slowing again resets the wait to recoverSeconds. */
  forgiveSeconds: 60,
  /** Steps per second the picture glides through. */
  glidePerSecond: .5,
  /** At most half the small marks are let go. */
  minInstanceScale: .5,
  /** Steps: 1 bloom, 2 tear, 3 instances. */
  steps: 3,
} as const;

export interface MeridianQuality {
  /**
   * Share of bloom kept, 1 to 0. Bloom fades rather than changing shape, so nothing steps; at 0 its passes are not drawn at
   * all, which is where the saving is.
   */
  bloom: number;
  /** Share of the glitch tear and glitch shards kept, 0 to 1. */
  tear: number;
  /** Share of small marks (nodes and dots) kept, 0.5 to 1. */
  instanceScale: number;
  /** Whether anything is reduced, or about to be. */
  reduced: boolean;
  /** Where the glide is, 0 (full) to 3 (everything reduced). */
  level: number;
}

export const FULL_QUALITY: Readonly<MeridianQuality> = Object.freeze({ bloom: 1, tear: 1, instanceScale: 1, reduced: false, level: 0 });

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;

export class MeridianGovernor {
  private target = 0;
  private level = 0;
  private slow = 0;
  private calm = 0;
  private wait: number = GOVERNOR.recoverSeconds;
  private sinceRecovery = Infinity;
  private steady = 0;
  private readonly out: MeridianQuality = { ...FULL_QUALITY };

  /** One drawn frame: how long it took from the last one, in ms. Returns the quality to draw the next frame with. */
  update(frameMs: number): MeridianQuality {
    if (!(frameMs > 0) || frameMs >= GOVERNOR.stallMs) return this.out;
    const dt = frameMs / 1000;
    this.sinceRecovery += dt;
    this.steady += dt;
    if (this.steady >= GOVERNOR.forgiveSeconds) this.wait = GOVERNOR.recoverSeconds;

    // Slowness is judged only once the last step has fully taken effect, so it never gives up more than it needs to.
    const settled = Math.abs(this.level - this.target) < 1e-9;
    if (!settled) this.slow = 0;
    else if (frameMs > GOVERNOR.budgetMs) this.slow += Math.min(dt, GOVERNOR.longestCountedSeconds);
    else this.slow = Math.max(0, this.slow - dt);
    if (frameMs > GOVERNOR.breaksCalmMs) this.calm = 0;
    else if (frameMs <= GOVERNOR.budgetMs) this.calm += dt;

    if (this.slow >= GOVERNOR.sustainSeconds && settled && this.target < GOVERNOR.steps) {
      this.target++;
      this.slow = 0; this.calm = 0; this.steady = 0;
      if (this.sinceRecovery < GOVERNOR.relapseSeconds) this.wait = Math.min(GOVERNOR.longestRecoverSeconds, this.wait * 2);
    } else if (this.target > 0 && this.calm >= this.wait) {
      this.target--;
      this.calm = 0; this.slow = 0; this.sinceRecovery = 0;
    }

    const glide = GOVERNOR.glidePerSecond * dt;
    if (this.level < this.target) this.level = Math.min(this.target, this.level + glide);
    else if (this.level > this.target) this.level = Math.max(this.target, this.level - glide);
    return this.write();
  }

  /** Back to full quality at once: a new show, or the output was closed and opened again. */
  reset(): void {
    this.target = 0; this.level = 0; this.slow = 0; this.calm = 0;
    this.wait = GOVERNOR.recoverSeconds; this.sinceRecovery = Infinity; this.steady = 0;
    this.write();
  }

  /** The quality now, without counting a frame. */
  get quality(): Readonly<MeridianQuality> { return this.out; }

  private write(): MeridianQuality {
    const out = this.out, level = this.level;
    out.bloom = 1 - clamp01(level);
    out.tear = 1 - clamp01(level - 1);
    out.instanceScale = 1 - (1 - GOVERNOR.minInstanceScale) * clamp01(level - 2);
    out.reduced = level > 1e-9 || this.target > 0;
    out.level = level;
    return out;
  }
}
