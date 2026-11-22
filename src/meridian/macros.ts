import { MACRO_KEYS, MERIDIAN_PARAMETERS } from './parameters';

/**
 * Each macro moves several drawing parameters from where the performer set them.
 * `gain` is the share of a parameter's range it travels when the macro is fully up (positive) or down.
 * At the centre (0.5) nothing moves. Structural parameters are never touched, so a macro never rebuilds the Score.
 */
const CURVES: Readonly<Record<(typeof MACRO_KEYS)[number], readonly (readonly [string, number])[]>> = {
  macroDensity: [['ringArcShare', 0.5], ['ringTicks', 0.5], ['spokeEndNodes', 0.4], ['nodeTwinkle', 0.3], ['structureNegativeSpace', -0.4], ['nodeSize', 0.05]],
  macroTension: [['heroContraction', 0.5], ['heroPulse', 0.4], ['rhythmAccent', 0.4], ['ringWobble', 0.3], ['glitchAmount', 0.1]],
  macroOrder: [['ringSpacingJitter', 0.5], ['spokeLengthJitter', 0.5], ['nodeJitter', 0.5], ['rhythmHumanise', 0.5], ['ringWobble', 0.3], ['rhythmSwing', 0.3]],
  macroSpeed: [['ringRotationSpeed', 0.25], ['spokeSweepSpeed', 0.3], ['nodeChaseSpeed', 0.3], ['rhythmPeakRate', 0.3], ['reactionTempoMultiplier', 0.2]],
  macroWeight: [['ringWeight', 0.06], ['spokeWeight', 0.06], ['heroWeight', 0.06], ['nodeSize', 0.05], ['ringThinWeight', 0.15], ['ringMediumWeight', 0.15]],
  macroGlitch: [['glitchAmount', 0.25], ['glitchRgbSplit', 0.6], ['glitchSlipH', 0.6], ['glitchScanBands', 0.6], ['glitchRadialTear', 0.4], ['glitchColourShred', 0.5]],
  macroHeat: [['colourSaturation', 0.3], ['lightBloomAmount', 0.3], ['lightExposure', 0.2], ['lightLineGlow', 0.4], ['colourAccentFrequency', 0.5], ['colourHueDrift', 0.4], ['heroGlow', 0.1]],
  macroScale: [['structureZoom', 0.3], ['ringTickLength', 0.4], ['lightBloomSize', 0.4], ['heroHaloSize', 0.25]],
};

interface Target { macro: string; key: string; low: number; high: number; fallback: number; reach: number }
const range = new Map(MERIDIAN_PARAMETERS.map((d) => [d.key, d]));
const TARGETS: readonly Target[] = MACRO_KEYS.flatMap((macro) => CURVES[macro].map(([key, gain]) => {
  const d = range.get(key);
  if (!d || d.structural) throw new Error(`Macro ${macro} cannot move ${key}`);
  return { macro, key, low: d.min, high: d.max, fallback: d.default, reach: gain * (d.max - d.min) };
}));

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: number | undefined, fallback: number) => (Number.isFinite(value) ? (value as number) : fallback);

/**
 * Writes the effective value of every parameter a macro touches into `out`, leaving other keys alone.
 * Two macros on one parameter add together. A missing or non-finite macro counts as centred.
 * Allocation free, so it can run every frame.
 */
export function applyMacros(params: Readonly<Record<string, number>>, out: Record<string, number>): void {
  for (const t of TARGETS) out[t.key] = finite(params[t.key], t.fallback);
  for (const t of TARGETS) out[t.key] += (clamp(finite(params[t.macro], 0.5), 0, 1) - 0.5) * 2 * t.reach;
  for (const t of TARGETS) out[t.key] = clamp(out[t.key], t.low, t.high);
}
