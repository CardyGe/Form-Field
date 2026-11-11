import type {ParameterDefinition} from '../shared/types';
/** Neutral, linear-light per-layer finishing. Coverage is never modified. */
/**
 * Flat colour and outlines: posterises the layer's tone into hard palette bands
 * with analytically filtered edges and constant-width contour lines. Neutral by
 * default (Flat colour 0), so existing projects keep their exact appearance.
 * Outline width is in pixels of a 1080-line frame, so 4K and supersampled
 * renders keep the same proportions as the preview.
 */
export const TOON_PARAMETERS:ParameterDefinition[]=[
 {key:'toonMix',label:'Flat colour',min:0,max:1,step:.01,default:0,section:'Material',description:'Replaces shading with hard bands of the layer palette. 0 keeps the original rendering.'},
 {key:'toonBands',label:'Colour bands',min:2,max:12,step:1,default:5,section:'Material',description:'Number of tone bands. The palette repeats beyond six bands.'},
 {key:'toonOffset',label:'Palette rotation',min:0,max:1,step:.01,default:0,section:'Material',description:'Moves the bands through the palette. A full turn returns to the start.'},
 {key:'toonCycles',label:'Palette cycles per loop',min:-8,max:8,step:1,default:0,section:'Motion',description:'Full palette turns per loop; the loop closes exactly. Bands flow smoothly through gradients, but flat areas change colour all at once.'},
 {key:'toonSoftness',label:'Band softness',min:0,max:1,step:.01,default:0,section:'Material',description:'0 gives crisp anti-aliased edges; higher values blend neighbouring bands.'},
 {key:'toonOutline',label:'Outline width',min:0,max:8,step:.05,default:0,section:'Material',description:'Contour lines between bands, in pixels at 1080 lines. Scales with export size.'},
 {key:'toonOutlineColor',label:'Outline colour',min:0,max:6,step:1,default:0,section:'Material',description:'0 is black; 1–6 use the matching palette swatch.'},
];
export const FINISH_PARAMETERS:ParameterDefinition[]=[
 {key:'toneContrast',label:'Tonal contrast',min:.5,max:2,step:.01,default:1,section:'Material',description:'Luminance contrast around the pivot, preserving colour ratios.'},
 {key:'tonePivot',label:'Contrast pivot',min:.05,max:.75,step:.01,default:.18,section:'Material',description:'Anchor for Tonal contrast. Neutral contrast leaves the pivot inactive.'},
 {key:'toneGamma',label:'Midtone gamma',min:.5,max:2,step:.01,default:1,section:'Material',description:'Raises or lowers midtones before highlight compression.'},
 {key:'shadowLift',label:'Shadow lift',min:-.25,max:.25,step:.005,default:0,section:'Material',description:'Opens or deepens the shadows without changing alpha.'},
 {key:'highlightRoll',label:'Highlight compression',min:0,max:1,step:.01,default:0,section:'Material',description:'A smooth shoulder that retains bright colour detail.'},
 {key:'vibrance',label:'Vibrance',min:-1,max:1,step:.01,default:0,section:'Material',description:'Adjusts colour intensity with more emphasis on restrained colours.'},
 ...TOON_PARAMETERS,
];
export const FINISH_KEYS=FINISH_PARAMETERS.map(p=>p.key);
export const TOON_KEYS=TOON_PARAMETERS.map(p=>p.key);
