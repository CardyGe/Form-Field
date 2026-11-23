import type { Layer, Project } from '../shared/types';

const sameLayer = (a: Layer, b: Layer): boolean => a === b || (
  a.kind === 'meridian' && b.kind === 'meridian' && a.id === b.id && a.visible === b.visible
  && a.mask.kind === b.mask.kind && a.mask.dataUrl === b.mask.dataUrl
  && a.meridian?.mark?.dataUrl === b.meridian?.mark?.dataUrl
);

/** True when the only change is to Meridian values, which use no prepared assets, so playback need not pause for it. */
export function canSkipPreparation(before: Project | null, after: Project): boolean {
  if (!before || before.layers.length !== after.layers.length) return false;
  for (const key of Object.keys(after) as (keyof Project)[]) if (key !== 'layers' && before[key] !== after[key]) return false;
  return after.layers.every((layer, i) => sameLayer(before.layers[i], layer));
}
