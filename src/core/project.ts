import {FINISH_PARAMETERS, FINISH_KEYS, TOON_KEYS, FEEDBACK_KEYS, SLIT_KEYS, GLOW_KEYS, PRINT_KEYS} from './finishing';
import { isSimplePolygon } from './surface-layout';
import { TIMING_PARAMETERS, TIMING_KEYS } from './timing';
import { NEON_STRATA, ACID_DRIP, POP_PORTAL, POUR, HOT_SIGNAL, LIME_VIOLET, ELECTRIC, CANDY, SOLAR, CYAN_YELLOW } from './palettes';
import { supportsFeedback } from '../rendering/feedback';
import { supportsSlitScan } from '../rendering/slitscan';
import { supportsGlow } from '../rendering/bloom';
import { supportsPrint } from '../rendering/print-screen';
import { SCOPE_FIGURES } from '../rendering/scope-curve';
import { MERIDIAN_LOOKS } from '../meridian/presets';
import { MERIDIAN_FIXED, MERIDIAN_GROUPS, MERIDIAN_PARAMETERS } from '../meridian/parameters';
import { SCORE_STYLE_DENSE } from '../meridian/pulse';
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_PARAMETERS, INSTRUMENT_UPGRADE_KEYS, isInstrument } from './instruments';
import type { Layer, LayerKind, MeridianLayerState, ParameterDefinition, Preset, Project } from '../shared/types';
import { GRAPHIC_LOOKS, GRAPHIC_PARAMETERS, GRAPHIC_VARIANTS, graphicVisibleKeys } from './graphics';

const TAU = Math.PI * 2;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
/** What the app accepts from an imported file, before it becomes a project asset. */
export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
export const MAX_IMPORT_SIDE = 8192;
const MAX_IMAGE_DIMENSION = 16384;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const DEFAULT_PALETTE = ['#49efd6', '#cbf34a', '#ef62d9', '#7747ef', '#ff826c', '#19112e'];
const SCULPTURE_PALETTE = CANDY;
const FRACTAL_PALETTE = ['#5fffe1', '#aff043', '#b77bff', '#f65aa6', '#ffb969', '#09102c'];
const FRACTAL_EVOLUTION = .82;
export const FRACTAL_FAMILIES = ['Kaleidoscope', 'Julia Bloom', 'Mandelbox', 'Portal'];
export const FRACTAL_VARIANTS = [
  ['Lace', 'Petals', 'Weave'],
  ['Classic', 'Radial', 'Spiral'],
  ['Architecture', 'Sphere Fold', 'Lattice'],
  ['Beaded Tunnel', 'Mosaic Spiral', 'Light Halo'],
];
export const FRACTAL_PROJECTION_LOOK_IDS = [
  'unfolding-rose', 'electric-coast', 'cathedral-passage', 'neon-passage', 'glass-spiral', 'afterlight',
];

const SUPER8_PALETTE = ['#ff6238', '#f5c842', '#408bba', '#be4266', '#171824', '#eeddb4'];
// New looks use the projector; absent controls in saved films migrate to neutral.
const SUPER8_PROJECTOR_LOOK = { emulsion: .55, pullDown: .6, shutter: .16, dust: .25, hair: .15, lightLeak: .22, halation: .35, vignette: .3, lensSoftness: .22, colorFade: .18 };
export const SUPER8_ROLL_KEYS = ['rollAmount', 'rollBands', 'rollOrigin', 'rollSmear'];
export const SUPER8_PROJECTOR_KEYS = ['emulsion', 'gateMode', 'gateInset', 'gateRoundness', 'sprockets', 'pullDown', 'shutter', 'shutterBlades', 'reelLoops', 'frameLines', 'dust', 'hair', 'lightLeak', 'halation', 'vignette', 'lensSoftness', 'colorFade'];

// Oscilloscope: 0 line, 1 halo, 2 bloom, 3 hot core, 4 second line, 5 unused.
const SCOPE_PALETTE = ['#ff2a8a', '#ff1e6e', '#c81050', '#ffffff', '#ff7ad0', '#000000'];
// Liquid Light: 0 rim, 1 body, 2 mid, 3 hot, 4 wash, 5 ground.
const LIQUID_PALETTE = ['#7a0006', '#ff1414', '#ff7a00', '#ffe81a', '#1a1aff', '#050002'];
// Meridian: 0 base line, 1 primary accent, 2 secondary accent, 3 hero core, 4 halo, 5 ground.
const MERIDIAN_PALETTE = ['#ffffff', '#ff3fd0', '#35d0ff', '#ffffff', '#ffffff', '#08070b'];
const OIL_PALETTE = ['#eeff00', '#a7de12', '#060710', '#25b8ed', '#071275', '#e2a51c'];

const parameter = (key: string, label: string, min: number, max: number, step: number, value: number, section: ParameterDefinition['section']): ParameterDefinition =>
  ({ key, label, min, max, step, default: value, section });

export const SCOPE_MODES = ['Classic', 'Ember Pulse'];
const SCOPE_MODE = parameter('scopeMode', 'Oscilloscope mode', 0, 1, 1, 0, 'Shape');
const EMBER_PARAMETERS = [
  { ...parameter('emberOpening', 'Opening', 0, 1, .01, .60, 'Shape'), description: 'Opens the cavity at the centre and spreads the lobes of the filament body.' },
  { ...parameter('emberTurbulence', 'Turbulence', 0, 1, .01, .58, 'Shape'), description: 'Bends the filaments and adds moving creases to the contours.' },
  { ...parameter('emberPulse', 'Pulse depth', 0, 1, .01, .72, 'Motion'), description: 'Increases the contrast in the movement and light between accents.' },
  { ...parameter('emberRings', 'Ring strength', 0, 1, .01, .62, 'Motion'), description: 'Sets the strength of the rings that travel out from the filament body.' },
  { ...parameter('emberHeat', 'Heat', 0, 1, .01, .62, 'Material'), description: 'Brings orange and gold into the brightest filaments.' },
  { ...parameter('emberSmoke', 'Smoke', 0, 1, .01, .70, 'Material'), description: 'Adds smoke that curls out of the filament body and thins between accents.' },
  { ...parameter('emberSmokeSpread', 'Smoke spread', 0, 1, .01, .44, 'Motion'), advanced: true, description: 'Sets how far the smoke drifts from the bloom before dispersing.' },
  { ...parameter('emberSmokeCurl', 'Smoke curl', 0, 1, .01, .67, 'Motion'), description: 'Controls how strongly the smoke rolls over itself.' },
  { ...parameter('emberSmokeResponse', 'Smoke audio response', 0, 1, .01, .72, 'Motion'), description: 'Lets beats launch fresh plumes, bass add body and highs bring out fine wisps.' },
  { ...parameter('emberSmokeLift', 'Smoke lift', -1, 1, .01, .26, 'Motion'), advanced: true, description: 'Adds upward or downward drift as the smoke ages.' },
  { ...parameter('emberSmokeLife', 'Smoke persistence', 0, 1, .01, .55, 'Motion'), advanced: true, description: 'Sets how long the wake hangs before it thins.' },
  { ...parameter('emberSmokeBody', 'Smoke thickness', 0, 1, .01, .61, 'Material'), description: 'Adds depth and hides some of the filaments behind denser smoke.' },
  { ...parameter('emberSmokeDetail', 'Smoke detail', 0, 1, .01, .60, 'Material'), advanced: true, description: 'Reveals finer folds and ragged edges.' },
  { ...parameter('emberSmokeLight', 'Smoke lighting', 0, 1, .01, .72, 'Material'), advanced: true, description: 'Sets how much the filaments light the surrounding smoke.' },
  { ...parameter('emberDensity', 'Filament density', 0, 1, .01, .62, 'Shape'), advanced: true, description: 'Fades more fine strands into the central body.' },
  { ...parameter('emberOuter', 'Outer contours', 0, 1, .01, .30, 'Shape'), advanced: true, description: 'Sets the strength of the broad traces around the frame.' },
  { ...parameter('emberPhrases', 'Phrases per loop', 1, 16, 1, 5, 'Motion'), advanced: true, description: 'Sets how many four-beat phrases play in one composition loop.' },
  { ...parameter('emberRest', 'Rest level', 0, 1, .01, .12, 'Material'), advanced: true, description: 'Sets the minimum light between accents.' },
];
const EMBER_KEYS = new Set(EMBER_PARAMETERS.map(definition => definition.key));
const SHARED_SCOPE_KEYS = new Set(['scopeMode', 'radius', 'beamWidth', 'intensity', 'halo', 'bloom', 'bloomSize', 'depthFade', 'afterglow', 'saturation', 'hue', 'exposure', ...FINISH_KEYS]);

export function scopeParameterVisible(params: Layer['params'], key: string): boolean {
  return params.scopeMode === 1
    ? EMBER_KEYS.has(key) || SHARED_SCOPE_KEYS.has(key)
    : !EMBER_KEYS.has(key);
}

const EMBER_BASE = { scopeMode: 1, radius: .43, beamWidth: .51, intensity: 1.60, halo: .48, bloom: .43, bloomSize: .29, depthFade: .74, afterglow: .16 };

export const EMBER_PALETTES = [
  { id: 'ember-pulse', name: 'Ember Pulse', palette: ['#b90b14', '#820008', '#a30f03', '#ffd074', '#fa3e14', '#be261d'] },
  { id: 'ember-glacier', name: 'Glacier Vapour', palette: ['#6bf9fc', '#17718a', '#2466cd', '#e9fcff', '#35a7ff', '#4385b2'] },
  { id: 'ember-orchid', name: 'Orchid Static', palette: ['#f658ee', '#782c9e', '#6314cf', '#ffc8e7', '#a47dff', '#8f38ac'] },
  { id: 'ember-acid', name: 'Acid Plume', palette: ['#bafa32', '#487018', '#53a60f', '#fff9a1', '#32ff8b', '#5e9c2a'] },
  { id: 'ember-silver', name: 'Silver Ash', palette: ['#d4e5f3', '#626f83', '#8393ad', '#fbfdff', '#a5c2df', '#8594a9'] },
];

const DEFINITIONS: Record<LayerKind, ParameterDefinition[]> = {
  ...INSTRUMENT_PARAMETERS,
  surface: [
    parameter('style', 'Pattern', 0, 3, 1, 0, 'Shape'),
    parameter('variant', 'Variant', 0, 2, 1, 0, 'Shape'),
    parameter('scale', 'Scale', 0.5, 12, 0.01, 4, 'Shape'),
    parameter('warp', 'Flow', 0, 1, 0.01, 0.45, 'Shape'),
    parameter('detail', 'Detail', 0, 1, 0.01, 0.4, 'Shape'),
    parameter('roundness', 'Roundness', 0, 1, 0.01, 0.6, 'Shape'),
    parameter('relief', 'Relief', 0, 1, 0.01, 0.55, 'Material'),
    parameter('iridescence', 'Optical sheen', 0, 1, 0.01, 0, 'Material'),
    {...parameter('anisotropy','Directional sheen',0,1,.01,0,'Material'),advanced:true},
    {...parameter('sheenAngle','Sheen direction',-Math.PI,Math.PI,.01,0,'Material'),advanced:true,description:'Highlight direction when Directional sheen is above zero.'},
    parameter('softness', 'Softness', 0, 1, 0.01, 0.25, 'Material'),
    parameter('contrast', 'Contrast', 0, 1, 0.01, 0.55, 'Material'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    parameter('rotation', 'Direction', -Math.PI, Math.PI, 0.01, 0, 'Shape'),
    parameter('offset', 'Color drift', 0, 1, 0.01, 0.2, 'Motion'),
    parameter('reveal', 'Negative space', 0, 1, 0.01, 0.1, 'Material'),
    parameter('density', 'Pattern density', 0.3, 3, 0.01, 1, 'Shape'),
    parameter('stretch', 'Stretch', 0.25, 4, 0.01, 1, 'Shape'),
    parameter('turbulence', 'Turbulence', 0, 1, 0.01, 0, 'Shape'),
    parameter('centerX', 'Center horizontal', -1, 1, 0.01, 0, 'Shape'),
    parameter('centerY', 'Center vertical', -1, 1, 0.01, 0, 'Shape'),
    parameter('lightAngle', 'Light angle', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('roughness', 'Roughness', 0.05, 1, 0.01, 0.3, 'Material'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
    ...TIMING_PARAMETERS.map(d => ({ ...d })),
  ],
  sculpture: [
    parameter('form', 'Form', 0, 3, 1, 0, 'Shape'),
    parameter('fold', 'Fold', 0, 1, 0.01, 0.6, 'Shape'),
    parameter('ridges', 'Ridges', 0, 1, 0.01, 0.5, 'Shape'),
    parameter('opening', 'Opening', 0, 1, 0.01, 0.55, 'Shape'),
    parameter('twist', 'Twist', -1, 1, 0.01, 0.3, 'Shape'),
    parameter('breath', 'Breath', 0, 1, 0.01, 0.25, 'Motion'),
    parameter('roughness', 'Roughness', 0.02, 1, 0.01, 0.3, 'Material'),
    parameter('iridescence', 'Iridescence', 0, 1, 0.01, 0.85, 'Material'),
    parameter('cameraYaw', 'Orbit', -Math.PI, Math.PI, 0.01, 0, 'Camera'),
    parameter('cameraPitch', 'Elevation', -1.3, 1.3, 0.01, 0.2, 'Camera'),
    parameter('zoom', 'Framing', 0.4, 3, 0.01, 1, 'Camera'),
    parameter('lightAngle', 'Light angle', -Math.PI, Math.PI, 0.01, 0.5, 'Material'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    { ...parameter('spin', 'Turns per loop', -3, 3, 1, 0, 'Motion'), description: 'Turns the form whole times each loop on a tilted axis, so its silhouette keeps changing. 0 holds it still.' },
    parameter('lobes', 'Lobes', 3, 12, 1, 6, 'Shape'),
    parameter('thickness', 'Thickness', 0, 1, 0.01, 0.5, 'Shape'),
    parameter('stretch', 'Stretch', 0.5, 1.8, 0.01, 1, 'Shape'),
    parameter('curl', 'Curl', 0, 1, 0.01, 0.5, 'Shape'),
    parameter('foldFrequency', 'Fold frequency', 0.5, 2, 0.01, 1, 'Shape'),
    parameter('asymmetry', 'Asymmetry', 0, 1, 0.01, 0, 'Shape'),
    parameter('ridgeScale', 'Ridge scale', 0.5, 2, 0.01, 1, 'Shape'),
    parameter('metallic', 'Metal finish', 0, 1, 0.01, 0, 'Material'),
    parameter('clearcoat', 'Clear coat', 0, 1, 0.01, 0.82, 'Material'),
    parameter('sheen', 'Sheen', 0, 1, 0.01, 0.23, 'Material'),
    parameter('filmScale', 'Film thickness', 0.25, 2, 0.01, 1, 'Material'),
    parameter('lightPower', 'Light power', 0.25, 2, 0.01, 1, 'Material'),
    parameter('shadowStrength', 'Shadow strength', 0, 1, 0.01, 1, 'Material'),
    parameter('shadowSoftness', 'Shadow softness', 0, 1, 0.01, 0, 'Material'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
  fractal: [
    parameter('style', 'Pattern', 0, FRACTAL_FAMILIES.length - 1, 1, 0, 'Shape'),
    parameter('variant', 'Variant', 0, 2, 1, 0, 'Shape'),
    parameter('scale', 'Scale', 0.5, 5, 0.01, 1.7, 'Shape'),
    parameter('detail', 'Detail', 0, 1, 0.01, 0.6, 'Shape'),
    parameter('fold', 'Fold', 0, 1, 0.01, 0.55, 'Shape'),
    parameter('symmetry', 'Symmetry', 3, 12, 1, 6, 'Shape'),
    parameter('twist', 'Twist', -1, 1, 0.01, 0.2, 'Shape'),
    parameter('morph', 'Morph', 0, 1, 0.01, 0.1, 'Motion'),
    parameter('travel', 'Travel', 0, 1, 0.01, 0.25, 'Motion'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    parameter('offset', 'Color drift', 0, 1, 0.01, 0.2, 'Motion'),
    parameter('relief', 'Relief', 0, 1, 0.01, 0.65, 'Material'),
    parameter('glow', 'Glow', 0, 1, 0.01, 0.35, 'Material'),
    parameter('contrast', 'Contrast', 0, 1, 0.01, 0.55, 'Material'),
    parameter('cameraYaw', 'Orbit', -Math.PI, Math.PI, 0.01, 0, 'Camera'),
    parameter('cameraPitch', 'Elevation', -1.1, 1.1, 0.01, 0.15, 'Camera'),
    parameter('zoom', 'Framing', 0.5, 2, 0.01, 1, 'Camera'),
    { ...parameter('zoomFlight', 'Zoom flight', 0, 1, 0.01, 0, 'Motion'), description: 'Flies continuously into the pattern; each loop zooms one step deeper and fades into the next. 0 is off.' },
    { ...parameter('outside', 'Outside colour', 0, 1, 0.01, 0, 'Material'), description: 'Julia only: fills the space beyond the set with dim colour bands instead of black.' },
    { ...parameter('approach', 'Fly in', 0, 1, 0.01, 0, 'Camera'), description: 'Moves the camera inside the Mandelbox toward its folded core. 0 frames the whole box from outside.' },
    parameter('quality', 'Render quality', 0, 2, 1, 2, 'Material'),
    parameter('density', 'Color density', 0.25, 3, 0.01, 1, 'Material'),
    parameter('juliaReal', 'Julia real', -1.2, 0.4, 0.00001, -0.74543, 'Shape'),
    parameter('juliaImag', 'Julia imaginary', -0.8, 0.8, 0.00001, 0.11301, 'Shape'),
    parameter('trap', 'Orbit detail', 0, 1, 0.01, 0.45, 'Material'),
    parameter('boxScale', 'Box scale', 1.45, 2.8, 0.01, 2, 'Shape'),
    parameter('boxRadius', 'Fold radius', 0.2, 0.8, 0.01, 0.5, 'Shape'),
    parameter('radial', 'Radial fold', 0, 1, 1, 0, 'Shape'),
    parameter('roughness', 'Roughness', 0.05, 1, 0.01, 0.32, 'Material'),
    parameter('lightAngle', 'Light angle', -Math.PI, Math.PI, 0.01, -0.6, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
    parameter('lineWidth', 'Line width', 0.25, 2, 0.01, 1, 'Shape'),
    parameter('colorMode', 'Coloring', 0, 2, 1, 0, 'Material'),
    parameter('colorSteps', 'Contour colors', 2, 12, 1, 6, 'Material'),
    parameter('colorMix', 'Coloring amount', 0, 1, 0.01, 1, 'Material'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    { ...parameter('focalX', 'Focal point X', -.45, .45, .01, 0, 'Shape'), description: 'Place the opening horizontally within the mapped surface.' },
    { ...parameter('focalY', 'Focal point Y', -.45, .45, .01, 0, 'Shape'), description: 'Place the opening vertically within the mapped surface.' },
    { ...parameter('cutout', 'Dark-space cutout', 0, 1, .01, 0, 'Material'), description: 'Let the mapped surface or layers below show through the dark gaps.' },
    { ...parameter('evolution', 'Evolution', 0, 1, .01, 0, 'Motion'), description: 'Sets how strongly the forms open, split, and reveal deeper layers. Zero restores the original motion.' },
    { ...parameter('reveal', 'Reveal', 0, 1, .01, 0, 'Motion'), description: 'Amount of the staged reveal. The movement follows the project loop.' },
    { ...parameter('passage', 'Camera passage', 0, 1, .01, 0, 'Camera'), description: 'Move from a held wide view towards a selected opening and ease back out.' },
    { ...parameter('depth', 'Depth', 0, 1, .01, 0, 'Shape'), description: 'Strength of the perspective and depth separation.' },
    { ...parameter('bank', 'Bank', -1, 1, .01, 0, 'Camera'), description: 'Set the camera tilt. With Evolution off, this controls the original rocking motion.' },
    { ...parameter('position', 'Travel position', 0, 1, .01, 0, 'Motion'), description: 'Scrub a still pose in Manual mode or shift the timing in Loop mode.' },
    parameter('autoTravel', 'Travel mode', 0, 1, 1, 1, 'Motion'),
    { ...parameter('afterglow', 'Afterglow', 0, 1, .01, .55, 'Material'), description: 'Amount of staggered, expanding light echoes around the halo.' },
  ],
  liquid: [
    parameter('scale', 'Cell size', 0.4, 3, 0.01, 1, 'Shape'),
    {...parameter('sizeRange', 'Size range', 4, 40, 0.5, 16, 'Shape'), preparation: true, description: 'How many times larger the biggest droplets are than the smallest.'},
    {...parameter('density', 'Density', 0, 1, 0.01, 0.6, 'Shape'), preparation: true, description: 'How tightly droplets pack. Low values leave dark gaps.'},
    {...parameter('crowding', 'Crowding', 0, 1, 0.01, 0.4, 'Shape'), description: 'Droplets swell into each other. The smaller one gives way and bends around the larger.'},
    {...parameter('dimple', 'Rings', 0, 1, 0.01, 0.15, 'Shape'), description: 'How many droplets are dished: a bright ring around a dark centre.'},
    parameter('floaters', 'Floaters', 0, 1, 0.01, 0.12, 'Shape'),
    {...parameter('merge', 'Merge', 0, 1, 0.01, 0, 'Shape'), description: 'Joins the larger droplets into blobs. Small droplets stay separate along the edges.'},
    {...parameter('press', 'Press', 0, 1, 0.01, 0, 'Shape'), description: 'A glass dome that magnifies the droplets under it and pushes them towards the hot colour.'},
    parameter('pressRadius', 'Press size', 0.1, 1, 0.01, 0.4, 'Shape'),
    parameter('pressX', 'Press horizontal', -1, 1, 0.01, 0, 'Shape'),
    parameter('pressY', 'Press vertical', -1, 1, 0.01, 0, 'Shape'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    parameter('drift', 'Drift', 0, 1, 0.01, 0.35, 'Motion'),
    parameter('warp', 'Flow', 0, 1, 0.01, 0.5, 'Motion'),
    parameter('breathing', 'Breathing', 0, 1, 0.01, 0.4, 'Motion'),
    parameter('shimmer', 'Swell', 0, 1, 0.01, 0.4, 'Motion'),
    {...parameter('pressPulse', 'Press pulse', 0, 1, 0.01, 0.6, 'Motion'), description: 'How far the press eases off and returns once per loop.'},
    parameter('thickness', 'Thickness', 0, 1.5, 0.01, 0.85, 'Material'),
    parameter('outline', 'Rim shade', 0, 1, 0.01, 0.5, 'Material'),
    parameter('rim', 'Rim light', 0, 1, 0.01, 0.4, 'Material'),
    {...parameter('farLayer', 'Far layer', 0, 1, 0.01, 0.5, 'Material'), description: 'A second, larger dish of droplets behind the main one.'},
    parameter('farBlur', 'Far blur', 0, 1, 0.01, 0.6, 'Material'),
    {...parameter('refraction', 'Refraction', 0, 1, 0.01, 0.5, 'Material'), description: 'Thin droplets act as lenses over the far layer.'},
    {...parameter('wash', 'Wash', 0, 1, 0.01, 0, 'Material'), description: 'Marbles the ground with bands of the wash colour.'},
    parameter('vein', 'Vein width', 0, 1, 0.01, 0.4, 'Material'),
    parameter('backgroundOpacity', 'Ground opacity', 0, 1, 0.01, 1, 'Material'),
    {...parameter('focus', 'Soft focus', 0, 1, 0.01, 0.15, 'Material'), description: 'Softens droplet edges like a projector lens, drifting slightly over the loop.'},
    {...parameter('fringe', 'Colour fringe', 0, 1, 0.01, 0.3, 'Material'), description: 'Warm and violet edges on droplets towards the sides of the frame.'},
    parameter('vignette', 'Vignette', 0, 1, 0.01, 0.25, 'Material'),
    {...parameter('grain', 'Grain', 0, 1, 0.01, 0.15, 'Material'), advanced: true},
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
  scope: [
    SCOPE_MODE, ...EMBER_PARAMETERS,
    {...parameter('figure', 'Figure', 0, SCOPE_FIGURES.length - 1, 1, 0, 'Shape'), description: 'The frequency ratio of the oscillators that steer the beam. Simple ratios are calm, larger ones dense.'},
    {...parameter('overtones', 'Overtones', 0, 1, 0.01, 0, 'Shape'), description: 'Bends the oscillators away from a pure sine, for lopsided, less regular figures.'},
    parameter('radius', 'Size', 0.08, 0.6, 0.005, 0.32, 'Shape'),
    {...parameter('tilt', 'Lean', -Math.PI, Math.PI, 0.01, 0.35, 'Shape'), description: 'A fixed lean of the whole figure.'},
    {...parameter('ring', 'Ring', 0, 1, 0.01, 0.8, 'Shape'), description: 'A circle around the figure, like the rim of the tube.'},
    {...parameter('figureB', 'Second figure', 0, SCOPE_FIGURES.length - 1, 1, 3, 'Shape'), description: 'The figure the line changes into when Morph is up.'},
    {...parameter('sway', 'Sway', 0, 1, 0.01, 0.3, 'Shape'), description: 'A slow, wide undulation of the whole line, so it never sits rigid.'},
    {...parameter('wiggle', 'Signal', 0, 1, 0.01, 0, 'Shape'), description: 'A fast, uneven ripple riding on the line, like sound on an oscilloscope.'},
    {...parameter('wiggleFrequency', 'Signal pitch', 4, 120, 1, 36, 'Shape'), description: 'Roughly how many ripples fit along the whole line.'},
    {...parameter('dash', 'Dashes', 0, 1, 0.01, 0, 'Shape'), description: 'Breaks the line into bright dashes with dim gaps.'},
    parameter('dashCount', 'Dash count', 1, 64, 1, 12, 'Shape'),
    parameter('dashLength', 'Dash length', 0.05, 0.95, 0.01, 0.3, 'Shape'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    {...parameter('drift', 'Phase drift', -4, 4, 1, 1, 'Motion'), description: 'Whole turns the oscillators slip against each other per cycle. This is what makes the figure fold, open and collapse.'},
    {...parameter('morph', 'Morph', 0, 1, 0.01, 0, 'Motion'), description: 'How far the line changes into the second figure and back, once per cycle.'},
    {...parameter('hold', 'Morph hold', 0, 0.9, 0.01, 0.3, 'Motion'), description: 'Share of the cycle spent resting on each figure.'},
    {...parameter('wiggleBursts', 'Signal bursts', 0, 1, 0.01, 0, 'Motion'), description: 'Gathers the signal into patches that travel, swell and fade.'},
    {...parameter('float', 'Float', 0, 1, 0.01, 0.4, 'Motion'), description: 'Rocks the whole figure gently, so it is never seen dead flat.'},
    {...parameter('dashSpeed', 'Dash travel', -8, 8, 1, 2, 'Motion'), description: 'Whole trips round the line per cycle.'},
    {...parameter('afterglow', 'Afterglow', 0, 1, 0.01, 0, 'Motion'), description: 'Fading trails where the line was a moment ago.'},
    {...parameter('tumbleX', 'Tumble forward', -4, 4, 1, 0, 'Motion'), description: 'Turns the whole figure, in whole turns per cycle about the horizontal axis. Leave at 0 for a flat screen.'},
    {...parameter('tumbleY', 'Tumble sideways', -4, 4, 1, 0, 'Motion'), description: 'Turns the whole figure, in whole turns per cycle about the vertical axis.'},
    {...parameter('hueDrift', 'Colour travel', 0, 1, 0.01, 0, 'Motion'), description: 'How much of the second line colour travels round the line, once per cycle.'},
    parameter('beamWidth', 'Beam width', 0.3, 6, 0.01, 1, 'Material'),
    parameter('intensity', 'Intensity', 0.2, 6, 0.01, 2.2, 'Material'),
    parameter('halo', 'Halo', 0, 2, 0.01, 1, 'Material'),
    {...parameter('bloom', 'Bloom', 0, 2, 0.01, 1, 'Material'), description: 'The wide soft glow around the line, in the bloom colour.'},
    parameter('bloomSize', 'Bloom size', 0, 1, 0.01, 0.5, 'Material'),
    {...parameter('fringe', 'Colour fringe', 0, 1, 0.01, 0.3, 'Material'), description: 'Splits red and blue apart towards the edge of the ring.'},
    {...parameter('depthFade', 'Depth fade', 0, 1, 0.01, 0.6, 'Material'), description: 'Dims and thins the parts of the line that are further away.'},
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
  oil: [
    parameter('poolSize', 'Pool size', 0.5, 2, 0.01, 1, 'Shape'),
    parameter('coverage', 'Paint coverage', 0, 1, 0.01, 0.58, 'Shape'),
    parameter('cellSize', 'Cell size', 0.25, 2, 0.01, 0.8, 'Shape'),
    parameter('lensSize', 'Lens size', 0.06, 0.34, 0.01, 0.2, 'Shape'),
    parameter('lensAspect', 'Lens stretch', 0.6, 1.8, 0.01, 1.1, 'Shape'),
    parameter('deformation', 'Organic shape', 0, 1, 0.01, 0.6, 'Shape'),
    parameter('lensDepth', 'Lens depth', 0, 1, 0.01, 0.65, 'Shape'),
    parameter('cellComplexity', 'Cell complexity', 0, 1, 0.01, 0.65, 'Material'),
    parameter('dispersion', 'Color separation', 0, 1, 0.01, 0.12, 'Material'),
    parameter('caustics', 'Caustic light', 0, 1, 0.01, 0, 'Material'),
    parameter('iridescence', 'Optical sheen', 0, 1, 0.01, 0, 'Material'),
    {...parameter('anisotropy','Directional sheen',0,1,.01,0,'Material'),advanced:true},
    {...parameter('sheenAngle','Sheen direction',-Math.PI,Math.PI,.01,0,'Material'),advanced:true,description:'Highlight direction when Directional sheen is above zero.'},
    parameter('travel', 'Slide travel', 0, 0.8, 0.01, 0.32, 'Motion'),
    parameter('relativeRotation', 'Relative rotation', 0, 1.2, 0.01, 0.3, 'Motion'),
    parameter('drag', 'Drag', 0, 1, 0.01, 0.55, 'Motion'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    parameter('lift', 'Lens lift', 0, 1, 0.01, 0, 'Motion'),
    { ...parameter('layout', 'Layout', 0, 2, 1, 0, 'Shape'), description: 'Slide: pools pressed by a moving glass. Pour: one paint mass with cells opening through it. Lacing: ribbons that run edge to edge.' },
    { ...parameter('dome', 'Glass dome', 0, 1, 0.01, 1, 'Shape'), description: 'How much of the glass dome is shown. 0 leaves only the paint.' },
    parameter('thickness', 'Thickness', 0, 1, 0.01, 0.6, 'Material'),
    parameter('refraction', 'Refraction', 0, 1, 0.01, 0.65, 'Material'),
    parameter('wetness', 'Wetness', 0, 1, 0.01, 0.8, 'Material'),
    parameter('ink', 'Ink amount', 0, 1, 0.01, 0.85, 'Material'),
    parameter('filaments', 'Filaments', 0, 1, 0.01, 0.6, 'Material'),
    parameter('softness', 'Edge softness', 0, 1, 0.01, 0.15, 'Material'),
    parameter('lightAngle', 'Light angle', -Math.PI, Math.PI, 0.01, 2.15, 'Material'),
    parameter('shadow', 'Shadow strength', 0, 1, 0.01, 0.7, 'Material'),
    parameter('grain', 'Grain', 0, 1, 0.01, 0.18, 'Material'),
    parameter('substrate', 'Substrate', 0, 1, 1, 1, 'Material'),
    parameter('quality', 'Render quality', 0, 2, 1, 1, 'Material'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
  super8: [
    parameter('mode', 'Mode', 0, 4, 1, 0, 'Shape'),
    parameter('scale', 'Geometry scale', 0.5, 3, 0.01, 1, 'Shape'),
    parameter('steps', 'Geometry steps', 3, 32, 1, 12, 'Shape'),
    parameter('coverage', 'Paint coverage', 0, 1, 0.01, 0.78, 'Shape'),
    parameter('erosion', 'Paint destruction', 0, 1, 0.01, 0.25, 'Shape'),
    parameter('rotation', 'Direction', -Math.PI, Math.PI, 0.01, -0.25, 'Shape'),
    parameter('texture', 'Paint texture', 0, 1, 0.01, 0.65, 'Material'),
    parameter('textureScale', 'Texture scale', 0.3, 3, 0.01, 1, 'Material'),
    parameter('roughness', 'Dry brush', 0, 1, 0.01, 0.55, 'Material'),
    parameter('bleed', 'Pigment bleed', 0, 1, 0.01, 0.25, 'Material'),
    parameter('travel', 'Motion amount', 0, 1, 0.01, 0.45, 'Motion'),
    parameter('cycles', 'Cycles per loop', 1, 8, 1, 1, 'Motion'),
    parameter('filmFps', 'Film frame rate', 1, 48, 1, 18, 'Motion'),
    parameter('feedback', 'Feedback', 0, 0.9, 0.01, 0.32, 'Motion'),
    parameter('feedbackSpacing', 'Feedback spacing (frames)', 1, 12, 1, 3, 'Motion'),
    parameter('feedbackZoom', 'Feedback zoom', -0.15, 0.15, 0.001, 0.025, 'Motion'),
    parameter('feedbackRotation', 'Feedback rotation', -0.3, 0.3, 0.001, 0.035, 'Motion'),
    parameter('scratches', 'Scratches', 0, 1, 0.01, 0.3, 'Material'),
    parameter('grain', 'Film grain', 0, 1, 0.01, 0.22, 'Material'),
    parameter('flicker', 'Flicker', 0, 1, 0.01, 0.18, 'Motion'),
    parameter('weave', 'Gate weave', 0, 1, 0.01, 0.2, 'Motion'),
    parameter('emulsion', 'Emulsion movement', 0, 1, 0.01, 0, 'Material'),
    parameter('gateMode', 'Projector view', 0, 2, 1, 0, 'Shape'),
    parameter('gateInset', 'Gate inset', 0, .25, .005, .035, 'Shape'),
    parameter('gateRoundness', 'Gate corners', 0, 1, .01, .35, 'Shape'),
    parameter('sprockets', 'Sprocket holes', 0, 1, .01, 0, 'Material'),
    parameter('pullDown', 'Frame advance', 0, 1, .01, 0, 'Motion'),
    parameter('shutter', 'Projector shutter', 0, 1, .01, 0, 'Motion'),
    parameter('shutterBlades', 'Shutter blades', 1, 3, 1, 2, 'Motion'),
    parameter('reelLoops', 'Reel turns per loop', 0, 8, 1, 0, 'Motion'),
    parameter('frameLines', 'Frame lines', 0, 1, .01, 0, 'Material'),
    parameter('dust', 'Dust', 0, 1, .01, 0, 'Material'),
    parameter('hair', 'Gate hair', 0, 1, .01, 0, 'Material'),
    parameter('lightLeak', 'Light leaks', 0, 1, .01, 0, 'Material'),
    parameter('halation', 'Halation', 0, 1, .01, 0, 'Material'),
    parameter('vignette', 'Projector vignette', 0, 1, .01, 0, 'Material'),
    parameter('lensSoftness', 'Lens softness', 0, 1, .01, 0, 'Material'),
    parameter('colorFade', 'Color fading', 0, 1, .01, 0, 'Material'),
    { ...parameter('rollAmount', 'Rolling shutter', 0, 1, .01, 0, 'Motion'), description: 'Each band of the frame is exposed a little later than the one before, so moving paint breaks into steps.' },
    parameter('rollBands', 'Shutter bands', 4, 96, 1, 28, 'Motion'),
    { ...parameter('rollOrigin', 'Shutter from centre', 0, 1, .01, 1, 'Motion'), description: 'At 0 the exposure rolls from top to bottom; at 1 it spreads out from the centre line in both directions.' },
    { ...parameter('rollSmear', 'Band smear', 0, 1, .01, 0, 'Motion'), description: 'Horizontal streaks, slipped bands and light tears along band edges.' },
    parameter('substrate', 'Substrate', 0, 1, 1, 1, 'Material'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
  graphic: GRAPHIC_PARAMETERS,
  meridian: MERIDIAN_PARAMETERS.map(d => ({ ...d })),
  image: [
    parameter('mirror', 'Mirror', 0, 3, 1, 0, 'Shape'),
    parameter('repeat', 'Repeat', 1, 8, 1, 1, 'Shape'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
};

for(const kind of Object.keys(DEFINITIONS) as LayerKind[])DEFINITIONS[kind]=[...DEFINITIONS[kind],...FINISH_PARAMETERS.map(d=>({...d}))];

export function parameterDefinitions(kind: LayerKind): ParameterDefinition[] {
  return DEFINITIONS[kind].map((definition) => ({ ...definition }));
}

/**
 * The definitions themselves, not copies, for code that only reads them on every frame (evaluateLayer).
 * Never change what this returns.
 */
export function readParameterDefinitions(kind: LayerKind): readonly Readonly<ParameterDefinition>[] {
  return DEFINITIONS[kind];
}

const FRACTAL_ADDED_FIELDS = [
  'zoomFlight', 'approach', 'outside', 'variant', 'quality', 'density', 'juliaReal', 'juliaImag',
  'trap', 'boxScale', 'boxRadius', 'radial', 'roughness', 'lightAngle', 'exposure', 'lineWidth',
  'focalX', 'focalY', 'cutout', 'evolution', 'reveal', 'passage', 'depth', 'bank', 'position', 'autoTravel', 'afterglow',
];
const GRADING_FIELDS = ['saturation', 'hue', 'exposure'];
const ADDED_FIELDS: Partial<Record<LayerKind, string[]>> = {
  surface: [...TIMING_KEYS,'anisotropy','sheenAngle','iridescence', 'roundness', 'relief', 'variant', 'density', 'stretch', 'turbulence', 'centerX', 'centerY', 'lightAngle', 'roughness', ...GRADING_FIELDS],
  sculpture: ['spin', 'opening', 'twist', 'form', 'lobes', 'thickness', 'stretch', 'curl', 'foldFrequency', 'asymmetry', 'ridgeScale', 'metallic', 'clearcoat', 'sheen', 'filmScale', 'lightPower', 'shadowStrength', 'shadowSoftness', ...GRADING_FIELDS],
  fractal: [...FRACTAL_ADDED_FIELDS, 'colorMode', 'colorSteps', 'colorMix', 'saturation', 'hue'],
  super8: [...SUPER8_PROJECTOR_KEYS, ...SUPER8_ROLL_KEYS],
  oil: ['layout','dome','anisotropy','sheenAngle','caustics', 'iridescence', 'deformation', 'lensDepth', 'cellComplexity', 'dispersion'],
  scope: [SCOPE_MODE.key, ...EMBER_KEYS],
  graphic: [...TIMING_KEYS],
  meridian: MERIDIAN_PARAMETERS.map(d => d.key),
  image: ['mirror', 'repeat', ...GRADING_FIELDS],
};

// Saved parameters and routes stay complete when switching family. The inspector
// shows only controls consumed by that family, while validation and evaluation
// continue to use the complete instrument definition.
export function visibleParameterDefinitions(layer: Layer): ParameterDefinition[] {
  const visible = familyParameterDefinitions(layer);
  const glow = supportsGlow(layer), print = supportsPrint(layer);
  // Meridian has its own bloom and afterglow, so the shared glow and echo would fight them.
  if (layer.kind === 'meridian') return visible.filter(d => !GLOW_KEYS.includes(d.key) && !FEEDBACK_KEYS.includes(d.key));
  return glow && print ? visible : visible.filter(d => (glow || !GLOW_KEYS.includes(d.key)) && (print || !PRINT_KEYS.includes(d.key)));
}
function familyParameterDefinitions(layer: Layer): ParameterDefinition[] {
  const definitions = parameterDefinitions(layer.kind);
  if (layer.kind === 'graphic') {
    const keys = graphicVisibleKeys(layer.params.style, layer.params.variant, layer.params.fill, layer.params.sweep);
    return definitions.filter(d => keys.has(d.key)||FINISH_KEYS.includes(d.key));
  }
  if(layer.kind==='livingink'&&layer.params.inkMode===2){
    const keys=new Set(['ageColour','inkMode','simulationQuality','loopReturn','pigmentCarry','scale','motion','backgroundOpacity','flowDirection','travel','eddyScale','surfaceHole','pattern','branching','seedCoverage','development','relief','pigment','edgeInk','edgeSoftness','lightAngle','lightHeight','fillLight','roughness','anisotropy','sheenAngle','clearcoat','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d=>keys.has(d.key)).map(d=>d.key==='scale'?{...d,preparation:true}:d);
  }
  if(layer.kind==='glitchtunnel'){
    // Its echo is part of the instrument, so the Feedback finish is hidden,
    // and the area outside the box is always the tunnel, never a background.
    const own=new Set(INSTRUMENT_PARAMETERS.glitchtunnel.map(d=>d.key).filter(key=>!INSTRUMENT_UPGRADE_KEYS.glitchtunnel.includes(key)));
    own.delete('backgroundOpacity');own.add('phaseOffset');
    return definitions.filter(d=>(own.has(d.key)||FINISH_KEYS.includes(d.key))&&!FEEDBACK_KEYS.includes(d.key)&&(d.key!=='streakAxis'||(layer.params.streaks??0)>0));
  }
  if(layer.kind==='texturecuts'){
    const keys=new Set(['cuts','textureSet','scale','rotation','motion','cycles','phaseOffset','backgroundOpacity','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d=>keys.has(d.key));
  }
  if (layer.kind === 'relief' && layer.params.reliefMode === 2) {
    const keys = new Set(['reliefMode','scale','columns','opening','motion','cycles','phaseOffset','delaySpread','pause',
      'lightAngle','lightHeight','fillLight','shadow','roughness','clearcoat','backgroundOpacity','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d => keys.has(d.key)).map(d => d.key === 'columns' ? {...d, label:'Pleats'} : d);
  }
  if(layer.kind==='relief'&&layer.params.reliefMode===1){
    const keys=new Set([...TIMING_KEYS,'panelMix','reliefMode','scale','columns','gap','stagger','hingeBias','opening','depth','axis','phaseSpread','organic','motion','cycles','phrase','phaseOffset','lightAngle','lightHeight','fillLight','shadow','roughness','clearcoat','backgroundOpacity','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d=>keys.has(d.key));
  }
  if (layer.kind === 'scope') {
    return definitions.filter(d => scopeParameterVisible(layer.params, d.key)).map(d =>
      layer.params.scopeMode === 1 && d.key === 'afterglow' ? { ...d, advanced: true } : d);
  }
  if (layer.kind !== 'fractal') return definitions;
  const family = Math.round(layer.params.style ?? 0), variant = Math.round(layer.params.variant ?? 0);
  const familySpecific: Record<string, number[]> = {
    juliaReal: [1], juliaImag: [1], trap: [1],
    boxScale: [2], boxRadius: [2], radial: [2], roughness: [2], lightAngle: [2],
    lineWidth: [0, 1, 3], zoomFlight: [0, 1], approach: [2], outside: [1],
    morph: [0, 1, 2], reveal: [0, 1, 3], cutout: [0, 1, 3], passage: [2],
    depth: [2, 3], bank: [2, 3], position: [3], autoTravel: [3], afterglow: [3],
  };
  return definitions.filter((definition) => {
    if (definition.key === 'colorSteps') return layer.params.colorMode === 2;
    if (definition.key === 'colorMix') return layer.params.colorMode > 0;
    if (definition.key === 'symmetry') return family === 0 || family === 3 || (family === 1 && variant === 1) || (family === 2 && layer.params.radial > 0);
    if (definition.key === 'afterglow' && variant !== 2) return false;
    if (definition.key === 'cycles' && family === 3 && layer.params.autoTravel === 0) return false;
    return !familySpecific[definition.key] || familySpecific[definition.key].includes(family);
  });
}

function defaultParams(kind: LayerKind): Record<string, number> {
  return Object.fromEntries(DEFINITIONS[kind].map((definition) => [definition.key, definition.default]));
}

function preset(id: string, name: string, description: string, kind: Preset['kind'], palette: string[], params: Record<string, number>): Preset {
  return { id, name, description, kind, palette, params: { ...defaultParams(kind), ...(kind === 'super8' ? SUPER8_PROJECTOR_LOOK : kind === 'fractal' ? { evolution: FRACTAL_EVOLUTION } : {}), ...params } };
}

export const SUPER8_MODES = ['Chromatic Staircase', 'Paint Destruction', 'Scratched Negative', 'Cut-out Collage', 'Painted Tunnel'];

export const PRESETS: Preset[] = [
  ...INSTRUMENTS.flatMap(info => info.looks.map(look => preset(look.id, look.name, info.description, info.kind, look.palette ?? info.palette, look.params))),
  ...GRAPHIC_LOOKS.map(look => preset(look.id, look.name, look.description, 'graphic', look.palette, look.params)),
  preset('chromatic-staircase', 'Chromatic Staircase', 'Hand-painted terraces through a warm, softly flickering projector.', 'super8', SUPER8_PALETTE, { coverage: 1, scale: 0.5, steps: 10 }),
  preset('paint-destruction', 'Paint Destruction', 'Eroding pigment, dry brush strokes and decaying paint echoes.', 'super8', ['#e95a24', '#e8af25', '#245ba1', '#c22d53', '#17131d', '#e4cda8'], { mode: 1, texture: 0.95, roughness: 0.85, feedback: 0.65, travel: 0.65, scratches: 0.15, emulsion: .85, lightLeak: .4, halation: .5, dust: .4, frameLines: .3, colorFade: 0, bleed: 0.2, erosion: 0.45, coverage: 0.95 }),
  preset('scratched-negative', 'Scratched Negative', 'Inverted stepped forms scored by shifting film scratches.', 'super8', ['#f0b458', '#cc5262', '#528f8d', '#7864a6', '#10151c', '#e2dcc4'], { mode: 2, scratches: 0.85, grain: 0.45, flicker: 0.35, weave: 0.4, filmFps: 12, feedback: 0.24, erosion: 0.38, gateMode: 2, sprockets: .85, frameLines: .85, pullDown: .9, dust: .65, hair: .6, lightLeak: .12, vignette: .5, coverage: 1, scale: 0.5, rotation: -1.2, steps: 7 }),
  preset('cut-out-collage', 'Cut-out Collage', 'Layered painted paper fragments with torn edges and offset impressions.', 'super8', SUPER8_PALETTE, { mode: 3, steps: 8, erosion: 0.35, texture: 0.8, roughness: 0.7, feedback: 0.4, feedbackRotation: -0.06, filmFps: 12, travel: 0.55, gateMode: 1, gateInset: .025, frameLines: .35, emulsion: .35, lensSoftness: .3, colorFade: .3 }),
  preset('painted-tunnel', 'Painted Tunnel', 'Scanned paint arches rush through a rolling shutter and break into stepped terraces.', 'super8', ['#f6b21c', '#1e4fd6', '#f0521c', '#ec8fb0', '#1b1726', '#f2efe8'], { mode: 4, steps: 10, coverage: 0.9, erosion: 0.12, texture: 0.8, textureScale: 1.1, roughness: 0.45, bleed: 0.15, travel: 0.6, cycles: 2, filmFps: 24, feedback: 0, rotation: 0, scratches: 0.12, grain: 0.15, flicker: 0.08, weave: 0.08, rollAmount: 0.7, rollBands: 30, rollOrigin: 1, rollSmear: 0.55, emulsion: 0.12, pullDown: 0, shutter: 0, lightLeak: 0, halation: 0.12, vignette: 0.08, lensSoftness: 0.05, colorFade: 0, dust: 0.12, hair: 0 }),
  preset('ember-cells', 'Ember Cells', 'Red, orange and yellow oil droplets of every size drifting on black.', 'liquid', LIQUID_PALETTE, {}),
  preset('blue-hour', 'Blue Hour', 'Small red droplets and bright yellow floaters over deep blue.', 'liquid', ['#5a0018', '#ff1230', '#ff5a1e', '#ffee1a', '#1a1aff', '#0a0a8c'], { scale: 0.6, density: 0.12, crowding: 0, dimple: 0, floaters: 0.5, thickness: 0.6, farLayer: 0.3, farBlur: 1, rim: 0.2, drift: 0.5 }),
  preset('ring-dish', 'Ring Dish', 'Large dished droplets: glowing rings around dark centres, loosely scattered.', 'liquid', ['#5c0004', '#ff2a0a', '#ff8a00', '#fff03a', '#1a1aff', '#040001'], { scale: 1.5, sizeRange: 8, density: 0.2, crowding: 0.85, dimple: 1, floaters: 0, thickness: 1.15, farLayer: 0.35, farBlur: 1, rim: 0.8, outline: 0.7, warp: 0.7 }),
  preset('clock-glass', 'Clock Glass', 'A glass dome presses the dish: droplets under it swell and burn yellow, then ease back.', 'liquid', ['#6a0010', '#f01228', '#ff8c0a', '#fff25a', '#1a1aff', '#030004'], { press: 0.95, pressRadius: 0.46, pressPulse: 0.75, density: 0.75, thickness: 0.7, floaters: 0, crowding: 0.55, farLayer: 0.3 }),
  preset('magenta-marble', 'Magenta Marble', 'Folded sheets of magenta and violet dye with dark veins and a few stray droplets.', 'liquid', ['#3a0028', '#ff1436', '#ff6a00', '#ffe81a', '#e010c8', '#4418d8'], { wash: 1, vein: 0.5, scale: 0.9, density: 0.04, sizeRange: 10, crowding: 0, floaters: 0.1, farLayer: 0.35, farBlur: 0.3, thickness: 0.8, warp: 0.8, drift: 0.6 }),
  preset('molten-bloom', 'Molten Bloom', 'Droplets run together into scalloped yellow blobs ringed by satellites, over red and magenta dye.', 'liquid', ['#b01000', '#ff3a00', '#ffa000', '#fff01a', '#e0109a', '#c00818'], { merge: 0.95, scale: 1.7, sizeRange: 12, density: 0.95, thickness: 1.25, crowding: 0.5, wash: 0.7, vein: 0.3, floaters: 0.08, farLayer: 0.25, dimple: 0, rim: 0.6, warp: 0.8 }),
  preset('twin-orbit', 'Twin Orbit', 'A figure of eight opens into two ovals and folds shut again inside a ring.', 'scope', SCOPE_PALETTE, { figure: 1, ring: 0.9, drift: 1, tilt: 0.15, sway: 0.15 }),
  preset('atom', 'Atom', 'Three clean loops slip through one another around a common centre.', 'scope', ['#ff3060', '#ff1030', '#d00818', '#ffffff', '#ff60a0', '#000000'], { figure: 3, ring: 0.3, drift: 1, tumbleY: 1, tilt: 0.6, radius: 0.34, sway: 0.2 }),
  preset('ember-ring', 'Ember Ring', 'A single pink loop opens from a line to a circle, wrapped in a wide orange glow.', 'scope', ['#ff5a9a', '#ff7a00', '#ff5200', '#fff2e0', '#ffc400', '#000000'], { figure: 0, ring: 1, radius: 0.3, tilt: 0.5, drift: 1, overtones: 0.25, beamWidth: 3.6, intensity: 3.6, halo: 1.3, bloom: 1.8, bloomSize: 0.8, fringe: 0.25, hueDrift: 0.3, depthFade: 0.35 }),
  preset('cyan-tangle', 'Cyan Tangle', 'A dense weave of cyan line that never stops folding, with a white-hot core and a blue glow.', 'scope', ['#2ad8ff', '#1a90ff', '#1228ff', '#ffffff', '#40ffb4', '#000000'], { figure: 7, ring: 0, radius: 0.36, tilt: 0.4, drift: 1, tumbleY: 1, overtones: 0.3, wiggle: 0.1, wiggleFrequency: 64, wiggleBursts: 0.5, afterglow: 0.35, intensity: 1.5, halo: 0.9, bloom: 1.3, bloomSize: 0.45, fringe: 0.7, hueDrift: 0.35, depthFade: 0.75 }),
  preset('signal-burst', 'Signal Burst', 'A calm trace that breaks into bursts of signal, trailing light.', 'scope', ['#ff2aa8', '#b020ff', '#5a10e0', '#ffffff', '#ffb040', '#000000'], { figure: 0, figureB: 1, morph: 0.35, hold: 0.4, ring: 0.6, radius: 0.36, tilt: 0.3, drift: 1, sway: 0.3, wiggle: 0.7, wiggleFrequency: 30, wiggleBursts: 0.85, afterglow: 0.6, intensity: 2.4, halo: 1.1, bloom: 1.2, bloomSize: 0.55, fringe: 0.5, hueDrift: 0.5 }),
  preset('morse-sphere', 'Morse Weave', 'Bright dashes race round a knot that unfolds into a star and back.', 'scope', ['#7dff5a', '#18c060', '#087048', '#ffffff', '#e8ff40', '#000000'], { figure: 4, figureB: 6, morph: 1, hold: 0.5, ring: 0, radius: 0.36, tilt: 0.5, drift: 1, dash: 1, dashCount: 28, dashLength: 0.35, dashSpeed: 3, afterglow: 0.45, intensity: 1.7, halo: 1, bloom: 1.1, bloomSize: 0.4, fringe: 0.35, hueDrift: 0.4, depthFade: 0.7 }),
  ...EMBER_PALETTES.map(look => preset(look.id, look.name, 'Rolling smoke and outward-travelling filaments.', 'scope', look.palette, EMBER_BASE)),
  preset('acid-slide', 'Acid Slide', 'Fluorescent yellow paint, cellular black ink and a glossy lens over cyan.', 'oil', OIL_PALETTE, {}),
  preset('cobalt-tide', 'Cobalt Tide', 'Electric blue paint and coral ink flowing over luminous turquoise.', 'oil', ['#234dff', '#05bdf5', '#2b0927', '#42f2b4', '#111044', '#e7b4ff'], { layout: 1, travel: 0.38, relativeRotation: 0.65, drag: 0.78, coverage: 0.64, lensSize: 0.24, deformation: 0.85, cellComplexity: 0.85, dispersion: 0.35 }),
  preset('acrylic-pour', 'Acrylic Pour', 'Yellow paint poured over cyan, opening into laced cells that swell and close.', 'oil', ['#ffe600', '#ffc400', '#0a0a12', '#00b8ff', '#00508f', '#ffffff'], { layout: 1, dome: 0, coverage: 0.55, cellSize: 1.1, ink: 0.85, thickness: 0.7, travel: 0.18, relativeRotation: 0.1, wetness: 0.9 }),
  preset('lace-ribbons', 'Lace Ribbons', 'Hot pink ribbons run edge to edge over yellow, laced with dark threads.', 'oil', ['#ff2e93', '#ff5fc0', '#14020c', '#ffe600', '#7a4a00', '#ffffff'], { layout: 2, dome: 0, coverage: 0.5, poolSize: 1, cellSize: 0.8, filaments: 0.9, ink: 0.8, thickness: 0.6, travel: 0.22, relativeRotation: 0.05 }),
  preset('acid-tide', 'Acid Tide', 'Luminous cyan, lime and orchid flowing through broad liquid bands.', 'surface', DEFAULT_PALETTE, { style: 0, scale: 4, warp: 0.45, detail: 0.4, roundness: 0.65, relief: 0.62, softness: 0.25, contrast: 0.55, offset: 0.2, reveal: 0.1, delayShape: 0, delaySpread: 0.6, pause: 0.5 }),
  preset('solar-melt', 'Solar Melt', 'Hot amber, scarlet and magenta gathered into slow molten drips.', 'surface', SOLAR, { style: 2, scale: 3.4, warp: 0.6, detail: 0.28, roundness: 0.85, relief: 0.64, softness: 0.34, contrast: 0.57, rotation: -0.18, offset: 0.08, reveal: 0.14, delayShape: 0, delaySpread: 0.5, pause: 0.4 }),
  preset('citrine-braids', 'Citrine Braids', 'Interwoven liquid bands in luminous citrus, cyan and orchid.', 'surface', DEFAULT_PALETTE, { style: 0, variant: 1, scale: 5.4, warp: 0.28, roundness: 0.6, relief: 0.8, density: 0.8, stretch: 0.8, roughness: 0.24, delayShape: 0, delaySpread: 0.5, pause: 0.4 }),
  preset('ripple-glass', 'Ripple Glass', 'Concentric ripples in cyan, magenta and yellow.', 'surface', POP_PORTAL, { style: 1, variant: 1, scale: 4.5, warp: 0.2, roundness: 0.85, relief: 0.62, density: 0.85, roughness: 0.28, delayShape: 1, delaySpread: 0.8, pause: 0.6 }),
  preset('vortex-pool', 'Vortex Pool', 'A curling pool of contour lines in candy pink, cyan and yellow.', 'surface', CANDY, { style: 1, variant: 2, scale: 4, warp: 0.15, roundness: 0.8, relief: 0.8, density: 1.15, stretch: 0.8, roughness: 0.28, delayShape: 1, delaySpread: 0.5, pause: 0.3 }),
  preset('coral-beads', 'Coral Beads', 'Rounded molten beads in hot pink, orange and yellow.', 'surface', HOT_SIGNAL, { style: 2, variant: 1, scale: 4.2, warp: 0.5, roundness: 1, relief: 0.8, density: 0.85, roughness: 0.2, delayShape: 0, delaySpread: 0.6, pause: 0.3 }),
  preset('satin-strands', 'Satin Strands', 'Long glossy strands in amber, scarlet and magenta.', 'surface', SOLAR, { style: 2, variant: 2, scale: 4.5, warp: 0.25, roundness: 0.85, relief: 0.82, density: 0.8, stretch: 1.1, roughness: 0.2, delayShape: 0, delaySpread: 0.5, pause: 0.3 }),
  preset('pearl-organism', 'Candy Organism', 'A curled form with tucked folds, fine fluting and slow breathing.', 'sculpture', CANDY, { fold: 0.72, ridges: 0.58, opening: 0.62, twist: -0.25, breath: 0.4, roughness: 0.3, iridescence: 0.85, cameraPitch: 0.24, lightAngle: 0.5, spin: 1, zoom: 2.2, toonMix: 1, toonBands: 5, toonOutline: 2.5 }),
  preset('pearl-bloom', 'Hot Bloom', 'An open bloom with seven softly fluted petals.', 'sculpture', HOT_SIGNAL, { form: 1, fold: 0.5, ridges: 0.55, opening: 0.8, lobes: 7, thickness: 0.45, curl: 0.6, twist: 0.25, cameraPitch: 0.26, roughness: 0.32, iridescence: 0.75, metallic: 0.1, clearcoat: 0.8, shadowStrength: 0.45, shadowSoftness: 0.6, spin: -1, zoom: 2.2, toonMix: 1, toonBands: 5, toonOutline: 2.5 }),
  preset('chrome-dahlia', 'Chrome Dahlia', 'A tightly gathered dahlia with electric highlights and fine folds.', 'sculpture', ELECTRIC, { form: 1, fold: 0.7, ridges: 0.7, opening: 0.3, lobes: 11, thickness: 0.3, curl: 0.8, twist: -0.6, stretch: 0.95, cameraPitch: 0.2, roughness: 0.22, iridescence: 0.5, metallic: 0.65, clearcoat: 0.9, lightAngle: -0.45, shadowStrength: 0.45, shadowSoftness: 0.6, spin: 1, zoom: 2.2, toonMix: 1, toonBands: 5, toonOutline: 2.5 }),
  preset('aurora-ribbon', 'Aurora Ribbon', 'A broad asymmetric ribbon in lime and violet light.', 'sculpture', LIME_VIOLET, { form: 2, fold: 0.9, ridges: 0.8, opening: 0.1, twist: -1, lobes: 5, thickness: 0.7, curl: 0.9, asymmetry: 0.35, stretch: 0.75, foldFrequency: 1.4, cameraPitch: 0.6, cameraYaw: 0.4, roughness: 0.24, iridescence: 1, filmScale: 1.45, metallic: 0.45, clearcoat: 0.9, lightAngle: -0.8, saturation: 1.25, shadowStrength: 0.45, shadowSoftness: 0.6, spin: -1, zoom: 2.2, toonMix: 1, toonBands: 5, toonOutline: 2.5 }),
  preset('liquid-trefoil', 'Liquid Trefoil', 'A smooth looping knot in cyan, magenta and yellow.', 'sculpture', POP_PORTAL, { form: 3, fold: 0.2, ridges: 0.3, opening: 0.55, twist: 0.4, thickness: 0.65, cameraPitch: 0.3, roughness: 0.23, iridescence: 0.62, metallic: 0.45, clearcoat: 0.9, lightAngle: 0.35, shadowStrength: 0.45, shadowSoftness: 0.6, spin: 1, zoom: 2.2, toonMix: 1, toonBands: 5, toonOutline: 2.5 }),
  preset('prismatic-fold', 'Prismatic Fold', 'Luminous folded geometry arranged into a shifting neon kaleidoscope.', 'fractal', FRACTAL_PALETTE, { style: 0, zoom: 1.17, detail: .65, reveal: .38 }),
  preset('velvet-petals', 'Hot Petals', 'Overlapping petals in hot pink, orange and yellow.', 'fractal', HOT_SIGNAL, { style: 0, variant: 1, scale: 1.8, detail: 0.48, fold: 0.64, symmetry: 8, twist: -0.12, morph: 0.1, travel: 0.18, relief: 0.52, glow: 0.25, density: 0.8, lineWidth: 1.15, zoom: 1.24, reveal: .54 }),
  preset('luminous-weave', 'Luminous Weave', 'Fine interlocking ribbons in electric cyan, blue and violet.', 'fractal', ELECTRIC, { style: 0, variant: 2, scale: 2.2, detail: 0.7, fold: 0.4, symmetry: 6, twist: 0.34, morph: 0.1, travel: 0.3, density: 1.2, lineWidth: 0.8, relief: 0.58, glow: 0.18, zoom: 1.19, reveal: .28 }),
  preset('velvet-julia', 'Lime Julia', 'Intricate Julia filigree in lime, green and cyan.', 'fractal', ['#c6ff00', '#5cff5c', '#00ff9c', '#00e5ff', '#9cff2e', '#04120a'], { style: 1, variant: 0, scale: 1.55, detail: 0.7, fold: 0.42, twist: -0.16, morph: 0.07, travel: 0.08, offset: 0.32, relief: 0.52, glow: 0.16, contrast: 0.5, cameraPitch: 0.12, juliaReal: -0.74543, juliaImag: 0.11301, density: 0.9, trap: 0.55, zoom: 1.46, outside: 0.49 }),
  preset('coral-mandala', 'Coral Mandala', 'Radial Julia branches gathered into an amber, scarlet and magenta mandala.', 'fractal', SOLAR, { style: 1, variant: 1, scale: 1.65, detail: 0.75, fold: 0.45, symmetry: 8, twist: 0.08, morph: 0.08, travel: 0.1, offset: 0.12, relief: 0.42, glow: 0.14, contrast: 0.52, juliaReal: -0.4, juliaImag: 0.6, density: 0.75, trap: 0.62, lineWidth: 1.1, exposure: 1.25, zoom: 1.8, zoomFlight: 0.5 }),
  preset('spiral-garden', 'Spiral Garden', 'Curling Julia tendrils in hot pink, orange and yellow.', 'fractal', ['#ff2e93', '#ff5a1f', '#ffcc00', '#ff4fd8', '#ff8a00', '#14020c'], { style: 1, variant: 2, scale: 1.75, detail: 0.8, fold: 0.55, twist: 0.16, morph: 0.06, travel: 0.08, offset: 0.2, relief: 0.5, glow: 0.12, contrast: 0.55, juliaReal: -0.70176, juliaImag: -0.3842, density: 1.15, trap: 0.48, lineWidth: 0.9, exposure: 1.3, zoom: 1.6, zoomFlight: 0.4, outside: 0.6 }),
  preset('abyssal-cathedral', 'Abyssal Cathedral', 'Folded architecture in cyan light with yellow edges.', 'fractal', CYAN_YELLOW, { style: 2, variant: 0, scale: 1.9, detail: 0.42, fold: 0, twist: 0.08, morph: 0.08, travel: 0.18, offset: 0.02, relief: 0.98, glow: 0.06, contrast: 0.5, cameraYaw: 0.65, cameraPitch: 0.35, boxScale: 2.2, boxRadius: 0.35, roughness: 0.42, density: 0.55, exposure: 1.15, lightAngle: -0.7, approach: 0.7 }),
  preset('ivory-vault', 'Candy Vault', 'Smooth sphere folds in candy pink, cyan and yellow.', 'fractal', CANDY, { style: 2, variant: 1, scale: 1.85, detail: 0.32, fold: 0.12, twist: -0.08, morph: 0.06, travel: 0.08, relief: 0.96, glow: 0.04, contrast: 0.5, cameraYaw: 0.55, cameraPitch: 0.32, boxScale: 1.85, boxRadius: 0.4, roughness: 0.55, density: 0.8, lightAngle: -0.45, exposure: 1.15, approach: 0.7 }),
  preset('chromatic-lattice', 'Chromatic Lattice', 'Open recursive lattice with crisp neon edges.', 'fractal', NEON_STRATA, { style: 2, variant: 2, scale: 2, detail: 0.42, fold: 0, twist: 0.08, morph: 0.08, travel: 0.08, relief: 0.98, glow: 0.05, contrast: 0.5, cameraYaw: -0.35, cameraPitch: 0.3, boxScale: 2.2, boxRadius: 0.35, roughness: 0.32, density: 0.8, lightAngle: -0.8, exposure: 1.15, approach: 0.6 }),
  preset('ink-lace', 'Ink Lace', 'Fine recursive lace in cyan and yellow on black.', 'fractal', CYAN_YELLOW, { style: 0, variant: 0, colorMode: 1, colorMix: 0.8, scale: 1.9, detail: 0.65, symmetry: 8, fold: 0.5, lineWidth: 0.85, relief: 0.5, glow: 0.12, contrast: 0.48, density: 0.8, zoom: 1.25, reveal: .25 }),
  preset('ember-julia', 'Ember Julia', 'Julia filigree mapped into crisp amber, scarlet and magenta contour bands.', 'fractal', SOLAR, { style: 1, variant: 0, colorMode: 2, colorSteps: 8, colorMix: 0.8, scale: 1.55, detail: 0.7, fold: 0.42, twist: -0.16, morph: 0.07, travel: 0.08, offset: 0.12, relief: 0.52, glow: 0.16, contrast: 0.5, cameraPitch: 0.12, juliaReal: -0.74543, juliaImag: 0.11301, density: 0.9, trap: 0.55, zoom: 1.5, outside: 0.48 }),
  preset('unfolding-rose', 'Unfolding Rose', 'Scarlet and acid-green lace reorganises into successive petals and inner rosettes.', 'fractal',
    ['#ffbf3a', '#f83659', '#f332ab', '#7134ed', '#58d943', '#130820'],
    { style: 0, variant: 1, scale: 2.19, symmetry: 8, fold: .54, detail: .52, twist: -.12, morph: .16, travel: .05, relief: .68, glow: .26, lineWidth: 1.48, zoom: 1.12, reveal: .94, cutout: 1, density: 1.34, exposure: 1.31 }),
  preset('electric-coast', 'Electric Coast', 'Cyan and ultramarine light runs along branching Julia contours.', 'fractal',
    ['#a2fff0', '#16e2ef', '#3269ee', '#b388ff', '#d3f9fc', '#05162a'],
    { style: 1, variant: 2, scale: 1.41, detail: .68, fold: .58, twist: .17, morph: .025, travel: .12, offset: .27, relief: .36, glow: .36, contrast: .53, juliaReal: -.70176, juliaImag: -.3842, trap: .68, lineWidth: 1.65, zoom: 1.44, zoomFlight: .36, outside: .14, reveal: .92, cutout: 1, exposure: 1.65 }),
  preset('cathedral-passage', 'Cathedral Passage', 'A held view of a folded vault gives way to a close approach through bands of amber and teal light.', 'fractal',
    ['#46d9ce', '#115668', '#3b2272', '#ba5c37', '#ffc765', '#f5dfad'],
    { style: 2, variant: 1, scale: 1.8, detail: .52, fold: .09, twist: .035, morph: .015, travel: .1, offset: .32, relief: .96, glow: .28, cameraYaw: .16, cameraPitch: .21, zoom: .91, boxScale: 2.12, boxRadius: .37, roughness: .32, density: .76, lightAngle: -.85, exposure: 1.35, passage: 1, depth: .74 }),
  preset('neon-passage', 'Neon Passage', 'Twin streams of neon beads accelerate into a single luminous throat.', 'fractal',
    ['#85fff8', '#1857ff', '#8332ff', '#fa184e', '#ff9b1a', '#b9fa32'],
    { style: 3, variant: 0, scale: 1.46, symmetry: 8, fold: .7, detail: .6, travel: .29, twist: .37, depth: .76, reveal: .56, density: .85, lineWidth: 1.16, cutout: 1, glow: .44, relief: .64, exposure: 1.23 }),
  preset('glass-spiral', 'Glass Spiral', 'A small disc of coloured fans grows into the next full mosaic.', 'fractal',
    ['#f4b72e', '#ee493a', '#c2251d', '#1d68e8', '#12c8c2', '#19a176'],
    { style: 3, variant: 1, scale: 1.54, symmetry: 7, fold: .62, detail: .48, travel: .04, twist: .58, depth: .42, reveal: .81, density: .86, lineWidth: .91, cutout: 1, glow: .13, relief: .68, exposure: 1.16 }),
  preset('afterlight', 'Afterlight', 'An upright beam carries expanding crowns and a second bloom below.', 'fractal',
    ['#ffe5a5', '#ff855c', '#db4f9c', '#534de4', '#3ee7da', '#8bdfdc'],
    { style: 3, variant: 2, scale: 1.34, symmetry: 10, fold: .55, detail: .7, travel: .09, twist: -.11, offset: .015, depth: .62, reveal: .92, afterglow: .86, density: .74, lineWidth: 1.27, cutout: 1, glow: .55, relief: .55, exposure: 1.28 }),
];


// Flat colour & outlines: saturated palettes, hard bands and constant-width
// contour lines for cartoon-style projection mapping. Motion comes from the
// source field; palette cycling is left to the artist because it switches the
// colour of whole flat areas at once.
export const FLAT_LOOK_IDS = ['neon-strata', 'acid-drip', 'pop-portal', 'contour-pop', 'pour-lace'];
PRESETS.push(
  preset('neon-strata', 'Neon Strata', 'Saturated strata flow through black-lined bands.', 'surface', NEON_STRATA, { style: 0, variant: 0, scale: 3.2, warp: 0.55, detail: 0.35, roundness: 0.7, relief: 0, softness: 0, contrast: 0.7, offset: 0.2, reveal: 0, toonMix: 1, toonBands: 6, toonOutline: 4, delayShape: 2, delaySpread: 0.7, pause: 0.5 }),
  preset('acid-drip', 'Acid Drip', 'Acid colour melts downward in outlined drips.', 'surface', ACID_DRIP, { style: 2, variant: 0, scale: 3, warp: 0.5, detail: 0.25, roundness: 0.9, relief: 0, softness: 0, contrast: 0.75, offset: 0.1, reveal: 0, toonMix: 1, toonBands: 5, toonOutline: 5, delayShape: 1, delaySpread: 0.35, pause: 0.35 }),
  preset('pop-portal', 'Pop Portal', 'Concentric neon rings pull inward through a portal.', 'surface', POP_PORTAL, { style: 3, variant: 0, scale: 4.5, warp: 0.3, roundness: 0.8, relief: 0, density: 1.2, contrast: 0.7, reveal: 0, toonMix: 1, toonBands: 8, toonOutline: 3, toonOutlineColor: 6, delayShape: 1, delaySpread: 0.5, pause: 0.4 }),
  preset('contour-pop', 'Contour Pop', 'Terraced contours as flat poster colour.', 'surface', NEON_STRATA, { style: 1, variant: 0, scale: 3.6, warp: 0.35, roundness: 0.75, relief: 0, density: 1, contrast: 0.7, reveal: 0, toonMix: 1, toonBands: 7, toonOutline: 3, delayShape: 1, delaySpread: 0.6, pause: 0.5 }),
  preset('pour-lace', 'Pour Lace', 'Acrylic-pour yellow and cyan with dark lacing.', 'surface', POUR, { style: 0, variant: 1, scale: 2.6, warp: 0.8, detail: 0.6, turbulence: 0.35, roundness: 0.85, relief: 0, softness: 0, contrast: 0.75, reveal: 0, toonMix: 1, toonBands: 4, toonSoftness: 0.05, toonOutline: 2.5, delayShape: 0, delaySpread: 0.4, pause: 0.3 }),
);

PRESETS.push(...MERIDIAN_LOOKS.map(look => preset(look.id, look.name, look.description, 'meridian', look.palette, { colourPalette: 0, colourPeakPalette: 0, ...look.params })));

/** Two Surface showcases for the feedback and time-displacement finishes. */
export const FINISH_SHOWCASE_IDS = ['recursion-tunnel', 'time-terraces'];
PRESETS.push(
  preset('recursion-tunnel', 'Recursion Tunnel', 'Flat neon frames nest inside each other and turn into the distance.', 'surface', NEON_STRATA, { style: 0, variant: 0, scale: 3.2, warp: 0.55, detail: 0.35, roundness: 0.7, relief: 0, softness: 0, contrast: 0.7, offset: 0.2, reveal: 0, toonMix: 1, toonBands: 6, toonOutline: 3, echo: 0.95, echoZoom: 0.9, echoRotate: 1.5, echoHue: 6, echoFrame: 0.62, echoBlend: 1 }),
  preset('time-terraces', 'Time Terraces', 'Neon strata cut into horizontal terraces, each a moment further in the past.', 'surface', NEON_STRATA, { style: 0, variant: 0, scale: 3.2, warp: 0.55, detail: 0.35, roundness: 0.7, relief: 0, softness: 0, contrast: 0.7, offset: 0.2, reveal: 0, toonMix: 1, toonBands: 6, toonOutline: 3, cycles: 4, slitShift: 1, slitSpan: 60, slitShape: 0, slitSlices: 9 }),
);

/**
 * Finish presets set only the feedback, time-displacement and glow controls, so they
 * apply to the selected layer of any kind that supports them. Applying one
 * resets the other finish controls, so finishes replace each other.
 */
export interface FinishLook { id: string; name: string; description: string; params: Record<string, number> }
export const FINISH_LOOKS: FinishLook[] = [
  { id: 'finish-none', name: 'No finish', description: 'Turns feedback, time displacement, glow and print screen off.', params: {} },
  { id: 'finish-tunnel', name: 'Tunnel', description: 'The layer becomes a frame that nests inside itself and turns into the distance. Best on full-frame sources.', params: { echo: 0.95, echoZoom: 0.9, echoRotate: 1.5, echoHue: 6, echoFrame: 0.62, echoBlend: 1 } },
  { id: 'finish-bloom-echo', name: 'Bloom Echo', description: 'A centre window streams outward, leaving colour-shifted echoes.', params: { echo: 0.85, echoZoom: 1.035, echoRotate: -1, echoHue: 9, echoBlend: 2, echoWindow: 0.35 } },
  { id: 'finish-glitch-tunnel', name: 'Glitch Tunnel', description: 'A centre window streams outward in stepped rings that streak, break into blocks and crunch into primary colour.', params: { echo: 1, echoBlend: 1, echoEdge: 0.6, echoWindow: 0.5, echoSquare: 0.7, echoRound: 0.25, echoZoom: 1.05, echoLens: 0.15, echoStreak: 0.4, echoStreakAxis: 1, echoBlock: 8, echoCrush: 0.7, echoHue: 12, echoSlip: 0.25 } },
  { id: 'finish-melt', name: 'Melt', description: 'Echoes slide downward and melt along their own slopes.', params: { echo: 0.9, echoZoom: 1, echoDriftY: -0.006, echoMelt: 0.7, echoHue: -4 } },
  { id: 'finish-terraces', name: 'Terraces', description: 'Horizontal bands, each a moment further in the past.', params: { slitShift: 1, slitSpan: 60, slitShape: 0, slitSlices: 9 } },
  { id: 'finish-block-shuffle', name: 'Block Shuffle', description: 'Blocks that each run at their own delay.', params: { slitShift: 1, slitSpan: 90, slitShape: 4, slitSlices: 8, slitBlocks: 5 } },
  { id: 'finish-ring-delay', name: 'Ring Delay', description: 'Rings lag outward in smooth waves while the delay sweeps once per loop.', params: { slitShift: 1, slitSpan: 60, slitShape: 2, slitSlices: 16, slitSmooth: 1, slitScroll: 1 } },
  { id: 'finish-soft-glow', name: 'Soft Glow', description: 'Bright areas spill a gentle halo.', params: { glowMix: 0.8, glowThreshold: 0.6, glowSize: 0.4 } },
  { id: 'finish-dream-haze', name: 'Dream Haze', description: 'The whole layer swims in a wide, soft haze.', params: { glowMix: 1.2, glowThreshold: 0.15, glowSize: 0.9 } },
  { id: 'finish-hot-highlights', name: 'Hot Highlights', description: 'Only the hottest points flare, tight and strong.', params: { glowMix: 1.5, glowThreshold: 0.8, glowSize: 0.2 } },
  { id: 'finish-glowing-trails', name: 'Glowing Trails', description: "Bloom Echo's outward trails, each one glowing.", params: { echo: 0.85, echoZoom: 1.035, echoRotate: -1, echoHue: 9, echoBlend: 2, echoWindow: 0.35, glowMix: 0.9, glowThreshold: 0.5, glowSize: 0.6 } },
  { id: 'finish-halftone', name: 'Halftone', description: 'Round dots in the layer\'s own colour, the screen at 45°.', params: { printMix: 1, printType: 0, printSize: 8, printAngle: 45 } },
  { id: 'finish-fine-halftone', name: 'Fine Halftone', description: 'Small classic dots that join into a checkerboard in the midtones.', params: { printMix: 1, printDot: 1, printSize: 4, printAngle: 45 } },
  { id: 'finish-engraving', name: 'Engraving', description: 'Parallel lines that swell in the light and thin in the dark.', params: { printMix: 1, printType: 1, printSize: 6, printAngle: 30 } },
  { id: 'finish-comic-process', name: 'Comic Process', description: 'Four ink screens overprinted at their classic angles.', params: { printMix: 1, printSize: 7, printColour: 3 } },
  { id: 'finish-rgb-raster', name: 'RGB Raster', description: 'Red, green and blue dot screens that add up to the layer\'s colour.', params: { printMix: 1, printSize: 9, printColour: 2 } },
  { id: 'finish-bitmap-dither', name: 'Bitmap Dither', description: 'Hard square cells in an 8×8 ordered dither.', params: { printMix: 1, printType: 2, printSize: 3, printMatrix: 2, printAngle: 0 } },
  { id: 'finish-halftone-edges', name: 'Halftone Edges', description: 'Dots only along the layer\'s edges; the rest stays smooth.', params: { printMix: 1, printSize: 8, printAngle: 45, printArea: 1, printEdgeWidth: 16 } },
];
const FINISH_LOOK_KEYS = [...FEEDBACK_KEYS, ...SLIT_KEYS, ...GLOW_KEYS, ...PRINT_KEYS];
/** Whether the layer takes finishes at all or, with an id, that finish: glow
 * and print looks need a layer that supports them. */
export function finishSupported(layer: Pick<Layer, 'kind' | 'params'>, finishId?: string): boolean {
  if (!supportsFeedback(layer) || !supportsSlitScan(layer)) return false;
  const look = FINISH_LOOKS.find(item => item.id === finishId);
  if (!look) return true;
  return (supportsGlow(layer) || !GLOW_KEYS.some(key => key in look.params)) && (supportsPrint(layer) || !PRINT_KEYS.some(key => key in look.params));
}
export function applyFinish(layer: Layer, finishId: string): Layer {
  const look = FINISH_LOOKS.find(item => item.id === finishId);
  if (!look) throw new Error(`Unknown finish: ${finishId}`);
  if (!finishSupported(layer, finishId)) throw new Error(`${look.name} cannot be applied to this layer.`);
  const next = structuredClone(layer), defaults = parameterDefinitions(layer.kind);
  for (const key of FINISH_LOOK_KEYS) { next.params[key] = defaults.find(d => d.key === key)!.default; delete next.modulations[key]; }
  Object.assign(next.params, look.params);
  return next;
}

/** Retired effect families; their layers are dropped when an older project is opened. */
export const RETIRED_KINDS: readonly string[] = ['caustic', 'magnetic', 'loom', 'reef', 'prism', 'veils', 'currents'];
export function createLayer(kind: LayerKind): Layer {
  if (!(kind in DEFINITIONS)) throw new Error(`Unknown layer kind: ${String(kind)}`);
  return {
    id: crypto.randomUUID(),
    name: INSTRUMENTS.find(i=>i.kind===kind)?.name ?? (kind === 'surface' ? 'Chromatic Field' : kind === 'sculpture' ? 'Pearl Sculpture' : kind === 'fractal' ? 'Prismatic Fractal' : kind === 'oil' ? 'Oil Slides' : kind === 'liquid' ? 'Liquid Light' : kind === 'scope' ? 'Oscilloscope' : kind === 'meridian' ? 'Meridian' : kind === 'super8' ? 'Super 8 Paint' : kind === 'graphic' ? 'Graphic Patterns' : 'Image'),
    kind, visible: true, opacity: 1, blend: 'normal',
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    mask: { kind: 'none', softness: 0.15, invert: false, size: 0.8 },
    params: { ...defaultParams(kind), ...(isInstrument(kind) ? INSTRUMENTS.find(i=>i.kind===kind)!.looks[0].params : kind === 'graphic' ? GRAPHIC_LOOKS[0].params : kind === 'super8' ? SUPER8_PROJECTOR_LOOK : kind === 'fractal' ? { evolution: FRACTAL_EVOLUTION } : {}), seed: 1729 },
    palette: [...(isInstrument(kind) ? (INSTRUMENTS.find(i=>i.kind===kind)!.looks[0].palette ?? INSTRUMENTS.find(i=>i.kind===kind)!.palette) : kind === 'sculpture' ? SCULPTURE_PALETTE : kind === 'fractal' ? FRACTAL_PALETTE : kind === 'oil' ? OIL_PALETTE : kind === 'liquid' ? LIQUID_PALETTE : kind === 'scope' ? SCOPE_PALETTE : kind === 'meridian' ? MERIDIAN_PALETTE : kind === 'super8' ? SUPER8_PALETTE : kind === 'graphic' ? GRAPHIC_LOOKS[0].palette : DEFAULT_PALETTE)], modulations: {},
  };
}

export function createProject(): Project {
  return {
    schemaVersion: 1, id: crypto.randomUUID(), name: 'Untitled composition', seed: 1729,
    duration: 10, fps: { num: 30, den: 1 }, width: 3840, height: 2160,
    background: '#100d1c', transparent: false,
    layers: [applyPreset(createLayer('surface'), 'acid-tide')],
  };
}

export function applyPreset(layer: Layer, presetId: string): Layer {
  const selected = PRESETS.find((item) => item.id === presetId);
  if (!selected) throw new Error(`Unknown preset: ${presetId}`);
  if (selected.kind !== layer.kind) throw new Error(`Preset ${selected.name} requires a ${selected.kind} layer.`);
  return {
    ...structuredClone(layer), name: selected.name, palette: [...selected.palette],
    params: selected.kind === 'meridian' ? meridianPresetParams(selected, layer) : { ...selected.params, seed: layer.params.seed ?? 1729 }, modulations: {},
  };
}

/** A Meridian preset is its composition, so it brings its own seed. The performer's seed bank stays. */
function meridianPresetParams(preset: Preset, layer: Layer): Record<string, number> {
  const params = { ...preset.params };
  for (let slot = 0; slot < 8; slot++) params[`seedSlot${slot}`] = layer.params[`seedSlot${slot}`] ?? 0;
  return params;
}

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampParameter(value: number, definition: ParameterDefinition): number {
  const clamped = Math.max(definition.min, Math.min(definition.max, value));
  return definition.step === 1 ? Math.round(clamped) || 0 : clamped;
}

// Identity, coverage and Julia topology are deliberate composition choices.
const VARIATION_FIXED = new Set([...MERIDIAN_FIXED, 'scopeMode','emberPhrases','simulationQuality','flowMode','inkMode','reliefMode','phrase','surfaceHole','style', 'variant', 'form', 'mode', 'colorMode', 'mirror', 'repeat', 'substrate', 'profile', 'fill', 'sweep', 'corners', 'quality', 'gateMode', 'gateInset', 'gateRoundness', 'backgroundOpacity', 'centerX', 'centerY', 'cycles', 'turns', 'reelLoops', 'shutterBlades', 'juliaReal', 'juliaImag', 'pattern', 'axis', 'phaseOffset']);
export type VariationLocks = { palette: boolean; structure: boolean; motion: boolean; material: boolean };

/** Deterministic by default; UI entropy is independent of the locked film seed. */
export function varyLayer(layer: Layer, strength: number, locks: VariationLocks, entropy?: number): Layer {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('Variation strength must be between 0 and 1.');
  const result = structuredClone(layer);
  if (strength === 0) return result;
  const oldSeed = layer.params.seed ?? hashSeed(layer.id);
  const nextSeed = (Math.imul((entropy ?? oldSeed) >>> 0, 1664525) + 1013904223) >>> 0;
  const random = seededRandom(nextSeed);
  // Noise routes share the source seed; either lock must therefore hold it.
  result.params.seed = locks.structure || locks.motion ? oldSeed : nextSeed;
  const definitions = visibleParameterDefinitions(layer);
  const kindPresets = PRESETS.filter(p => p.kind === layer.kind &&
    (layer.kind !== 'scope' || p.params.scopeMode === (layer.params.scopeMode ?? 0)));
  const recipes = kindPresets.filter(p =>
    [...VARIATION_FIXED].every(key => !(key in p.params) || !(key in layer.params) ||
      !['flowMode','inkMode','reliefMode','style','variant','form','mode','colorMode','profile','fill','sweep','pattern','axis'].includes(key) || p.params[key] === layer.params[key]));
  // Stay near the closest authored structure, rather than walking every slider
  // towards an extreme after repeated clicks. One recipe drives the whole look.
  const distance = (p: Preset) => definitions.filter(d => d.section === 'Shape' && !VARIATION_FIXED.has(d.key))
    .reduce((n,d) => n + ((layer.params[d.key] - p.params[d.key]) / (d.max-d.min)) ** 2, 0);
  const anchor = recipes.sort((a,b) => distance(a)-distance(b))[0];
  const character = { Shape: random()*2-1, Material: random()*2-1, Motion: random()*2-1, Camera: random()*2-1 };
  for (const d of definitions) {
    const key = d.key, original = layer.params[key];
    const locked = d.section === 'Motion' ? locks.motion : d.section === 'Material' ? locks.material : locks.structure;
    if (locked || VARIATION_FIXED.has(key) || d.momentary || d.structural || layer.kind === 'fractal' && ['focalX', 'focalY', 'cutout', 'autoTravel', 'position', 'passage', 'reveal'].includes(key) || (locks.palette && ['hue','saturation','vibrance'].includes(key))) continue;
    // Preserve artist-authored routes and their baseline values as a unit.
    // Flat colour is an explicit choice: never switch it on, change its palette
    // cycling (which can strobe), or vary its controls while it is off.
    if (TOON_KEYS.includes(key) && (key === 'toonMix' || key === 'toonCycles' || !(layer.params.toonMix > 0))) continue;
    // Feedback is likewise an explicit choice, and its blend and frame are structural.
    if (SLIT_KEYS.includes(key) && (['slitShift', 'slitShape', 'slitScroll', 'slitSlices'].includes(key) || !((layer.params.slitShift ?? 0) !== 0))) continue;
    if (FEEDBACK_KEYS.includes(key) && (['echo', 'echoBlend', 'echoFrame', 'echoWindow', 'echoStreakAxis', 'echoKeep'].includes(key) || !(layer.params.echo > 0))) continue;
    // Glow too: never switch it on or off or change its colour, and keep its
    // threshold and size near where the artist set them, not near the recipe's.
    const glow = GLOW_KEYS.includes(key);
    if (glow && (key === 'glowMix' || key === 'glowTint' || !((layer.params.glowMix ?? 0) > 0))) continue;
    // Print screen likewise: never switch it, never change a stepped choice or
    // its travel, and keep its continuous controls near the artist's values.
    const print = PRINT_KEYS.includes(key);
    if (print && (key === 'printMix' || d.step === 1 || !((layer.params.printMix ?? 0) > 0))) continue;
    if (layer.modulations[key] || key==='tonePivot' || key==='warpScale'&&layer.params.warp===0 || key==='sheenAngle'&&layer.params.anisotropy===0) continue;
    const span = d.max-d.min;
    const personality = character[d.section] * .7 + (random()*2-1) * .3;
    const factor = key === 'angularStep' ? .003 : d.section === 'Camera' ? .035 :
      ['spacing','boxScale','boxRadius'].includes(key) ? .035 : .12;
    let target = (glow || print ? original : anchor?.params[key] ?? d.default) + personality * span * factor;
    // Practical film cadences, chosen once for the whole effect.
    if (key === 'filmFps') target = [12,18,24][Math.floor(random()*3)];
    result.params[key] = clampParameter(original + (target-original)*strength, d);
  }
  if (!locks.palette) {
    const palettes = kindPresets;
    if (palettes.length) {
      // Select a complete authored palette: cross-fading unrelated swatches can
      // erase contrast and produce muddy colours after repeated variations.
      const alternatives = palettes.filter(p => p.palette.some((c,i) => c !== layer.palette[i]));
      const choices = alternatives.length ? alternatives : palettes;
      result.palette = [...choices[Math.floor(random()*choices.length)].palette];
    }
  }
  return result;
}

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
function fail(path: string, reason: string): never { throw new Error(`Invalid project: ${path} ${reason}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(path, 'must be an object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not supported by schema version 1.');
}
function text(value: unknown, path: string, max = 120): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path, `must be nonempty text of at most ${max} characters.`);
  return value;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, `must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be true or false.');
  return value;
}
function choice<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(path, `must be one of: ${options.join(', ')}.`);
  return value as T;
}
function hex(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(path, 'must be a six-digit hex color.');
  return value;
}

function jpegOrientation(binary: string, start: number, end: number, path: string): number | undefined {
  if (binary.slice(start, start + 6) !== 'Exif\0\0') return undefined;
  const base = start + 6; const size = end - base;
  const failExif = (): never => fail(path, 'contains invalid or truncated JPEG EXIF orientation metadata.');
  const within = (offset: number, bytes: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > size - bytes) failExif();
  };
  within(0, 8);
  const order = binary.slice(base, base + 2);
  if (order !== 'II' && order !== 'MM') failExif();
  const little = order === 'II';
  const read16 = (offset: number) => {
    within(offset, 2);
    const a = binary.charCodeAt(base + offset); const b = binary.charCodeAt(base + offset + 1);
    return little ? a + b * 256 : a * 256 + b;
  };
  const read32 = (offset: number) => {
    within(offset, 4);
    return little ? read16(offset) + read16(offset + 2) * 65536 : read16(offset) * 65536 + read16(offset + 2);
  };
  if (read16(2) !== 42) failExif();
  const directory = read32(4);
  if (directory < 8) failExif();
  const entries = read16(directory);
  within(directory + 2, entries * 12 + 4);
  let orientation: number | undefined;
  for (let i = 0; i < entries; i++) {
    const entry = directory + 2 + i * 12;
    if (read16(entry) !== 0x0112) continue;
    // The primary-image Orientation tag is exactly one inline TIFF SHORT.
    if (read16(entry + 2) !== 3 || read32(entry + 4) !== 1) failExif();
    const value = read16(entry + 8);
    if (value < 1 || value > 8 || (orientation !== undefined && orientation !== value)) failExif();
    orientation = value;
  }
  return orientation;
}

function imageAsset(value: unknown, path: string): { dataUrl: string; width: number; height: number } {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 64) fail(path, 'must be a PNG, JPEG or still WebP data URL of at most 20 MiB.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) fail(path, 'must be a base64 PNG, JPEG or still WebP data URL.');
  let binary: string;
  try { binary = atob(match[2]); } catch { fail(path, 'contains invalid base64 data.'); }
  if (binary.length > MAX_ASSET_BYTES) fail(path, 'exceeds the 20 MiB asset limit.');
  const byte = (index: number) => binary.charCodeAt(index);
  const u16 = (offset: number) => byte(offset) * 256 + byte(offset + 1);
  const u32 = (offset: number) => (byte(offset) * 16777216 + byte(offset + 1) * 65536 + byte(offset + 2) * 256 + byte(offset + 3));
  const little32 = (offset: number) => byte(offset) + byte(offset + 1) * 256 + byte(offset + 2) * 65536 + byte(offset + 3) * 16777216;
  let width = 0; let height = 0;
  if (match[1] === 'png') {
    if (binary.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || binary.slice(12, 16) !== 'IHDR' || u32(8) !== 13) fail(path, 'has an invalid PNG header.');
    width = u32(16); height = u32(20);
    let cursor = 8; let ended = false; let hasData = false;
    while (cursor + 12 <= binary.length) {
      const size = u32(cursor); const type = binary.slice(cursor + 4, cursor + 8);
      if (size > binary.length - cursor - 12) fail(path, 'contains a truncated PNG chunk.');
      if (type === 'acTL') fail(path, 'must be a still image; animated PNG is not supported.');
      if (type === 'IDAT') hasData = true;
      cursor += size + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    if (!ended || !hasData || cursor !== binary.length) fail(path, 'contains an incomplete PNG image.');
  } else if (match[1] === 'jpeg') {
    if (binary.length < 4 || u16(0) !== 0xffd8 || u16(binary.length - 2) !== 0xffd9) fail(path, 'has an invalid JPEG header or ending.');
    let cursor = 2; let orientation: number | undefined;
    while (cursor + 4 <= binary.length) {
      if (byte(cursor) !== 0xff) fail(path, 'has an invalid JPEG marker.');
      while (byte(cursor) === 0xff) cursor++;
      if (cursor >= binary.length) fail(path, 'contains a truncated JPEG marker.');
      const marker = byte(cursor++);
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > binary.length) fail(path, 'contains a truncated JPEG segment.');
      const size = u16(cursor);
      if (size < 2 || cursor + size > binary.length) fail(path, 'contains a truncated JPEG segment.');
      if (marker === 0xe1) {
        const value = jpegOrientation(binary, cursor + 2, cursor + size, path);
        if (value !== undefined) {
          if (orientation !== undefined && orientation !== value) fail(path, 'contains conflicting JPEG EXIF orientations.');
          orientation = value;
        }
      }
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) fail(path, 'has an invalid JPEG frame header.');
        height = u16(cursor + 3); width = u16(cursor + 5);
      }
      cursor += size;
    }
    // Browser Image dimensions describe the EXIF-oriented bitmap, not the raw SOF raster.
    if (orientation !== undefined && orientation >= 5) [width, height] = [height, width];
  } else {
    if (binary.slice(0, 4) !== 'RIFF' || binary.slice(8, 12) !== 'WEBP' || little32(4) + 8 !== binary.length) fail(path, 'has an invalid WebP container.');
    let cursor = 12;
    while (cursor + 8 <= binary.length) {
      const type = binary.slice(cursor, cursor + 4); const size = little32(cursor + 4); const start = cursor + 8;
      if (start + size > binary.length) fail(path, 'contains a truncated WebP chunk.');
      if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && (byte(start) & 2))) fail(path, 'must be a still image; animated WebP is not supported.');
      if (type === 'VP8X' && size >= 10) {
        width = 1 + byte(start + 4) + byte(start + 5) * 256 + byte(start + 6) * 65536;
        height = 1 + byte(start + 7) + byte(start + 8) * 256 + byte(start + 9) * 65536;
      } else if (type === 'VP8 ' && size >= 10 && !width) {
        if (binary.slice(start + 3, start + 6) !== '\x9d\x01\x2a') fail(path, 'has an invalid WebP frame header.');
        width = (byte(start + 6) + byte(start + 7) * 256) & 0x3fff;
        height = (byte(start + 8) + byte(start + 9) * 256) & 0x3fff;
      } else if (type === 'VP8L' && size >= 5 && !width) {
        if (byte(start) !== 0x2f) fail(path, 'has an invalid lossless WebP header.');
        width = 1 + byte(start + 1) + ((byte(start + 2) & 0x3f) << 8);
        height = 1 + (byte(start + 2) >> 6) + (byte(start + 3) << 2) + ((byte(start + 4) & 0x0f) << 10);
      }
      cursor = start + size + (size % 2);
    }
    if (cursor !== binary.length) fail(path, 'contains an incomplete WebP image.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) fail(path, 'has unsupported image dimensions (maximum 16384 per side and 64 megapixels).');
  return { dataUrl: value, width, height };
}

/** The file checks every image import shares. Throws the message to show the user. */
export function assertImportableImage(file: { type: string; size: number }): void {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Choose a PNG or JPEG image.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose an image smaller than 12 MB.');
}

/** A Mark is the user's own logo as a PNG, held to the same limits as any imported image. */
export function meridianMark(dataUrl: string): { dataUrl: string; width: number; height: number } {
  if (!dataUrl.startsWith('data:image/png;')) fail('mark', 'must be a PNG.');
  return imageAsset(dataUrl, 'mark');
}

/** A Meridian file is opened on stage, so a damaged value is repaired rather than refused. Unknown keys still fail. */
function repairMeridianParams(params: Record<string, unknown>): void {
  for (const d of MERIDIAN_PARAMETERS) {
    const value = params[d.key];
    if (value === undefined) continue;
    params[d.key] = typeof value !== 'number' || !Number.isFinite(value) ? d.default
      : d.step === 1 ? Math.min(d.max, Math.max(d.min, Math.round(value))) : Math.min(d.max, Math.max(d.min, value));
  }
}

/** The part of a Meridian layer's saved state that is sound; anything else is dropped, and nothing here is fatal. */
function meridianState(input: unknown): MeridianLayerState | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.locks) || raw.locks.some(lock => typeof lock !== 'string')) return undefined;
  const state: MeridianLayerState = { locks: (raw.locks as string[]).filter((lock, i, all) => MERIDIAN_GROUPS.includes(lock) && all.indexOf(lock) === i) };
  for (const slot of ['morphA', 'morphB'] as const) {
    const capture = raw[slot];
    if (typeof capture !== 'object' || capture === null || Array.isArray(capture)) continue;
    const entries = Object.entries(capture as Record<string, unknown>);
    const known = (key: string) => MERIDIAN_PARAMETERS.some(d => d.key === key);
    if (entries.every(([key, value]) => known(key) && typeof value === 'number' && Number.isFinite(value))) state[slot] = Object.fromEntries(entries) as Record<string, number>;
  }
  if (typeof raw.morphAmount === 'number' && Number.isFinite(raw.morphAmount)) state.morphAmount = Math.min(1, Math.max(0, raw.morphAmount));
  const mark = raw.mark;
  if (typeof mark === 'object' && mark !== null) {
    try {
      const m = mark as Record<string, unknown>, asset = imageAsset(m.dataUrl, 'mark');
      if (m.width === asset.width && m.height === asset.height) state.mark = { dataUrl: asset.dataUrl, width: asset.width, height: asset.height };
    } catch { /* a damaged mark is dropped */ }
  }
  return state;
}

function validateLayer(input: unknown, index: number, version:1|2=1): Layer {
  const path = `layers[${index}]`; const layer = object(input, path);
  keys(layer, ['id', 'name', 'kind', 'visible', 'opacity', 'blend', 'transform', 'mask', 'params', 'palette', 'image', 'modulations','surface','meridian'], path);
  if(own(layer,'surface')){
    if(version!==2)fail(`${path}.surface`,'requires document version 2.');
    const surface=object(layer.surface,`${path}.surface`);keys(surface,['source','role','influence','points','clipMask'],`${path}.surface`);if(own(surface,'clipMask'))boolean(surface.clipMask,`${path}.surface.clipMask`);
    choice(surface.source,['polygon','mask'] as const,`${path}.surface.source`);choice(surface.role,['obstacle','emitter','edge'] as const,`${path}.surface.role`);number(surface.influence,`${path}.surface.influence`,0,1);
    if(!Array.isArray(surface.points)||surface.points.length<3||surface.points.length>12)fail(`${path}.surface.points`,'needs 3 to 12 vertices.');
    for(const [i,p] of surface.points.entries()){const point=object(p,`${path}.surface.points[${i}]`);keys(point,['x','y'],`${path}.surface.points[${i}]`);number(point.x,`${path}.surface.points[${i}].x`,0,1);number(point.y,`${path}.surface.points[${i}].y`,0,1);}
    if(!isSimplePolygon(surface.points as {x:number;y:number}[]))fail(`${path}.surface.points`,'must form a simple polygon with a useful area.');
    if(surface.source==='mask'&&(layer.mask as Record<string,unknown>)?.kind!=='image')fail(`${path}.surface.source`,'requires an imported image mask.');
  }
  const kind = choice(layer.kind, ['surface', 'sculpture', 'fractal', 'oil', 'liquid', 'scope', 'super8', 'graphic', 'image', 'meridian', ...INSTRUMENT_KINDS] as const, `${path}.kind`);
  text(layer.id, `${path}.id`, 100); text(layer.name, `${path}.name`);
  boolean(layer.visible, `${path}.visible`); number(layer.opacity, `${path}.opacity`, 0, 1);
  choice(layer.blend, ['normal', 'screen', 'multiply', 'add', 'source'] as const, `${path}.blend`);
  const transform = object(layer.transform, `${path}.transform`);
  keys(transform, ['x', 'y', 'scale', 'rotation'], `${path}.transform`);
  number(transform.x, `${path}.transform.x`, -2, 2); number(transform.y, `${path}.transform.y`, -2, 2);
  number(transform.scale, `${path}.transform.scale`, 0.05, 8); number(transform.rotation, `${path}.transform.rotation`, -TAU, TAU);
  const mask = object(layer.mask, `${path}.mask`);
  keys(mask, ['kind', 'softness', 'invert', 'size', 'dataUrl'], `${path}.mask`);
  choice(mask.kind, ['none', 'circle', 'rectangle', 'image'] as const, `${path}.mask.kind`);
  number(mask.softness, `${path}.mask.softness`, 0, 1); boolean(mask.invert, `${path}.mask.invert`); number(mask.size, `${path}.mask.size`, 0.01, 2);
  if (mask.kind === 'image') imageAsset(mask.dataUrl, `${path}.mask.dataUrl`);
  else if (own(mask, 'dataUrl')) fail(`${path}.mask.dataUrl`, 'is only allowed for an image mask.');
  const params = structuredClone(object(layer.params, `${path}.params`));
  // A Meridian saved before Pulse existed keeps the look it was made with.
  if (kind === 'meridian' && !own(params, 'scoreStyle')) params.scoreStyle = SCORE_STYLE_DENSE;
  // These additive schema-1 controls postdate the original instrument formats.
  // Normalize only absent fields; explicit invalid values and unknown keys still fail.
  for (const key of [...(ADDED_FIELDS[kind] ?? []),...FINISH_KEYS,...(isInstrument(kind)?INSTRUMENT_UPGRADE_KEYS[kind]:[])]) {
    if (!own(params, key)) params[key] = DEFINITIONS[kind].find((definition) => definition.key === key)!.default;
  }
  if (kind === 'meridian') { repairMeridianParams(params); for (const d of MERIDIAN_PARAMETERS) if (d.momentary && own(params, d.key)) params[d.key] = 0; } // A move is a press, never a saved state.
  keys(params, ['seed', ...DEFINITIONS[kind].map((definition) => definition.key)], `${path}.params`);
  number(params.seed, `${path}.params.seed`, 0, 0xffffffff, true);
  for (const definition of DEFINITIONS[kind]) number(params[definition.key], `${path}.params.${definition.key}`, definition.min, definition.max, definition.step === 1);
  if (kind === 'graphic' && (params.variant as number) >= GRAPHIC_VARIANTS[params.style as number].length) fail(`${path}.params.variant`, 'does not belong to this graphic family.');
  if (!Array.isArray(layer.palette) || layer.palette.length !== 6) fail(`${path}.palette`, 'must contain exactly six hex colors.');
  layer.palette.forEach((color, i) => hex(color, `${path}.palette[${i}]`));
  if (own(layer, 'image')) {
    if (kind !== 'image') fail(`${path}.image`, 'is only allowed on an image layer.');
    const image = object(layer.image, `${path}.image`);
    keys(image, ['name', 'dataUrl', 'width', 'height', 'fit'], `${path}.image`);
    text(image.name, `${path}.image.name`, 250);
    const asset = imageAsset(image.dataUrl, `${path}.image.dataUrl`);
    number(image.width, `${path}.image.width`, 1, MAX_IMAGE_DIMENSION, true); number(image.height, `${path}.image.height`, 1, MAX_IMAGE_DIMENSION, true);
    if (image.width !== asset.width || image.height !== asset.height) fail(`${path}.image`, 'dimensions do not match the embedded image.');
    choice(image.fit, ['contain', 'cover'] as const, `${path}.image.fit`);
  }
  const modulations = object(layer.modulations, `${path}.modulations`);
  const routeKeys = [...DEFINITIONS[kind].filter((definition) => definition.step !== 1 && !definition.preparation&&!(kind==='livingink'&&params.inkMode===2&&definition.key==='scale')).map((definition) => definition.key), 'opacity', 'transform.x', 'transform.y', 'transform.scale', 'transform.rotation'];
  keys(modulations, routeKeys, `${path}.modulations`);
  for (const [key, value] of Object.entries(modulations)) {
    const routePath = `${path}.modulations.${key}`; const modulation = object(value, routePath);
    keys(modulation, ['kind', 'cycles', 'phase', 'amount', 'points','range'], routePath);
    if(own(modulation,'range')){
      if(version!==2)fail(`${routePath}.range`,'requires document version 2.');
      const range=object(modulation.range,`${routePath}.range`);keys(range,['min','max'],`${routePath}.range`);
      const definition=DEFINITIONS[kind].find(d=>d.key===key),bounds=definition?[definition.min,definition.max]:key==='opacity'?[0,1]:key==='transform.scale'?[.05,8]:key==='transform.rotation'?[-TAU,TAU]:[-2,2];
      number(range.min,`${routePath}.range.min`,bounds[0],bounds[1]);number(range.max,`${routePath}.range.max`,bounds[0],bounds[1]);if((range.min as number)>=(range.max as number))fail(`${routePath}.range`,'needs minimum below maximum.');
    }
    choice(modulation.kind, ['sine', 'pulse', 'noise', 'keyframes'] as const, `${routePath}.kind`);
    number(modulation.cycles, `${routePath}.cycles`, 1, 16, true);
    number(modulation.phase, `${routePath}.phase`, 0, 1); number(modulation.amount, `${routePath}.amount`, 0, 1);
    if (!Array.isArray(modulation.points) || modulation.points.length > 64) fail(`${routePath}.points`, 'must be an array of at most 64 key points.');
    if (modulation.kind === 'keyframes' && modulation.points.length < 2) fail(`${routePath}.points`, 'needs at least two key points.');
    let previous = -1;
    modulation.points.forEach((value, i) => {
      const pointPath = `${routePath}.points[${i}]`; const point = object(value, pointPath);
      keys(point, ['time', 'value'], pointPath);
      const time = number(point.time, `${pointPath}.time`, 0, 1);
      number(point.value, `${pointPath}.value`, -1, 1);
      if (time >= 1 || time <= previous) fail(`${pointPath}.time`, 'must increase strictly in [0, 1); the loop endpoint is implicit.');
      previous = time;
    });
  }
  const result: Layer = { ...structuredClone(input as Layer), params: params as Record<string, number> };
  delete result.meridian;
  const state = kind === 'meridian' ? meridianState(layer.meridian) : undefined;
  if (state) result.meridian = state;
  return result;
}

export function validateProject(input: unknown): Project {
  const project = object(input, 'root');
  keys(project, ['schemaVersion', 'id', 'name', 'seed', 'duration', 'fps', 'width', 'height', 'background', 'transparent', 'highlights', 'tileEdges', 'layers'], 'root');
  if (project.schemaVersion !== 1&&project.schemaVersion!==2) fail('schemaVersion', 'must be 1 or 2; this file version is not supported.');
  text(project.id, 'id', 100); text(project.name, 'name'); number(project.seed, 'seed', 0, 0xffffffff, true);
  number(project.duration, 'duration', 0.1, 600);
  const fps = object(project.fps, 'fps'); keys(fps, ['num', 'den'], 'fps');
  number(fps.num, 'fps.num', 1, 240000, true); number(fps.den, 'fps.den', 1, 10000, true);
  const rate = (fps.num as number) / (fps.den as number);
  if (rate < 1 || rate > 120) fail('fps', 'must describe a frame rate between 1 and 120 FPS.');
  if (Math.round((project.duration as number) * rate) < 1 || Math.round((project.duration as number) * rate) > 72000) fail('duration', 'must produce between 1 and 72000 frames.');
  number(project.width, 'width', 64, 8192, true); number(project.height, 'height', 64, 8192, true);
  hex(project.background, 'background'); boolean(project.transparent, 'transparent');
  if (own(project, 'highlights')) choice(project.highlights, ['soft', 'exact'] as const, 'highlights');
  if (own(project, 'tileEdges')) boolean(project.tileEdges, 'tileEdges');
  if (!Array.isArray(project.layers) || project.layers.length < 1 || project.layers.length > 4) fail('layers', 'must contain between one and four layers.');
  // Layers from retired effect families are dropped so older films still open.
  const kept = (project.layers as unknown[]).filter(layer => !RETIRED_KINDS.includes((layer as { kind?: string } | null)?.kind as string));
  if (!kept.length) fail('layers', 'only uses effects that have been retired (Caustic Atlas, Magnetic Skin, Holographic Loom, Crystal Reef, Prism Cathedral, Volumetric Veils, Velvet Currents).');
  const layers = kept.map((layer,i)=>validateLayer(layer,i,project.schemaVersion as 1|2));
  if(layers.some(l=>l.kind==='livingink'&&l.params.inkMode===2)&&(project.duration as number)>60)fail('duration','must be at most 60 seconds for evolving pigment.');
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) fail('layers', 'contains duplicate layer IDs.');
  return { ...structuredClone(input as Project), layers };
}
