import { STRIDE, type DisplayList } from './display-list';
import { PRIMITIVE } from './types';

/** Where a layer's list lands: list units to frame heights about the frame's centre, with the light its layer passes. */
export interface LightPlacement { aspect: number; a: number; b: number; c: number; d: number; x: number; y: number; level: number }
export interface LightMeasure { area: number; light: number }
export interface ComposedLight { light: number; area: number; red: number }

const TAU = Math.PI * 2, STEPS = 12, UNSEEN = 0.02, FLASH_AREA = 0.25;
const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

/** The share of the frame one layer lights, with each line's glow, after its placement and the frame's edges, and how bright that light is. */
export function measureList(list: DisplayList, place: LightPlacement, out: LightMeasure): void {
  const d = list.data, { aspect, a, b, c, d: e, x: tx, y: ty } = place, scale = Math.sqrt(Math.abs(a * e - b * c)), halfW = aspect / 2;
  let area = 0, energy = 0;
  for (let i = 0; i < list.count; i++) {
    const at = i * STRIDE, kind = d[at], alpha = clamp(d[at + 9] * place.level, 0, 1);
    if (d[at + 9] <= UNSEEN) continue; // A layer's area is what it covers when lit, so one faded to dark still owns it.
    const curve = kind === PRIMITIVE.arc || kind === PRIMITIVE.ring, segment = kind === PRIMITIVE.segment;
    const radius = Math.abs(d[at + 3]), start = kind === PRIMITIVE.arc ? d[at + 4] : 0, sweep = kind === PRIMITIVE.arc ? d[at + 5] : TAU;
    const length = segment ? Math.hypot(d[at + 3] - d[at + 1], d[at + 4] - d[at + 2]) : curve ? radius * sweep : d[at + 3] * 2;
    let inside = 0;
    for (let s = 0; s < STEPS; s++) {
      const t = (s + 0.5) / STEPS;
      const px = segment ? d[at + 1] + (d[at + 3] - d[at + 1]) * t : curve ? d[at + 1] + Math.cos(start + sweep * t) * radius : d[at + 1];
      const py = segment ? d[at + 2] + (d[at + 4] - d[at + 2]) * t : curve ? d[at + 2] + Math.sin(start + sweep * t) * radius : d[at + 2];
      const qx = a * px + b * py + tx, qy = c * px + e * py + ty;
      if (Math.abs(qx) <= halfW && Math.abs(qy) <= 0.5) inside++;
    }
    const lit = length * scale * (inside / STEPS) * (Math.abs(d[at + 6]) * 2 + Math.max(0, d[at + 7]) * 0.05) * scale / aspect;
    area += lit; energy += lit * alpha;
  }
  out.area = clamp(area, 0, 1);
  out.light = area > 0 ? energy / area : 0;
}

const ORDER = new Uint8Array(8); // Layers are summed by value, so swapping two layers cannot change even the last bit.
const comesAfter = (areas: ArrayLike<number>, lights: ArrayLike<number>, reds: ArrayLike<number>, a: number, b: number): boolean =>
  areas[a] !== areas[b] ? areas[a] > areas[b] : lights[a] !== lights[b] ? lights[a] > lights[b] : reds[a] > reds[b];

/**
 * Every layer's light as one picture. Light is scaled by how much of the flash area is lit, so a strobe made by the lit
 * area itself still counts as a change of light. The result does not depend on layer order.
 */
export function composeLight(areas: ArrayLike<number>, lights: ArrayLike<number>, reds: ArrayLike<number>, count: number, out: ComposedLight): void {
  const n = Math.min(count, ORDER.length);
  for (let i = 0; i < n; i++) {
    let at = i;
    while (at > 0 && comesAfter(areas, lights, reds, ORDER[at - 1], i)) { ORDER[at] = ORDER[at - 1]; at--; }
    ORDER[at] = i;
  }
  let area = 0, energy = 0, red = 0;
  for (let k = 0; k < n; k++) { const i = ORDER[k]; area += areas[i]; energy += areas[i] * lights[i]; red += areas[i] * reds[i]; }
  out.area = clamp(area, 0, 1);
  out.light = area > 0 ? energy / area * Math.min(1, area / FLASH_AREA) : 0;
  out.red = area > 0 ? clamp(red / area, 0, 1) : 0;
}
