/** The field is clamped to this size, so the cubic term's stiffness has a known ceiling. */
export const FIELD_LIMIT = 1.5;

/**
 * The largest safe explicit time step. The 9-point Laplacian's eigenvalues lie in [-4, 0], so the linear operator's
 * fastest decay is (4 - K)², steering adds up to 4·alignment, and the nonlinear terms add 3u² and 2g|u|.
 * The 1.8 keeps a 10% margin below the stability limit of 2.
 */
export function stableStep(wavelength: number, alignment: number, asymmetry: number): number {
  const K = (2 * Math.PI / wavelength) ** 2;
  return 1.8 / ((4 - K) ** 2 + 4 * alignment + 3 * FIELD_LIMIT ** 2 + 2 * FIELD_LIMIT * asymmetry);
}
