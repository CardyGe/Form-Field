import { validateMorphParams, type MorphParams } from './params';

/** Eight big performance controls. Centre (0.5) leaves the look alone; each moves several parameters together. */
export const MACROS = ['growth', 'chaos', 'density', 'liquid', 'heat', 'prism', 'warp', 'impact'] as const;
export type MacroKey = typeof MACROS[number];

export const neutralMacros = (): Record<MacroKey, number> => Object.fromEntries(MACROS.map(key => [key, .5])) as Record<MacroKey, number>;

export function applyMacros(base: MorphParams, macros: Record<MacroKey, number>): MorphParams {
  if (MACROS.every(key => macros[key] === .5)) return base;
  const m = (key: MacroKey) => macros[key] - .5, p = { ...base };
  p.drive *= 1 + m('growth') * 1.2; p.speed *= 1 + m('growth') * 1.2;
  p.forkRate += m('chaos'); p.curlAmount += m('chaos') * .8; p.alignment -= m('chaos') * .6;
  p.wavelength *= 1 - m('density');
  p.flowSpeed += m('liquid') * .8; p.roughness -= m('liquid') * .2; p.refraction += m('liquid') * .6;
  p.colourShift += m('heat') * .5; p.exposure *= 1 + m('heat') * .3; p.saturation *= 1 + m('heat') * .5;
  p.irid += m('prism'); p.chroma += m('prism') * .6; p.filmNm += m('prism') * 300;
  p.surge += m('warp') * .8; p.spiral += m('warp'); p.fieldDrift += m('warp') * .6;
  p.depth *= 1 + m('impact') * .8; p.bloom += m('impact') * .6; p.lineSharp += m('impact') * .4;
  return validateMorphParams(p);
}

export const macrosFrom = (params: MorphParams): Record<MacroKey, number> => Object.fromEntries(MACROS.map(key => [key, params[key]])) as Record<MacroKey, number>;
