/**
 * Live settings: everything the operator can change. Stored in their own file,
 * never in a project. validateLiveSettings repairs a damaged or outdated file
 * field by field, so Live always starts.
 */
import { HOT_SIGNAL, NEON_STRATA } from '../core/palettes';
import type { Link } from '../react/links';
import { readLiveLink, MAX_LIVE_LINKS } from './modulate';
import { validateReliefPalette, type ReliefPaletteName } from './relief-palettes';

/** The part of the camera view that paints. 0..1, origin bottom-left. */
export interface Box { left: number; right: number; bottom: number; top: number }
export type PaintKey = 'response' | 'strokeLength' | 'bristle' | 'spread' | 'fadeSeconds' | 'colourChange' | 'ground';
export interface LiveControl<K extends string = PaintKey> { key: K; label: string; min: number; max: number; step: number; default: number }
export const LOOK_LABELS = { paint: 'Paint', smoke: 'Smoke', relief: 'Relief', signal: 'Signal Melt' } as const;
export type LookKind = keyof typeof LOOK_LABELS;
export type ReliefKey = 'depth' | 'reach' | 'settle' | 'lightAngle' | 'edgeLight';
export const RELIEF_CONTROLS: LiveControl<ReliefKey>[] = [
  { key: 'depth', label: 'Depth', min: 0, max: 1.25, step: .01, default: 1 },
  { key: 'reach', label: 'Reach', min: 0, max: 1, step: .01, default: .6 },
  { key: 'settle', label: 'Settle', min: .25, max: 3, step: .05, default: 1 },
  { key: 'lightAngle', label: 'Light angle', min: -90, max: 90, step: 1, default: 0 },
  { key: 'edgeLight', label: 'Edge light', min: 0, max: 1, step: .01, default: 0 },
];
export const RELIEF_SURFACES = { blades: 'Blades', scales: 'Hex scales', weave: 'Woven ribbons' } as const;
export const RELIEF_SIZES = { fine: 'Fine', extraFine: 'Extra fine', micro: 'Micro', nano: 'Nano' } as const;
export const RELIEF_MOTIONS = { sweep: 'Directional sweep', ripple: 'Ripple tank', latch: 'Flip and hold', ricochet: 'Ricochet' } as const;
export const RELIEF_FINISHES = { silver: 'Brushed silver', brass: 'Hammered brass', pearl: 'Pearlescent ceramic', foil: 'Dichroic foil' } as const;
export type ReliefSettings = Record<ReliefKey, number> & {
  surface: keyof typeof RELIEF_SURFACES;
  size: keyof typeof RELIEF_SIZES;
  motion: keyof typeof RELIEF_MOTIONS;
  finish: keyof typeof RELIEF_FINISHES;
};

export const RELIEF_PRESETS: { name: string; settings: ReliefSettings }[] = [
  { name: 'Silver tide', settings: { surface: 'blades', size: 'fine', motion: 'sweep', finish: 'silver', depth: 1, reach: .6, settle: 1, lightAngle: 0, edgeLight: 0 } },
  { name: 'Chrome volley', settings: { surface: 'scales', size: 'nano', motion: 'ricochet', finish: 'silver', depth: .92, reach: .8, settle: 1.65, lightAngle: -38, edgeLight: .48 } },
  { name: 'Dragon skin', settings: { surface: 'scales', size: 'extraFine', motion: 'sweep', finish: 'foil', depth: 1.18, reach: .75, settle: 1.3, lightAngle: -20, edgeLight: .68 } },
  { name: 'Porcelain pool', settings: { surface: 'scales', size: 'fine', motion: 'ripple', finish: 'pearl', depth: .95, reach: .87, settle: 2.2, lightAngle: 32, edgeLight: .27 } },
  { name: 'Gold brocade', settings: { surface: 'weave', size: 'fine', motion: 'sweep', finish: 'brass', depth: 1.1, reach: .72, settle: 1.45, lightAngle: 25, edgeLight: .32 } },
  { name: 'Signal shutters', settings: { surface: 'scales', size: 'extraFine', motion: 'latch', finish: 'brass', depth: 1.05, reach: .40, settle: .75, lightAngle: -28, edgeLight: .92 } },
  { name: 'Aurora silk', settings: { surface: 'weave', size: 'fine', motion: 'ripple', finish: 'foil', depth: 1, reach: .67, settle: 1.85, lightAngle: -42, edgeLight: .66 } },
];

export type SignalKey = 'poseCount' | 'poseFill' | 'poseEcho' | 'poseSpacing' | 'chargeSeconds' | 'release' | 'halo' | 'vividness' | 'contours' | 'echoSpread' | 'colourChange' | 'maskThreshold' | 'maskSoftness' | 'shift' | 'relief' | 'focus' | 'chroma' | 'memorySeconds' | 'blockSize' | 'tear' | 'response' | 'mix';
export type SmokeKey = 'density' | 'emit' | 'smoulder' | 'response' | 'rise' | 'swirl' | 'lifeSeconds' | 'colourChange' | 'vividness';
/** Where people are found. ignoreStillSeconds null means Off. */
export interface PeopleSettings { ignoreStillSeconds: number | null; useEmptyRoom: boolean }
export interface LiveSettings {
  version: 1;
  source: { kind: 'camera' | 'file' | 'test'; deviceId: string | null };
  /** What sound, the beat, tempo and MIDI drive here (stage 5). */
  links: Link[];
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
  relief: ReliefSettings;
  reliefPresence: boolean;
  reliefPalette: ReliefPaletteName;
  /** forever: smoke never fades, and stays in the picture. */
  smoke: Record<SmokeKey, number> & { palette: string[]; forever: boolean };
  signal: Record<SignalKey, number> & { hold: boolean; removeBackground: boolean; keepStill: boolean; palette: string[] };
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
export const SIGNAL_MAX_POSES = 16;

/** Signal Melt: luma relief is an artistic depth proxy, never measured distance. */
export const SIGNAL_CONTROLS: LiveControl<SignalKey>[] = [
  { key: 'poseEcho', label: 'Pose echoes', min: 0, max: 1, step: .01, default: .65 },
  { key: 'poseCount', label: 'Number of poses', min: 1, max: SIGNAL_MAX_POSES, step: 1, default: 8 },
  { key: 'poseFill', label: 'Pose fill', min: 0, max: 1, step: .01, default: .07 },
  { key: 'poseSpacing', label: 'Time between poses', min: .1, max: .6, step: .05, default: .25 },
  { key: 'chargeSeconds', label: 'Pose charge time', min: .5, max: 8, step: .1, default: 2.5 },
  { key: 'release', label: 'Gesture release', min: 0, max: 1, step: .01, default: .65 },
  { key: 'halo', label: 'Prismatic flare', min: 0, max: 1, step: .01, default: .55 },
  { key: 'vividness', label: 'Colour intensity', min: 0, max: 1, step: .01, default: 1 },
  { key: 'contours', label: 'Luminous contours', min: 0, max: 1, step: .01, default: .65 },
  { key: 'echoSpread', label: 'Echo spread', min: 0, max: 1, step: .01, default: .55 },
  { key: 'colourChange', label: 'Colour flow', min: 0, max: 1, step: .01, default: .4 },
  { key: 'maskThreshold', label: 'Cutout strength', min: .1, max: .85, step: .01, default: .45 },
  { key: 'maskSoftness', label: 'Edge softness', min: .01, max: .2, step: .01, default: .06 },
  { key: 'shift', label: 'Pixel shift', min: 0, max: 1, step: .01, default: .45 },
  { key: 'relief', label: 'Depth relief', min: 0, max: 1, step: .01, default: .55 },
  { key: 'focus', label: 'Depth focus', min: 0, max: 1, step: .01, default: .45 },
  { key: 'chroma', label: 'Chroma slip', min: 0, max: 1, step: .01, default: .5 },
  { key: 'memorySeconds', label: 'Frame memory', min: .1, max: 20, step: .1, default: 3 },
  { key: 'blockSize', label: 'Block size', min: 2, max: 96, step: 1, default: 24 },
  { key: 'tear', label: 'Block fracture', min: 0, max: 1, step: .01, default: .45 },
  { key: 'response', label: 'Movement response', min: 0, max: 3, step: .01, default: 1.2 },
  { key: 'mix', label: 'Effect mix', min: 0, max: 1, step: .01, default: 1 },
];
export const SIGNAL_STARTS: { label: string; values: Record<SignalKey, number> }[] = [
  { label: 'Prism body', values: { poseEcho: .1, poseCount: 4, poseFill: .05, poseSpacing: .15, chargeSeconds: 2, release: .25, halo: .25, vividness: 1, contours: .9, echoSpread: .15, colourChange: .2, maskThreshold: .45, maskSoftness: .06, shift: .7, relief: .85, focus: .5, chroma: .15, memorySeconds: .25, blockSize: 4, tear: .05, response: 1, mix: 1 } },
  { label: 'Chroma wake', values: { poseEcho: .8, poseCount: 8, poseFill: .1, poseSpacing: .25, chargeSeconds: 2.5, release: .65, halo: .55, vividness: 1, contours: .45, echoSpread: .8, colourChange: .6, maskThreshold: .45, maskSoftness: .06, shift: .25, relief: .35, focus: .3, chroma: .95, memorySeconds: 4, blockSize: 12, tear: .15, response: 1.3, mix: 1 } },
  { label: 'Signal sculpture', values: { poseEcho: 1, poseCount: 10, poseFill: .12, poseSpacing: .4, chargeSeconds: 1.5, release: 1, halo: .85, vividness: 1, contours: .7, echoSpread: .5, colourChange: .35, maskThreshold: .45, maskSoftness: .06, shift: .65, relief: .5, focus: .45, chroma: .6, memorySeconds: 12, blockSize: 48, tear: .9, response: 2, mix: 1 } },
  { label: 'Long exposure', values: {
    poseEcho: 1, poseCount: 16, poseFill: .18, poseSpacing: .35, chargeSeconds: 2,
    release: .25, halo: .3, vividness: 1, contours: .55, echoSpread: .2, colourChange: .3,
    maskThreshold: .45, maskSoftness: .06, shift: .2, relief: .35, focus: .45, chroma: .35,
    memorySeconds: .4, blockSize: 12, tear: .08, response: 1.2, mix: 1,
  } },
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
    relief: { ...RELIEF_PRESETS[0].settings },
    reliefPresence: false,
    reliefPalette: 'material',
    signal: { ...Object.fromEntries(SIGNAL_CONTROLS.map(c => [c.key, c.default])) as Record<SignalKey, number>, hold: false, removeBackground: true, keepStill: true, palette: [...NEON_STRATA] },
    smoke: { ...Object.fromEntries(SMOKE_CONTROLS.map(c => [c.key, c.default])) as Record<SmokeKey, number>, palette: [...HOT_SIGNAL], forever: false },
    people: { ignoreStillSeconds: IGNORE_STILL.default, useEmptyRoom: false },
    links: [],
  };
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function choice<K extends string>(value: unknown, labels: Record<K, string>, fallback: K): K {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(labels, value) ? value as K : fallback;
}
const ranged = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function readLiveLinks(raw: unknown): Link[] {
  if (!Array.isArray(raw)) return [];
  const out: Link[] = [], ids = new Set<string>();
  for (const item of raw.slice(0, MAX_LIVE_LINKS)) {
    const link = readLiveLink(item);
    if (link && !ids.has(link.id)) { ids.add(link.id); out.push(link); }
  }
  return out;
}

export function validateLiveSettings(value: unknown): LiveSettings {
  const d = defaultLiveSettings(), v = record(value), source = record(v.source), box = record(v.box), paint = record(v.paint);
  const kind = source.kind === 'file' || source.kind === 'test' || source.kind === 'camera' ? source.kind : d.source.kind;
  const b: Box = { left: ranged(box.left, 0, 1, 0), right: ranged(box.right, 0, 1, 1), bottom: ranged(box.bottom, 0, 1, 0), top: ranged(box.top, 0, 1, 1) };
  const isPalette = (p: unknown): p is string[] => Array.isArray(p) && p.length === 6 && p.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
  const palette = isPalette(v.palette) ? v.palette : d.palette;
  const relief = record(v.relief), signal = record(v.signal), smoke = record(v.smoke), people = record(v.people);
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
    look: v.look === 'smoke' || v.look === 'relief' || v.look === 'signal' ? v.look : 'paint',
    reliefPresence: v.reliefPresence === true,
    reliefPalette: validateReliefPalette(v.reliefPalette),
    relief: {
      ...Object.fromEntries(RELIEF_CONTROLS.map(c => [c.key, ranged(relief[c.key], c.min, c.max, c.default)])) as Record<ReliefKey, number>,
      surface: choice(relief.surface, RELIEF_SURFACES, d.relief.surface),
      size: choice(relief.size, RELIEF_SIZES, d.relief.size),
      motion: choice(relief.motion, RELIEF_MOTIONS, d.relief.motion),
      finish: choice(relief.finish, RELIEF_FINISHES, d.relief.finish),
    },
    signal: { ...Object.fromEntries(SIGNAL_CONTROLS.map(c => [c.key, c.key === 'poseCount' ? Math.round(ranged(signal[c.key], c.min, c.max, c.default)) : ranged(signal[c.key], c.min, c.max, c.default)])) as Record<SignalKey, number>, hold: signal.hold === true, removeBackground: signal.removeBackground !== false, keepStill: signal.keepStill !== false, palette: [...(isPalette(signal.palette) ? signal.palette : d.signal.palette)] },
    smoke: { ...Object.fromEntries(SMOKE_CONTROLS.map(c => [c.key, ranged(smoke[c.key], c.min, c.max, c.default)])) as Record<SmokeKey, number>,
      palette: [...(isPalette(smoke.palette) ? smoke.palette : d.smoke.palette)], forever: smoke.forever === true },
    people: { ignoreStillSeconds: still, useEmptyRoom: typeof people.useEmptyRoom === 'boolean' ? people.useEmptyRoom : false },
    links: readLiveLinks(v.links),
  };
}

/** The display to use for the output: the chosen one if it is still connected, else one that is not this screen, else any. */
export function chooseDisplay(displays: { id: number; primary: boolean }[], current: number | null): number | null {
  if (displays.some(d => d.id === current)) return current;
  return (displays.find(d => !d.primary) ?? displays[0])?.id ?? null;
}

/** Paint and motion-only Relief run with optical flow alone; Signal finds people when it removes the background. */
export function usesPeople(settings: LiveSettings): boolean {
  return settings.look === 'smoke' || (settings.look === 'relief' && settings.reliefPresence) || (settings.look === 'signal' && settings.signal.removeBackground);
}

/** Signal treats stillness as participation unless the operator explicitly opts out. */
export function personStillTimeout(settings: LiveSettings): number | null {
  return settings.look === 'signal' && settings.signal.keepStill ? null : settings.people.ignoreStillSeconds;
}
