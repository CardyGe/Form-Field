/** How much a field changed between two samples: 0 unchanged, 1 unrelated. */
export function fieldActivity(a: Float32Array, b: Float32Array): number {
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < a.length; i++) { xy += a[i] * b[i]; xx += a[i] * a[i]; yy += b[i] * b[i]; }
  if (xx <= 0 || yy <= 0) return 0;
  const change = 1 - xy / Math.sqrt(xx * yy);
  return change < 1e-9 ? 0 : Math.min(1, change);
}

const RAMP_PER_SECOND = .12, RELAX_PER_SECOND = .1, SEED_AFTER_SECONDS = 8;

/** Keeps an endless pattern alive: a settled picture gets more movement first, and fresh disturbances only if that fails. */
export class ActivityGovernor {
  private below = 0;
  private boost = 0;

  update(activity: number, floor: number, seconds: number): { driftBoost: number; seedBurst: number } {
    if (floor <= 0) { this.below = 0; this.boost = 0; return { driftBoost: 0, seedBurst: 0 }; }
    if (activity < floor) {
      this.below += seconds;
      this.boost = Math.min(1, this.boost + RAMP_PER_SECOND * seconds);
    } else {
      this.below = 0;
      this.boost = Math.max(0, this.boost - RELAX_PER_SECOND * seconds);
    }
    const seedBurst = this.below >= SEED_AFTER_SECONDS ? Math.min(1, .25 + (this.below - SEED_AFTER_SECONDS) * .12) : 0;
    return { driftBoost: this.boost, seedBurst };
  }
}
