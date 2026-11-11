import type { Layer } from '../shared/types';

/** Viewport bounds in the repeating pattern's local, height-normalized space. */
export function graphicGridBounds(layer: Layer, phase: number, aspect: number) {
  const p = layer.params, t = layer.transform;
  const wrapped = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const angle = p.orientation + (p.style === 4 ? 0 : p.turns * wrapped);
  const c = Math.cos(angle), s = Math.sin(angle), lc = Math.cos(t.rotation), ls = Math.sin(t.rotation);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [-aspect / 2, aspect / 2]) for (const y of [-.5, .5]) {
    const px = x - t.x * aspect, py = y + t.y;
    const qx = (px * lc - py * ls) / t.scale - p.centerX * aspect * .5;
    const qy = (px * ls + py * lc) / t.scale - p.centerY * .5;
    const gx = (qx * c + qy * s) / (p.size * p.stretch), gy = (-qx * s + qy * c) / p.size;
    minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
    minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
  }
  return { x0: Math.floor(minX / aspect + .5), x1: Math.floor(maxX / aspect + .5),
    y0: Math.floor(minY + .5), y1: Math.floor(maxY + .5) };
}

export function graphicRenderPlan(layer: Layer, phase: number, width: number, height: number, limit: number) {
  const radial = layer.params.style === 1 || layer.params.style === 3;
  const magnification = layer.transform.scale * layer.params.size * Math.max(1, layer.params.stretch);
  const bounds = graphicGridBounds(layer, phase, width / height);
  const cells = (bounds.x1 - bounds.x0 + 1) * (bounds.y1 - bounds.y0 + 1);
  // Geometry handles magnification; mipmapped cells remain efficient when small.
  // Bound geometry work for extreme-aspect, highly rotated legal projects.
  const inView = radial || magnification >= 1 && cells <= 64;
  const factor = inView ? 1 : Math.min(Math.max(1, magnification), limit / Math.max(width, height),
    Math.sqrt(16_777_216 / (width * height)));
  return { inView, bounds, width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}
