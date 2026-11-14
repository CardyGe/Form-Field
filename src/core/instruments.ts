import { ELECTRIC, HOT_SIGNAL, LIME_VIOLET, SOLAR, CANDY, CYAN_YELLOW, FLAT_FINISH } from './palettes';
import { TIMING_PARAMETERS } from './timing';
import type { ParameterDefinition } from '../shared/types';

export const INSTRUMENT_KINDS = ['livingink','relief','resonance'] as const;
export type InstrumentKind = typeof INSTRUMENT_KINDS[number];
const p=(key:string,label:string,min:number,max:number,step:number,value:number,section:ParameterDefinition['section']='Shape'):ParameterDefinition=>({key,label,min,max,step,default:value,section});
const lighting=()=>[p('lightAngle','Light angle',-Math.PI,Math.PI,.01,-.7,'Material'),p('roughness','Roughness',.08,1,.01,.35,'Material')];
const common=()=>[p('scale','Pattern scale',.3,8,.01,2.4),p('rotation','Direction',-Math.PI,Math.PI,.01,0),p('motion','Motion amount',0,1,.01,.35,'Motion'),p('cycles','Cycles per loop',1,8,1,1,'Motion'),p('backgroundOpacity','Field background',0,1,.01,1,'Material'),p('saturation','Saturation',0,2,.01,1,'Material'),p('hue','Hue shift',-Math.PI,Math.PI,.01,0,'Material'),p('exposure','Exposure',.25,2,.01,1,'Material')];
export const INSTRUMENT_PARAMETERS:Record<InstrumentKind,ParameterDefinition[]>={
 livingink:[...common(),p('pattern','Growth family',0,3,1,0),{...p('branching','Branching',0,1,.01,.5),preparation:true},p('relief','Pigment relief',0,1,.01,.7,'Material'),p('pigment','Pigment amount',.15,.85,.01,.48,'Material'),p('flow','Flow distortion',0,1,.01,.25),...lighting()],
 relief:[...common(),p('columns','Piece density',3,20,1,8),p('opening','Hinge opening',0,1,.01,.65),p('depth','Relief depth',.05,1,.01,.5),p('bevel','Piece bevel',.02,.35,.01,.12),p('waveCount','Travelling bands',1,6,1,2,'Motion'),p('axis','Hinge axis',0,2,1,0),p('shadow','Shadow strength',0,1,.01,.6,'Material'),...lighting()],
 resonance:[...common(),p('modeA','Horizontal mode',1,12,1,3),p('modeB','Vertical mode',1,12,1,5),p('modalBlend','Modal blend',0,1,.01,.35),p('bandWidth','Nodal width',.015,.3,.005,.09,'Material'),p('grains','Sand texture',0,1,.01,.65,'Material'),p('relief','Membrane relief',0,1,.01,.25,'Material'),...lighting()],
};
// Additive controls preserve saved 0.9 appearances at their neutral defaults.
const a=(key:string,label:string,min:number,max:number,step:number,value:number,section:ParameterDefinition['section']='Shape',description?:string):ParameterDefinition=>({...p(key,label,min,max,step,value,section),advanced:true,description});
const field=[a('stretch','Field stretch',.25,4,.01,1),a('warp','Domain warp',0,1,.01,0),a('warpScale','Warp scale',.25,6,.01,1.2,'Shape','Frequency of the domain deformation; effective when Domain warp is above zero.'),a('twist','Field twist',-2,2,.01,0),a('phaseOffset','Motion phase',0,1,.01,0,'Motion','Offsets the intrinsic cycle without changing loop length.')];
const directed=[
 p('organic','Organic motion',0,1,.01,0,'Motion'),p('flowDirection','Flow direction',-Math.PI,Math.PI,.01,0,'Motion'),
 p('travel','Travel',0,1,.01,.6,'Motion'),a('eddyScale','Eddy frequency',.4,4,.01,1.4,'Motion'),
 p('phrase','Motion phrase',0,2,1,0,'Motion'),
];
const material=[a('lightHeight','Light elevation',.2,2,.01,1,'Material'),a('fillLight','Fill light',0,1,.01,.26,'Material'),a('anisotropy','Directional sheen',0,1,.01,0,'Material'),a('sheenAngle','Sheen direction',-Math.PI,Math.PI,.01,0,'Material','Direction of the stretched highlight when Directional sheen is above zero.'),a('clearcoat','Clear coat',0,1,.01,0,'Material')];
const specific:Record<InstrumentKind,ParameterDefinition[]>={
 livingink:[...TIMING_PARAMETERS.map(d=>({...d})),{...p('ageColour','Colour by age',0,1,.01,0,'Material'),description:'Evolving only: colours ink by how long it has been there, so new growth stands out from old. 0 keeps one colour.'},p('pigmentCarry','Pigment carry',0,1,.01,.6,'Material'),a('edgeSoftness','Pigment softness',0,1,.01,0,'Material'),a('edgeInk','Edge pigment',0,1,.01,.24,'Material'),{...a('seedCoverage','Seed coverage',.3,.85,.01,.62,'Shape','Re-prepares the chemical texture; does not change during playback.'),preparation:true},{...a('development','Development',.65,1.4,.01,1,'Shape','Duration of deterministic chemical preparation, not playback speed.'),preparation:true}],
 relief:[...TIMING_PARAMETERS.map(d=>({...d})),{...p('panelMix','Panel sizes',0,1,.01,0),description:'Mixes large, medium and small panels instead of one uniform grid. Solid relief only.'},a('gap','Joint spacing',.01,.24,.005,.08),a('stagger','Row stagger',0,1,.01,0),a('hingeBias','Hinge position',-1,1,.01,0),a('roundness','Plate rounding',0,1,.01,0),a('phaseSpread','Opening variation',0,1,.01,0,'Motion')],
 resonance:[{...p('sequence','Mode score',0,3,1,0,'Motion'),description:'Holds one figure, then snaps to the next mode, stepping through this many changes and back to the first each loop. 0 keeps one figure.'},{...p('snap','Snap speed',0,1,.01,.5,'Motion'),description:'How quickly the sand reorganises between figures in a mode score.'},{...p('fill','Plate fill',0,1,.01,0,'Material'),description:'Fills the plate between the sand lines with two palette colours instead of leaving it clear.'},a('radialMix','Circular modes',0,1,.01,0),a('harmonic','Harmonic detail',0,1,.01,0),a('grainSize','Grain density',40,260,1,130,'Material'),a('nodalSoftness','Nodal softness',0,1,.01,0,'Material')],
};
export const INSTRUMENT_UPGRADE_KEYS:Record<InstrumentKind,string[]>=Object.fromEntries(INSTRUMENT_KINDS.map(kind=>{
 const mode=kind==='livingink'?[p('inkMode','Pigment motion',0,2,1,0,'Motion'),{...p('simulationQuality','Chemical resolution',0,2,1,1),preparation:true},{...p('loopReturn','Loop return',0,.5,.01,.3,'Motion'),description:'Evolving chemistry: the share of the loop over which grown ink recedes back into its starting seeds, so the last frame flows into the first. At 0 the clip grows once and stops.'}]:kind==='relief'?[p('reliefMode','Relief construction',0,1,1,0)]:[];
 const obstacle=kind==='livingink'?[{...a('surfaceHole','Central obstacle',0,.8,.01,0,'Shape','A source-space circular void that redirects evolving pigment.'),preparation:kind==='livingink'}]:[];
 const added=[...field,...directed.map(d=>({...d,preparation:kind==='livingink'&&['travel','flowDirection','eddyScale'].includes(d.key)||d.preparation})),...mode,...obstacle,...material,...specific[kind]];
 INSTRUMENT_PARAMETERS[kind].push(...added.map(d=>({...d})));
 return [kind,added.map(d=>d.key)];
})) as Record<InstrumentKind,string[]>;
const cool=ELECTRIC,warm=HOT_SIGNAL,pearl=LIME_VIOLET;
export interface InstrumentInfo {kind:InstrumentKind;name:string;description:string;palette:string[];looks:{id:string;name:string;params:Record<string,number>;palette?:string[]}[]}
export const INSTRUMENTS:InstrumentInfo[]=[
 {kind:'livingink',name:'Living Ink',description:'Seeded cellular pigment · embossed lace',palette:pearl,looks:[{id:'ivory-coral',name:'Lime Coral',params:{}}]},
 {kind:'relief',name:'Kinetic Relief',description:'Hinged ceramic shutters · architectural depth',palette:pearl,looks:[{id:'porcelain-shutters',name:'Neon Shutters',params:{scale:1,columns:7}},{id:'basalt-scales',name:'Basalt Scales',palette:cool,params:{scale:1.3,columns:6,axis:2,opening:.45,depth:.8,roughness:.65}}]},
 {kind:'resonance',name:'Resonant Sand',description:'Standing-wave figures · granular membranes',palette:pearl,looks:[{id:'salt-mandala',name:'Hot Mandala',palette:HOT_SIGNAL,params:{sequence:3,snap:.5,fill:1,motion:1,toonMix:0,scale:1.4,bandWidth:.12}},{id:'midnight-membrane',name:'Midnight Membrane',palette:cool,params:{modeA:2,modeB:5,grains:.3,relief:.8,bandWidth:.18,sequence:2,snap:.3,fill:1,toonMix:0,scale:1.4}}]},
];
export function isInstrument(kind:string):kind is InstrumentKind{return (INSTRUMENT_KINDS as readonly string[]).includes(kind);}

const explorations:Partial<Record<InstrumentKind,InstrumentInfo['looks'][number]>>={
 resonance:{id:'orbital-cymatics',name:'Orbital Cymatics',palette:SOLAR,params:{radialMix:.8,harmonic:.3,grainSize:180,nodalSoftness:.12,warp:.05,scale:2,bandWidth:.13,sequence:3,snap:.7}},
};
for(const info of INSTRUMENTS){const look=explorations[info.kind];if(look)info.looks.push(look);}

// Authored behaviour studies within the existing instruments. References and
// original design decisions: docs/projection-media-direction-2026-11-10.md.
export const PROJECTION_LOOK_IDS=['ink-estuary','tidal-pigment','breathing-facade','folding-copper','quiet-monument'];
const studies:Partial<Record<InstrumentKind,InstrumentInfo['looks']>>={
 livingink:[
  {id:'ink-estuary',name:'Ink Estuary · Evolving',palette:cool,params:{...FLAT_FINISH,toonBands:4,pigmentCarry:.1,ageColour:1,edgeSoftness:0,inkMode:2,scale:2.2,travel:.55,pattern:3,motion:1,relief:.18,seedCoverage:.5,development:1.2,pigment:.6,edgeInk:.6,backgroundOpacity:0}},
  {id:'tidal-pigment',name:'Tidal Pigment · Loop',palette:SOLAR,params:{inkMode:1,organic:.55,scale:1.8,pattern:1,motion:1,flow:.5,relief:.35,edgeInk:.5,flowDirection:.35,backgroundOpacity:0}},
 ],
 relief:[
  {id:'breathing-facade',name:'Breathing Facade',params:{reliefMode:1,scale:1,columns:7,motion:1,opening:.85,phaseSpread:.8,organic:.6,phrase:1,shadow:.7,backgroundOpacity:0}},
  {id:'folding-copper',name:'Folding Copper',palette:warm,params:{reliefMode:1,scale:1,columns:5,axis:1,motion:1,opening:.95,phaseSpread:1,organic:.8,phrase:2,shadow:.85,depth:.8,lightAngle:-.9,backgroundOpacity:0}},
  {id:'quiet-monument',name:'Quiet Monument',palette:cool,params:{reliefMode:1,scale:1.2,columns:9,axis:2,motion:.6,opening:.8,phaseSpread:.45,organic:.3,phrase:1,shadow:.9,roughness:.6,gap:.12,backgroundOpacity:0}},
 ],
};
for(const info of INSTRUMENTS)info.looks.push(...(studies[info.kind]??[]));
// Relief and Resonance start from flat colour with outlines; shading stays one control away.
for(const info of INSTRUMENTS)if(info.kind==='relief'||info.kind==='resonance')for(const look of info.looks)look.params={...FLAT_FINISH,...look.params};
// Relief panels open outward from an origin, holding between moves; solid looks mix panel sizes.
const RELIEF_TIMING:Record<string,Record<string,number>>={
 'porcelain-shutters':{reliefMode:1,panelMix:.5,motion:1,delayShape:1,delaySpread:.6,pause:.4},
 'basalt-scales':{reliefMode:1,panelMix:.35,motion:1,delayShape:2,delaySpread:.5,pause:.4},
 'breathing-facade':{panelMix:.7,delayShape:1,delaySpread:.6,pause:.35},
 'folding-copper':{panelMix:.5,delayShape:0,delaySpread:.5,pause:.3},
 'quiet-monument':{panelMix:.9,delayShape:2,delaySpread:.4,pause:.5},
};
for(const look of INSTRUMENTS.find(i=>i.kind==='relief')!.looks)Object.assign(look.params,RELIEF_TIMING[look.id]??{});
// Loop ink travels one pattern period per loop in staggered pulses instead of breathing in place.
const INK_TRAVEL:Record<string,Record<string,number>>={
 'ivory-coral':{inkMode:1,motion:1,flowDirection:.3,delayShape:0,delaySpread:.2,pause:.15},
 'tidal-pigment':{delayShape:2,delaySpread:.2,pause:.15},
};
for(const look of INSTRUMENTS.find(i=>i.kind==='livingink')!.looks)look.params={...FLAT_FINISH,...look.params,...INK_TRAVEL[look.id]};
const RELIEF_PALETTES:Record<string,string[]>={'porcelain-shutters':CANDY,'basalt-scales':CYAN_YELLOW};
for(const look of INSTRUMENTS.find(i=>i.kind==='relief')!.looks)if(RELIEF_PALETTES[look.id])look.palette=RELIEF_PALETTES[look.id];
