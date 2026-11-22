import type { ParameterDefinition } from '../shared/types';
import { SEED_SCHEME } from './schemes';

export const MERIDIAN_GROUPS: readonly string[] = ['Score', 'Structure', 'Rings', 'Spokes', 'Nodes', 'Hero', 'Rhythm', 'Glitch', 'Light', 'Colour', 'Output', 'Safety', 'Reaction'];
/** Macros and moves sit outside the lockable groups: they are always on screen. */
export const PERFORMANCE_GROUP = 'Performance';

export const MERIDIAN_MOVES = ['moveNext', 'moveHold', 'moveDrop', 'moveCollapse', 'moveMutate', 'moveReseed', 'moveBurst'] as const;
export const MACRO_KEYS = ['macroDensity', 'macroTension', 'macroOrder', 'macroSpeed', 'macroWeight', 'macroGlitch', 'macroHeat', 'macroScale'] as const;
/** The seed and the seed bank only change what the next phrase is, so they are never link targets. */
export const MERIDIAN_UNLINKED: readonly string[] = ['seed', ...Array.from({ length: 8 }, (_, i) => `seedSlot${i}`)];
/** Never varied by the Variation tool: identity, show safety, output flags, the performer's macro positions and one-shot actions. */
export const MERIDIAN_FIXED: readonly string[] = [...MERIDIAN_UNLINKED, 'scoreStyle', 'scoreEvolution', 'scoreHoldShape', 'scoreBpm', 'scorePulseBars', 'scoreLoopPhrase', 'moveRecall', 'glitchSeed', 'safetyFlashGuard', 'safetyMaxFlashes', 'safetyRedLimit', 'safetyFullField', 'outputMono', 'outputTransparent', ...MACRO_KEYS];


type Section = ParameterDefinition['section'];
const SECTION: Record<string, Section> = {
  Score: 'Motion', Rhythm: 'Motion', Reaction: 'Motion', Performance: 'Motion',
  Structure: 'Shape', Rings: 'Shape', Spokes: 'Shape', Nodes: 'Shape', Hero: 'Shape',
  Glitch: 'Material', Light: 'Material', Colour: 'Material', Output: 'Material', Safety: 'Material',
};

// key, label, min, max, step, default, description
type Row = readonly [string, string, number, number, number, number, string];
const build = (group: string, rows: readonly Row[], structural: readonly string[] = []): ParameterDefinition[] =>
  rows.map(([key, label, min, max, step, value, description]) => ({
    key, label, min, max, step, default: value, section: SECTION[group], group, description,
    ...(structural.includes(key) ? { structural: true } : {}),
  }));

const SCORE: Row[] = [
  ['seed', 'Seed', 0, 4294967295, 1, 1729, 'Picks the composition. The same seed always draws the same design.'],
  ['scoreStyle', 'Style', 0, 2, 1, 2, 'Evolve is one slow living structure that keeps changing form. Pulse is a sparse step sequencer. Dense is the full phrase machine.'],
  ['scoreEvolution', 'Evolution', 0, 1, 0.01, 0.5, 'How quickly Evolve changes form, from frozen at 0 to restless at full.'],
  ['scoreHoldShape', 'Hold shape', 0, 1, 1, 0, 'On, Evolve stays on its current form while it keeps turning and breathing.'],
  ['scoreBpm', 'Tempo', 40, 220, 1, 124, 'Beats per minute of the Pulse sequencer, and of the soft pulse of light in Evolve.'],
  ['scorePulseBars', 'Pulse phrase', 1, 16, 1, 4, 'How many bars one Pulse composition lasts before it collapses and the next begins.'],
  ['scoreLoopPhrase', 'Loop this phrase', 0, 1, 1, 0, 'On, Pulse keeps repeating the current composition. Off, every phrase is new.'],
  ['scoreBars', 'Phrase length', 1, 32, 1, 8, 'How many bars one phrase lasts, from the first point to the rest.'],
  ['scoreQuantise', 'Quantise', 0, 3, 1, 1, 'When a move you press actually happens: 0 at once, 1 on the beat, 2 on the bar, 3 at the next phrase.'],
  ['scoreAutopilot', 'Autopilot', 0, 1, 1, 1, 'On, phrases follow one another by themselves. Off, it waits for Next.'],
  ['scoreVariation', 'Variation', 0, 1, 0.01, 0.3, 'How far Mutate wanders from the current design while keeping its character.'],
  ['scoreRepeat', 'Phrases per loop', 1, 16, 1, 1, 'How many phrases make up one loop in the Studio, so a long export can hold several.'],
  ['scoreDraw', 'Draw share', 0.1, 4, 0.01, 1, 'How much of the phrase is spent drawing the rings and spokes on. 1 is the normal length.'],
  ['scoreBuild', 'Build share', 0.1, 4, 0.01, 1, 'How much of the phrase is spent building detail. 1 is the normal length.'],
  ['scoreCharge', 'Charge share', 0.1, 4, 0.01, 1, 'How long the tension gathers before the peak. 1 is the normal length.'],
  ['scorePeak', 'Peak share', 0.1, 4, 0.01, 1, 'How long the peak lasts. 1 is the normal length.'],
  ['scoreCollapse', 'Collapse share', 0.1, 4, 0.01, 1, 'How long the design takes to fall inwards. 1 is the normal length.'],
  ['scoreRest', 'Rest share', 0.1, 4, 0.01, 1, 'How long the single quiet dot lasts before the next phrase. 1 is the normal length.'],
];
const STRUCTURE: Row[] = [
  ['symmetry', 'Symmetry order', 0, 24, 1, 0, 'How many times the design repeats around the centre. 0 lets the seed choose.'],
  ['zones', 'Zones', 1, 8, 1, 4, 'How many bands the design is divided into from the edge to the centre.'],
  ['structureRadialRatio', 'Radial ratio', 0, 2.2, 0.01, 0, 'How quickly each band shrinks towards the centre. 1 or below lets the seed choose.'],
  ['structureCentreX', 'Centre X', -0.5, 0.5, 0.01, 0, 'Slides the whole design left or right.'],
  ['structureCentreY', 'Centre Y', -0.5, 0.5, 0.01, 0, 'Slides the whole design up or down.'],
  ['structureEllipse', 'Ellipse', 0, 1, 0.01, 0, 'Squashes the circles into ovals.'],
  ['structureRotation', 'Rotation', -180, 180, 0.1, 0, 'Turns the whole design, in degrees.'],
  ['structureZoom', 'Zoom', 0.5, 2, 0.01, 1, 'Makes the whole design larger or smaller in the frame.'],
  ['structureTilt', 'Perspective tilt', 0, 1, 0.01, 0, 'Leans the design away from you as if it were a disc seen at an angle.'],
  ['structureSquareMix', 'Polar / square mix', 0, 1, 0.01, 0, 'Bends circles towards squares. On a design composed square, it bends them back towards circles.'],
  ['structureNegativeSpace', 'Negative space', 0, 1, 0.01, 0.5, 'Below the middle, quiet bands fill with marks. Above it, empty wedges open through the design.'],
];
const RINGS: Row[] = [
  ['ringCount', 'Ring count', 0, 32, 1, 7, 'The most rings drawn. Fewer gives a calmer design.'],
  ['ringWeight', 'Ring weight', 0, 16, 0.01, 1, 'Scales the thickness of every ring and arc together.'],
  ['ringThinWeight', 'Thin ring weight', 0.5, 4, 0.01, 1, 'Thickness of the fine rings, in pixels at 1080p.'],
  ['ringMediumWeight', 'Medium ring weight', 0.5, 6, 0.01, 1.6, 'Thickness of the stronger rings, in pixels at 1080p.'],
  ['ringSpacingJitter', 'Spacing jitter', 0, 1, 0.01, 0, 'Nudges the rings off their even spacing.'],
  ['ringArcShare', 'Arc share', 0, 1, 0.01, 0.35, 'How many of the rings are broken into arcs instead of full circles.'],
  ['ringDashCount', 'Dash count', 0, 64, 1, 0, 'Cuts rings into this many dashes. 0 keeps them whole.'],
  ['ringDashGap', 'Dash gap', 0, 1, 0.01, 0.4, 'How much of each dash is empty gap.'],
  ['ringTicks', 'Ticks', 0, 1, 0.01, 0.5, 'How many small tick marks are drawn along the scales.'],
  ['ringTickLength', 'Tick length', 0, 1, 0.01, 0.5, 'How long the tick marks are.'],
  ['ringRotationSpeed', 'Rotation speed', -4, 4, 0.01, 1, 'How fast the rings turn. Negative turns them the other way.'],
  ['ringCounterRotation', 'Counter-rotation', 0, 1, 0.01, 0.5, 'How much alternate rings turn against their neighbours.'],
  ['ringDrawOnStyle', 'Draw-on style', 0, 3, 1, 0, 'How rings appear: 0 sweep round, 1 fade in, 2 grow out, 3 snap on.'],
  ['ringWobble', 'Wobble', 0, 1, 0.01, 0, 'A slight wavering of the rings, like a hand-drawn line.'],
  ['ringOpacity', 'Ring opacity', 0, 1, 0.01, 1, 'How solid the rings and arcs are.'],
];
const SPOKES: Row[] = [
  ['spokeCount', 'Spoke count', 0, 96, 1, 12, 'The most spokes drawn round the centre. 0 removes them.'],
  ['spokeTwinShare', 'Twin share', 0, 1, 0.01, 0.55, 'How likely a spoke is to be drawn as a close pair.'],
  ['spokeTwinGap', 'Twin gap', 0.2, 4, 0.01, 1.1, 'The gap between the two lines of a pair, in degrees.'],
  ['spokeInnerReach', 'Inner reach', 0, 1, 0.01, 0, 'How far in towards the centre the spokes start.'],
  ['spokeOuterReach', 'Outer reach', 0, 1, 0.01, 1, 'How far out towards the edge the spokes run.'],
  ['spokeOffsetAngle', 'Offset angle', -180, 180, 0.1, 0, 'Turns the spokes against the rest of the design, in degrees.'],
  ['spokeLengthJitter', 'Length jitter', 0, 1, 0.01, 0, 'Makes the spokes uneven in length.'],
  ['spokeSweepSpeed', 'Sweep speed', 0, 4, 0.01, 1, 'How fast the spokes sweep on as the phrase draws.'],
  ['spokeRetractStyle', 'Retract style', 0, 2, 1, 0, 'How spokes leave: 0 shrink to the centre, 1 shrink to the edge, 2 fade.'],
  ['spokeWeight', 'Spoke weight', 0, 16, 0.01, 1, 'Scales the thickness of the spokes and ticks.'],
  ['spokeEndNodes', 'End nodes', 0, 1, 0.01, 0, 'Puts small marks at the outer end of each spoke.'],
  ['spokeOpacity', 'Spoke opacity', 0, 1, 0.01, 1, 'How solid the spokes are.'],
];
const NODES: Row[] = [
  ['latticeType', 'Lattice type', 0, 1, 0.01, 0.35, 'Round layouts at 0, square grids at 1. In between, the seed picks one.'],
  ['nodeDensity', 'Node density', 0, 1, 0.01, 0.5, 'How many small marks fill the lattice zones.'],
  ['nodeSize', 'Node size', 0, 8, 0.01, 1, 'Scales the size of every node.'],
  ['nodeShape', 'Node shape', 0, 2, 1, 0, 'The mark used: 0 as designed, 1 all dots, 2 all squares.'],
  ['nodeGlow', 'Node glow', 0, 2, 0.01, 0.5, 'A soft light around each node.'],
  ['nodeJitter', 'Node jitter', 0, 1, 0.01, 0, 'Shakes the nodes slightly off their grid positions.'],
  ['nodeChaseSpeed', 'Chase speed', 0, 4, 0.01, 1, 'How fast light runs from node to node.'],
  ['nodeChasePattern', 'Chase pattern', 0, 3, 1, 0, 'The path the light takes: 0 round, 1 outwards, 2 inwards, 3 scattered.'],
  ['nodeRingSnap', 'Ring snap', 0, 1, 0.01, 0, 'Pulls nodes onto the nearest ring.'],
  ['nodeColourAccent', 'Colour accent', 0, 1, 0.01, 0.3, 'How many nodes take the accent colour.'],
  ['nodeTwinkle', 'Twinkle', 0, 1, 0.01, 0, 'Lets nodes flicker softly on and off.'],
  ['nodeOpacity', 'Node opacity', 0, 1, 0.01, 1, 'How solid the nodes are.'],
];
const HERO: Row[] = [
  ['heroRadius', 'Hero radius', 0, 1, 0.01, 0.5, 'Where the bright hero ring sits between its two neighbours.'],
  ['heroWeight', 'Hero weight', 0, 16, 0.01, 1, 'Scales the thickness of the hero ring.'],
  ['heroIgnition', 'Ignition', 0, 1, 0.01, 0.6, 'How suddenly the hero ring lights at the peak.'],
  ['heroContraction', 'Contraction', 0, 1, 0.01, 0.5, 'How far the hero ring tightens while tension builds.'],
  ['heroOvershoot', 'Overshoot', 0, 1, 0.01, 0.3, 'How far the hero ring swings past its size when it fires.'],
  ['heroHaloSize', 'Halo size', 0, 2, 0.01, 1, 'The reach of the light round the hero ring.'],
  ['heroHaloStrength', 'Halo strength', 0, 2, 0.01, 1, 'How bright the light round the hero ring is.'],
  ['heroInnerFill', 'Inner fill', 0, 1, 0.01, 0, 'Fills the inside of the hero ring with soft light.'],
  ['heroPulse', 'Pulse amount', 0, 1, 0.01, 0.5, 'How strongly the hero ring beats with the rhythm.'],
  ['heroSplit', 'Split', 0, 1, 0.01, 0, 'Divides the hero ring into two rings that drift apart.'],
  ['heroGlow', 'Hero glow', 0, 8, 0.01, 1, 'Scales the glow of the hero ring.'],
];
const RHYTHM: Row[] = [
  ['rhythmRingHits', 'Ring hits', 1, 32, 1, 5, 'How many beats of the pattern the rings land on.'],
  ['rhythmRingSteps', 'Ring steps', 4, 32, 1, 16, 'How many steps the ring pattern is divided into.'],
  ['rhythmSpokeHits', 'Spoke hits', 1, 32, 1, 5, 'How many beats of the pattern the spokes land on.'],
  ['rhythmSpokeSteps', 'Spoke steps', 4, 32, 1, 16, 'How many steps the spoke pattern is divided into.'],
  ['rhythmNodeHits', 'Node hits', 1, 32, 1, 9, 'How many beats of the pattern the nodes land on.'],
  ['rhythmNodeSteps', 'Node steps', 4, 32, 1, 16, 'How many steps the node pattern is divided into.'],
  ['rhythmRotation', 'Pattern rotation', 0, 31, 1, 0, 'Shifts every pattern along by this many steps.'],
  ['rhythmSwing', 'Swing', 0, 1, 0.01, 0, 'Delays every second step for a lilting feel.'],
  ['rhythmSubdivisionRamp', 'Subdivision ramp', 0, 1, 0.01, 0.5, 'How much the beat gets faster as the phrase builds.'],
  ['rhythmPolyrhythm', 'Polyrhythm', 0, 1, 0.01, 0, 'Sets rings, spokes and nodes against one another in different lengths.'],
  ['rhythmAccent', 'Accent', 0, 1, 0.01, 0.5, 'How much harder the strong beats hit.'],
  ['rhythmHumanise', 'Humanise', 0, 1, 0.01, 0, 'Loosens the timing so it feels played, not machined.'],
  ['rhythmPeakRate', 'Peak rate', 0.25, 4, 0.01, 1, 'How fast the rhythm runs during the peak.'],
];
const GLITCH: Row[] = [
  ['glitchAmount', 'Glitch amount', 0, 4, 0.01, 1, 'The overall strength of the tearing at the peak. 0 keeps the lines clean.'],
  ['glitchBlockSize', 'Block size', 0, 1, 0.01, 0.3, 'How large the torn blocks are.'],
  ['glitchBlockAspect', 'Block aspect', 0.25, 4, 0.01, 1, 'Whether the blocks are wide and flat or tall and thin.'],
  ['glitchSlipH', 'Horizontal slip', 0, 1, 0.01, 0.3, 'How far blocks slide sideways.'],
  ['glitchSlipV', 'Vertical slip', 0, 1, 0.01, 0.1, 'How far blocks slide up or down.'],
  ['glitchRgbSplit', 'RGB split', 0, 1, 0.01, 0.16, 'Pulls the red, green and blue apart at the tear.'],
  ['glitchScanBands', 'Scan bands', 0, 1, 0.01, 0.2, 'Adds horizontal bands like a failing screen.'],
  ['glitchPosterise', 'Posterise', 0, 1, 0.01, 0, 'Reduces the colour to a few flat steps.'],
  ['glitchHoldFrames', 'Hold frames', 0, 12, 1, 5, 'How many frames a tear is held before it changes.'],
  ['glitchRadialTear', 'Radial tear', 0, 1, 0.01, 0.26, 'Tears the design outwards from the centre.'],
  ['glitchSpread', 'Spread', 0, 1, 0.01, 0.32, 'How far across the frame the tear reaches.'],
  ['glitchColourShred', 'Colour shred', 0, 1, 0.01, 0.2, 'Scrambles the colour inside torn areas.'],
  ['glitchRecovery', 'Recovery', 0, 1, 0.01, 0.5, 'How quickly the design settles again after a tear.'],
  ['glitchSeed', 'Glitch seed', 0, 999999, 1, 1, 'Picks which pattern the tears follow. Change it to get different tears.'],
];
const LIGHT: Row[] = [
  ['lightExposure', 'Exposure', 0.25, 2, 0.01, 1, 'The overall brightness of the lines.'],
  ['lightCore', 'Core', 0, 2, 0.01, 1, 'How white-hot the centre of each line is.'],
  ['lightBloomAmount', 'Bloom amount', 0, 2, 0.01, 0.6, 'How much bright lines spill light into the dark.'],
  ['lightBloomSize', 'Bloom size', 0, 1, 0.01, 0.5, 'How far that spilled light reaches.'],
  ['lightLineGlow', 'Line glow', 0, 2, 0.01, 0.5, 'A soft light hugging every line.'],
  ['lightAfterglow', 'Afterglow', 0, 1, 0.01, 0.3, 'How long lines stay lit after they move.'],
  ['lightTrailLength', 'Trail length', 0, 1, 0.01, 0.3, 'How long the trails behind moving marks are.'],
  ['lightBackgroundLift', 'Background lift', 0, 0.3, 0.01, 0, 'Raises the black into a dim glow.'],
  ['lightVignette', 'Vignette', 0, 1, 0.01, 0.3, 'Darkens the corners of the frame.'],
  ['lightContrast', 'Contrast', 0.5, 2, 0.01, 1, 'The difference between the brightest and dimmest parts.'],
];
const COLOUR: Row[] = [
  ['colourPalette', 'Palette', 0, SEED_SCHEME, 1, SEED_SCHEME, 'Chooses a colour scheme. Seed chooses gives every composition its own.'],
  ['colourBase', 'Base colour', 0, 5, 1, 0, 'Which swatch of the layer palette draws the main lines.'],
  ['colourAccent', 'Accent colour', 0, 5, 1, 1, 'Which swatch of the layer palette draws the highlights.'],
  ['colourPeakPalette', 'Peak palette', 0, SEED_SCHEME, 1, SEED_SCHEME, 'A second colour scheme that tears in at the peak. Same as main keeps one scheme throughout.'],
  ['colourHueDrift', 'Hue drift', 0, 1, 0.01, 0, 'Lets the colours slowly slide round the colour wheel.'],
  ['colourAccentFrequency', 'Accent frequency', 0, 1, 0.01, 0.3, 'How often the accent colour appears.'],
  ['colourSaturation', 'Saturation', 0, 2, 0.01, 1, 'How vivid the colours are. 0 is grey.'],
  ['colourFringe', 'Fringe', 0, 1, 0.01, 0.2, 'Coloured edges on the lines, like a lens.'],
  ['colourByRadius', 'Colour by radius', 0, 1, 0.01, 0, 'Shifts colour from the centre outwards.'],
  ['colourByAge', 'Colour by age', 0, 1, 0.01, 0, 'Shifts colour as a mark gets older.'],
];
const OUTPUT: Row[] = [
  ['outputMinLineWidth', 'Minimum line width', 0.5, 6, 0.01, 1.5, 'The thinnest any line is drawn, so it never vanishes on a large wall.'],
  ['outputAntiAlias', 'Edge softness', 0.5, 3, 0.01, 1, 'How soft the edge of each line is, in pixels.'],
  ['outputSafeMargin', 'Safe margin', 0, 0.2, 0.001, 0, 'Keeps the design away from the edge of the frame.'],
  ['outputBlackLevel', 'Black level', 0, 0.2, 0.001, 0, 'Lifts the black for a projector that cannot go fully dark.'],
  ['outputMono', 'Mono', 0, 1, 1, 0, 'Draws everything in one colour.'],
  ['outputTransparent', 'Transparent background', 0, 1, 1, 0, 'Leaves out the black so Meridian can sit over other layers.'],
];
const SAFETY: Row[] = [
  ['safetyFlashGuard', 'Flash guard', 0, 1, 1, 1, 'Keeps large bright flashes within safe limits. Leave this on for an audience.'],
  ['safetyMaxFlashes', 'Flashes per second', 1, 3, 1, 3, 'The most large bright flashes allowed in a second.'],
  ['safetyRedLimit', 'Red limit', 0, 1, 0.01, 0.5, 'How much strongly saturated red is allowed in a flash. Lower is gentler.'],
  ['safetyFullField', 'Full-field limit', 0, 1, 0.01, 0.5, 'How much of the frame may light up at once during a flash.'],
];
const REACTION: Row[] = [
  ['reactionBass', 'Bass', 0, 2, 0.01, 1, 'How strongly the design reacts to low sounds.'],
  ['reactionMids', 'Mids', 0, 2, 0.01, 1, 'How strongly the design reacts to middle sounds.'],
  ['reactionHighs', 'Highs', 0, 2, 0.01, 1, 'How strongly the design reacts to high sounds.'],
  ['reactionBeat', 'Beat', 0, 2, 0.01, 1, 'How strongly the design reacts to each beat.'],
  ['reactionAttack', 'Attack', 0, 500, 1, 20, 'How quickly the design responds when a sound arrives, in milliseconds.'],
  ['reactionRelease', 'Release', 0, 2000, 1, 250, 'How slowly the response fades after a sound, in milliseconds.'],
  ['reactionTempoMultiplier', 'Tempo multiplier', 0.25, 4, 0.01, 1, 'Plays the design at a multiple of the music tempo.'],
  ['reactionBeatSnap', 'Beat snap', 0, 1, 0.01, 0.5, 'From reacting freely at 0 to landing exactly on the beat at 1.'],
];
const MOVE_ROWS: Row[] = [
  ['moveNext', 'Next', 0, 1, 0.01, 0, 'Starts a new phrase at the next quantise point.'],
  ['moveHold', 'Hold', 0, 1, 0.01, 0, 'Stays in the Charge state for as long as it is held.'],
  ['moveDrop', 'Drop', 0, 1, 0.01, 0, 'Jumps straight to the peak on the next beat.'],
  ['moveCollapse', 'Collapse', 0, 1, 0.01, 0, 'Collapses the design early.'],
  ['moveMutate', 'Mutate', 0, 1, 0.01, 0, 'Varies the next phrase while keeping its character.'],
  ['moveReseed', 'Reseed', 0, 1, 0.01, 0, 'Makes a new composition for the next phrase.'],
  ['moveBurst', 'Burst', 0, 1, 0.01, 0, 'Fires a short burst of energy through the design.'],
  ['moveRecall', 'Recall', 0, 8, 1, 0, 'Plays a saved seed next. 0 is none, 1 to 8 are the seed slots.'],
];
const SLOT_ROWS: Row[] = Array.from({ length: 8 }, (_, i): Row =>
  [`seedSlot${i}`, `Seed slot ${i + 1}`, 0, 999999, 1, 0, `A seed stored in slot ${i + 1}. Recall ${i + 1} plays it next.`]);
const MACRO_ROWS: Row[] = [
  ['macroDensity', 'Density', 0, 1, 0.01, 0.5, 'Fills the design with more detail, or clears it out. Centre is as designed.'],
  ['macroTension', 'Tension', 0, 1, 0.01, 0.5, 'Tightens and charges the design, or relaxes it. Centre is as designed.'],
  ['macroOrder', 'Order / Chaos', 0, 1, 0.01, 0.5, 'Towards 0 everything is exact; towards 1 it loosens and scatters.'],
  ['macroSpeed', 'Speed', 0, 1, 0.01, 0.5, 'Speeds up or slows down all the motion. Centre is as designed.'],
  ['macroWeight', 'Weight', 0, 1, 0.01, 0.5, 'Makes every line thicker or finer. Centre is as designed.'],
  ['macroGlitch', 'Glitch', 0, 1, 0.01, 0.5, 'Adds tearing and colour splitting, or removes it. Centre is as designed.'],
  ['macroHeat', 'Heat', 0, 1, 0.01, 0.5, 'Makes the colour and light hotter and brighter, or cooler and quieter. Centre is as designed.'],
  ['macroScale', 'Scale', 0, 1, 0.01, 0.5, 'Makes everything larger and wider, or smaller and tighter. Centre is as designed.'],
];

const STRUCTURAL = ['seed', 'scoreBars', 'scoreRepeat', 'scoreDraw', 'scoreBuild', 'scoreCharge', 'scorePeak', 'scoreCollapse', 'scoreRest', 'symmetry', 'zones', 'structureRadialRatio', 'ringCount', 'spokeCount', 'latticeType', 'nodeDensity', 'rhythmRingHits', 'rhythmRingSteps', 'rhythmSpokeHits', 'rhythmSpokeSteps', 'rhythmNodeHits', 'rhythmNodeSteps', 'rhythmRotation'];

export const MERIDIAN_PARAMETERS: ParameterDefinition[] = [
  ...build('Score', SCORE, STRUCTURAL), ...build('Structure', STRUCTURE, STRUCTURAL), ...build('Rings', RINGS, STRUCTURAL),
  ...build('Spokes', SPOKES, STRUCTURAL), ...build('Nodes', NODES, STRUCTURAL), ...build('Hero', HERO), ...build('Rhythm', RHYTHM, STRUCTURAL),
  ...build('Glitch', GLITCH), ...build('Light', LIGHT), ...build('Colour', COLOUR), ...build('Output', OUTPUT), ...build('Safety', SAFETY), ...build('Reaction', REACTION),
  ...build(PERFORMANCE_GROUP, MACRO_ROWS),
  ...build(PERFORMANCE_GROUP, MOVE_ROWS).map((d) => ({ ...d, momentary: true })),
  ...build('Score', SLOT_ROWS),
];

/** Every default, for the composer, the evaluator and tests. */
export const MERIDIAN_DEFAULTS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(MERIDIAN_PARAMETERS.map((d) => [d.key, d.default])));
