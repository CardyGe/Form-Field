/**
 * Copper Concertina: a row of linked facets folding like a pleated sheet.
 *
 * Pure geometry, no renderer. The profile is the wall's cross-section in the
 * plane perpendicular to the hinges: x runs along the wall, z points toward the
 * audience. Each facet keeps its length; facet k+1 starts exactly where facet k
 * ends, so hinges cannot open cracks or pass through one another.
 *
 * Timing is in beats over an 8-beat loop (120 BPM = 4 s). Beats describe the
 * visual rhythm only; no audio input is needed.
 */

export const CONCERTINA_BEATS = 8;

export interface ConcertinaOptions {
  /** Number of facets along the wall. Six hinges = seven facets by default. */
  facets?: number;
  /** Maximum tilt of a facet from flat, in radians. */
  maxTilt?: number;
  /** Total width of the flat sheet along x. */
  width?: number;
}

export interface ConcertinaProfile {
  /** Facet endpoints, length facets+1. points[0] is the left edge. */
  points: { x: number; z: number }[];
  /** Tilt of each facet from flat, radians, alternating in sign. */
  tilts: number[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Envelope for the facet at normalised position x (0 = left, 1 = right) at beat b.
 *  - Beats 0–1.5: flat.
 *  - The crease catches at the left and travels right, reaching full tilt by beat 5.
 *  - Beats 5–5.5: held at full depth.
 *  - Beats 5.5–7.5: pleats let go from the far right back to the left.
 *  - Beat 8 is flat again, so the loop closes.
 */
export function concertinaEnvelope(beat: number, x: number): number {
  const b = ((beat % CONCERTINA_BEATS) + CONCERTINA_BEATS) % CONCERTINA_BEATS;
  const riseStart = 1.5 + 2 * x;
  const rise = smoothstep(riseStart, riseStart + 1.5, b);
  const fallStart = 5.5 + (1 - x) * 1.0;
  const fall = 1 - smoothstep(fallStart, fallStart + 1.0, b);
  return rise * fall;
}

/** Facet tilts and endpoints at a given beat within the 8-beat loop. */
export function concertinaProfile(beat: number, opts: ConcertinaOptions = {}): ConcertinaProfile {
  const facets = opts.facets ?? 7;
  const maxTilt = opts.maxTilt ?? 0.9;
  const width = opts.width ?? 1;
  if (facets < 2) throw new Error('A concertina needs at least two facets');
  const length = width / facets;
  const points = [{ x: 0, z: 0 }];
  const tilts: number[] = [];
  let x = 0;
  let z = 0;
  for (let k = 0; k < facets; k++) {
    const pos = k / (facets - 1);
    // Alternate the direction of each facet so neighbours fold back on each other.
    const sign = k % 2 === 0 ? 1 : -1;
    const tilt = sign * maxTilt * concertinaEnvelope(beat, pos);
    tilts.push(tilt);
    x += length * Math.cos(tilt);
    z += length * Math.sin(tilt);
    points.push({ x, z });
  }
  return { points, tilts };
}
