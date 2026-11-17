import type { LayerKind } from '../shared/types';
import { INSTRUMENTS } from './instruments';

/** The Library's name for each kind of layer, shared by Studio and Map. */
export const KIND_LABELS: Record<LayerKind, string> = {
  ...Object.fromEntries(INSTRUMENTS.map(i => [i.kind, i.name])) as Record<LayerKind, string>,
  surface: 'Surface', sculpture: 'Sculpture', fractal: 'Fractal', oil: 'Oil Slides', liquid: 'Liquid Light',
  scope: 'Oscilloscope', super8: 'Super 8 Paint', graphic: 'Graphic Patterns', image: 'Image',
};
