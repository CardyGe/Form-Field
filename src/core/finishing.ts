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
/**
 * Video feedback: each frame, the layer's previous output is transformed,
 * colour-shifted, faded and drawn behind the new source. Fading makes the
 * process forget its start, so rendering a few hundred frames of warm-up
 * reaches the loop's steady state and the last frame flows into the first.
 * Motion values are per frame. Off by default (Feedback 0).
 */
export const FEEDBACK_PARAMETERS:ParameterDefinition[]=[
 {key:'echo',label:'Feedback',min:0,max:1,step:.01,default:0,section:'Motion',description:'How much of each frame survives into the next. 0 is off; higher values leave longer trails.'},
 {key:'echoZoom',label:'Echo zoom',min:.8,max:1.25,step:.001,default:.96,section:'Motion',description:'Scale applied to the echo every frame. Below 1 recedes into a tunnel; above 1 rushes outward.'},
 {key:'echoRotate',label:'Echo rotation',min:-10,max:10,step:.05,default:0,section:'Motion',description:'Degrees the echo turns every frame.'},
 {key:'echoDriftX',label:'Echo drift X',min:-.02,max:.02,step:.0005,default:0,section:'Motion',description:'Horizontal travel of the echo every frame, as a fraction of the frame height.'},
 {key:'echoDriftY',label:'Echo drift Y',min:-.02,max:.02,step:.0005,default:0,section:'Motion',description:'Vertical travel of the echo every frame, as a fraction of the frame height.'},
 {key:'echoHue',label:'Echo hue shift',min:-30,max:30,step:.5,default:0,section:'Material',description:'Degrees each echo turns around the colour wheel, so trails cycle through colour.'},
 {key:'echoMelt',label:'Echo melt',min:0,max:1,step:.01,default:0,section:'Motion',description:'Pushes each echo along its own brightness slopes, so trails smear and melt.'},
 {key:'echoFrame',label:'Source frame',min:0,max:.95,step:.01,default:0,section:'Shape',description:'Cuts a centred hole in the source so it becomes a frame. With Echo zoom below 1, frames nest inside each other.'},
 {key:'echoWindow',label:'Source window',min:0,max:.95,step:.01,default:0,section:'Shape',description:'Shows the source only inside a centred window this size; 0 shows all of it. With Echo zoom above 1, echoes stream outward around the window.'},
 {key:'echoBlend',label:'Echo blend',min:0,max:2,step:1,default:0,section:'Material',description:'Mix blends echoes across the whole source. Behind draws the source over its echoes, which show through transparent areas and frames. Brighter keeps whichever is brighter, for glowing trails.'},
];
/**
 * Time displacement (slit-scan): parts of the frame show the source as it was
 * some frames ago. Stateless and exactly looping. Off by default (Time shift 0).
 */
export const SLIT_PARAMETERS:ParameterDefinition[]=[
 {key:'slitShift',label:'Time shift',min:-1,max:1,step:.01,default:0,section:'Motion',description:'How far back the delay map reaches, as a share of Time span. Negative values flip the map. 0 is off.'},
 {key:'slitSpan',label:'Time span',min:1,max:120,step:1,default:30,section:'Motion',description:'The longest delay in frames, at Time shift 1.'},
 {key:'slitShape',label:'Delay map',min:0,max:4,step:1,default:0,section:'Shape',description:'Which parts of the frame lag: rows, columns, rings, a diagonal or random blocks.'},
 {key:'slitSlices',label:'Time slices',min:2,max:32,step:1,default:12,section:'Shape',description:'Moments of the past sampled each frame. More slices are smoother and slower to render.'},
 {key:'slitSmooth',label:'Slice blend',min:0,max:1,step:.01,default:0,section:'Shape',description:'0 gives hard stepped terraces; 1 blends neighbouring slices into a continuous smear.'},
 {key:'slitBlocks',label:'Block count',min:2,max:40,step:1,default:8,section:'Shape',description:'Blocks per frame height for the Blocks map.'},
 {key:'slitScroll',label:'Map scroll',min:-4,max:4,step:1,default:0,section:'Motion',description:'Times the delay map sweeps across the frame per loop.'},
];
export const FINISH_PARAMETERS:ParameterDefinition[]=[
 {key:'toneContrast',label:'Tonal contrast',min:.5,max:2,step:.01,default:1,section:'Material',description:'Luminance contrast around the pivot, preserving colour ratios.'},
 {key:'tonePivot',label:'Contrast pivot',min:.05,max:.75,step:.01,default:.18,section:'Material',description:'Anchor for Tonal contrast. Neutral contrast leaves the pivot inactive.'},
 {key:'toneGamma',label:'Midtone gamma',min:.5,max:2,step:.01,default:1,section:'Material',description:'Raises or lowers midtones before highlight compression.'},
 {key:'shadowLift',label:'Shadow lift',min:-.25,max:.25,step:.005,default:0,section:'Material',description:'Opens or deepens the shadows without changing alpha.'},
 {key:'highlightRoll',label:'Highlight compression',min:0,max:1,step:.01,default:0,section:'Material',description:'A smooth shoulder that retains bright colour detail.'},
 {key:'vibrance',label:'Vibrance',min:-1,max:1,step:.01,default:0,section:'Material',description:'Adjusts colour intensity with more emphasis on restrained colours.'},
 ...TOON_PARAMETERS,
 ...FEEDBACK_PARAMETERS,
 ...SLIT_PARAMETERS,
];
export const FINISH_KEYS=FINISH_PARAMETERS.map(p=>p.key);
export const TOON_KEYS=TOON_PARAMETERS.map(p=>p.key);
export const FEEDBACK_KEYS=FEEDBACK_PARAMETERS.map(p=>p.key);
export const SLIT_KEYS=SLIT_PARAMETERS.map(p=>p.key);
