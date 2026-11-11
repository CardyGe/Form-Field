import {FINISH_PARAMETERS, FINISH_KEYS} from './finishing';
import { isSimplePolygon } from './surface-layout';
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_PARAMETERS, INSTRUMENT_UPGRADE_KEYS, isInstrument } from './instruments';
import { SIGNATURE_LOOKS } from './signature-looks';
import type { Layer, LayerKind, ParameterDefinition, Preset, Project } from '../shared/types';
import { GRAPHIC_LOOKS, GRAPHIC_PARAMETERS, GRAPHIC_VARIANTS, graphicVisibleKeys } from './graphics';

const TAU = Math.PI * 2;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16384;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const DEFAULT_PALETTE = ['#49efd6', '#cbf34a', '#ef62d9', '#7747ef', '#ff826c', '#19112e'];
const SCULPTURE_PALETTE = ['#f6dfef', '#bdb7eb', '#9ad9df', '#f7c8b4', '#d3e7a4', '#24203b'];
const FRACTAL_PALETTE = ['#5fffe1', '#aff043', '#b77bff', '#f65aa6', '#ffb969', '#09102c'];

const SUPER8_PALETTE = ['#ff6238', '#f5c842', '#408bba', '#be4266', '#171824', '#eeddb4'];
// New looks use the projector; absent controls in saved films migrate to neutral.
const SUPER8_PROJECTOR_LOOK = { emulsion: .55, pullDown: .6, shutter: .16, dust: .25, hair: .15, lightLeak: .22, halation: .35, vignette: .3, lensSoftness: .22, colorFade: .18 };
export const SUPER8_PROJECTOR_KEYS = ['emulsion', 'gateMode', 'gateInset', 'gateRoundness', 'sprockets', 'pullDown', 'shutter', 'shutterBlades', 'reelLoops', 'frameLines', 'dust', 'hair', 'lightLeak', 'halation', 'vignette', 'lensSoftness', 'colorFade'];

const OIL_PALETTE = ['#eeff00', '#a7de12', '#060710', '#25b8ed', '#071275', '#e2a51c'];

const parameter = (key: string, label: string, min: number, max: number, step: number, value: number, section: ParameterDefinition['section']): ParameterDefinition =>
  ({ key, label, min, max, step, default: value, section });

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
    parameter('style', 'Pattern', 0, 2, 1, 0, 'Shape'),
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
    parameter('mode', 'Mode', 0, 3, 1, 0, 'Shape'),
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
    parameter('substrate', 'Substrate', 0, 1, 1, 1, 'Material'),
    parameter('saturation', 'Saturation', 0, 2, 0.01, 1, 'Material'),
    parameter('hue', 'Hue shift', -Math.PI, Math.PI, 0.01, 0, 'Material'),
    parameter('exposure', 'Exposure', 0.25, 2, 0.01, 1, 'Material'),
  ],
  graphic: GRAPHIC_PARAMETERS,
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

const FRACTAL_ADDED_FIELDS = ['variant', 'quality', 'density', 'juliaReal', 'juliaImag', 'trap', 'boxScale', 'boxRadius', 'radial', 'roughness', 'lightAngle', 'exposure', 'lineWidth'];
const GRADING_FIELDS = ['saturation', 'hue', 'exposure'];
const ADDED_FIELDS: Partial<Record<LayerKind, string[]>> = {
  surface: ['anisotropy','sheenAngle','iridescence', 'roundness', 'relief', 'variant', 'density', 'stretch', 'turbulence', 'centerX', 'centerY', 'lightAngle', 'roughness', ...GRADING_FIELDS],
  sculpture: ['opening', 'twist', 'form', 'lobes', 'thickness', 'stretch', 'curl', 'foldFrequency', 'asymmetry', 'ridgeScale', 'metallic', 'clearcoat', 'sheen', 'filmScale', 'lightPower', 'shadowStrength', 'shadowSoftness', ...GRADING_FIELDS],
  fractal: [...FRACTAL_ADDED_FIELDS, 'colorMode', 'colorSteps', 'colorMix', 'saturation', 'hue'],
  super8: SUPER8_PROJECTOR_KEYS,
  oil: ['anisotropy','sheenAngle','caustics', 'iridescence', 'deformation', 'lensDepth', 'cellComplexity', 'dispersion'],
  graphic: [],
  image: ['mirror', 'repeat', ...GRADING_FIELDS],
};

// Saved parameters and routes stay complete when switching family. The inspector
// shows only controls consumed by that family, while validation and evaluation
// continue to use the complete instrument definition.
export function visibleParameterDefinitions(layer: Layer): ParameterDefinition[] {
  const definitions = parameterDefinitions(layer.kind);
  if (layer.kind === 'graphic') {
    const keys = graphicVisibleKeys(layer.params.style, layer.params.variant, layer.params.fill, layer.params.sweep);
    return definitions.filter(d => keys.has(d.key)||FINISH_KEYS.includes(d.key));
  }
  if(layer.kind==='currents'&&layer.params.flowMode===1){
    const keys=new Set(['flowMode','scale','motion','cycles','backgroundOpacity','flowDirection','travel','eddyScale','phrase','surfaceHole','fibres','curl','trailLength','width','depth','flowDetail','phaseOffset','anisotropy','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d=>keys.has(d.key));
  }
  if(layer.kind==='livingink'&&layer.params.inkMode===2){
    const keys=new Set(['inkMode','simulationQuality','pigmentCarry','scale','motion','backgroundOpacity','flowDirection','travel','eddyScale','surfaceHole','pattern','branching','seedCoverage','development','relief','pigment','edgeInk','edgeSoftness','lightAngle','lightHeight','fillLight','roughness','anisotropy','sheenAngle','clearcoat','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d=>keys.has(d.key)).map(d=>d.key==='scale'?{...d,preparation:true}:d);
  }
  if(layer.kind==='relief'&&layer.params.reliefMode===1){
    const keys=new Set(['reliefMode','scale','columns','gap','stagger','hingeBias','opening','depth','axis','phaseSpread','organic','motion','cycles','phrase','phaseOffset','lightAngle','lightHeight','fillLight','shadow','roughness','clearcoat','backgroundOpacity','saturation','hue','exposure',...FINISH_KEYS]);
    return definitions.filter(d=>keys.has(d.key));
  }
  if (layer.kind !== 'fractal') return definitions;
  const family = Math.round(layer.params.style ?? 0), variant = Math.round(layer.params.variant ?? 0);
  const familySpecific: Record<string, number[]> = {
    juliaReal: [1], juliaImag: [1], trap: [1],
    boxScale: [2], boxRadius: [2], radial: [2], roughness: [2], lightAngle: [2],
    lineWidth: [0, 1],
  };
  return definitions.filter((definition) => {
    if (definition.key === 'colorSteps') return layer.params.colorMode === 2;
    if (definition.key === 'colorMix') return layer.params.colorMode > 0;
    if (definition.key === 'symmetry') return family === 0 || (family === 1 && variant === 1) || (family === 2 && layer.params.radial > 0);
    return !familySpecific[definition.key] || familySpecific[definition.key].includes(family);
  });
}

function defaultParams(kind: LayerKind): Record<string, number> {
  return Object.fromEntries(DEFINITIONS[kind].map((definition) => [definition.key, definition.default]));
}

function preset(id: string, name: string, description: string, kind: Preset['kind'], palette: string[], params: Record<string, number>): Preset {
  return { id, name, description, kind, palette, params: { ...defaultParams(kind), ...(kind === 'super8' ? SUPER8_PROJECTOR_LOOK : {}), ...params } };
}

export const SUPER8_MODES = ['Chromatic Staircase', 'Paint Destruction', 'Scratched Negative', 'Cut-out Collage'];

export const PRESETS: Preset[] = [
  ...INSTRUMENTS.flatMap(info => info.looks.map(look => preset(look.id, look.name, info.description, info.kind, look.palette ?? info.palette, look.params))),
  ...GRAPHIC_LOOKS.map(look => preset(look.id, look.name, look.description, 'graphic', look.palette, look.params)),
  preset('chromatic-staircase', 'Chromatic Staircase', 'Hand-painted terraces through a warm, softly flickering projector.', 'super8', SUPER8_PALETTE, {}),
  preset('paint-destruction', 'Paint Destruction', 'Eroding pigment, dry brush strokes and decaying paint echoes.', 'super8', ['#e95a24', '#e8af25', '#245ba1', '#c22d53', '#17131d', '#e4cda8'], { mode: 1, erosion: 0.7, texture: 0.95, roughness: 0.85, bleed: 0.5, feedback: 0.65, travel: 0.65, scratches: 0.15, emulsion: .85, lightLeak: .4, halation: .5, dust: .4, frameLines: .3 }),
  preset('scratched-negative', 'Scratched Negative', 'Inverted stepped forms scored by shifting film scratches.', 'super8', ['#f0b458', '#cc5262', '#528f8d', '#7864a6', '#10151c', '#e2dcc4'], { mode: 2, scratches: 0.85, grain: 0.45, flicker: 0.35, weave: 0.4, filmFps: 12, feedback: 0.24, erosion: 0.38, gateMode: 2, sprockets: .85, frameLines: .85, pullDown: .9, dust: .65, hair: .6, lightLeak: .12, vignette: .5 }),
  preset('cut-out-collage', 'Cut-out Collage', 'Layered painted paper fragments with torn edges and offset impressions.', 'super8', SUPER8_PALETTE, { mode: 3, steps: 8, erosion: 0.35, texture: 0.8, roughness: 0.7, feedback: 0.4, feedbackRotation: -0.06, filmFps: 12, travel: 0.55, gateMode: 1, gateInset: .025, frameLines: .35, emulsion: .35, lensSoftness: .3, colorFade: .3 }),
  preset('acid-slide', 'Acid Slide', 'Fluorescent yellow paint, cellular black ink and a glossy lens over cyan.', 'oil', OIL_PALETTE, {}),
  preset('cellular-lift', 'Cellular Lift', 'A glassy dome lifts away to reveal its branching cellular footprint.', 'oil', OIL_PALETTE, { lift: 1, travel: 0.22, drag: 0.7, cellSize: 1.2, relativeRotation: 0.18, filaments: 0.25 }),
  preset('ink-drag', 'Ink Drag', 'Fine black filaments pulled through bright paint by a sliding lens.', 'oil', OIL_PALETTE, { travel: 0.52, drag: 0.92, filaments: 1, relativeRotation: 0.45, cellSize: 0.6, coverage: 0.68 }),
  preset('chromatic-slides', 'Chromatic Slides', 'Hot pink and tangerine pools with dark violet ink and blue-green glass.', 'oil', ['#ff318b', '#ffab35', '#180d38', '#22dbc8', '#13266f', '#ffd18a'], { coverage: 0.5, lensAspect: 1.45, lensSize: 0.23, drag: 0.45, relativeRotation: 0.5, wetness: 0.95 }),
  preset('cobalt-tide', 'Cobalt Tide', 'Electric blue paint and coral ink flowing over luminous turquoise.', 'oil', ['#234dff', '#05bdf5', '#2b0927', '#42f2b4', '#111044', '#e7b4ff'], { travel: 0.38, relativeRotation: 0.65, drag: 0.78, coverage: 0.64, lensSize: 0.24, deformation: 0.85, cellComplexity: 0.85, dispersion: 0.35 }),
  preset('ember-glass', 'Ember Glass', 'Amber and scarlet pigment, black branching ink and deep violet glass.', 'oil', ['#ff9d19', '#fa3154', '#160721', '#33255c', '#0b0820', '#ffe7ad'], { travel: 0.28, drag: 0.65, coverage: 0.62, lensAspect: 0.85, lensDepth: 0.85, thickness: 0.85, cellComplexity: 0.8, wetness: 1 }),
  preset('pearl-ink', 'Pearl Ink', 'Creamy ivory pools with indigo ink, fine dragged threads and warm reflections.', 'oil', ['#f5e7c7', '#e7a99d', '#101c3f', '#bacfc7', '#465778', '#fff3dd'], { travel: 0.42, drag: 0.9, filaments: 0.85, coverage: 0.56, lensSize: 0.22, deformation: 0.75, cellComplexity: 0.95, grain: 0.3, dispersion: 0 }),
  preset('acid-tide', 'Acid Tide', 'Luminous cyan, lime and orchid flowing through broad liquid bands.', 'surface', DEFAULT_PALETTE, { style: 0, scale: 4, warp: 0.45, detail: 0.4, roundness: 0.65, relief: 0.62, softness: 0.25, contrast: 0.55, offset: 0.2, reveal: 0.1 }),
  preset('orchid-rings', 'Orchid Rings', 'Soft nested contours in orchid, lilac and warm pearl.', 'surface', ['#edb2ed', '#a44cbd', '#e7d8fa', '#67257e', '#f7a588', '#21112d'], { style: 1, scale: 3.2, warp: 0.32, detail: 0.3, roundness: 0.22, relief: 0.75, softness: 0.48, contrast: 0.44, offset: 0.13, reveal: 0.04 }),
  preset('solar-melt', 'Solar Melt', 'Warm amber and coral gathered into slow molten drips.', 'surface', ['#ffb840', '#ff764f', '#f24978', '#ac2b7b', '#f9d98d', '#291327'], { style: 2, scale: 3.4, warp: 0.6, detail: 0.28, roundness: 0.85, relief: 0.64, softness: 0.34, contrast: 0.57, rotation: -0.18, offset: 0.08, reveal: 0.14 }),
  preset('deep-bloom', 'Deep Bloom', 'Electric blue and lavender cut through midnight negative space.', 'surface', ['#3a6cf4', '#7c55ef', '#b8b6ff', '#56e2d5', '#ed7fd1', '#080f26'], { style: 3, scale: 5.2, warp: 0.67, detail: 0.58, roundness: 0.3, relief: 0.7, softness: 0.2, contrast: 0.68, offset: 0.33, reveal: 0.28 }),
  preset('mineral-silk', 'Mineral Silk', 'Quiet mineral green with creamy, finely warped contours.', 'surface', ['#b3cfa3', '#526e5e', '#e7e2c5', '#89b6ad', '#cfaa9b', '#182c2a'], { style: 0, scale: 5.4, warp: 0.24, detail: 0.24, roundness: 0.8, relief: 0.4, softness: 0.52, contrast: 0.4, offset: 0.06, reveal: 0.06 }),
  preset('citrine-braids', 'Citrine Braids', 'Interwoven liquid bands in luminous citrus, cyan and orchid.', 'surface', DEFAULT_PALETTE, { style: 0, variant: 1, scale: 5.4, warp: 0.28, roundness: 0.6, relief: 0.8, density: 0.8, stretch: 0.8, roughness: 0.24 }),
  preset('velvet-ribbons', 'Velvet Ribbons', 'Broad, rounded ribbons gathered into a flowing chromatic weave.', 'surface', DEFAULT_PALETTE, { style: 0, variant: 2, scale: 5.4, warp: 0.3, roundness: 0.9, relief: 0.8, density: 1.2, stretch: 0.7, roughness: 0.4 }),
  preset('ripple-glass', 'Ripple Glass', 'Concentric ripples in orchid, lilac and warm pearl.', 'surface', ['#edb2ed', '#a44cbd', '#e7d8fa', '#67257e', '#f7a588', '#21112d'], { style: 1, variant: 1, scale: 4.5, warp: 0.2, roundness: 0.85, relief: 0.62, density: 0.85, roughness: 0.28 }),
  preset('vortex-pool', 'Vortex Pool', 'A curling pool of luminous contour lines and soft mineral light.', 'surface', ['#edb2ed', '#a44cbd', '#e7d8fa', '#67257e', '#f7a588', '#21112d'], { style: 1, variant: 2, scale: 4, warp: 0.15, roundness: 0.8, relief: 0.8, density: 1.15, stretch: 0.8, roughness: 0.28 }),
  preset('coral-beads', 'Coral Beads', 'Rounded molten beads in amber, coral and deep rose.', 'surface', ['#ffb840', '#ff764f', '#f24978', '#ac2b7b', '#f9d98d', '#291327'], { style: 2, variant: 1, scale: 4.2, warp: 0.5, roundness: 1, relief: 0.8, density: 0.85, roughness: 0.2 }),
  preset('satin-strands', 'Satin Strands', 'Long, glossy strands with warm highlights and slow liquid movement.', 'surface', ['#ffb840', '#ff764f', '#f24978', '#ac2b7b', '#f9d98d', '#291327'], { style: 2, variant: 2, scale: 4.5, warp: 0.25, roundness: 0.85, relief: 0.82, density: 0.8, stretch: 1.1, roughness: 0.2 }),
  preset('twin-suns', 'Twin Suns', 'Two radiant portals suspended in electric blue and lavender.', 'surface', ['#3a6cf4', '#7c55ef', '#b8b6ff', '#56e2d5', '#ed7fd1', '#080f26'], { style: 3, variant: 1, scale: 4.7, warp: 0.35, roundness: 0.7, relief: 0.8, density: 0.95, roughness: 0.25 }),
  preset('chromatic-lens', 'Chromatic Lens', 'A luminous lens of rounded bands with fine turbulent detail.', 'surface', ['#3a6cf4', '#7c55ef', '#b8b6ff', '#56e2d5', '#ed7fd1', '#080f26'], { style: 3, variant: 2, scale: 5, warp: 0.25, roundness: 1, relief: 0.9, density: 1.1, turbulence: 0.15, roughness: 0.2 }),
  preset('pearl-organism', 'Pearl Organism', 'A curled opal form with tucked folds, fine fluting and slow breathing.', 'sculpture', SCULPTURE_PALETTE, { fold: 0.72, ridges: 0.58, opening: 0.62, twist: -0.25, breath: 0.4, roughness: 0.3, iridescence: 0.85, cameraPitch: 0.24, lightAngle: 0.5 }),
  preset('mercury-flower', 'Mercury Flower', 'Folded silver-lilac petals with broad spectral highlights.', 'sculpture', ['#d6dded', '#9f9dd1', '#8bd5d5', '#edb1ce', '#e6e5fc', '#14182a'], { fold: 0.78, ridges: 0.73, opening: 0.32, twist: -0.6, breath: 0.25, roughness: 0.24, iridescence: 0.66, cameraYaw: -0.3, cameraPitch: 0.36, zoom: 1.08, lightAngle: -0.6 }),
  preset('rose-shell', 'Rose Shell', 'A scalloped rose shell, opening and twisting through a seamless cycle.', 'sculpture', ['#f0b7bc', '#a96b9c', '#f4d5b1', '#c7abd8', '#f6e9dd', '#2d1933'], { fold: 0.42, ridges: 0.32, opening: 0.9, twist: 0.65, breath: 0.48, roughness: 0.43, iridescence: 0.58, cameraYaw: 0.35, cameraPitch: 0.1, lightAngle: 1.2 }),
  preset('pearl-bloom', 'Pearl Bloom', 'An open pearlescent bloom with seven softly fluted petals.', 'sculpture', SCULPTURE_PALETTE, { form: 1, fold: 0.5, ridges: 0.55, opening: 0.8, lobes: 7, thickness: 0.45, curl: 0.6, twist: 0.25, cameraPitch: 0.26, roughness: 0.32, iridescence: 0.75, metallic: 0.1, clearcoat: 0.8, shadowStrength: 0.45, shadowSoftness: 0.6 }),
  preset('chrome-dahlia', 'Chrome Dahlia', 'A tightly gathered dahlia with cool chrome highlights and fine folds.', 'sculpture', ['#b9d2e4', '#9f9dd1', '#8bd5d5', '#edb1ce', '#e6e5fc', '#14182a'], { form: 1, fold: 0.7, ridges: 0.7, opening: 0.3, lobes: 11, thickness: 0.3, curl: 0.8, twist: -0.6, stretch: 0.95, cameraPitch: 0.2, roughness: 0.22, iridescence: 0.5, metallic: 0.65, clearcoat: 0.9, lightAngle: -0.45, shadowStrength: 0.45, shadowSoftness: 0.6 }),
  preset('satin-orbit', 'Satin Orbit', 'A folded peach ribbon turning around a softly illuminated center.', 'sculpture', ['#e9b9a9', '#a96b9c', '#f4d5b1', '#c7abd8', '#f6e9dd', '#2d1933'], { form: 2, fold: 0.65, ridges: 0.45, opening: 0.6, twist: 0.75, lobes: 8, thickness: 0.25, curl: 0.55, cameraPitch: 0.55, roughness: 0.36, iridescence: 0.65, metallic: 0.1, clearcoat: 0.6, lightAngle: 0.65, shadowStrength: 0.45, shadowSoftness: 0.6 }),
  preset('aurora-ribbon', 'Aurora Ribbon', 'A broad asymmetric ribbon with green, violet and blue spectral light.', 'sculpture', ['#89bacc', '#9e86d5', '#bedbc4', '#c2b8ed', '#8ce6d2', '#152043'], { form: 2, fold: 0.9, ridges: 0.8, opening: 0.1, twist: -1, lobes: 5, thickness: 0.7, curl: 0.9, asymmetry: 0.35, stretch: 0.75, foldFrequency: 1.4, cameraPitch: 0.6, cameraYaw: 0.4, roughness: 0.24, iridescence: 1, filmScale: 1.45, metallic: 0.45, clearcoat: 0.9, lightAngle: -0.8, saturation: 1.25, shadowStrength: 0.45, shadowSoftness: 0.6 }),
  preset('liquid-trefoil', 'Liquid Trefoil', 'A smooth looping knot in cool silver, pearl and lavender.', 'sculpture', ['#d0c4de', '#9f9dd1', '#9dcada', '#edb1ce', '#e6e5fc', '#14182a'], { form: 3, fold: 0.2, ridges: 0.3, opening: 0.55, twist: 0.4, thickness: 0.65, cameraPitch: 0.3, roughness: 0.23, iridescence: 0.62, metallic: 0.45, clearcoat: 0.9, lightAngle: 0.35, shadowStrength: 0.45, shadowSoftness: 0.6 }),
  preset('prismatic-fold', 'Prismatic Fold', 'Luminous folded geometry arranged into a shifting neon kaleidoscope.', 'fractal', FRACTAL_PALETTE, { style: 0 }),
  preset('velvet-petals', 'Velvet Petals', 'Soft overlapping petals with rich violet edges and warm coral light.', 'fractal', ['#ffb5a0', '#e47ca4', '#bda2ee', '#8056c8', '#f6d3ad', '#140c29'], { style: 0, variant: 1, scale: 1.8, detail: 0.48, fold: 0.64, symmetry: 8, twist: -0.12, morph: 0.1, travel: 0.18, relief: 0.52, glow: 0.25, density: 0.8, lineWidth: 1.15 }),
  preset('luminous-weave', 'Luminous Weave', 'Fine interlocking ribbons in cool turquoise, iris and amber.', 'fractal', ['#87f4e7', '#719be4', '#bca4f0', '#ecb584', '#e9ddd0', '#0b1326'], { style: 0, variant: 2, scale: 2.2, detail: 0.7, fold: 0.4, symmetry: 6, twist: 0.34, morph: 0.1, travel: 0.3, density: 1.2, lineWidth: 0.8, relief: 0.58, glow: 0.18 }),
  preset('velvet-julia', 'Velvet Julia', 'Intricate Julia filigree in velvet violet, warm pink and soft amber.', 'fractal', ['#e8bcff', '#aa63db', '#f3aac4', '#725cba', '#f6d8b8', '#170e2c'], { style: 1, variant: 0, scale: 1.55, detail: 0.7, fold: 0.42, twist: -0.16, morph: 0.07, travel: 0.08, offset: 0.32, relief: 0.52, glow: 0.16, contrast: 0.5, cameraPitch: 0.12, juliaReal: -0.74543, juliaImag: 0.11301, density: 0.9, trap: 0.55 }),
  preset('coral-mandala', 'Coral Mandala', 'Radial Julia branches gathered into a luminous coral, rose and amethyst mandala.', 'fractal', ['#ff8056', '#ffd3a5', '#ff4d8b', '#b37bfa', '#ffbd8c', '#160b28'], { style: 1, variant: 1, scale: 1.65, detail: 0.75, fold: 0.45, symmetry: 8, twist: 0.08, morph: 0.08, travel: 0.1, offset: 0.12, relief: 0.42, glow: 0.14, contrast: 0.52, juliaReal: -0.4, juliaImag: 0.6, density: 0.75, trap: 0.62, lineWidth: 1.1, exposure: 1.25 }),
  preset('spiral-garden', 'Spiral Garden', 'Curling Julia tendrils with turquoise light and luminous violet edges.', 'fractal', ['#43cdd7', '#8d7cf0', '#d6b8ff', '#67eac0', '#f7b18c', '#071526'], { style: 1, variant: 2, scale: 1.75, detail: 0.8, fold: 0.55, twist: 0.16, morph: 0.06, travel: 0.08, offset: 0.2, relief: 0.5, glow: 0.12, contrast: 0.55, juliaReal: -0.70176, juliaImag: -0.3842, density: 1.15, trap: 0.48, lineWidth: 0.9, exposure: 1.3 }),
  preset('abyssal-cathedral', 'Abyssal Cathedral', 'Folded architecture with cool mineral light and restrained gilded edges.', 'fractal', ['#24b8c7', '#3488a6', '#595ab5', '#bc954e', '#8faeab', '#050b19'], { style: 2, variant: 0, scale: 1.9, detail: 0.42, fold: 0, twist: 0.08, morph: 0.08, travel: 0.18, offset: 0.02, relief: 0.98, glow: 0.06, contrast: 0.5, cameraYaw: 0.65, cameraPitch: 0.35, zoom: 0.72, boxScale: 2.2, boxRadius: 0.35, roughness: 0.42, density: 0.55, exposure: 1.15, lightAngle: -0.7 }),
  preset('ivory-vault', 'Ivory Vault', 'Smooth sphere folds with warm ivory highlights and cool architectural shadows.', 'fractal', ['#e9ddc5', '#a7b1c6', '#c0aebd', '#7d8b9d', '#e5c7a2', '#111723'], { style: 2, variant: 1, scale: 1.85, detail: 0.32, fold: 0.12, twist: -0.08, morph: 0.06, travel: 0.08, relief: 0.96, glow: 0.04, contrast: 0.5, cameraYaw: 0.55, cameraPitch: 0.32, zoom: 0.85, boxScale: 1.85, boxRadius: 0.4, roughness: 0.55, density: 0.8, lightAngle: -0.45, exposure: 1.15 }),
  preset('chromatic-lattice', 'Chromatic Lattice', 'Open recursive lattice with crisp cool edges and small amber accents.', 'fractal', ['#a9d7da', '#829fc5', '#c3afd5', '#c8a67c', '#d9d9c7', '#0c1424'], { style: 2, variant: 2, scale: 2, detail: 0.42, fold: 0, twist: 0.08, morph: 0.08, travel: 0.08, relief: 0.98, glow: 0.05, contrast: 0.5, cameraYaw: -0.35, cameraPitch: 0.3, zoom: 0.9, boxScale: 2.2, boxRadius: 0.35, roughness: 0.32, density: 0.8, lightAngle: -0.8, exposure: 1.15 }),
  preset('ink-lace', 'Ink Lace', 'Fine recursive lace rendered in warm ivory and midnight ink.', 'fractal', ['#eee6d2', '#aca7ba', '#8ca6ac', '#c9b798', '#e8d9bc', '#080e1b'], { style: 0, variant: 0, colorMode: 1, colorMix: 0.8, scale: 1.9, detail: 0.65, symmetry: 8, fold: 0.5, lineWidth: 0.85, relief: 0.5, glow: 0.12, contrast: 0.48, density: 0.8 }),
  preset('ember-julia', 'Ember Julia', 'Julia filigree mapped into crisp ember, coral and golden contour bands.', 'fractal', ['#ffe0a0', '#ff9c50', '#f64d45', '#b73e6a', '#874a8d', '#1c1024'], { style: 1, variant: 0, colorMode: 2, colorSteps: 8, colorMix: 0.8, scale: 1.55, detail: 0.7, fold: 0.42, twist: -0.16, morph: 0.07, travel: 0.08, offset: 0.12, relief: 0.52, glow: 0.16, contrast: 0.5, cameraPitch: 0.12, juliaReal: -0.74543, juliaImag: 0.11301, density: 0.9, trap: 0.55 }),
  preset('porcelain-vault', 'Porcelain Vault', 'Sphere-fold architecture in porcelain white and cool blue shadow.', 'fractal', ['#eee5d3', '#b1b8c8', '#c4b8be', '#8b9bad', '#e5d0ae', '#111a2c'], { style: 2, variant: 1, colorMode: 1, colorMix: 0.8, scale: 1.85, detail: 0.32, fold: 0.12, twist: -0.08, morph: 0.06, travel: 0.08, relief: 0.96, glow: 0.04, contrast: 0.5, cameraYaw: 0.55, cameraPitch: 0.32, zoom: 0.75, boxScale: 1.85, boxRadius: 0.4, roughness: 0.55, density: 0.8, lightAngle: -0.45, exposure: 1.15 }),
];

for (const look of SIGNATURE_LOOKS) {
  const base = PRESETS.find(p => p.id === look.base);
  if (!base) throw new Error(`Missing signature base: ${look.base}`);
  PRESETS.push({ ...preset(look.id, look.name, look.description, base.kind, look.palette ?? base.palette, { ...base.params, ...look.params }), signature: true });
}

export function createLayer(kind: LayerKind): Layer {
  if (!(kind in DEFINITIONS)) throw new Error(`Unknown layer kind: ${String(kind)}`);
  return {
    id: crypto.randomUUID(),
    name: INSTRUMENTS.find(i=>i.kind===kind)?.name ?? (kind === 'surface' ? 'Chromatic Field' : kind === 'sculpture' ? 'Pearl Sculpture' : kind === 'fractal' ? 'Prismatic Fractal' : kind === 'oil' ? 'Oil Slides' : kind === 'super8' ? 'Super 8 Paint' : kind === 'graphic' ? 'Graphic Patterns' : 'Image'),
    kind, visible: true, opacity: 1, blend: 'normal',
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    mask: { kind: 'none', softness: 0.15, invert: false, size: 0.8 },
    params: { ...defaultParams(kind), ...(isInstrument(kind) ? INSTRUMENTS.find(i=>i.kind===kind)!.looks[0].params : kind === 'graphic' ? GRAPHIC_LOOKS[0].params : kind === 'super8' ? SUPER8_PROJECTOR_LOOK : {}), seed: 1729 },
    palette: [...(isInstrument(kind) ? (INSTRUMENTS.find(i=>i.kind===kind)!.looks[0].palette ?? INSTRUMENTS.find(i=>i.kind===kind)!.palette) : kind === 'sculpture' ? SCULPTURE_PALETTE : kind === 'fractal' ? FRACTAL_PALETTE : kind === 'oil' ? OIL_PALETTE : kind === 'super8' ? SUPER8_PALETTE : kind === 'graphic' ? GRAPHIC_LOOKS[0].palette : DEFAULT_PALETTE)], modulations: {},
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
    params: { ...selected.params, seed: layer.params.seed ?? 1729 }, modulations: {},
  };
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
const VARIATION_FIXED = new Set(['simulationQuality','flowMode','inkMode','reliefMode','phrase','surfaceHole','style', 'variant', 'form', 'mode', 'colorMode', 'mirror', 'repeat', 'substrate', 'profile', 'fill', 'sweep', 'corners', 'quality', 'gateMode', 'gateInset', 'gateRoundness', 'backgroundOpacity', 'centerX', 'centerY', 'cycles', 'turns', 'reelLoops', 'shutterBlades', 'juliaReal', 'juliaImag', 'pattern', 'axis', 'phaseOffset']);
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
  const recipes = PRESETS.filter(p => p.kind === layer.kind &&
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
    if (locked || VARIATION_FIXED.has(key) || (locks.palette && ['hue','saturation','vibrance'].includes(key))) continue;
    // Preserve artist-authored routes and their baseline values as a unit.
    if (layer.modulations[key] || key==='tonePivot' || key==='warpScale'&&layer.params.warp===0 || key==='sheenAngle'&&layer.params.anisotropy===0) continue;
    const span = d.max-d.min;
    const personality = character[d.section] * .7 + (random()*2-1) * .3;
    const factor = key === 'angularStep' ? .003 : d.section === 'Camera' ? .035 :
      ['spacing','boxScale','boxRadius'].includes(key) ? .035 : .12;
    let target = (anchor?.params[key] ?? d.default) + personality * span * factor;
    // Practical film cadences, chosen once for the whole effect.
    if (key === 'filmFps') target = [12,18,24][Math.floor(random()*3)];
    result.params[key] = clampParameter(original + (target-original)*strength, d);
  }
  if (!locks.palette) {
    const palettes = PRESETS.filter(p => p.kind === layer.kind);
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

function validateLayer(input: unknown, index: number, version:1|2=1): Layer {
  const path = `layers[${index}]`; const layer = object(input, path);
  keys(layer, ['id', 'name', 'kind', 'visible', 'opacity', 'blend', 'transform', 'mask', 'params', 'palette', 'image', 'modulations','surface'], path);
  if(own(layer,'surface')){
    if(version!==2)fail(`${path}.surface`,'requires document version 2.');
    const surface=object(layer.surface,`${path}.surface`);keys(surface,['source','role','influence','points','clipMask'],`${path}.surface`);if(own(surface,'clipMask'))boolean(surface.clipMask,`${path}.surface.clipMask`);
    choice(surface.source,['polygon','mask'] as const,`${path}.surface.source`);choice(surface.role,['obstacle','emitter','edge'] as const,`${path}.surface.role`);number(surface.influence,`${path}.surface.influence`,0,1);
    if(!Array.isArray(surface.points)||surface.points.length<3||surface.points.length>12)fail(`${path}.surface.points`,'needs 3 to 12 vertices.');
    for(const [i,p] of surface.points.entries()){const point=object(p,`${path}.surface.points[${i}]`);keys(point,['x','y'],`${path}.surface.points[${i}]`);number(point.x,`${path}.surface.points[${i}].x`,0,1);number(point.y,`${path}.surface.points[${i}].y`,0,1);}
    if(!isSimplePolygon(surface.points as {x:number;y:number}[]))fail(`${path}.surface.points`,'must form a simple polygon with a useful area.');
    if(surface.source==='mask'&&(layer.mask as Record<string,unknown>)?.kind!=='image')fail(`${path}.surface.source`,'requires an imported image mask.');
  }
  const kind = choice(layer.kind, ['surface', 'sculpture', 'fractal', 'oil', 'super8', 'graphic', 'image', ...INSTRUMENT_KINDS] as const, `${path}.kind`);
  text(layer.id, `${path}.id`, 100); text(layer.name, `${path}.name`);
  boolean(layer.visible, `${path}.visible`); number(layer.opacity, `${path}.opacity`, 0, 1);
  choice(layer.blend, ['normal', 'screen', 'multiply', 'add'] as const, `${path}.blend`);
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
  // These additive schema-1 controls postdate the original instrument formats.
  // Normalize only absent fields; explicit invalid values and unknown keys still fail.
  for (const key of [...(ADDED_FIELDS[kind] ?? []),...FINISH_KEYS,...(isInstrument(kind)?INSTRUMENT_UPGRADE_KEYS[kind]:[])]) {
    if (!own(params, key)) params[key] = DEFINITIONS[kind].find((definition) => definition.key === key)!.default;
  }
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
  return { ...structuredClone(input as Layer), params: params as Record<string, number> };
}

export function validateProject(input: unknown): Project {
  const project = object(input, 'root');
  keys(project, ['schemaVersion', 'id', 'name', 'seed', 'duration', 'fps', 'width', 'height', 'background', 'transparent', 'layers'], 'root');
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
  if (!Array.isArray(project.layers) || project.layers.length < 1 || project.layers.length > 4) fail('layers', 'must contain between one and four layers.');
  const layers = project.layers.map((layer,i)=>validateLayer(layer,i,project.schemaVersion as 1|2));
  if(layers.some(l=>l.kind==='livingink'&&l.params.inkMode===2)&&(project.duration as number)>60)fail('duration','must be at most 60 seconds for evolving pigment.');
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) fail('layers', 'contains duplicate layer IDs.');
  return { ...structuredClone(input as Project), layers };
}
