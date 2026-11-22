import type { MorphParams } from './params';

/** Six deliberately different starting points for a set. */
export const MORPH_LOOKS: readonly { id: string; name: string; params: Partial<MorphParams> }[] = [
  { id: 'orchid-lens', name: 'Orchid Lens', params: { palette: 0, fieldType: 0, formType: 1, formSize: .42, wavelength: 13, asymmetry: .16, drive: .28, alignment: .65, metal: .85, roughness: .2, irid: .75, filmNm: 420, refraction: .45, lineSharp: .45, spiral: 0 } },
  { id: 'solar-fingers', name: 'Solar Fingers', params: { palette: 1, fieldType: 1, formType: 3, formSize: .34, wavelength: 18, asymmetry: .38, drive: .42, alignment: .55, metal: .6, roughness: .26, irid: .45, filmNm: 560, refraction: .6, lineSharp: .3, spiral: .22 } },
  { id: 'mercury-coral', name: 'Mercury Coral', params: { palette: 2, fieldType: 5, formType: 0, formSize: .42, wavelength: 11, asymmetry: .3, drive: .36, alignment: .4, metal: 1, roughness: .09, irid: .3, filmNm: 300, refraction: .3, lineSharp: .6, spiral: 0 } },
  { id: 'abyss-filament', name: 'Abyss Filament', params: { palette: 3, fieldType: 2, formType: 2, formSize: .55, wavelength: 9, asymmetry: .05, drive: .22, alignment: .85, metal: .95, roughness: .14, irid: .9, filmNm: 680, refraction: .7, lineSharp: .7, spiral: -.18 } },
  { id: 'acid-petri', name: 'Acid Petri', params: { palette: 5, fieldType: 4, formType: 1, formSize: .28, wavelength: 15, asymmetry: .52, drive: .5, alignment: .35, metal: .5, roughness: .32, irid: .65, filmNm: 780, refraction: .8, lineSharp: .25, spiral: .1 } },
  { id: 'twin-moons', name: 'Twin Moons', params: { palette: 10, fieldType: 4, formType: 2, formSize: .36, wavelength: 12, asymmetry: .12, drive: .3, alignment: .75, metal: .9, roughness: .16, irid: .85, filmNm: 500, refraction: .55, lineSharp: .5, spiral: .3 } },
];
