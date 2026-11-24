export interface MarkPlacement {
  /** Layer UV to output UV, column-major: the same matrix the design's marks are placed through. */
  view: ArrayLike<number>;
  aspect: number; zoom: number; rotation: number; centreX: number; centreY: number;
  /** The Mark's size in frame heights of the design. */
  width: number; height: number;
}

/**
 * Output UV to the Mark's own 0..1 coordinates, column-major, written into `out` without allocating.
 * The Mark sits on the design's origin, where the final point rests, and takes the design's zoom and rotation
 * and the layer's move, scale and turn. Ellipse and tilt are left out so a logo is never distorted.
 */
export function markFromOutput(p: MarkPlacement, out: Float64Array): void {
  const cos = Math.cos(p.rotation) * p.zoom, sin = Math.sin(p.rotation) * p.zoom;
  // Mark coordinates to layer UV.
  const a = cos * p.width / p.aspect, b = -sin * p.height / p.aspect, c = sin * p.width, d = cos * p.height;
  const e = p.centreX + .5 - (a + b) / 2, f = p.centreY + .5 - (c + d) / 2;
  // Then through the view: an affine matrix, so its last row stays 0 0 1.
  const v = p.view;
  const m00 = v[0] * a + v[3] * c, m01 = v[0] * b + v[3] * d, m02 = v[0] * e + v[3] * f + v[6];
  const m10 = v[1] * a + v[4] * c, m11 = v[1] * b + v[4] * d, m12 = v[1] * e + v[4] * f + v[7];
  const det = m00 * m11 - m01 * m10 || 1e-12;
  out[0] = m11 / det; out[1] = -m10 / det; out[2] = 0;
  out[3] = -m01 / det; out[4] = m00 / det; out[5] = 0;
  out[6] = (m01 * m12 - m11 * m02) / det; out[7] = (m10 * m02 - m00 * m12) / det; out[8] = 1;
}
