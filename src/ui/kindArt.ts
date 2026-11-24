/** Studio's picture for each kind of instrument, shown in Map's look browser until a preset's own preview is ready. */
import graphicThumb from './assets/graphics.png';
import surfaceThumb from './assets/surface.png';
import sculptureThumb from './assets/sculpture.png';
import fractalThumb from './assets/fractal.png';
import oilThumb from './assets/oil.png';
import liquidThumb from './assets/liquid.png';
import scopeThumb from './assets/scope.png';
import meridianThumb from './assets/meridian.png';
import super8Thumb from './assets/super8.png';

const instruments = import.meta.glob<string>('./assets/instruments/*.png', { eager: true, query: '?url', import: 'default' });
const ART: Record<string, string> = { graphic: graphicThumb, surface: surfaceThumb, sculpture: sculptureThumb, fractal: fractalThumb, oil: oilThumb, liquid: liquidThumb, scope: scopeThumb, meridian: meridianThumb, super8: super8Thumb };

export function kindArt(kind: string): string | undefined {
  return ART[kind] ?? instruments[`./assets/instruments/${kind}.png`];
}
