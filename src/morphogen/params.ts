/**
 * Morphogen's parameters: one table that the solver, shading, panel, validation and sound links all read.
 * Values are plain numbers so a whole look fits in the Live settings message.
 */
export type MorphSection = 'Pattern' | 'Flow' | 'Forms' | 'Motion' | 'Relief' | 'Material' | 'Iridescence' | 'Colour' | 'Camera' | 'Finish' | 'Reaction' | 'System';

const c = <K extends string>(key: K, label: string, section: MorphSection, min: number, max: number, value: number, description: string, step = .01) =>
  ({ key, label, section, min, max, step, default: value, description });

const TABLE = [
  c('wavelength', 'Stripe width', 'Pattern', 7, 32, 12, 'Distance between stripes, in simulation pixels.', .1),
  c('drive', 'Drive', 'Pattern', .05, .7, .28, 'How strongly the pattern grows. Higher is bolder and quicker to reform.'),
  c('asymmetry', 'Fingers', 'Pattern', 0, .7, .12, 'Moves even stripes toward fat fingers and cells.'),
  c('alignment', 'Alignment', 'Pattern', 0, 1, .65, 'How firmly stripes follow the flow field.'),
  c('forkRate', 'Fork rate', 'Pattern', 0, 1, .3, 'How often small disturbances open new forks.'),
  c('lineSharp', 'Line sharpness', 'Pattern', 0, 1, .45, 'Rounds or sharpens the stripe profile.'),
  c('seed', 'Seed', 'Pattern', 0, 9999, 1, 'The starting arrangement of the pattern.', 1),
  c('fieldType', 'Flow type', 'Flow', 0, 5, 0, 'Radial, spiral, swirl, parallel, poles or curl.', 1),
  c('fieldMix', 'Flow mix', 'Flow', 0, 1, .2, 'Blends the chosen flow with slow organic curl.'),
  c('centreX', 'Centre X', 'Flow', -1, 1, 0, 'Horizontal centre of the flow.'),
  c('centreY', 'Centre Y', 'Flow', -1, 1, 0, 'Vertical centre of the flow.'),
  c('spiral', 'Spiral', 'Flow', -1, 1, 0, 'Twists the flow clockwise or anticlockwise.'),
  c('curlAmount', 'Curl amount', 'Flow', 0, 1, .2, 'How far organic curl bends the flow.'),
  c('curlScale', 'Curl scale', 'Flow', .3, 6, 1.4, 'Size of the organic curl. Higher is smaller and busier.'),
  c('formType', 'Form', 'Forms', 0, 3, 1, 'None, disc, ring or soft blob.', 1),
  c('formX', 'Form X', 'Forms', -1, 1, 0, 'Horizontal position of the form.'),
  c('formY', 'Form Y', 'Forms', -1, 1, 0, 'Vertical position of the form.'),
  c('formSize', 'Form size', 'Forms', .05, .9, .42, 'Radius of the form as a share of picture height.'),
  c('formSoft', 'Form softness', 'Forms', 0, .3, .02, 'How gradually the form edge blends.', .005),
  c('refraction', 'Refraction', 'Forms', 0, 1, .45, 'How strongly the form bends the picture like a lens.'),
  c('formWavelength', 'Inner stripe width', 'Forms', .5, 2, .8, 'Stripe width inside the form, relative to outside.'),
  c('orbit', 'Orbit', 'Forms', 0, 1, .45, 'How far the form slowly wanders.'),
  c('speed', 'Speed', 'Motion', 0, 4, 1, 'How fast the simulation runs. Zero holds the growth.'),
  c('flowSpeed', 'Streaming', 'Motion', 0, 1, .6, 'Carries stripes and forks along the flow, with slow eddies.'),
  c('surge', 'Surge', 'Motion', 0, 1, .4, 'Rings that squeeze and release the stripes as they travel outward.'),
  c('shimmer', 'Shimmer', 'Motion', 0, 1, .7, 'Sweeps light, reflections and film colour across the surface.'),
  c('breathing', 'Breathing', 'Motion', 0, 1, .35, 'Slowly widens and narrows the stripes to keep them moving.'),
  c('travel', 'Travel', 'Motion', 0, 1, .3, 'A slow wave of stronger and weaker growth across the picture.'),
  c('fieldDrift', 'Flow drift', 'Motion', 0, 1, .4, 'How quickly the flow field itself changes.'),
  c('freezeFloor', 'Keep alive', 'Motion', 0, 1, .35, 'Minimum activity before the engine stirs a settled pattern.'),
  c('depth', 'Depth', 'Relief', 0, 2, 1, 'Height of the stripes in the lighting.'),
  c('bevel', 'Bevel', 'Relief', 0, 1, .4, 'Width of the rounded shoulder on each stripe.'),
  c('roughness', 'Roughness', 'Material', .04, .9, .2, 'Mirror-like when low, satin when high.'),
  c('metal', 'Metal', 'Material', 0, 1, .85, 'How much reflections take on the surface colour.'),
  c('clearcoat', 'Clear coat', 'Material', 0, 1, .5, 'A glossy layer over the surface.'),
  c('lightAngle', 'Light angle', 'Material', -3.14, 3.14, -.7, 'Direction of the main light.'),
  c('envRotate', 'Reflection angle', 'Material', -3.14, 3.14, 0, 'Rotates the studio reflected in the surface.'),
  c('irid', 'Iridescence', 'Iridescence', 0, 1, .6, 'Strength of the oil-film rainbow.'),
  c('filmNm', 'Film thickness', 'Iridescence', 100, 900, 420, 'Thickness of the film in nanometres. Changes the rainbow colours.', 1),
  c('filmVary', 'Film variation', 'Iridescence', 0, 1, .5, 'How much film thickness follows the stripe height.'),
  c('filmIor', 'Film index', 'Iridescence', 1.1, 2.4, 1.45, 'Optical density of the film. Higher gives stronger colour bands.'),
  c('palette', 'Palette', 'Colour', 0, 11, 0, 'The colour family.', 1),
  c('colourShift', 'Colour shift', 'Colour', 0, 1, 0, 'Moves the picture through its palette.'),
  c('colourZones', 'Colour zones', 'Colour', 0, 1, .5, 'Separates large areas of the picture into different colours.'),
  c('saturation', 'Saturation', 'Colour', 0, 2, 1, 'Colour intensity.'),
  c('exposure', 'Exposure', 'Colour', .25, 2, 1, 'Overall brightness before the flash limiter.'),
  c('bloom', 'Bloom', 'Finish', 0, 1, .25, 'Soft glow around the brightest highlights.'),
  c('chroma', 'Colour split', 'Finish', 0, 1, .2, 'Lens-like colour fringing on slopes.'),
  c('grain', 'Grain', 'Finish', 0, 1, .05, 'Fine film grain that hides projector banding.'),
  c('quality', 'Quality', 'System', 0, 2, 1, 'Simulation size: 432, 576 or 720 lines.', 1),
] as const;

export type MorphKey = typeof TABLE[number]['key'];
export interface MorphControl { key: MorphKey; label: string; section: MorphSection; min: number; max: number; step: number; default: number; description: string; advanced?: boolean }
export type MorphParams = Record<MorphKey, number>;
export const MORPH_CONTROLS: readonly MorphControl[] = TABLE;

export function defaultMorphParams(): MorphParams {
  return Object.fromEntries(MORPH_CONTROLS.map(x => [x.key, x.default])) as MorphParams;
}

/** Repairs a saved or incoming set field by field: a bad value becomes its default, an extreme one its limit. */
export function validateMorphParams(value: unknown): MorphParams {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(MORPH_CONTROLS.map(x => {
    const v = raw[x.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return [x.key, x.default];
    const limited = Math.max(x.min, Math.min(x.max, v));
    return [x.key, x.step === 1 ? Math.round(limited) : limited];
  })) as MorphParams;
}
