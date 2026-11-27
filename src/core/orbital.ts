import type { Layer, ParameterDefinition, Project } from '../shared/types';

export const ORBIT_TAU = 2 * Math.PI;
export const ORBIT_CAPACITY = 160;
export const ORBIT_CHOICES = {
  orbitLayout: ['Ring to spiral', 'Rosette', 'Helix', 'Knot', 'Lattice', 'Concentric rings'],
  orbitPiece: ['Enamel disc', 'Dome', 'Sphere', 'Ring', 'Rounded tile', 'Capsule'],
  orbitMotion: ['Wind and unwind', 'Travelling wave', 'Counter-rotation', 'Tumble', 'Breathe', 'Still'],
  orbitBackdrop: ['Morphing print', 'Solid', 'Bullseyes', 'Dots', 'Diamonds', 'Checker', 'Gradient', 'Clear', 'Contour lines', 'Woven lines'],
  orbitShadowModel: ['Cast', 'Soft contact'],
  orbitFinish: ['Enamel', 'Flat ink', 'Satin', 'Metallic'],
  orbitPlayback: ['Endless', 'Seamless loop', 'Fade cue'],
  orbitOrder: ['Centre outward', 'Outside inward', 'Around the ring'],
  orbitColourMode: ['Per piece', 'By arm', 'Along the path', 'By depth'],
  orbitFadeTarget: ['Whole picture', 'Background', 'Sculpture'],
} as const;

type Section = ParameterDefinition['section'];
function p(key: string, label: string, min: number, max: number, value: number, section: Section, step = .01, advanced = false): ParameterDefinition {
  return { key, label, min, max, default: value, section, step, advanced };
}
const shape = (key: string, label: string, min: number, max: number, value: number, step?: number) => p(key, label, min, max, value, 'Shape', step);
const motion = (key: string, label: string, min: number, max: number, value: number, step?: number, advanced?: boolean) => p(key, label, min, max, value, 'Motion', step, advanced);
const material = (key: string, label: string, min: number, max: number, value: number, step?: number, advanced?: boolean) => p(key, label, min, max, value, 'Material', step, advanced);
const ORBIT_INSTALLATION_PARAMETERS = [
  motion('orbitPhrasing', 'Long-form movement', 0, 1, 0),
  motion('orbitPhraseSeconds', 'Long-form cycle (seconds)', 8, 120, 36, 1, true),
  motion('orbitPaletteTime', 'Palette / finish blend (seconds)', 0, 8, 1.6),
  material('orbitShadowModel', 'Shadows', 0, 1, 0, 1),
  material('orbitPatternFocus', 'Quiet centre', 0, 1, 0),
  { ...material('orbitCleanDetail', 'Fine-detail filtering', 0, 1, 0), description: 'Softens fine pattern edges and reduces tiny accents as the mapped image gets smaller.' },
  { ...p('orbitSafeMargin', 'Safe frame margin', 0, .23, 0, 'Camera'), description: 'Keeps room for the whole movement using a fixed camera fit. 0 uses the Framing control directly.' },
];
export const ORBIT_INSTALLATION_KEYS = ORBIT_INSTALLATION_PARAMETERS.map(def => def.key);
export const ORBIT_PARAMETERS: ParameterDefinition[] = [
  shape('orbitLayout', 'Arrangement', 0, 5, 0, 1), shape('orbitPiece', 'Piece shape', 0, 5, 0, 1),
  shape('orbitCount', 'Piece count', 12, ORBIT_CAPACITY, 68, 1), shape('orbitArms', 'Arms / rows', 1, 12, 3, 1),
  shape('orbitRadius', 'Overall radius', .12, .66, .32), shape('orbitOpening', 'Centre opening', 0, .9, .57),
  shape('orbitTwist', 'Coiling', -2, 2, .88), shape('orbitDepth', 'Depth', 0, 1, .64),
  shape('orbitSize', 'Piece size', .012, .13, .059), shape('orbitMinimum', 'Minimum piece size', .06, 1, .31),
  shape('orbitScatter', 'Size variation', 0, 1, .22), shape('orbitAccent', 'Accent pieces', 0, 1, .64),
  shape('orbitAspect', 'Piece stretch', .5, 2, 1),
  motion('orbitMotion', 'Movement', 0, 5, 0, 1), motion('orbitPlayback', 'Playback', 0, 2, 0, 1),
  motion('orbitRate', 'Motion speed / direction', -2, 2, .62), motion('orbitAmount', 'Movement amount', 0, 1, .85),
  motion('orbitTurns', 'Turns per loop', -5, 5, 1, 1), motion('orbitCycles', 'Phrases per loop', 1, 12, 3, 1),
  motion('orbitSpread', 'Wave stagger', 0, 1, .54), motion('orbitOrder', 'Wave starts at', 0, 2, 0, 1),
  motion('orbitRoll', 'Piece tumble', 0, 1, .6), motion('orbitMorph', 'Morph duration (seconds)', 0, 8, 1.8),
  motion('orbitMorphStagger', 'Morph stagger', 0, .9, .31, .01, true),
  motion('orbitEase', 'Hold at the ends', 0, 1, .37, .01, true),
  motion('orbitBackgroundRate', 'Background speed / direction', -2, 2, .51),
  motion('orbitBackgroundCycles', 'Background cycles per loop', 0, 12, 4, 1),
  motion('orbitColourRate', 'Colour drift', -2, 2, 0),
  motion('orbitColourCycles', 'Colour turns per loop', -6, 6, 0, 1, true),
  motion('orbitFadeIn', 'Fade-in duration (seconds)', 0, 12, 0),
  motion('orbitFadeTime', 'Fade duration (seconds)', .1, 12, 1.5),
  motion('orbitFadeTarget', 'Fade affects', 0, 2, 0, 1),
  material('orbitBackdrop', 'Background', 0, ORBIT_CHOICES.orbitBackdrop.length - 1, 0, 1), material('orbitBackgroundMix', 'Background opacity', 0, 1, 1),
  material('orbitPatternSize', 'Pattern density', 4, 75, 21), material('orbitPatternContrast', 'Pattern contrast', 0, 1, .78),
  material('orbitPatternAngle', 'Pattern rotation', -Math.PI, Math.PI, 0, .01, true),
  material('orbitPaletteLink', 'Use sculpture colours in pattern', 0, 1, 0, .01, true),
  material('orbitPatternLink', 'Follow sculpture rhythm', 0, 1, 0, .01, true),
  material('orbitColourMode', 'Colour placement', 0, 3, 0, 1),
  material('orbitColourOffset', 'Colour position', 0, 1, 0), material('orbitColourBlend', 'Blend colour bands', 0, 1, .08),
  material('orbitCap', 'Colour cap size', .04, .9, .42), material('orbitRim', 'Ink rim', 0, .4, .11),
  material('orbitFinish', 'Piece finish', 0, 3, 0, 1), material('orbitLight', 'Light direction', -Math.PI, Math.PI, 2.1),
  material('orbitShadows', 'Shadow strength', 0, 1, .56), material('orbitSoftness', 'Shadow softness', 0, 1, .65),
  material('orbitFade', 'Manual fade', 0, 1, 0),
  material('saturation', 'Saturation', 0, 2, 1), material('hue', 'Hue shift', -Math.PI, Math.PI, 0), material('exposure', 'Exposure', .25, 2, 1),
  p('orbitCamera', 'Camera tilt', -.45, .45, .035, 'Camera'),
  p('orbitFraming', 'Framing', .55, 1.7, 1, 'Camera'),
  ...ORBIT_INSTALLATION_PARAMETERS,
];

export const ORBIT_SWATCHES = ['Face', 'Cap', 'Ink / rim', 'Ground', 'Pattern light', 'Pattern dark'];
export const ORBIT_PALETTES = [
  { name: 'Electric Blueprint', colors: ['#32a7f3', '#f5ff21', '#111421', '#42a7ea', '#ecfd3c', '#101926'] },
  { name: 'Porcelain and Cobalt', colors: ['#fcf3e2', '#5a8bfa', '#182b71', '#e4e0d7', '#fcf3e2', '#6c8bd0'] },
  { name: 'Traffic Heat', colors: ['#ff5d30', '#ffcb3c', '#481235', '#2b1236', '#f54963', '#711d45'] },
  { name: 'Violet and Lime', colors: ['#b5ff37', '#b057fd', '#151029', '#221744', '#7ddd57', '#0c141e'] },
  { name: 'Mercury and Peach', colors: ['#8ea7c3', '#ffc493', '#27324d', '#313545', '#a7b6c8', '#181e30'] },
  { name: 'Blacklight Coral', colors: ['#fc54a3', '#37f5eb', '#17133b', '#2a235c', '#8229ae', '#120e2c'] },
  { name: 'Ultramarine and Brass', colors: ['#365fff', '#ffd178', '#251610', '#181b55', '#c48745', '#0c0e26'] },
  { name: 'Acid Print', colors: ['#ebfb3c', '#f6f2e7', '#151914', '#e1e6a9', '#f6f2e7', '#465423'] },
  { name: 'Red Shift', colors: ['#fa3226', '#fba5a9', '#270b20', '#45152c', '#ed3853', '#220e19'] },
  { name: 'Copper on Aubergine', colors: ['#ff8361', '#ffd799', '#321123', '#34172c', '#a35b76', '#261120'] },
  { name: 'Glacier Light', colors: ['#66d4ff', '#a7ffdf', '#193e66', '#132849', '#466d8f', '#0e1d35'] },
  { name: 'Newsprint', colors: ['#f4f2e9', '#a3a199', '#171717', '#b7b6ad', '#f4f2e9', '#292928'] },
];

export const ORBIT_LOOKS: { id: string; name: string; description: string; palette: number; params: Record<string, number> }[] = [
  { id: 'orbital-blueprint', name: 'Electric Blueprint', description: 'Cyan and acid yellow enamel coils above a changing printed grid.', palette: 0, params: {} },
  { id: 'orbital-porcelain', name: 'Porcelain Rosette', description: 'A slow petal wave across a quiet cobalt print.', palette: 1, params: { orbitLayout: 1, orbitPiece: 1, orbitCount: 84, orbitArms: 7, orbitMotion: 1, orbitRate: .26, orbitBackdrop: 4, orbitPatternContrast: .34, orbitFinish: 2, orbitSpread: .82 } },
  { id: 'orbital-traffic', name: 'Traffic Spiral', description: 'Hot discs fold in opposing directions over a dark dotted field.', palette: 2, params: { orbitMotion: 2, orbitArms: 4, orbitTwist: 1.4, orbitBackdrop: 3, orbitRate: .95, orbitBackgroundRate: -.34, orbitColourRate: .14 } },
  { id: 'orbital-mercury', name: 'Mercury Helix', description: 'Metallic links wind in depth over a soft gradient.', palette: 4, params: { orbitLayout: 2, orbitPiece: 3, orbitFinish: 3, orbitMotion: 3, orbitBackdrop: 6, orbitDepth: .94, orbitCount: 48, orbitShadows: .65 } },
  { id: 'orbital-lattice', name: 'Blacklight Lattice', description: 'A staggered grid of tiles tumbles over a fine checker.', palette: 5, params: { orbitLayout: 4, orbitPiece: 4, orbitArms: 8, orbitCount: 64, orbitMotion: 1, orbitBackdrop: 5, orbitPatternContrast: .4, orbitFinish: 1, orbitSize: .062 } },
  { id: 'orbital-knot', name: 'Brass Knot', description: 'Capsules trace a deep knot against a solid ultramarine ground.', palette: 6, params: { orbitLayout: 3, orbitPiece: 5, orbitArms: 2, orbitCount: 70, orbitMotion: 4, orbitBackdrop: 1, orbitFinish: 3, orbitSize: .05, orbitDepth: .8 } },
  { id: 'orbital-wall-blueprint', name: 'Wall Blueprint', description: 'A blue and yellow spiral with a quiet centre and a slow second rhythm.', palette: 0,
    params: { orbitCount: 76, orbitSize: .063, orbitOpening: .63, orbitRate: .44, orbitBackgroundRate: .23, orbitPatternSize: 18, orbitPatternFocus: .8,
      orbitPatternContrast: .72, orbitPhrasing: .68, orbitPhraseSeconds: 32, orbitCleanDetail: .8, orbitSafeMargin: .06, orbitShadowModel: 1, orbitShadows: .66 } },
  { id: 'orbital-amber-aperture', name: 'Amber Aperture', description: 'Warm satin discs on clear, with soft shadows for layering over a mapped surface.', palette: 9,
    params: { orbitLayout: 5, orbitPiece: 1, orbitArms: 3, orbitCount: 56, orbitRate: .22, orbitSize: .072, orbitMotion: 2, orbitBackdrop: 7, orbitFinish: 2,
      orbitPhrasing: .84, orbitPhraseSeconds: 49, orbitSafeMargin: .12, orbitCleanDetail: 1, orbitShadowModel: 1, orbitShadows: .62 } },
  { id: 'orbital-glacier', name: 'Glacier Relief', description: 'A slow aqua rosette above contour lines, opening from the outside inward.', palette: 10,
    params: { orbitLayout: 1, orbitPiece: 1, orbitArms: 6, orbitCount: 66, orbitMotion: 1, orbitOrder: 1, orbitSpread: .83, orbitAmount: .46, orbitRate: .27, orbitBackgroundRate: .12,
      orbitBackdrop: 8, orbitPatternSize: 13, orbitPatternFocus: .63, orbitPatternContrast: .62, orbitFinish: 2, orbitPhrasing: .91, orbitPhraseSeconds: 52,
      orbitSize: .068, orbitMinimum: .47, orbitSafeMargin: .035, orbitCleanDetail: 1, orbitShadowModel: 1, orbitShadows: .72 } },
  { id: 'orbital-ink', name: 'Floating Ink', description: 'Concentric discs on a transparent ground for layering.', palette: 11, params: { orbitLayout: 5, orbitPiece: 0, orbitArms: 3, orbitMotion: 2, orbitBackdrop: 7, orbitFinish: 1, orbitCount: 76, orbitRate: .33 } },
];

export const hasOrbital = (project: Project) => project.layers.some(layer => layer.visible && layer.kind === 'orbital');

export function orbitFade(layer: Layer, phase: number, duration: number, liveSeconds?: number): number {
  const p = layer.params;
  const seconds = liveSeconds ?? Math.max(0, Math.min(1, phase / ORBIT_TAU)) * duration;
  const fadeTime = Math.min(duration, p.orbitFadeTime);
  const amount = p.orbitPlayback === 2 ? Math.max(0, Math.min(1, (seconds - duration + fadeTime) / fadeTime)) : 0;
  const cue = amount * amount * (3 - 2 * amount);
  const fadeIn = p.orbitPlayback === 2 && p.orbitFadeIn > 0 ? Math.min(1, seconds / p.orbitFadeIn) : 1;
  return (1 - p.orbitFade) * (1 - cue) * fadeIn * fadeIn * (3 - 2 * fadeIn);
}

export function orbitVisibleParameter(layer: Layer, key: string): boolean {
  const p = layer.params;
  if (key === 'orbitRate' || key === 'orbitBackgroundRate' || key === 'orbitColourRate') return p.orbitPlayback !== 1;
  if (key === 'orbitTurns' || key === 'orbitCycles' || key === 'orbitBackgroundCycles' || key === 'orbitColourCycles') return p.orbitPlayback === 1;
  if (key === 'orbitPatternLink') return p.orbitBackdrop === 0 || p.orbitBackdrop === 8 || p.orbitBackdrop === 9;
  if (key === 'orbitPhraseSeconds') return p.orbitPlayback !== 1 && p.orbitPhrasing > 0;
  if (key === 'orbitPatternFocus') return ![1, 6, 7].includes(p.orbitBackdrop);
  if (key === 'orbitFadeTime' || key === 'orbitFadeIn') return p.orbitPlayback === 2;
  return true;
}
