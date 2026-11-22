/** The field is clamped to this size, so the cubic term's stiffness has a known ceiling. */
export const FIELD_LIMIT = 1.5;

/**
 * The largest safe explicit time step. The 9-point Laplacian's eigenvalues lie in [-4, 0], so the linear operator's
 * fastest decay is the larger of (4 - K)² and K², steering adds up to 4·alignment, and the nonlinear terms add 3u² and 2g|u|.
 * The 1.8 keeps a 10% margin below the stability limit of 2.
 */
export function stableStep(wavelength: number, alignment: number, asymmetry: number): number {
  const K = (2 * Math.PI / wavelength) ** 2;
  return 1.8 / (Math.max((4 - K) ** 2, K * K) + 4 * alignment + 3 * FIELD_LIMIT ** 2 + 2 * FIELD_LIMIT * asymmetry);
}

/** How many fixed steps this frame owes. `speed` is simulation time per second. After a stall the excess is dropped. */
export function accumulateSteps(carry: number, seconds: number, speed: number, dt: number, maxSteps: number): { steps: number; carry: number } {
  if (speed <= 0) return { steps: 0, carry };
  const total = carry + seconds * speed / dt, steps = Math.floor(total + 1e-9);
  return steps > maxSteps ? { steps: maxSteps, carry: 0 } : { steps, carry: Math.max(0, total - steps) };
}
