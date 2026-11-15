/**
 * Live settings: everything the operator can change. Stored in their own file,
 * never in a project. validateLiveSettings repairs a damaged or outdated file
 * field by field, so Live always starts.
 */
import { HOT_SIGNAL } from '../core/palettes';

/** The part of the camera view that paints. 0..1, origin bottom-left. */
export interface Box { left: number; right: number; bottom: number; top: number }
export type PaintKey = 'response' | 'strokeLength' | 'bristle' | 'spread' | 'fadeSeconds' | 'colourChange' | 'ground';
export interface LiveControl { key: PaintKey; label: string; min: number; max: number; step: number; default: number }
export interface LiveSettings {
  version: 1;
  source: { kind: 'camera' | 'file' | 'test'; deviceId: string | null };
  mirror: boolean;
  box: Box;
  sensitivity: number;
  noiseFloor: number;
  /** Electron display id for the artwork window. */
  display: number | null;
  quality: 720 | 1080;
  paint: Record<PaintKey, number>;
  palette: string[];
}

export const PAINT_CONTROLS: LiveControl[] = [
  { key: 'response', label: 'Movement response', min: 0, max: 3, step: .01, default: 1 },
  { key: 'strokeLength', label: 'Stroke length', min: 0, max: 1, step: .01, default: .5 },
  { key: 'bristle', label: 'Bristle', min: 0, max: 1, step: .01, default: .6 },
  { key: 'spread', label: 'Spread', min: 0, max: 1, step: .01, default: .35 },
  { key: 'fadeSeconds', label: 'Fade time', min: 2, max: 120, step: 1, default: 30 },
  { key: 'colourChange', label: 'Colour change', min: 0, max: 1, step: .01, default: .3 },
  { key: 'ground', label: 'Ground', min: 0, max: 1, step: 1, default: 0 },
];
export const SENSITIVITY = { min: .2, max: 4, default: 1 };
export const NOISE_FLOOR = { min: 0, max: .1, default: .02 };

export function defaultLiveSettings(): LiveSettings {
  return {
    version: 1, source: { kind: 'camera', deviceId: null }, mirror: true,
    box: { left: 0, right: 1, bottom: 0, top: 1 },
    sensitivity: SENSITIVITY.default, noiseFloor: NOISE_FLOOR.default, display: null, quality: 1080,
    paint: Object.fromEntries(PAINT_CONTROLS.map(c => [c.key, c.default])) as Record<PaintKey, number>,
    palette: [...HOT_SIGNAL],
  };
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const ranged = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function validateLiveSettings(value: unknown): LiveSettings {
  const d = defaultLiveSettings(), v = record(value), source = record(v.source), box = record(v.box), paint = record(v.paint);
  const kind = source.kind === 'file' || source.kind === 'test' || source.kind === 'camera' ? source.kind : d.source.kind;
  const b: Box = { left: ranged(box.left, 0, 1, 0), right: ranged(box.right, 0, 1, 1), bottom: ranged(box.bottom, 0, 1, 0), top: ranged(box.top, 0, 1, 1) };
  const palette = Array.isArray(v.palette) && v.palette.length === 6 && v.palette.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? v.palette as string[] : d.palette;
  return {
    version: 1,
    source: { kind, deviceId: typeof source.deviceId === 'string' ? source.deviceId : null },
    mirror: typeof v.mirror === 'boolean' ? v.mirror : d.mirror,
    box: b.left < b.right && b.bottom < b.top ? b : d.box,
    sensitivity: ranged(v.sensitivity, SENSITIVITY.min, SENSITIVITY.max, d.sensitivity),
    noiseFloor: ranged(v.noiseFloor, NOISE_FLOOR.min, NOISE_FLOOR.max, d.noiseFloor),
    display: typeof v.display === 'number' && Number.isFinite(v.display) ? v.display : null,
    quality: v.quality === 720 ? 720 : 1080,
    paint: Object.fromEntries(PAINT_CONTROLS.map(c => [c.key, ranged(paint[c.key], c.min, c.max, c.default)])) as Record<PaintKey, number>,
    palette: [...palette],
  };
}
