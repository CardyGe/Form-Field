import type { ParameterDefinition } from '../shared/types';

export const GRAPHIC_FAMILIES = ['Pillars', 'Circle blooms', 'Packed tiles', 'Spiral forms', 'Circuit paths'];
export const GRAPHIC_VARIANTS = [
  ['Wave', 'Uneven pillars', 'Lava columns', 'Fine bars', 'Warm curtains', 'Green tide'],
  ['Concentric halo', 'Orbital bloom', 'Counter-rotating fans'],
  ['Mosaic', 'Hollow frames', 'Nested contours', 'Travelling morph'],
  ['Beaded spiral', 'Polygon tunnel', 'Woven vortex', 'Web rosette', 'Line interference', 'Coiling ribbon', 'Particle rays', 'Disc mandala', 'Monochrome vortex'],
  ['Circuit worms', 'Directional channels', 'Mirrored carpet', 'Radial core'],
];
const p = (key: string, label: string, min: number, max: number, step: number, value: number, section: ParameterDefinition['section'] = 'Shape'): ParameterDefinition =>
  ({ key, label, min, max, step, default: value, section });
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
  p('glyphCount','Spiral detail',64,900,1,500),p('profile','Shape profile',0,9,1,0),
  p('spacing','Spiral spacing',.001,.012,.0001,.003),p('angularStep','Spiral angle',-Math.PI,Math.PI,.001,1.082),
  p('glyphSize','Shape size',.015,1.5,.005,.1),p('growth','Size falloff',.5,1.5,.01,1),
  p('profileAngle','Shape angle',-Math.PI,Math.PI,.01,0),p('twistDepth','Spiral coiling',0,.8,.001,0,'Motion'),
  p('pathResolution','Path density',12,64,1,40),p('pathLength','Path length',2,160,1,9),
  p('pathWidth','Path thickness',.12,.92,.01,.52,'Material'),p('hollow','Path hollowness',0,.88,.01,.55,'Material'),
  p('direction','Channel direction',-Math.PI,Math.PI,.01,0),p('bias','Direction strength',0,1,.01,.85),
  p('corners','Path corners',0,2,1,1),p('reveal','Draw amount',.05,1,.01,1,'Motion'),p('hold','Hold open',0,.8,.01,.2,'Motion'),
  p('innerRadius','Ring inner radius',.04,.45,.01,.2),p('ringWidth','Ring width',.03,.3,.01,.16),
];
const common = ['style','variant','size','stretch','centerX','centerY','orientation','motion','cycles','turns','phaseOffset','colorOffset','colorDensity','colorDrift','colorBalance','backgroundOpacity','softness','saturation','hue','exposure'];
const familyKeys = [
  ['columns','widthScatter','amplitude','waveCount','gap','gutter','roundness'],
  ['circleCount','radius','orbit','coil','coilDepth','breathing'],
  ['tileResolution','tileArea','tileGap','roundness','fill','stroke','contourSpacing','contourDuty','sweep','sweepAngle','sweepWidth','sweepSpread','shrink','rounding'],
  ['glyphCount','profile','spacing','angularStep','glyphSize','growth','profileAngle','twistDepth','stroke'],
  ['pathResolution','pathLength','pathWidth','hollow','direction','bias','corners','reveal','hold','innerRadius','ringWidth'],
];
export function graphicVisibleKeys(style: number, variant: number, fill: number, sweep: number): Set<string> {
  const keys = new Set([...common,...(familyKeys[style] ?? [])]);
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
const pearl = ['#ffe9e3','#ff9ca9','#ae88db','#7bd3cc','#a6e2dc','#040306'];
const green = ['#abff91','#83d781','#54a296','#40528b','#291766','#050809'];
const mono = ['#ffffff','#dddddd','#aaaaaa','#666666','#292929','#000000'];
const warm = ['#fff394','#ffd078','#ffa659','#ff6a63','#ed365d','#080305'];
const red = ['#f42d39','#e31928','#ae1322','#761020','#471019','#030205'];
const look = (id: string,name: string,description: string,style: number,variant: number,palette: string[],params: Record<string, number>): GraphicLook => ({id,name,description,palette,params:{style,variant,...params}});
export const GRAPHIC_LOOKS: GraphicLook[] = [
  look('pillar-wave','Pillar Wave','Rounded opposing columns trace a travelling wave.',0,0,purple,{}),
  look('uneven-pillars','Uneven Pillars','Unequal purple columns gather into broad waves.',0,1,purple,{columns:32,widthScatter:.65,waveCount:1.3}),
  look('lava-columns','Lava Columns','Wide rounded columns move like graphic lava.',0,2,purple,{columns:10,widthScatter:.3,amplitude:.28,gap:.05,gutter:6,waveCount:1}),
  look('fine-bars','Fine Bars','Fine uneven bars pulse through interlocking waves.',0,3,purple,{columns:140,widthScatter:.5,amplitude:.4,waveCount:4,gutter:1}),
  look('warm-curtains','Warm Curtains','Coral and amber curtains leave a flowing dark channel.',0,4,warm,{columns:100,amplitude:.05,gap:.23,gutter:1,waveCount:3}),
  look('green-tide','Green Tide','Luminous green pillars sweep through deep blue.',0,5,green,{columns:80,amplitude:.38,waveCount:2.5,gutter:2}),
  look('concentric-halo','Concentric Halo','Fine layered circles breathe around a luminous green centre.',1,0,green,{motion:.5,orbit:.012,coil:.18,coilDepth:.08,radius:.48,colorBalance:.65}),
  look('orbital-bloom','Orbital Bloom','Layered lime discs unfold into a soft orbital flower.',1,1,['#edff23','#ccdf1a','#a7be16','#77930c','#405706','#102100'],{orbit:.6,coil:.62,coilDepth:.4,radius:.55,motion:.6}),
  look('circle-fans','Circle Fans','Opposite circle stacks sweep into warm fans and propellers.',1,2,warm,{orbit:.7,coil:2.75,coilDepth:.55,radius:.66,turns:1,motion:.75}),
  look('packed-mosaic','Packed Mosaic','Seeded cyan and violet bricks pack into a crisp field.',2,0,aqua,{fill:0,tileResolution:40,roundness:.08,sweep:0}),
  look('neon-frames','Neon Frames','Large hollow frames softly round as a wave passes.',2,1,aqua,{fill:1,tileResolution:16,tileArea:9,roundness:.25,stroke:2.4,shrink:.16}),
  look('nested-tiles','Nested Tiles','Nested pastel rectangles become rings and capsules.',2,2,pearl,{fill:2,tileResolution:22,tileArea:7,contourSpacing:5,roundness:.38,sweep:1}),
  look('tile-ripple','Tile Ripple','An expanding wave rounds and shrinks a nested tile field.',2,3,red,{fill:2,tileResolution:38,tileArea:4,roundness:.04,sweep:2,contourSpacing:3.3,sweepWidth:.2,shrink:.45}),
  look('beaded-spiral','Beaded Spiral','Violet beads curl into a finely sampled spiral.',3,0,purple,{profile:0,glyphSize:.05,angularStep:1.082,turns:1,colorDensity:2}),
  look('polygon-tunnel','Polygon Tunnel','Large seven-sided forms overlap into a green contour tunnel.',3,1,green,{profile:6,glyphSize:.5,angularStep:1.4486,spacing:.0024,stroke:.8,colorDensity:5,turns:1}),
  look('woven-vortex','Woven Vortex','Angular pink and violet forms weave into a pinwheel.',3,2,purple,{profile:6,glyphSize:.5,angularStep:.8901,spacing:.0025,stroke:1.2,colorDensity:4,turns:1}),
  look('web-rosette','Web Rosette','Outlined overlapping circles reveal a scalloped pearl rosette.',3,3,pearl,{profile:0,glyphSize:.5,angularStep:.576,spacing:.0025,stroke:1.1,colorDensity:5,turns:1}),
  look('line-interference','Line Interference','Fine green lines create a shifting radiation field.',3,4,green,{profile:1,glyphSize:.95,angularStep:.28,twistDepth:.07,spacing:.002,stroke:.75,motion:.5,colorDensity:2}),
  look('coiling-ribbon','Coiling Ribbon','Overlapping pentagons form a broad magenta spiral ribbon.',3,5,purple,{profile:4,glyphSize:.5,angularStep:.035,twistDepth:.028,spacing:.0025,stroke:.55,motion:.8,colorDensity:3}),
  look('particle-rays','Particle Rays','Warm hexagonal beads coil into luminous spokes.',3,6,warm,{profile:5,glyphSize:.065,angularStep:.91,twistDepth:.18,spacing:.0035,stroke:.5,motion:.8,turns:1,colorDensity:3}),
  look('disc-mandala','Disc Mandala','Overlapping outlined discs open and close into spiral scales.',3,7,purple,{profile:0,glyphSize:.09,angularStep:1.134,twistDepth:.12,spacing:.003,stroke:.85,motion:.65,colorDensity:3}),
  look('scalloped-vortex','Scalloped Vortex','Monochrome polygon bands fold into a scalloped whirlpool.',3,8,mono,{profile:9,glyphSize:.2,angularStep:.4363,twistDepth:.08,spacing:.003,stroke:.8,motion:.65,colorDensity:6}),
  look('circuit-worms','Circuit Worms','Short hollow red paths grow and retract over a dark field.',4,0,red,{pathResolution:42,pathLength:9,pathWidth:.52,hollow:.55,motion:.85}),
  look('circuit-channels','Circuit Channels','Long parallel paths gather into blue and pink channels.',4,1,['#ee83f2','#ca58ed','#a144eb','#7453ea','#3c3af0','#040309'],{pathResolution:42,pathLength:120,pathWidth:.7,hollow:.2,direction:0,bias:.95,motion:.85}),
  look('maze-carpet','Maze Carpet','Mirrored fine paths reveal a violet ornamental maze.',4,2,pearl,{pathResolution:48,pathLength:28,pathWidth:.5,hollow:.6,motion:.8}),
  look('radial-circuit','Radial Circuit','Attractor-guided paths surround a dark ring and central core.',4,3,red,{pathResolution:52,pathLength:18,pathWidth:.55,hollow:.55,innerRadius:.2,ringWidth:.16,motion:.85}),
];
