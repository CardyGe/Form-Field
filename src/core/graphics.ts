import { TIMING_KEYS, TIMING_PARAMETERS } from './timing';
import { ACID_DRIP, CANDY, HOT_SIGNAL, LIME_VIOLET, NEON_STRATA, POP_PORTAL } from './palettes';
import type { ParameterDefinition } from '../shared/types';

export const GRAPHIC_FAMILIES = ['Pillars', 'Circle blooms', 'Packed tiles', 'Spiral forms', 'Circuit paths'];
export const GRAPHIC_VARIANTS = [
  ['Wave', 'Uneven pillars', 'Lava columns', 'Fine bars', 'Warm curtains', 'Green tide'],
  ['Concentric halo', 'Orbital bloom', 'Counter-rotating fans'],
  ['Mosaic', 'Hollow frames', 'Nested contours', 'Travelling morph', 'Mint / Magenta', 'Cross Current', 'Glass Ripple'],
  ['Beaded spiral', 'Polygon tunnel', 'Woven vortex', 'Web rosette', 'Line interference', 'Coiling ribbon', 'Particle rays', 'Disc mandala', 'Monochrome vortex'],
  ['Circuit worms', 'Directional channels', 'Mirrored carpet', 'Radial core'],
];
const p = (key: string, label: string, min: number, max: number, step: number, value: number, section: ParameterDefinition['section'] = 'Shape'): ParameterDefinition =>
  ({ key, label, min, max, step, default: value, section });
export const CELL_WAVE_KEYS = ['cellMinimum', 'cellFrames', 'cellInset', 'cellColourLead', 'cellRim', 'cellGrain',
  'cellMetallic', 'cellIridescence', 'cellRoughness', 'cellLightAngle', 'cellLightTravel',
  'cellAudioAmount', 'cellAudioSource', 'cellLightField', 'cellLightLayout', 'cellLightCycles'];

export function isCellWave(style: number, variant: number): boolean {
  return style === 2 && variant >= 4;
}

export const CELL_LIGHT_LAYOUTS = ['Diagonal sweep', 'Crossing bands', 'Ripples'];
export const CELL_LIGHT_CYCLES = ['Match tile motion', '1 cycle', '2 cycles', '3 cycles', '4 cycles', '5 cycles', '6 cycles', '7 cycles', '8 cycles'];

export const CELL_AUDIO_SOURCES = [
  { label: 'Detected beat', signal: 'beat.pulse' },
  { label: 'Bass', signal: 'audio.bass' },
  { label: 'Midrange', signal: 'audio.mids' },
  { label: 'Highs', signal: 'audio.highs' },
  { label: 'Overall level', signal: 'audio.level' },
];

/** Shape the shared audio envelope. Keep peak response bounded even with over-range input. */
export function cellAudioHighlight(amount: number, source: number, signals?: Readonly<Record<string, number>>): number {
  const level = signals?.[CELL_AUDIO_SOURCES[source]?.signal ?? 'beat.pulse'];
  if (!(amount > 0) || level === undefined || !Number.isFinite(level)) return 0;
  const strength = Math.min(1, Math.max(0, (level - .06) / .94));
  return Math.min(amount, 1) * strength * strength * (3 - 2 * strength);
}

export const GRAPHIC_PARAMETERS: ParameterDefinition[] = [
  p('style','Family',0,4,1,0), p('variant','Look',0,8,1,0),
  p('size','Pattern size',.25,2,.01,1), p('stretch','Pattern stretch',.4,2.5,.01,1),
  p('centerX','Pattern horizontal',-1,1,.01,0), p('centerY','Pattern vertical',-1,1,.01,0),
  p('orientation','Pattern angle',-Math.PI,Math.PI,.01,0),
  p('motion','Motion depth',0,1,.01,.65,'Motion'), p('cycles','Cycles per loop',1,8,1,1,'Motion'),
  p('turns','Full turns per loop',-4,4,1,0,'Motion'), p('phaseOffset','Motion phase',0,1,.01,0,'Motion'),
  p('colorOffset','Palette position',0,1,.01,0,'Material'), p('colorDensity','Palette repeats',.25,8,.01,1,'Material'),
  p('colorDrift','Palette motion',0,1,.01,0,'Motion'), p('colorBalance','Color balance',.2,3,.01,1,'Material'),
  p('backgroundOpacity','Pattern background',0,1,.01,1,'Material'),
  p('softness','Edge softness',0,3,.01,.15,'Material'), p('stroke','Outline width',.25,8,.01,1.25,'Material'),
  p('saturation','Saturation',0,2,.01,1,'Material'),p('hue','Hue shift',-Math.PI,Math.PI,.01,0,'Material'),p('exposure','Exposure',.25,2,.01,1,'Material'),
  p('columns','Columns',6,180,1,56), p('widthScatter','Uneven widths',0,.9,.01,.1),
  p('amplitude','Wave height',0,.44,.01,.3), p('waveCount','Waves across',.25,6,.01,2),
  p('gap','Centre opening',.005,.4,.005,.035),p('gutter','Column spacing',0,10,.1,2),p('roundness','Corner roundness',0,1,.01,1),
  p('circleCount','Circle layers',8,96,1,48),p('radius','Outer radius',.12,1.1,.01,.48),
  p('orbit','Orbit spread',0,1.3,.01,.012),p('coil','Layer twist',-6.28,6.28,.01,.18),
  p('coilDepth','Coiling depth',0,2.5,.01,.45,'Motion'),p('breathing','Breathing',0,.3,.01,.035,'Motion'),
  p('tileResolution','Tile density',8,64,1,36),p('tileArea','Largest tile',1,12,1,5),
  p('tileGap','Tile spacing',0,.22,.005,.07),p('fill','Tile finish',0,2,1,0,'Material'),
  p('contourSpacing','Contour spacing',1.5,24,.1,5,'Material'),p('contourDuty','Contour thickness',.15,.85,.01,.45,'Material'),
  p('sweep','Wave layout',0,2,1,1,'Motion'),p('sweepAngle','Wave direction',-Math.PI,Math.PI,.01,.7,'Motion'),
  p('sweepWidth','Wave width',.04,.65,.01,.22,'Motion'),p('sweepSpread','Wave spread',.2,3,.01,1,'Motion'),
  p('shrink','Wave shrink',0,.8,.01,.4,'Motion'),p('rounding','Wave rounding',0,1,.01,1,'Motion'),
  p('cellMinimum','Minimum cell size',0,.65,.01,.16), p('cellFrames','Hollow frames',0,1,.01,1,'Material'),
  p('cellInset','Inset tiles',0,1,.01,.65,'Material'), p('cellRim','Lit edges',0,1,.01,.55,'Material'),
  p('cellGrain','Surface grain',0,1,.01,.4,'Material'), p('cellColourLead','Colour phase lead',-.5,.5,.01,.09,'Motion'),
  p('cellMetallic','Metallic sheen',0,1,.01,0,'Material'),
  p('cellIridescence','Iridescence',0,1,.01,0,'Material'),
  p('cellRoughness','Reflection roughness',0,1,.01,.5,'Material'),
  p('cellLightAngle','Light angle',-Math.PI,Math.PI,.01,.72,'Material'),
  p('cellLightTravel','Light sweep',0,1.5,.01,.46,'Material'),
  p('cellLightField','Light across tiles',0,1,.01,0,'Material'),
  p('cellLightLayout','Reflection pattern',0,CELL_LIGHT_LAYOUTS.length-1,1,0,'Material'),
  p('cellLightCycles','Light cycles per loop',0,CELL_LIGHT_CYCLES.length-1,1,0,'Motion'),
  p('cellAudioAmount','Audio highlight',0,1,.01,0,'Material'),
  p('cellAudioSource','Highlight input',0,CELL_AUDIO_SOURCES.length-1,1,0,'Material'),
  p('glyphCount','Spiral detail',64,900,1,500),p('profile','Shape profile',0,9,1,0),
  p('spacing','Spiral spacing',.001,.012,.0001,.003),p('angularStep','Spiral angle',-Math.PI,Math.PI,.001,1.082),
  p('glyphSize','Shape size',.015,1.5,.005,.1),p('growth','Size falloff',.5,1.5,.01,1),
  p('profileAngle','Shape angle',-Math.PI,Math.PI,.01,0),p('twistDepth','Spiral coiling',0,.8,.001,0,'Motion'),
  p('pathResolution','Path density',12,64,1,40),p('pathLength','Path length',2,160,1,9),
  p('pathWidth','Path thickness',.12,.92,.01,.52,'Material'),p('hollow','Path hollowness',0,.88,.01,.55,'Material'),
  p('direction','Channel direction',-Math.PI,Math.PI,.01,0),p('bias','Direction strength',0,1,.01,.85),
  p('corners','Path corners',0,2,1,1),p('reveal','Draw amount',.05,1,.01,1,'Motion'),p('hold','Hold open',0,.8,.01,.2,'Motion'),
  p('innerRadius','Ring inner radius',.04,.45,.01,.2),p('ringWidth','Ring width',.03,.3,.01,.16),
  ...TIMING_PARAMETERS.map(d => ({ ...d }))
];
const common = [...TIMING_KEYS,'style','variant','size','stretch','centerX','centerY','orientation','motion','cycles','turns','phaseOffset','colorOffset','colorDensity','colorDrift','colorBalance','backgroundOpacity','softness','saturation','hue','exposure'];
const familyKeys = [
  ['columns','widthScatter','amplitude','waveCount','gap','gutter','roundness'],
  ['circleCount','radius','orbit','coil','coilDepth','breathing'],
  ['tileResolution','tileArea','tileGap','roundness','fill','stroke','contourSpacing','contourDuty','sweep','sweepAngle','sweepWidth','sweepSpread','shrink','rounding'],
  ['glyphCount','profile','spacing','angularStep','glyphSize','growth','profileAngle','twistDepth','stroke'],
  ['pathResolution','pathLength','pathWidth','hollow','direction','bias','corners','reveal','hold','innerRadius','ringWidth'],
];
export function graphicVisibleKeys(style: number, variant: number, fill: number, sweep: number): Set<string> {
  const keys = new Set([...common,...(familyKeys[style] ?? [])]);
  if (isCellWave(style, variant)) {
    const cellKeys = ['tileResolution', 'tileGap', 'roundness', 'sweepWidth', 'sweepSpread', ...CELL_WAVE_KEYS];
    if (variant !== 6) cellKeys.push('sweepAngle');
    return new Set([...common, ...cellKeys]);
  }
  if (style === 2) {
    if (fill !== 1) keys.delete('stroke');
    if (fill !== 2) { keys.delete('contourSpacing');keys.delete('contourDuty'); }
    if (sweep !== 1) keys.delete('sweepAngle');
  }
  if (style === 4) {
    if (variant !== 1) {keys.delete('direction');keys.delete('bias');}
    if (variant !== 3) {keys.delete('innerRadius');keys.delete('ringWidth');}
    keys.delete('turns');
  }
  return keys;
}
export interface GraphicLook { id: string; name: string; description: string; palette: string[]; params: Record<string, number> }
const purple = ['#c844ed','#9a2fe1','#7a25c8','#502099','#341079','#05040b'];
const aqua = ['#9f5cfe','#816cf4','#548de9','#30b7e5','#17ffef','#03040a'];
const green = ['#abff91','#83d781','#54a296','#40528b','#291766','#050809'];
const mono = ['#ffffff','#dddddd','#aaaaaa','#666666','#292929','#000000'];
const warm = ['#fff394','#ffd078','#ffa659','#ff6a63','#ed365d','#080305'];
const red = ['#f42d39','#e31928','#ae1322','#761020','#471019','#030205'];
// Each family's elements start at their own time (Delay spread) and hold still
// for part of the cycle (Pause), so the field moves as a wave rather than in unison.
const FAMILY_TIMING: Record<number, Record<string, number>> = {
  0: { delayShape: 0, delaySpread: .25, pause: .4 },
  1: { delayShape: 1, delaySpread: .6, pause: .3 },
  2: { delayShape: 2, delaySpread: .4, pause: .4 },
  3: { delayShape: 1, delaySpread: .5, pause: .3 },
  4: { delayShape: 1, delaySpread: .7, pause: 0 },
};
const look = (id: string,name: string,description: string,style: number,variant: number,palette: string[],params: Record<string, number>): GraphicLook => ({id,name,description,palette,params:{style,variant,...FAMILY_TIMING[style],...params}});
const cellWaveDefaults = { tileResolution: 16, tileArea: 1, tileGap: .055, roundness: .16,
  sweepWidth: .27, sweepSpread: 1, motion: 1, delaySpread: 0, pause: 0 };
export const CELL_WAVE_PALETTES = [
  {name:'Mint / Magenta',colors:['#a5efc8','#c5ecdb','#785399','#df40b9','#ff74d8','#181912']},
  {name:'Cross Current',colors:['#49d7ee','#71e0ff','#ff802b','#7065ff','#aec6ff','#080c20']},
  {name:'Glass Ripple',colors:['#57d8c2','#9af3db','#82965d','#ffaf5d','#ffdf9c','#0a1919']},
  {name:'Brushed Copper',colors:['#ff9e63','#ffd3a5','#a85d41','#c26848','#efb36a','#1c0e0a']},
  {name:'Liquid Chrome',colors:['#7994b0','#cad9e8','#5b708d','#e6f2fb','#a3bacb','#0d1420']},
  {name:'Opal',colors:['#8ee9ec','#c7f8da','#c2afff','#ffbde2','#ffdccb','#151529']},
  {name:'Oil Slick',colors:['#62c89a','#a4ed6b','#f2bf55','#875cf4','#e58fef','#10101d']},
  {name:'Titanium Blue',colors:['#4d68ff','#7dd8ff','#839cc4','#489ab9','#78ffec','#09152a']},
  {name:'Rose Gold',colors:['#fa835f','#ffd0b4','#a4707c','#e98fa6','#ffd4bd','#241323']},
  {name:'Jade & Gold',colors:['#40c699','#80efd2','#bdb56f','#ffc052','#ffec9b','#071a15']},
  {name:'Ultraviolet & Lime',colors:['#bff656','#e7ff9d','#5856ba','#a284ff','#c2a3ff','#141029']},
  {name:'Ember & Ice',colors:['#ff704d','#ffad6b','#77558d','#68c8ff','#b3ecff','#12152b']},
  {name:'Midnight Fuchsia',colors:['#646bff','#8fb2ff','#7347ab','#ff53b5','#ff9cdb','#120a24']},
  {name:'Pearl & Ink',colors:['#b8b3a9','#eee6d8','#8d8c9c','#a3b9d0','#e0eafa','#171922']},
  {name:'Coral & Petrol',colors:['#e9a285','#ffcbb0','#356f94','#399ed0','#7fe1dd','#0c1821']},
];
export const GRAPHIC_LOOKS: GraphicLook[] = [
  look('lava-columns','Lava Columns','Wide rounded columns move like graphic lava.',0,2,HOT_SIGNAL,{columns:10,widthScatter:.3,amplitude:.28,gap:.05,gutter:6,waveCount:1}),
  look('uneven-pillars','Uneven Pillars','Unequal candy-coloured columns gather into broad waves.',0,1,CANDY,{columns:32,widthScatter:.65,waveCount:1.3}),
  look('warm-curtains','Warm Curtains','Coral and amber curtains leave a flowing dark channel.',0,4,warm,{columns:100,amplitude:.05,gap:.23,gutter:1,waveCount:3}),
  look('green-tide','Green Tide','Luminous green pillars sweep through deep blue.',0,5,green,{columns:80,amplitude:.38,waveCount:2.5,gutter:2}),
  look('circle-fans','Circle Fans','Opposite circle stacks sweep into warm fans and propellers.',1,2,warm,{orbit:.7,coil:2.75,coilDepth:.55,radius:.66,turns:1,motion:.75}),
  look('packed-mosaic','Packed Mosaic','Seeded cyan and violet bricks pack into a crisp field.',2,0,aqua,{fill:0,tileResolution:40,roundness:.08,sweep:1,shrink:.3}),
  look('nested-tiles','Nested Tiles','Nested neon rectangles become rings and capsules.',2,2,NEON_STRATA,{fill:2,tileResolution:22,tileArea:7,contourSpacing:5,roundness:.38,sweep:1}),
  look('graphic-mint-magenta','Mint / Magenta','Mint and pink sweep through dots, hollow frames and rounded tiles.',2,4,
    CELL_WAVE_PALETTES[0].colors,
    {...cellWaveDefaults,sweepAngle:-1.15,cellGrain:.62,cellRim:.7,cellMetallic:.22,cellIridescence:.13,cellLightField:.55}),
  look('graphic-cross-current','Cross Current','Crossing waves reveal orange where their blue fronts meet.',2,5,
    CELL_WAVE_PALETTES[1].colors,
    {...cellWaveDefaults,tileResolution:23,sweepAngle:.48,sweepWidth:.31,cellColourLead:.05,cellRim:.43,cellMetallic:.27,cellIridescence:.19,cellLightField:.7,cellLightLayout:1}),
  look('graphic-ripple-glass','Glass Ripple','Expanding rings leave hollow amber and teal cells in their wake.',2,6,
    CELL_WAVE_PALETTES[2].colors,
    {...cellWaveDefaults,tileResolution:26,sweepWidth:.21,cellInset:.88,cellRim:.85,cellGrain:.25,cellMetallic:.19,cellIridescence:.28,cellLightField:.64,cellLightLayout:2}),
  look('beaded-spiral','Beaded Spiral','Acid beads curl into a finely sampled spiral.',3,0,ACID_DRIP,{profile:0,glyphSize:.05,angularStep:1.082,turns:1,colorDensity:2,twistDepth:.004}),
  look('polygon-tunnel','Polygon Tunnel','Large seven-sided forms overlap into a green contour tunnel.',3,1,green,{profile:6,glyphSize:.5,angularStep:1.4486,spacing:.0024,stroke:.8,colorDensity:5,turns:1,twistDepth:.003}),
  look('web-rosette','Web Rosette','Outlined overlapping circles reveal a scalloped neon rosette.',3,3,POP_PORTAL,{profile:0,glyphSize:.5,angularStep:.576,spacing:.0025,stroke:1.1,colorDensity:5,turns:1}),
  look('coiling-ribbon','Coiling Ribbon','Overlapping pentagons form a broad magenta spiral ribbon.',3,5,purple,{profile:4,glyphSize:.5,angularStep:.035,twistDepth:.028,spacing:.0025,stroke:.55,motion:.8,colorDensity:3}),
  look('particle-rays','Particle Rays','Warm hexagonal beads coil into luminous spokes.',3,6,warm,{profile:5,glyphSize:.065,angularStep:.91,twistDepth:.18,spacing:.0035,stroke:.5,motion:.8,turns:1,colorDensity:3}),
  look('disc-mandala','Disc Mandala','Overlapping outlined discs open and close into spiral scales.',3,7,LIME_VIOLET,{profile:0,glyphSize:.09,angularStep:1.134,twistDepth:.12,spacing:.003,stroke:.85,motion:.65,colorDensity:3}),
  look('circuit-worms','Circuit Worms','Short hollow hot-pink paths grow and retract over a dark field.',4,0,HOT_SIGNAL,{pathResolution:42,pathLength:9,pathWidth:.52,hollow:.55,motion:.85}),
  look('circuit-channels','Circuit Channels','Long parallel paths gather into blue and pink channels.',4,1,['#ee83f2','#ca58ed','#a144eb','#7453ea','#3c3af0','#040309'],{pathResolution:42,pathLength:120,pathWidth:.7,hollow:.2,direction:0,bias:.95,motion:.85}),
  look('maze-carpet','Maze Carpet','Mirrored fine paths reveal an acid-coloured ornamental maze.',4,2,ACID_DRIP,{pathResolution:48,pathLength:28,pathWidth:.5,hollow:.6,motion:.8}),
  look('radial-circuit','Radial Circuit','Attractor-guided paths surround a dark ring and central core.',4,3,NEON_STRATA,{pathResolution:52,pathLength:18,pathWidth:.55,hollow:.55,innerRadius:.2,ringWidth:.16,motion:.85}),
];
