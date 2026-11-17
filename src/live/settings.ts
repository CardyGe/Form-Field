/**
 * Live settings: everything the operator can change. Stored in their own file,
 * never in a project. validateLiveSettings repairs a damaged or outdated file
 * field by field, so Live always starts.
 */
import { HOT_SIGNAL } from '../core/palettes';

/** The part of the camera view that paints. 0..1, origin bottom-left. */
export interface Box { left: number; right: number; bottom: number; top: number }
export type PaintKey = 'response' | 'strokeLength' | 'bristle' | 'spread' | 'fadeSeconds' | 'colourChange' | 'ground';
export interface LiveControl<K extends string = PaintKey> { key: K; label: string; min: number; max: number; step: number; default: number }
export const LOOK_LABELS = { paint: 'Paint', smoke: 'Smoke', relief: 'Relief' } as const;
export type LookKind = keyof typeof LOOK_LABELS;
export type ReliefKey = 'depth' | 'reach' | 'settle';
export const RELIEF_CONTROLS: LiveControl<ReliefKey>[] = [
  { key: 'depth', label: 'Depth', min: 0, max: 1.25, step: .01, default: 1 },
  { key: 'reach', label: 'Reach', min: 0, max: 1, step: .01, default: .6 },
  { key: 'settle', label: 'Settle', min: .25, max: 3, step: .05, default: 1 },
];
export type SmokeKey = 'density' | 'emit' | 'smoulder' | 'response' | 'rise' | 'swirl' | 'lifeSeconds' | 'colourChange' | 'vividness';
/** Where people are found. ignoreStillSeconds null means Off. */
export interface PeopleSettings { ignoreStillSeconds: number | null; useEmptyRoom: boolean }
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
  /** Paint's palette. Smoke keeps its own in `smoke.palette`. */
  palette: string[];
  look: LookKind;
  relief: Record<ReliefKey, number>;
  /** forever: smoke never fades, and stays in the picture. */
  smoke: Record<SmokeKey, number> & { palette: string[]; forever: boolean };
  people: PeopleSettings;
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
export const SMOKE_CONTROLS: LiveControl<SmokeKey>[] = [
  { key: 'density', label: 'Density', min: 0, max: 1, step: .01, default: .6 },
  { key: 'emit', label: 'Emit', min: 0, max: 1, step: .01, default: .6 },
  { key: 'smoulder', label: 'Smoulder', min: 0, max: 1, step: .01, default: .5 },
  { key: 'response', label: 'Movement response', min: 0, max: 3, step: .01, default: 1 },
  { key: 'rise', label: 'Rise', min: 0, max: 1, step: .01, default: .4 },
  /** Saved as swirl; 0 is calm, flowing ribbons, 1 is wild curls. */
  { key: 'swirl', label: 'Calm ↔ Wild', min: 0, max: 1, step: .01, default: .35 },
  { key: 'lifeSeconds', label: 'Smoke life', min: 1, max: 12, step: .5, default: 6 },
  { key: 'colourChange', label: 'Colour change', min: 0, max: 1, step: .01, default: .3 },
  { key: 'vividness', label: 'Vividness', min: 0, max: 1, step: .01, default: .8 },
];
/** Starting points: each sets every smoke control except colour, Vividness and Emit, so they look clearly different. Smouldering is the default. */
export const SMOKE_STARTS: { id: 'wispy' | 'smouldering' | 'solid'; label: string; values: Record<Exclude<SmokeKey, 'colourChange' | 'emit' | 'vividness'>, number> }[] = [
  { id: 'wispy', label: 'Wispy', values: { density: .25, smoulder: .9, rise: .8, swirl: .45, lifeSeconds: 4, response: 1.5 } },
  { id: 'smouldering', label: 'Smouldering', values: { density: .6, smoulder: .5, rise: .4, swirl: .35, lifeSeconds: 6, response: 1 } },
  { id: 'solid', label: 'Solid', values: { density: 1, smoulder: .1, rise: .15, swirl: .2, lifeSeconds: 10, response: .7 } },
];
export const IGNORE_STILL = { min: 10, max: 120, default: 30 };
export const SENSITIVITY = { min: .2, max: 4, default: 1 };
export const NOISE_FLOOR = { min: 0, max: .1, default: .02 };

export function defaultLiveSettings(): LiveSettings {
  return {
    version: 1, source: { kind: 'camera', deviceId: null }, mirror: true,
    box: { left: 0, right: 1, bottom: 0, top: 1 },
    sensitivity: SENSITIVITY.default, noiseFloor: NOISE_FLOOR.default, display: null, quality: 1080,
    paint: Object.fromEntries(PAINT_CONTROLS.map(c => [c.key, c.default])) as Record<PaintKey, number>,
    palette: [...HOT_SIGNAL],
    look: 'paint',
    relief: Object.fromEntries(RELIEF_CONTROLS.map(c => [c.key, c.default])) as Record<ReliefKey, number>,
    smoke: { ...Object.fromEntries(SMOKE_CONTROLS.map(c => [c.key, c.default])) as Record<SmokeKey, number>, palette: [...HOT_SIGNAL], forever: false },
    people: { ignoreStillSeconds: IGNORE_STILL.default, useEmptyRoom: false },
  };
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const ranged = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function validateLiveSettings(value: unknown): LiveSettings {
  const d = defaultLiveSettings(), v = record(value), source = record(v.source), box = record(v.box), paint = record(v.paint);
  const kind = source.kind === 'file' || source.kind === 'test' || source.kind === 'camera' ? source.kind : d.source.kind;
  const b: Box = { left: ranged(box.left, 0, 1, 0), right: ranged(box.right, 0, 1, 1), bottom: ranged(box.bottom, 0, 1, 0), top: ranged(box.top, 0, 1, 1) };
  const isPalette = (p: unknown): p is string[] => Array.isArray(p) && p.length === 6 && p.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
  const palette = isPalette(v.palette) ? v.palette : d.palette;
  const relief = record(v.relief), smoke = record(v.smoke), people = record(v.people);
  const still = people.ignoreStillSeconds === null ? null : ranged(people.ignoreStillSeconds, IGNORE_STILL.min, IGNORE_STILL.max, IGNORE_STILL.default);
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
    look: v.look === 'smoke' || v.look === 'relief' ? v.look : 'paint',
    relief: Object.fromEntries(RELIEF_CONTROLS.map(c => [c.key, ranged(relief[c.key], c.min, c.max, c.default)])) as Record<ReliefKey, number>,
    smoke: { ...Object.fromEntries(SMOKE_CONTROLS.map(c => [c.key, ranged(smoke[c.key], c.min, c.max, c.default)])) as Record<SmokeKey, number>,
      palette: [...(isPalette(smoke.palette) ? smoke.palette : d.smoke.palette)], forever: smoke.forever === true },
    people: { ignoreStillSeconds: still, useEmptyRoom: typeof people.useEmptyRoom === 'boolean' ? people.useEmptyRoom : false },
  };
}

/** The display to use for the output: the chosen one if it is still connected, else one that is not this screen, else any. */
export function chooseDisplay(displays: { id: number; primary: boolean }[], current: number | null): number | null {
  if (displays.some(d => d.id === current)) return current;
  return (displays.find(d => !d.primary) ?? displays[0])?.id ?? null;
}
