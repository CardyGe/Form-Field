/**
 * The Finish list: which effects a layer can take, whether each is doing anything, what its row says, and how its
 * switch turns it off and back on without losing the settings. Pure, so the rules are tested apart from the panel.
 */
import { FEEDBACK_KEYS, GLOW_KEYS, GRADE_KEYS, GRADIENT_KEYS, KEY_KEYS, LIQUID_KEYS, LUMA_WARP_KEYS, MIRROR_KEYS, POLAR_KEYS, PRINT_KEYS, SLIT_KEYS, SPLIT_KEYS, TOON_KEYS, WARP_KEYS } from '../core/finishing';
import { supportsGlow } from '../rendering/bloom';
import { GRADIENT_PALETTES, supportsLens } from '../rendering/colour-lens';
import { supportsFeedback } from '../rendering/feedback';
import { supportsPrint } from '../rendering/print-screen';
import { SLIT_MODES, supportsSlitScan } from '../rendering/slitscan';
import { LIQUID_STYLES, LUMA_SOURCES, MIRROR_MODES, POLAR_MODES, WARP_FIELDS, supportsWarp } from '../rendering/warp';
import type { Layer, ParameterDefinition } from '../shared/types';

export const FINISH_GROUPS = ['Colour', 'Light', 'Warp', 'Surface', 'Time'] as const;
export type FinishGroup = typeof FINISH_GROUPS[number];

export interface FinishEffect {
  id: string;
  label: string;
  group: FinishGroup;
  description: string;
  keys: string[];
  /** The settings the switch turns off, and the value each takes when first switched on. Empty: no switch. */
  power: Record<string, number>;
  supported: (layer: Layer) => boolean;
  summary?: (params: Record<string, number>) => string;
}

const TONE_KEYS = ['toneContrast', 'tonePivot', 'toneGamma', 'shadowLift', 'highlightRoll', 'vibrance'];
const always = () => true;
const percent = (n: number) => `${Math.round(n * 100)}%`;

export const FINISH_EFFECTS: FinishEffect[] = [
  { id: 'colour', label: 'Color finish', group: 'Colour', description: 'Saturation, hue and exposure.', keys: ['saturation', 'hue', 'exposure'], power: {}, supported: always },
  { id: 'tone', label: 'Tonal finishing', group: 'Colour', description: 'Shape luminance and colour while preserving transparency.', keys: TONE_KEYS, power: {}, supported: always },
  { id: 'balance', label: 'Colour balance', group: 'Colour', description: 'Warms, cools and tints the layer, with separate shadow and highlight colour.', keys: GRADE_KEYS, power: {}, supported: supportsLens },
  { id: 'gradient', label: 'Gradient map', group: 'Colour', description: 'Recolours the layer by brightness using a palette.', keys: GRADIENT_KEYS, power: { gradMix: 1 }, supported: supportsLens, summary: p => GRADIENT_PALETTES[Math.round(p.gradPalette ?? 0)]?.name ?? '' },
  { id: 'key', label: 'Key', group: 'Colour', description: 'Cuts the layer out by brightness or colour.', keys: KEY_KEYS, power: { keyMix: 1 }, supported: supportsLens, summary: p => Math.round(p.keyMode ?? 0) === 1 ? 'Hue' : 'Brightness' },
  { id: 'glow', label: 'Glow', group: 'Light', description: 'Bright areas spill soft light. Loops close exactly; adds a few blur passes per glowing layer.', keys: GLOW_KEYS, power: { glowMix: .8 }, supported: supportsGlow, summary: p => percent(p.glowMix ?? 0) },
  { id: 'split', label: 'Colour split', group: 'Light', description: 'Pulls colour apart along edges, lenses or waves. Loops close exactly.', keys: SPLIT_KEYS, power: { splitAmount: 8, splitOrder: 0 }, supported: supportsLens, summary: p => (p.splitAmount ?? 0) > 0 ? `${Number((p.splitAmount ?? 0).toFixed(1))} px` : 'Channels' },
  { id: 'warp', label: 'Warp', group: 'Warp', description: 'Bends the picture with waves, noise, ripples, magnets or plasma.', keys: WARP_KEYS, power: { bendAmount: .15 }, supported: supportsWarp, summary: p => WARP_FIELDS[Math.round(p.bendField ?? 0)] ?? '' },
  { id: 'liquid', label: 'Liquid', group: 'Warp', description: 'Swirls and melts the picture along flowing currents.', keys: LIQUID_KEYS, power: { liquidAmount: .25 }, supported: supportsWarp, summary: p => LIQUID_STYLES[Math.round(p.liquidStyle ?? 0)] ?? '' },
  { id: 'lumaWarp', label: 'Luma Warp', group: 'Warp', description: 'Melts the picture along its own light, or along the layer below.', keys: LUMA_WARP_KEYS, power: { lumaWarpAmount: .15 }, supported: supportsWarp, summary: p => LUMA_SOURCES[Math.round(p.lumaWarpSource ?? 0)] ?? '' },
  { id: 'polar', label: 'Polar', group: 'Warp', description: 'Wraps the picture into a circle, or unrolls a circle into a strip.', keys: POLAR_KEYS, power: { polarAmount: 1 }, supported: supportsWarp, summary: p => POLAR_MODES[Math.round(p.polarMode ?? 0)] ?? '' },
  { id: 'mirror', label: 'Mirror', group: 'Warp', description: 'Reflects the picture into symmetrical halves, quarters or wedges.', keys: MIRROR_KEYS, power: { mirrorAmount: 1 }, supported: supportsWarp, summary: p => MIRROR_MODES[Math.round(p.mirrorMode ?? 0)] ?? '' },
  { id: 'print', label: 'Print screen', group: 'Surface', description: 'Halftone dots, line screens and ordered dither, sized in pixels of a 1080-line frame. Loops close exactly.', keys: PRINT_KEYS, power: { printMix: 1 }, supported: supportsPrint, summary: p => ['Dots', 'Lines', 'Dither'][Math.round(p.printType ?? 0)] ?? '' },
  { id: 'flat', label: 'Flat colour & outlines', group: 'Surface', description: "Hard palette bands and contour lines. For the cleanest edges, lower the source's Relief and Softness.", keys: TOON_KEYS, power: { toonMix: 1 }, supported: always, summary: p => `${Math.round(p.toonBands ?? 5)} bands` },
  { id: 'time', label: 'Time displacement', group: 'Time', description: 'Parts of the frame show other moments of the loop. Loops close exactly; each slice renders the source once more.', keys: SLIT_KEYS, power: { slitShift: 1 }, supported: supportsSlitScan, summary: p => SLIT_MODES[Math.round(p.slitMode ?? 0)] ?? '' },
  { id: 'feedback', label: 'Feedback', group: 'Time', description: 'Each frame keeps a faded, moved echo of the last. Loops close exactly; exports warm up before the first frame.', keys: FEEDBACK_KEYS, power: { echo: .8 }, supported: supportsFeedback, summary: p => percent(p.echo ?? 0) },
];

/** The effects this layer shows: supported, with at least one of their settings available. */
export function finishEffectsFor(layer: Layer, definitions: readonly ParameterDefinition[]): FinishEffect[] {
  const available = new Set(definitions.map(d => d.key));
  return FINISH_EFFECTS.filter(effect => effect.supported(layer) && effect.keys.some(key => available.has(key)));
}

export function hasPower(effect: FinishEffect): boolean {
  return Object.keys(effect.power).length > 0;
}

/** How many settings differ from their defaults. */
export function changedSettings(layer: Pick<Layer, 'params'>, effect: FinishEffect, definitions: readonly ParameterDefinition[]): number {
  return definitions.filter(d => effect.keys.includes(d.key) && (layer.params[d.key] ?? d.default) !== d.default).length;
}

/** Whether the effect is changing the picture. */
export function finishEffectOn(layer: Pick<Layer, 'params' | 'modulations'>, effect: FinishEffect, definitions: readonly ParameterDefinition[]): boolean {
  if (hasPower(effect)) return Object.keys(effect.power).some(key => (layer.params[key] ?? 0) !== 0 || !!layer.modulations[key]);
  return effect.keys.some(key => !!layer.modulations[key]) || changedSettings(layer, effect, definitions) > 0;
}

/** The short text on the effect's row. Empty while it is off. */
export function finishSummary(layer: Pick<Layer, 'params' | 'modulations'>, effect: FinishEffect, definitions: readonly ParameterDefinition[]): string {
  if (!finishEffectOn(layer, effect, definitions)) return '';
  if (effect.summary) return effect.summary(layer.params);
  const changed = changedSettings(layer, effect, definitions);
  return changed ? `${changed} changed` : 'Animated';
}

/** An animated switch setting belongs to the Motion tab, so the switch leaves it alone. */
export function powerLocked(layer: Pick<Layer, 'modulations'>, effect: FinishEffect): boolean {
  return Object.keys(effect.power).some(key => !!layer.modulations[key]);
}

/**
 * Flips the effect. Off stores the switch settings and zeroes them; on restores what was stored, or the effect's
 * starting amount. Everything else on the effect stays as set, so turning it back on returns the same look.
 */
export function toggleFinishEffect(layer: Layer, effect: FinishEffect, definitions: readonly ParameterDefinition[], stored?: Record<string, number>): { layer: Layer; stored?: Record<string, number> } {
  if (!hasPower(effect) || powerLocked(layer, effect)) return { layer, stored };
  const params = { ...layer.params };
  if (finishEffectOn(layer, effect, definitions)) {
    const kept: Record<string, number> = {};
    for (const key of Object.keys(effect.power)) { kept[key] = params[key] ?? 0; params[key] = 0; }
    return { layer: { ...layer, params }, stored: kept };
  }
  Object.assign(params, stored ?? effect.power);
  return { layer: { ...layer, params }, stored: undefined };
}

/** Returns every setting of the effect to its default and removes its animation. */
export function resetFinishEffect(layer: Layer, effect: FinishEffect, definitions: readonly ParameterDefinition[]): Layer {
  const params = { ...layer.params }, modulations = { ...layer.modulations };
  for (const d of definitions) if (effect.keys.includes(d.key)) { params[d.key] = d.default; delete modulations[d.key]; }
  return { ...layer, params, modulations };
}

/**
 * The effects shown on a layer's Finish list: anything on, anything with changed settings, and anything added or
 * switched off during this session, so a switch never makes its row disappear.
 */
export function finishRackEffects(layer: Layer, definitions: readonly ParameterDefinition[], added: ReadonlySet<string> = new Set()): FinishEffect[] {
  return finishEffectsFor(layer, definitions).filter(effect => added.has(effect.id) || finishEffectOn(layer, effect, definitions) || changedSettings(layer, effect, definitions) > 0);
}

/** Adding an effect makes it visible at once: a switched effect that is off turns on. */
export function addFinishEffect(layer: Layer, effect: FinishEffect, definitions: readonly ParameterDefinition[], stored?: Record<string, number>): { layer: Layer; stored?: Record<string, number> } {
  if (!hasPower(effect) || finishEffectOn(layer, effect, definitions)) return { layer, stored };
  return toggleFinishEffect(layer, effect, definitions, stored);
}

/** Effects whose name, group or description contains every word of the search. */
export function searchFinishEffects(effects: readonly FinishEffect[], query: string): FinishEffect[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return effects.filter(effect => { const text = `${effect.label} ${effect.group} ${effect.description}`.toLowerCase(); return words.every(word => text.includes(word)); });
}
