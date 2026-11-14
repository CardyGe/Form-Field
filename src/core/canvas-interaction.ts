import { FINISH_KEYS } from './finishing';
import type { Layer, LayerKind, ParameterDefinition } from '../shared/types';
import { visibleParameterDefinitions, type VariationLocks } from './project';

export const TRANSFORM_LIMITS = { position: [-2, 2], scale: [.05, 8] } as const;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Compare only editable values; embedded images can be many megabytes. */
export function sameCanvasValues(a: Layer, b: Layer): boolean {
  return (['x', 'y', 'scale', 'rotation'] as const).every(key => a.transform[key] === b.transform[key]) &&
    Object.keys(a.params).length === Object.keys(b.params).length &&
    Object.entries(a.params).every(([key, value]) => b.params[key] === value);
}

const preferred: Partial<Record<LayerKind, string[]>> = {
  surface: ['warp', 'detail'], sculpture: ['fold', 'twist'], fractal: ['fold', 'twist'],
  oil: ['deformation', 'lensSize'], super8: ['coverage', 'erosion'], livingink: ['flow', 'warp'],
  currents: ['curl', 'coherence'], relief: ['opening', 'depth'],
  resonance: ['modalBlend', 'radialMix'],
  texturecuts: ['scale', 'cuts'],
};

/** Continuous, visible controls only; never rebuild a simulation during a drag. */
export function canvasAxes(layer: Layer, locks: VariationLocks): ParameterDefinition[] {
  let keys = preferred[layer.kind] ?? [];
  if(layer.kind==='currents'&&layer.params.flowMode===1)keys=['curl','width'];
  if(layer.kind==='livingink'&&layer.params.inkMode===2)keys=['pigment','relief'];
  if (layer.kind === 'fractal' && layer.params.style === 1) keys = ['juliaReal', 'juliaImag'];
  if (layer.kind === 'fractal' && layer.params.style === 2) keys = ['boxScale', 'boxRadius'];
  if (layer.kind === 'graphic') keys = [
    ['waveCount', 'amplitude'], ['coil', 'orbit'], ['roundness', 'tileGap'],
    ['spacing', 'glyphSize'], ['size', 'stretch'],
  ][Math.round(layer.params.style)] ?? [];
  // Finishing and feedback controls act on the finished layer, never as drag axes.
  const available = visibleParameterDefinitions(layer).filter(d => !FINISH_KEYS.includes(d.key) &&
    d.step !== 1 && !d.preparation && !layer.modulations[d.key] &&
    (d.section === 'Shape' && !locks.structure || keys.includes(d.key) && d.section === 'Material' && !locks.material));
  return [...keys.map(key => available.find(d => d.key === key)), ...available]
    .filter((d, i, all): d is ParameterDefinition => !!d && all.indexOf(d) === i).slice(0, 2);
}

export function shapeFromDrag(base: Layer, axes: ParameterDefinition[], dx: number, dy: number): Layer {
  const params = { ...base.params };
  axes.forEach((d, i) => {
    // Most of a viewport gives useful travel while preserving the starting look.
    const delta = i === 0 ? dx : -dy;
    if (delta === 0) return;
    const value = base.params[d.key] + delta * (d.max - d.min) * .65;
    params[d.key] = clamp(Number((Math.round(value / d.step) * d.step).toFixed(6)), d.min, d.max);
  });
  return { ...base, params };
}

export function panFromDrag(base: Layer['transform'], dx: number, dy: number): Layer['transform'] {
  const [min, max] = TRANSFORM_LIMITS.position;
  return { ...base, x: clamp(base.x + dx, min, max), y: clamp(base.y + dy, min, max) };
}

/** Scale the layer about the cursor in composition coordinates (Y points down).
 * This is independent of rotation/aspect: translation and the pivot share the
 * compositor's screen coordinate system. Limits may constrain the pivot at edges. */
export function zoomAt(base: Layer['transform'], factor: number, x: number, y: number): Layer['transform'] {
  const scale = clamp(base.scale * factor, ...TRANSFORM_LIMITS.scale);
  const ratio = scale / base.scale, [min, max] = TRANSFORM_LIMITS.position;
  return { ...base, scale, x: clamp(x - (x - base.x) * ratio, min, max), y: clamp(y - (y - base.y) * ratio, min, max) };
}

export function wheelZoomFactor(deltaY: number, deltaMode: number, height: number): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1);
  return Math.exp(-clamp(pixels, -240, 240) * .0025);
}
