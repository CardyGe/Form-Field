/**
 * Signal path: VHS, Dropout, CRT, JPEG damage and Databend finishes.
 *
 * Each damages the finished layer like a worn broadcast or a broken file. This file holds the rules for when the
 * pass runs, which stages it runs and the choices, so they can be tested apart from the shader.
 */
import type { Layer } from '../shared/types';

export const CRT_MASKS = ['None', 'Stripes', 'Slots', 'Dots'];
export const CRT_BEZELS = ['Transparent', 'Black'];
export const DROP_FILLS = ['Black', 'Noise', 'Hold line'];
export const DATABEND_MODES = ['Echo', 'Comb', 'Fold', 'Stutter', 'Corrupt'];
export const DATABEND_AXES = ['Across', 'Down', 'Wrap'];

type SignalStage = 'databend' | 'jpeg' | 'vhs' | 'drop' | 'crt';
/** Pass order: file damage first, then tape, dropouts and finally the screen showing it. */
const STAGES: { stage: SignalStage; amount: string }[] = [
  { stage: 'databend', amount: 'databendAmount' },
  { stage: 'jpeg', amount: 'jpegAmount' },
  { stage: 'vhs', amount: 'vhsAmount' },
  { stage: 'drop', amount: 'dropAmount' },
  { stage: 'crt', amount: 'crtAmount' },
];
const AMOUNTS = STAGES.map(item => item.amount);

/** A tiled pattern's source is a tile, not the frame, so it cannot take frame-wide damage. */
export function supportsSignal(layer: Pick<Layer, 'kind'>): boolean {
  return layer.kind !== 'graphic';
}

const amountOn = (layer: Pick<Layer, 'params' | 'modulations'>, key: string) => (layer.params[key] ?? 0) > 0 || !!layer.modulations[key];

export function signalActive(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): boolean {
  return supportsSignal(layer) && AMOUNTS.some(key => amountOn(layer, key));
}

/** The stages that run for this layer, in pass order. */
export function signalStages(layer: Pick<Layer, 'kind' | 'params' | 'modulations'>): SignalStage[] {
  if (!supportsSignal(layer)) return [];
  return STAGES.filter(item => amountOn(layer, item.amount)).map(item => item.stage);
}

/** The loop frame for a loop phase in radians: the nearest frame, with the closing frame mapped back to 0. */
export function loopFrame(wrapped: number, frames: number): number {
  const count = Math.max(1, Math.round(frames));
  return Math.round(wrapped / (Math.PI * 2) * count) % count;
}

/** Barrel distortion of the CRT glass: the centre stays put and the corners are pushed out. */
export function crtCurve(uv: [number, number], curve: number): [number, number] {
  if (curve <= 0) return [uv[0], uv[1]];
  const x = uv[0] * 2 - 1, y = uv[1] * 2 - 1;
  return [(x * (1 + curve * y * y) + 1) / 2, (y * (1 + curve * x * x) + 1) / 2];
}

const VHS_OWN = ['vhsTracking', 'vhsBleed', 'vhsNoise', 'vhsHeadSwitch', 'vhsAge', 'vhsRoll'];
const DROP_OWN = ['dropChance', 'dropBands', 'dropFill', 'dropBurst'];
const CRT_OWN = ['crtCurve', 'crtLines', 'crtLineDepth', 'crtMask', 'crtMaskSize', 'crtCorners', 'crtBezel', 'crtBrightness'];
const JPEG_OWN = ['jpegQuality', 'jpegBlock', 'jpegChroma', 'jpegGlitch', 'jpegGlitchSwaps'];
const DATABEND_OWN = ['databendMode', 'databendAxis', 'databendDistance', 'databendRepeats', 'databendFeedback', 'databendSplit', 'databendDepth', 'databendCycles'];

/** Whether a signal control applies, given the layer's other choices. The amounts are always shown; unknown keys are not. */
export function signalControlVisible(layer: Pick<Layer, 'params' | 'modulations'>, key: string): boolean {
  const p = layer.params;
  if (AMOUNTS.includes(key)) return true;
  if (VHS_OWN.includes(key)) return amountOn(layer, 'vhsAmount');
  if (DROP_OWN.includes(key)) return amountOn(layer, 'dropAmount');
  if (CRT_OWN.includes(key)) {
    if (!amountOn(layer, 'crtAmount')) return false;
    if (key === 'crtMaskSize') return Math.round(p.crtMask ?? 0) !== 0;
    return true;
  }
  if (JPEG_OWN.includes(key)) {
    if (!amountOn(layer, 'jpegAmount')) return false;
    if (key === 'jpegGlitchSwaps') return (p.jpegGlitch ?? 0) > 0;
    return true;
  }
  if (DATABEND_OWN.includes(key)) {
    if (!amountOn(layer, 'databendAmount')) return false;
    const mode = Math.round(p.databendMode ?? 0);
    if (key === 'databendRepeats' || key === 'databendFeedback') return mode === 0 || mode === 1;
    if (key === 'databendCycles') return mode === 1 || mode === 3;
    return true;
  }
  return false;
}
