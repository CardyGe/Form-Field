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
 {key:'echoCentreX',label:'Vanishing point X',min:-.5,max:.5,step:.005,default:0,section:'Shape',description:'Moves the point the echoes zoom towards, and the source frame or window with it, as a fraction of the frame height.'},
 {key:'echoCentreY',label:'Vanishing point Y',min:-.5,max:.5,step:.005,default:0,section:'Shape',description:'Vertical position of the vanishing point.'},
 {key:'echoTiltX',label:'Echo tilt X',min:-.6,max:.6,step:.005,default:0,section:'Motion',description:'Perspective tilt added to every echo, so nested frames step sideways like a staircase.'},
 {key:'echoTiltY',label:'Echo tilt Y',min:-.6,max:.6,step:.005,default:0,section:'Motion',description:'Vertical perspective tilt added to every echo.'},
 {key:'echoLens',label:'Echo lens',min:-.5,max:.5,step:.005,default:0,section:'Shape',description:'Bends every echo through a lens. Positive bulges, so nested frames round off and corners fill with arcs; negative pinches.'},
 {key:'echoRound',label:'Frame rounding',min:0,max:1,step:.01,default:0,section:'Shape',description:'Rounds the corners of the source frame or window.'},
 {key:'echoSquare',label:'Frame squareness',min:0,max:1,step:.01,default:0,section:'Shape',description:'0 shapes the frame or window like the output; 1 makes it square.'},
 {key:'echoEdge',label:'Frame edge',min:0,max:1,step:.01,default:0,section:'Shape',description:'Draws a dark rule around the source frame or window every frame, so the echoes stack as distinct steps.'},
 {key:'echoStreak',label:'Echo streaks',min:0,max:1,step:.01,default:0,section:'Material',description:'Drags each echo outward in thin torn lines, each line by its own amount, so the outer echoes smear into streaks.'},
 {key:'echoStreakAxis',label:'Streak direction',min:0,max:1,step:1,default:0,section:'Material',description:'Radial streaks fan out from the vanishing point; Box streaks run straight to the nearest side of the frame.'},
 {key:'echoBlock',label:'Echo blocks',min:0,max:32,step:1,default:0,section:'Material',description:'Breaks each echo into jittering blocks this many pixels across (at 1080 lines), like a damaged video codec, and reads echoes as hard pixels so they stay crisp. Older echoes break up more.'},
 {key:'echoSlip',label:'Channel slip',min:0,max:1,step:.01,default:0,section:'Material',description:'Shifts red and blue apart sideways on every echo, so colour fringes build up into horizontal bands.'},
 {key:'echoCrush',label:'Colour crush',min:0,max:1,step:.01,default:0,section:'Material',description:'Pushes every echo towards pure primaries and steps its brightness, so older echoes collapse into saturated glitch colour.'},
 {key:'echoKeep',label:'Hold brightness',min:0,max:1,step:1,default:0,section:'Material',description:'With Echo zoom above 1, echoes keep full brightness until they leave the frame instead of fading. Loops still close: everything leaves within a few seconds.'},
 {key:'echoEvents',label:'Glitch events',min:0,max:3,step:.05,default:0,section:'Material',description:'Every few frames some cells tear sideways or up and down, posterise or swap colour channels. The damage is carried outward by later echoes.'},
 {key:'echoColourDrift',label:'Colour drift',min:0,max:.1,step:.001,default:0,section:'Material',description:'Rotates the colour channels of every echo a little, so rings drift through red, green and blue.'},
 {key:'echoPunch',label:'Contrast push',min:0,max:.1,step:.001,default:0,section:'Material',description:'Raises the contrast of every echo, so older echoes burn towards pure colour.'},
 {key:'echoPixel',label:'Echo pixel size',min:0,max:16,step:1,default:0,section:'Material',description:'Carries the echoes as chunky pixels this many pixels across (at 1080 lines). 0 keeps full resolution.'},
 {key:'echoBlend',label:'Echo blend',min:0,max:2,step:1,default:0,section:'Material',description:'Mix blends echoes across the whole source. Behind draws the source over its echoes, which show through transparent areas and frames. Brighter keeps whichever is brighter, for glowing trails.'},
];
/**
 * Time displacement (slit-scan): parts of the frame show the source as it was
 * some frames ago. Stateless and exactly looping. Off by default (Time shift 0).
 */
export const SLIT_PARAMETERS:ParameterDefinition[]=[
 {key:'slitShift',label:'Time shift',min:-1,max:1,step:.01,default:0,section:'Motion',description:'How far back the delay map reaches, as a share of Time span. In Delay map mode, negative values flip the map. Other Time modes use only its size. 0 is off.'},
 {key:'slitSpan',label:'Time span',min:1,max:120,step:1,default:30,section:'Motion',description:'The longest delay in frames, at Time shift 1.'},
 {key:'slitShape',label:'Delay map',min:0,max:6,step:1,default:0,section:'Shape',description:'Which parts of the frame lag: rows, columns, rings, a diagonal, random blocks, by brightness or in bands.'},
 {key:'slitSlices',label:'Time slices',min:2,max:32,step:1,default:12,section:'Shape',description:'Moments of the past sampled each frame. More slices are smoother and slower to render.'},
 {key:'slitSmooth',label:'Slice blend',min:0,max:1,step:.01,default:0,section:'Shape',description:'0 gives hard stepped terraces; 1 blends neighbouring slices into a continuous smear.'},
 {key:'slitBlocks',label:'Block count',min:2,max:40,step:1,default:8,section:'Shape',description:'Blocks per frame height for the Blocks map.'},
 {key:'slitScroll',label:'Map scroll',min:-4,max:4,step:1,default:0,section:'Motion',description:'Times the delay map sweeps across the frame per loop.'},
 {key:'slitMode',label:'Time mode',min:0,max:4,step:1,default:0,section:'Shape',description:'How the slices combine: a delay map, an echo, the median, the darkest or the brightest.'},
 {key:'slitDirection',label:'Direction',min:0,max:1,step:1,default:0,section:'Motion',description:'Slices reach into the past, or into the future of the loop.'},
 {key:'slitDecay',label:'Echo fade',min:.05,max:1,step:.01,default:.7,section:'Material',description:'How quickly older slices fade in Echo. 1 weights every slice equally.'},
 {key:'slitReach',label:'Colour reach',min:.1,max:1,step:.01,default:1,section:'Material',description:'How far back each colour remembers. Red remembers least, blue all of it.'},
 {key:'slitTwist',label:'Twist',min:-4,max:4,step:.01,default:0,section:'Shape',description:'Turns each older slice a little further around the frame centre.'},
 {key:'slitZoom',label:'Time zoom',min:0,max:.9,step:.01,default:0,section:'Shape',description:'Scales each older slice a little further in towards the centre.'},
 {key:'slitChroma',label:'Colour lag',min:0,max:1,step:.01,default:0,section:'Material',description:'Delays red and blue against green, so colours trail apart.'},
];
/**
 * Glow: the bright parts of the layer spill soft light around themselves. The
 * blur runs at fixed heights in lines, so exports match the preview. Stateless
 * and exactly looping; it never enters the Feedback history. Off by default
 * (Glow amount 0).
 */
export const GLOW_PARAMETERS:ParameterDefinition[]=[
 {key:'glowMix',label:'Glow amount',min:0,max:2,step:.01,default:0,section:'Material',description:'Soft light spilling from the bright parts of the layer. 0 is off.'},
 {key:'glowThreshold',label:'Glow threshold',min:0,max:1,step:.01,default:.5,section:'Material',description:'Brightness above which light glows. 0 makes the whole layer glow.'},
 {key:'glowSize',label:'Glow size',min:0,max:1,step:.01,default:.5,section:'Material',description:'Tight halo at 0, wide haze at 1. The width is a share of the frame, so exports match the preview.'},
 {key:'glowTint',label:'Glow colour',min:0,max:6,step:1,default:0,section:'Material',description:'0 keeps the layer\'s own colour; 1–6 use the matching palette swatch.'},
 {key:'glowSpread',label:'Glow colour spread',min:0,max:1,step:.01,default:0,section:'Material',description:'Lets the wide part of the glow fan out into colour. 0 keeps one colour.'},
 {key:'glowStreak',label:'Glow streak',min:0,max:2,step:.01,default:0,section:'Material',description:'Stretches bright points into streaks of light. 0 is off.'},
 {key:'glowStreakAngle',label:'Streak angle',min:-90,max:90,step:1,default:0,section:'Material',description:'Direction of the streaks, in degrees from horizontal.'},
 {key:'glowStreakShape',label:'Streak shape',min:0,max:1,step:1,default:0,section:'Material',description:'Line streaks one way; Cross adds a second streak at right angles.'},
];
/**
 * Print screen: the layer's tone is redrawn as halftone dots, a line screen or
 * an ordered dither. Sizes are in pixels of a 1080-line frame and the screen
 * is fixed to the frame, so 4K and supersampled renders match the preview.
 * Stateless and exactly looping; it never enters the Feedback history. Off by
 * default (Print screen 0).
 */
export const PRINT_PARAMETERS:ParameterDefinition[]=[
 {key:'printMix',label:'Print screen',min:0,max:1,step:.01,default:0,section:'Material',description:'Blends from the plain layer to the screened layer. 0 is off.'},
 {key:'printType',label:'Screen type',min:0,max:3,step:1,default:0,section:'Material',description:'Dots, lines, ordered dither or blue noise.'},
 {key:'printSize',label:'Screen size',min:1,max:64,step:.25,default:8,section:'Material',description:'Dot pitch, line pitch or the size of one dither cell, in pixels at 1080 lines.'},
 {key:'printAngle',label:'Screen angle',min:-90,max:90,step:.5,default:45,section:'Material',description:'Turns the whole screen about the frame centre, in degrees.'},
 {key:'printDot',label:'Dot shape',min:0,max:3,step:1,default:0,section:'Material',description:'Round, Classic (round dots that join into a checkerboard at mid tone, then round holes), Diamond or Square.'},
 {key:'printMatrix',label:'Dither matrix',min:0,max:2,step:1,default:2,section:'Material',description:'2×2, 4×4 or 8×8 Bayer pattern.'},
 {key:'printScroll',label:'Screen travel per loop',min:-8,max:8,step:1,default:0,section:'Motion',description:'The screen slides this many whole cells along its angle per loop; the loop closes exactly.'},
 {key:'printFloor',label:'Tone floor',min:0,max:1,step:.01,default:0,section:'Material',description:'Tones below this print nothing.'},
 {key:'printCeiling',label:'Tone ceiling',min:0,max:1,step:.01,default:1,section:'Material',description:'Tones above this print the largest mark.'},
 {key:'printMax',label:'Largest mark',min:.1,max:1,step:.01,default:.8,section:'Material',description:'The most of a cell any mark covers. Below 1, even full-bright areas print as marks with the background between them; 1 lets them print solid.'},
 {key:'printGain',label:'Dot gain',min:-1,max:1,step:.01,default:0,section:'Material',description:'Bends the tone curve: positive fattens the marks, negative thins them.'},
 {key:'printSoft',label:'Mark softness',min:0,max:1,step:.01,default:0,section:'Material',description:'0 is a crisp filtered edge; 1 softens each mark across half a cell.'},
 {key:'printInvert',label:'Invert',min:0,max:1,step:1,default:0,section:'Material',description:'Off: bright tone makes big marks, like light on dark. On: dark tone makes big marks, like ink on paper.'},
 {key:'printColour',label:'Screen colour',min:0,max:4,step:1,default:0,section:'Material',description:'Layer colour, one palette ink, three added RGB light screens, four overprinted CMYK ink screens, or a retro palette.'},
 {key:'printInk',label:'Ink',min:1,max:6,step:1,default:1,section:'Material',description:'Palette swatch used by Palette ink.'},
 {key:'printPaper',label:'Paper',min:0,max:6,step:1,default:0,section:'Material',description:'0 leaves the gaps transparent; 1–6 fill them with that palette swatch, inside the layer\'s own coverage.'},
 {key:'printArea',label:'Print area',min:0,max:2,step:1,default:0,section:'Material',description:'Everywhere, edges only, or away from edges. Outside the area the layer shows as normal.'},
 {key:'printEdgeWidth',label:'Edge width',min:1,max:64,step:.5,default:12,section:'Material',description:'How far the edge band reaches from an edge, in pixels at 1080 lines.'},
 {key:'printEdgeSense',label:'Edge sensitivity',min:0,max:1,step:.01,default:.5,section:'Material',description:'How small a tone step counts as an edge. Higher finds fainter edges.'},
 {key:'printEdgeFeather',label:'Edge feather',min:0,max:1,step:.01,default:.25,section:'Material',description:'Softness of the boundary between screened and plain.'},
 {key:'printRetro',label:'Retro palette',min:0,max:3,step:1,default:0,section:'Material',description:'Game Boy, CGA, Teletext or Green screen, used when Screen colour is Retro palette.'},
 {key:'printShimmer',label:'Shimmer',min:0,max:1,step:1,default:0,section:'Motion',description:'On: the blue-noise pattern changes each frame, so the screen shimmers. Off: it holds still.'},
];
/**
 * Split: the layer's colour channels are pulled apart along a direction, so
 * edges grow coloured fringes. Distances are in pixels of a 1080-line frame.
 * Stateless and exactly looping; it never enters the Feedback history. Off by
 * default (Split amount 0 and Channel order RGB).
 */
export const SPLIT_PARAMETERS:ParameterDefinition[]=[
 {key:'splitAmount',label:'Split amount',min:0,max:64,step:.25,default:0,section:'Material',description:'How far the colour channels are pulled apart, in pixels at 1080 lines. 0 is off.'},
 {key:'splitShape',label:'Split shape',min:0,max:3,step:1,default:0,section:'Material',description:'Straight pulls one way, Lens pulls from the centre, Edges only where tone changes, Wave in rippling bands.'},
 {key:'splitAngle',label:'Split angle',min:-180,max:180,step:1,default:0,section:'Material',description:'Direction of a Straight, Edges or Wave split, in degrees.'},
 {key:'splitSamples',label:'Colour smoothness',min:3,max:15,step:1,default:3,section:'Material',description:'How many steps the split is drawn in. 3 gives pure red, green and blue; more is a smooth rainbow.'},
 {key:'splitThreshold',label:'Edge threshold',min:0,max:1,step:.01,default:.15,section:'Material',description:'How strong an edge must be before Edges splits it.'},
 {key:'splitWaves',label:'Waves',min:1,max:24,step:1,default:4,section:'Material',description:'Number of ripples across the frame for the Wave shape.'},
 {key:'splitTravel',label:'Wave travel per loop',min:-8,max:8,step:1,default:1,section:'Motion',description:'Whole ripples the Wave shape slides per loop; the loop closes exactly.'},
 {key:'splitOrder',label:'Channel order',min:0,max:5,step:1,default:0,section:'Material',description:'Which colour channel goes where: RGB leaves them alone, the others swap them.'},
 {key:'splitBlocks',label:'Order blocks',min:0,max:64,step:1,default:0,section:'Material',description:'Breaks the frame into blocks, this many per frame height, each of which may swap its channel order. 0 swaps the whole frame.'},
 {key:'splitChance',label:'Block chance',min:0,max:1,step:.01,default:.5,section:'Material',description:'Share of blocks that swap their channel order.'},
];
/**
 * Gradient map: the layer's brightness is mapped onto a gradient of colours,
 * dark to bright. Off by default (Gradient map 0).
 */
export const GRADIENT_PARAMETERS:ParameterDefinition[]=[
 {key:'gradMix',label:'Gradient map',min:0,max:1,step:.01,default:0,section:'Material',description:'Blends from the layer\'s colour to its brightness mapped onto a gradient. 0 is off.'},
 {key:'gradPalette',label:'Gradient colours',min:0,max:9,step:1,default:0,section:'Material',description:'0 uses the layer palette, sorted dark to bright; the others are ready-made gradients.'},
 {key:'gradMidpoint',label:'Gradient midpoint',min:.05,max:.95,step:.01,default:.5,section:'Material',description:'The brightness that lands halfway along the gradient. Lower brightens the result; higher darkens it.'},
 {key:'gradOffset',label:'Gradient offset',min:0,max:1,step:.01,default:0,section:'Material',description:'Slides the gradient round; a full turn returns to the start.'},
 {key:'gradCycles',label:'Gradient cycles per loop',min:-8,max:8,step:1,default:0,section:'Motion',description:'Whole turns the gradient makes per loop; the loop closes exactly.'},
 {key:'gradKeep',label:'Keep brightness',min:0,max:1,step:1,default:0,section:'Material',description:'Off: the gradient sets the brightness. On: the layer keeps its own brightness and takes only the gradient\'s colour.'},
];
/**
 * Grading: white balance, then a tint in the shadows and one in the highlights.
 * Each keeps the pixel's brightness. Off by default (all amounts 0).
 */
export const GRADE_PARAMETERS:ParameterDefinition[]=[
 {key:'gradeTemperature',label:'Temperature',min:-1,max:1,step:.01,default:0,section:'Material',description:'Warms (positive) or cools (negative) the colour without changing brightness. 0 is off.'},
 {key:'gradeTint',label:'Tint',min:-1,max:1,step:.01,default:0,section:'Material',description:'Moves the colour towards magenta (positive) or green (negative) without changing brightness. 0 is off.'},
 {key:'gradeShadowTint',label:'Shadow tint',min:0,max:1,step:.01,default:0,section:'Material',description:'How strongly the darks take the shadow colour. Brightness is kept, except that a black or near-black colour darkens them. 0 is off.'},
 {key:'gradeShadowColour',label:'Shadow colour',min:1,max:6,step:1,default:1,section:'Material',description:'Palette swatch used for the shadow tint.'},
 {key:'gradeHighlightTint',label:'Highlight tint',min:0,max:1,step:.01,default:0,section:'Material',description:'How strongly the brights take the highlight colour. Brightness is kept, except that a black or near-black colour darkens them. 0 is off.'},
 {key:'gradeHighlightColour',label:'Highlight colour',min:1,max:6,step:1,default:2,section:'Material',description:'Palette swatch used for the highlight tint.'},
];
/**
 * Luma Key: makes part of the layer transparent by its brightness or its hue.
 * Colour and coverage fade together, so the edge has no fringe. Off by default.
 */
export const KEY_PARAMETERS:ParameterDefinition[]=[
 {key:'keyMix',label:'Key',min:0,max:1,step:.01,default:0,section:'Material',description:'How much of the layer outside the key range becomes transparent. 0 is off.'},
 {key:'keyMode',label:'Key by',min:0,max:1,step:1,default:0,section:'Material',description:'Brightness keeps a range of tones; hue keeps one colour.'},
 {key:'keyLow',label:'Key low',min:0,max:1,step:.01,default:.25,section:'Material',description:'Darkest tone kept when keying by brightness.'},
 {key:'keyHigh',label:'Key high',min:0,max:1,step:.01,default:1,section:'Material',description:'Brightest tone kept when keying by brightness.'},
 {key:'keySoftness',label:'Key softness',min:0,max:1,step:.01,default:.1,section:'Material',description:'Feathers the edge of the key.'},
 {key:'keyHue',label:'Key hue',min:0,max:360,step:1,default:120,section:'Material',description:'The colour kept when keying by hue, in degrees round the colour wheel.'},
 {key:'keyHueRange',label:'Hue range',min:1,max:180,step:1,default:40,section:'Material',description:'How far either side of the key hue is kept, in degrees.'},
 {key:'keyInvert',label:'Invert key',min:0,max:1,step:1,default:0,section:'Material',description:'Off keeps the range; on removes it instead.'},
];
/**
 * Warp: waves, noise, ripples, magnets or plasma bend the picture. Off by default (Warp amount 0).
 */
export const WARP_PARAMETERS:ParameterDefinition[]=[
 {key:'bendAmount',label:'Warp amount',min:0,max:1,step:0.005,default:0,section:'Material',description:'How far the picture is bent, as a share of the frame height. 0 is off.'},
 {key:'bendField',label:'Warp type',min:0,max:4,step:1,default:0,section:'Shape',description:'Waves, Noise, Ripple, Magnetic or Plasma.'},
 {key:'bendScale',label:'Warp scale',min:0.25,max:12,step:0.01,default:3,section:'Shape',description:'How many bends fit across the frame.'},
 {key:'bendAngle',label:'Warp angle',min:-180,max:180,step:1,default:0,section:'Shape',description:'Direction of the bends, in degrees.'},
 {key:'bendCycles',label:'Warp cycles per loop',min:-8,max:8,step:1,default:1,section:'Motion',description:'Whole cycles the bends travel per loop; the loop closes exactly.'},
 {key:'bendDetail',label:'Warp detail',min:1,max:5,step:1,default:3,section:'Shape',description:'Layers of finer bends added on top.'},
 {key:'bendPoints',label:'Warp points',min:1,max:8,step:1,default:3,section:'Shape',description:'How many magnets pull and push in Magnetic.'},
 {key:'bendFalloff',label:'Warp falloff',min:0,max:1,step:0.01,default:0.5,section:'Shape',description:'How quickly a magnet fades with distance.'},
 {key:'bendChroma',label:'Warp colour fringe',min:0,max:1,step:0.01,default:0,section:'Material',description:'Bends red and blue by different amounts, so edges grow colour fringes.'},
];
/**
 * Liquid: the picture is swirled and melted along flowing currents. Off by default (Liquid amount 0).
 */
export const LIQUID_PARAMETERS:ParameterDefinition[]=[
 {key:'liquidAmount',label:'Liquid amount',min:0,max:1,step:0.005,default:0,section:'Material',description:'How far the picture is pushed along the currents. 0 is off.'},
 {key:'liquidStyle',label:'Liquid style',min:0,max:4,step:1,default:0,section:'Shape',description:'Swirl, Flow, Ridge, Vortex or Chaos.'},
 {key:'liquidScale',label:'Liquid scale',min:0.25,max:8,step:0.01,default:2,section:'Shape',description:'Size of the currents.'},
 {key:'liquidSteps',label:'Flow steps',min:1,max:16,step:1,default:6,section:'Shape',description:'How many steps the picture follows the currents. More is smoother and slower.'},
 {key:'liquidDetail',label:'Liquid detail',min:1,max:5,step:1,default:3,section:'Shape',description:'Layers of finer currents added on top.'},
 {key:'liquidCycles',label:'Liquid cycles per loop',min:-4,max:4,step:1,default:1,section:'Motion',description:'Whole cycles the currents turn per loop; the loop closes exactly.'},
 {key:'liquidTrail',label:'Liquid trail',min:0,max:1,step:0.01,default:0,section:'Material',description:'Leaves a faint smear behind the flow.'},
 {key:'liquidChroma',label:'Liquid colour fringe',min:0,max:1,step:0.01,default:0,section:'Material',description:'Flows red and blue by different amounts, so edges grow colour fringes.'},
];
/**
 * Luma Warp: the picture is pushed along its own light, or the layer below. Off by default (Luma warp amount 0).
 */
export const LUMA_WARP_PARAMETERS:ParameterDefinition[]=[
 {key:'lumaWarpAmount',label:'Luma warp amount',min:0,max:1,step:0.005,default:0,section:'Material',description:'How far the picture is pushed by light and dark. 0 is off.'},
 {key:'lumaWarpSource',label:'Driven by',min:0,max:1,step:1,default:0,section:'Shape',description:'This layer, or the layer below it.'},
 {key:'lumaWarpChannel',label:'Read from',min:0,max:4,step:1,default:0,section:'Shape',description:'Brightness, red, green, blue or saturation.'},
 {key:'lumaWarpMode',label:'Luma direction',min:0,max:2,step:1,default:0,section:'Shape',description:'Push along an angle, along edges or along contours.'},
 {key:'lumaWarpAngle',label:'Luma angle',min:-180,max:180,step:1,default:90,section:'Shape',description:'Direction of the push, in degrees.'},
 {key:'lumaWarpThreshold',label:'Luma threshold',min:0,max:1,step:0.01,default:0,section:'Material',description:'Tones below this are left alone.'},
 {key:'lumaWarpSoft',label:'Luma softness',min:0,max:1,step:0.01,default:0.2,section:'Material',description:'Softens the start of the push.'},
 {key:'lumaWarpChroma',label:'Luma colour fringe',min:0,max:1,step:0.01,default:0,section:'Material',description:'Pushes red and blue by different amounts, so edges grow colour fringes.'},
];
/**
 * Polar: wraps the picture into a circle or unrolls a circle. Off by default (Polar amount 0).
 */
export const POLAR_PARAMETERS:ParameterDefinition[]=[
 {key:'polarAmount',label:'Polar amount',min:0,max:1,step:0.005,default:0,section:'Material',description:'How far the picture is wrapped. 0 is off.'},
 {key:'polarMode',label:'Polar type',min:0,max:1,step:1,default:0,section:'Shape',description:'Wraps the picture into a circle, or unrolls a circle into a strip.'},
 {key:'polarCentreX',label:'Polar centre X',min:-0.5,max:0.5,step:0.005,default:0,section:'Shape',description:'Horizontal position of the centre, as a share of the frame height.'},
 {key:'polarCentreY',label:'Polar centre Y',min:-0.5,max:0.5,step:0.005,default:0,section:'Shape',description:'Vertical position of the centre.'},
 {key:'polarTwist',label:'Polar twist',min:-4,max:4,step:0.01,default:0,section:'Shape',description:'Turns the picture further around the centre the further out it is.'},
];
/**
 * Mirror: reflects the picture into halves, quarters or wedges. Off by default (Mirror amount 0).
 */
export const MIRROR_PARAMETERS:ParameterDefinition[]=[
 {key:'mirrorAmount',label:'Mirror amount',min:0,max:1,step:0.01,default:0,section:'Material',description:'How much of the mirrored picture shows. 0 is off.'},
 {key:'mirrorMode',label:'Mirror type',min:0,max:3,step:1,default:0,section:'Shape',description:'Left-right, top-bottom, four-way or kaleidoscope.'},
 {key:'mirrorSegments',label:'Mirror segments',min:2,max:16,step:1,default:6,section:'Shape',description:'Wedges in the kaleidoscope.'},
 {key:'mirrorAngle',label:'Mirror angle',min:-180,max:180,step:1,default:0,section:'Shape',description:'Turns the mirror lines, in degrees.'},
 {key:'mirrorTurns',label:'Mirror turns per loop',min:-8,max:8,step:1,default:0,section:'Motion',description:'Whole turns the mirror makes per loop; the loop closes exactly.'},
];
/** LED wall: the picture rebuilt as a grid of glowing LEDs. Off by default (LED wall 0). */
export const LED_PARAMETERS:ParameterDefinition[]=[
 {key:'ledAmount',label:'LED wall',min:0,max:1,step:.01,default:0,section:'Material',description:'Blends from the plain layer to a wall of LEDs. 0 is off.'},
 {key:'ledSize',label:'LED pitch',min:2,max:64,step:.25,default:10,section:'Shape',description:'Distance between LEDs, in pixels at 1080 lines.'},
 {key:'ledDot',label:'LED size',min:.2,max:1,step:.01,default:.75,section:'Shape',description:'How much of each cell the LED fills.'},
 {key:'ledShape',label:'LED shape',min:0,max:2,step:1,default:0,section:'Shape',description:'Round, square or stripes.'},
 {key:'ledBrightness',label:'LED brightness',min:.5,max:4,step:.01,default:1.5,section:'Material',description:'How hard the LEDs shine.'},
 {key:'ledGaps',label:'LED background',min:0,max:7,step:1,default:1,section:'Material',description:'What shows between the LEDs: transparent, black or a palette swatch.'},
 {key:'ledDead',label:'Dead LEDs',min:0,max:.2,step:.001,default:0,section:'Material',description:'The share of LEDs that stay dark.'},
 {key:'ledScan',label:'LED scan lines',min:0,max:1,step:.01,default:0,section:'Material',description:'Darkens alternate rows, like a scanned display.'},
 {key:'ledFlicker',label:'LED flicker',min:0,max:1,step:.01,default:0,section:'Motion',description:'Each LED shimmers a little. Loops close exactly.'},
];
/** Characters: the picture rebuilt from text characters. Off by default (Characters 0). */
export const CHAR_PARAMETERS:ParameterDefinition[]=[
 {key:'charAmount',label:'Characters',min:0,max:1,step:.01,default:0,section:'Material',description:'Blends from the plain layer to text characters. 0 is off.'},
 {key:'charSize',label:'Character size',min:4,max:96,step:.25,default:16,section:'Shape',description:'Height of one character cell, in pixels at 1080 lines.'},
 {key:'charSet',label:'Character set',min:0,max:3,step:1,default:0,section:'Shape',description:'Density, Blocks, Binary or Dots.'},
 {key:'charColour',label:'Character colour',min:0,max:1,step:1,default:0,section:'Material',description:'Layer colour or one palette ink.'},
 {key:'charInk',label:'Character ink',min:1,max:6,step:1,default:1,section:'Material',description:'Palette swatch used by Palette ink.'},
 {key:'charGaps',label:'Character background',min:0,max:7,step:1,default:1,section:'Material',description:'What shows behind the characters: transparent, black or a palette swatch.'},
 {key:'charContrast',label:'Character contrast',min:.5,max:3,step:.01,default:1,section:'Material',description:'Stretches the tone that picks each character.'},
 {key:'charSwaps',label:'Character swaps per loop',min:0,max:32,step:1,default:0,section:'Motion',description:'How often characters change to a neighbour in the set, per loop. Loops close exactly.'},
 {key:'charSwapChance',label:'Swap chance',min:0,max:1,step:.01,default:.05,section:'Material',description:'The share of cells that swap each time.'},
];
/** Tiles: the picture rebuilt from mosaic tiles, bricks or beads. Off by default (Tiles 0). */
export const TILE_PARAMETERS:ParameterDefinition[]=[
 {key:'tileAmount',label:'Tiles',min:0,max:1,step:.01,default:0,section:'Material',description:'Blends from the plain layer to tiles. 0 is off.'},
 {key:'tileStyle',label:'Tile style',min:0,max:2,step:1,default:0,section:'Shape',description:'Mosaic, Brick or Beads.'},
 {key:'tileSize',label:'Tile size',min:3,max:96,step:.25,default:18,section:'Shape',description:'Height of one tile, in pixels at 1080 lines.'},
 {key:'tileGrout',label:'Grout width',min:0,max:.5,step:.01,default:.12,section:'Shape',description:'The gap between tiles, as a share of a tile.'},
 {key:'tileGaps',label:'Grout colour',min:0,max:7,step:1,default:1,section:'Material',description:'What fills the grout: transparent, black or a palette swatch.'},
 {key:'tileRelief',label:'Tile relief',min:0,max:1,step:.01,default:.5,section:'Material',description:'How much each tile is lit as a raised block.'},
 {key:'tileLight',label:'Light angle',min:-180,max:180,step:1,default:135,section:'Material',description:'The direction the relief light comes from, in degrees.'},
 {key:'tileJitter',label:'Irregularity',min:0,max:1,step:.01,default:.3,section:'Material',description:'How far each mosaic tile strays from the grid.'},
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
 ...GLOW_PARAMETERS,
 ...PRINT_PARAMETERS,
 ...LED_PARAMETERS,
 ...CHAR_PARAMETERS,
 ...TILE_PARAMETERS,
 ...SPLIT_PARAMETERS,
 ...GRADIENT_PARAMETERS,
 ...GRADE_PARAMETERS,
 ...KEY_PARAMETERS,
 ...WARP_PARAMETERS,
 ...LIQUID_PARAMETERS,
 ...LUMA_WARP_PARAMETERS,
 ...POLAR_PARAMETERS,
 ...MIRROR_PARAMETERS,
];
export const FINISH_KEYS=FINISH_PARAMETERS.map(p=>p.key);
export const TOON_KEYS=TOON_PARAMETERS.map(p=>p.key);
export const FEEDBACK_KEYS=FEEDBACK_PARAMETERS.map(p=>p.key);
export const SLIT_KEYS=SLIT_PARAMETERS.map(p=>p.key);
export const GLOW_KEYS=GLOW_PARAMETERS.map(p=>p.key);
export const PRINT_KEYS=PRINT_PARAMETERS.map(p=>p.key);
export const LED_KEYS=LED_PARAMETERS.map(p=>p.key);
export const CHAR_KEYS=CHAR_PARAMETERS.map(p=>p.key);
export const TILE_KEYS=TILE_PARAMETERS.map(p=>p.key);
export const SPLIT_KEYS=SPLIT_PARAMETERS.map(p=>p.key);
export const GRADIENT_KEYS=GRADIENT_PARAMETERS.map(p=>p.key);
export const GRADE_KEYS=GRADE_PARAMETERS.map(p=>p.key);
export const KEY_KEYS=KEY_PARAMETERS.map(p=>p.key);
export const WARP_KEYS=WARP_PARAMETERS.map(p=>p.key);
export const LIQUID_KEYS=LIQUID_PARAMETERS.map(p=>p.key);
export const LUMA_WARP_KEYS=LUMA_WARP_PARAMETERS.map(p=>p.key);
export const POLAR_KEYS=POLAR_PARAMETERS.map(p=>p.key);
export const MIRROR_KEYS=MIRROR_PARAMETERS.map(p=>p.key);
