import type { ParameterDefinition } from '../shared/types';

export const INSTRUMENT_KINDS = ['caustic','livingink','magnetic','currents','relief','loom','reef','prism','resonance','veils'] as const;
export type InstrumentKind = typeof INSTRUMENT_KINDS[number];
const p=(key:string,label:string,min:number,max:number,step:number,value:number,section:ParameterDefinition['section']='Shape'):ParameterDefinition=>({key,label,min,max,step,default:value,section});
const lighting=()=>[p('lightAngle','Light angle',-Math.PI,Math.PI,.01,-.7,'Material'),p('roughness','Roughness',.08,1,.01,.35,'Material')];
const common=()=>[p('scale','Pattern scale',.3,8,.01,2.4),p('rotation','Direction',-Math.PI,Math.PI,.01,0),p('motion','Motion amount',0,1,.01,.35,'Motion'),p('cycles','Cycles per loop',1,8,1,1,'Motion'),p('backgroundOpacity','Field background',0,1,.01,1,'Material'),p('saturation','Saturation',0,2,.01,1,'Material'),p('hue','Hue shift',-Math.PI,Math.PI,.01,0,'Material'),p('exposure','Exposure',.25,2,.01,1,'Material')];
export const INSTRUMENT_PARAMETERS:Record<InstrumentKind,ParameterDefinition[]>={
 caustic:[...common(),p('waves','Wave mixture',2,8,1,5),p('focus','Light focus',.1,1,.01,.65,'Material'),p('dispersion','Spectral spread',0,1,.01,.2,'Material'),p('depth','Wave depth',.1,1,.01,.48),p('width','Light ridge width',.02,.22,.005,.075,'Material')],
 livingink:[...common(),p('pattern','Growth family',0,3,1,0),{...p('branching','Branching',0,1,.01,.5),preparation:true},p('relief','Pigment relief',0,1,.01,.7,'Material'),p('pigment','Pigment amount',.15,.85,.01,.48,'Material'),p('flow','Flow distortion',0,1,.01,.25),...lighting()],
 magnetic:[...common(),p('peaks','Peak spacing',1.5,8,.01,3.8),p('pull','Magnetic pull',0,1,.01,.65),p('sharpness','Peak sharpness',.4,3,.01,1.4),p('metallic','Metal finish',0,1,.01,.8,'Material'),p('iridescence','Opal finish',0,1,.01,.3,'Material'),...lighting()],
 currents:[...common(),p('fibres','Fibre density',12,96,1,42),p('curl','Current curl',0,1,.01,.6),p('coherence','Flow coherence',0,1,.01,.75),p('trailLength','Trail length',.08,1,.01,.65,'Motion'),p('width','Fibre width',.08,.8,.01,.3,'Material'),p('depth','Depth spread',0,1,.01,.45),...lighting()],
 relief:[...common(),p('columns','Piece density',3,20,1,8),p('opening','Hinge opening',0,1,.01,.65),p('depth','Relief depth',.05,1,.01,.5),p('bevel','Piece bevel',.02,.35,.01,.12),p('waveCount','Travelling bands',1,6,1,2,'Motion'),p('axis','Hinge axis',0,2,1,0),p('shadow','Shadow strength',0,1,.01,.6,'Material'),...lighting()],
 loom:[...common(),p('weave','Thread density',8,120,1,46),p('crossingAngle','Weave crossing',.02,.7,.005,.13),p('folds','Fabric folds',1,8,1,3),p('tension','Fabric tension',0,1,.01,.55),p('foil','Foil finish',0,1,.01,.45,'Material'),...lighting()],
 reef:[...common(),p('density','Vein density',1.5,9,.01,3.4),p('branchWidth','Vein width',.025,.3,.005,.09),p('height','Crystal height',.1,1,.01,.65),p('facetCount','Crystal facets',3,8,1,6),p('growth','Growth front',0,1,.01,.65,'Motion'),p('emission','Inner light',0,1,.01,.25,'Material'),...lighting()],
 prism:[...common(),p('arches','Vault depth',3,18,1,10),p('aperture','Arch opening',.3,1,.01,.7),p('spacing','Vault spacing',.5,2,.01,1),p('reflection','Mirror finish',0,1,.01,.65,'Material'),p('dispersion','Glass dispersion',0,1,.01,.25,'Material'),...lighting()],
 resonance:[...common(),p('modeA','Horizontal mode',1,12,1,3),p('modeB','Vertical mode',1,12,1,5),p('modalBlend','Modal blend',0,1,.01,.35),p('bandWidth','Nodal width',.015,.3,.005,.09,'Material'),p('grains','Sand texture',0,1,.01,.65,'Material'),p('relief','Membrane relief',0,1,.01,.25,'Material'),...lighting()],
 veils:[...common(),p('density','Pigment density',.1,1,.01,.48),p('folds','Volume folds',1,8,1,3),p('erosion','Volume erosion',0,1,.01,.4),p('depth','Volume depth',.4,3,.01,1.5),p('scattering','Edge illumination',0,1,.01,.6,'Material'),p('lightAngle','Light angle',-Math.PI,Math.PI,.01,-.7,'Material'),p('quality','Render quality',0,2,1,1,'Material')],
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
 caustic:[a('waveBias','Wave alignment',0,1,.01,0),a('refraction','Refraction strength',.25,2,.01,1),a('halo','Light halo',0,.7,.01,.2,'Material'),a('waveSkew','Wave asymmetry',-1,1,.01,0)],
 livingink:[p('pigmentCarry','Pigment carry',0,1,.01,.6,'Material'),a('edgeSoftness','Pigment softness',0,1,.01,0,'Material'),a('edgeInk','Edge pigment',0,1,.01,.24,'Material'),{...a('seedCoverage','Seed coverage',.3,.85,.01,.62,'Shape','Re-prepares the chemical texture; does not change during playback.'),preparation:true},{...a('development','Development',.65,1.4,.01,1,'Shape','Duration of deterministic chemical preparation, not playback speed.'),preparation:true}],
 magnetic:[a('peakHeight','Peak height',.1,2,.01,1),a('ridgeBlend','Ridge formation',0,1,.01,0),a('attractorRadius','Attractor radius',.3,3,.01,1),a('valleyFill','Continuous skin',0,1,.01,0,'Material')],
 currents:[a('vortex','Vortex curl',-1,1,.01,0),a('braid','Braided flow',0,1,.01,0),a('taper','Fibre taper',0,1,.01,0,'Material'),a('flowDetail','Fine eddies',0,1,.01,0)],
 relief:[a('gap','Joint spacing',.01,.24,.005,.08),a('stagger','Row stagger',0,1,.01,0),a('hingeBias','Hinge position',-1,1,.01,0),a('roundness','Plate rounding',0,1,.01,0),a('phaseSpread','Opening variation',0,1,.01,0,'Motion')],
 loom:[a('threadWidth','Thread width',.1,.85,.01,.4,'Material'),a('weftRatio','Weft spacing',.3,2,.01,.85),a('foldDepth','Fold depth',0,2,.01,1),a('crossweave','Interlaced shading',0,1,.01,0,'Material')],
 reef:[a('facetTwist','Facet orientation',-Math.PI,Math.PI,.01,0),a('cellIrregularity','Mineral irregularity',.1,1,.01,.6),a('crystalSpread','Crystal spread',.2,.9,.01,.65),a('veinBias','Vein depth',0,1,.01,0,'Material')],
 prism:[a('archShape','Arch roundness',0,1,.01,.55),a('frameWidth','Frame thickness',.015,.16,.005,.055),a('twistDepth','Vault twist',-1,1,.01,0),a('vanishX','Vanishing point X',-1,1,.01,0),a('vanishY','Vanishing point Y',-1,1,.01,0)],
 resonance:[a('radialMix','Circular modes',0,1,.01,0),a('harmonic','Harmonic detail',0,1,.01,0),a('grainSize','Grain density',40,260,1,130,'Material'),a('nodalSoftness','Nodal softness',0,1,.01,0,'Material')],
 veils:[a('banding','Banding suppression',0,1,.01,0,'Material','Deterministic sampling dither breaks depth bands. High quality reduces the resulting fine sampling texture.'),a('ribbonWidth','Ribbon width',.3,2,.01,1),a('turbulence','Volume turbulence',0,1,.01,0),a('scatterBias','Scattering direction',-.7,.7,.01,0,'Material','Negative values favour back-scattering; positive values favour forward-scattering.'),a('absorption','Optical absorption',.25,4,.01,2.5,'Material'),a('lightHeight','Light elevation',.1,2,.01,.3,'Material')],
};
export const INSTRUMENT_UPGRADE_KEYS:Record<InstrumentKind,string[]>=Object.fromEntries(INSTRUMENT_KINDS.map(kind=>{
 const mode=kind==='currents'?[p('flowMode','Fibre motion',0,1,1,0,'Motion')]:kind==='livingink'?[p('inkMode','Pigment motion',0,2,1,0,'Motion'),{...p('simulationQuality','Chemical resolution',0,2,1,1),preparation:true}]:kind==='relief'?[p('reliefMode','Relief construction',0,1,1,0)]:[];
 const obstacle=kind==='currents'||kind==='livingink'?[{...a('surfaceHole','Central obstacle',0,.8,.01,0,'Shape','A source-space circular void that redirects transported fibres and evolving pigment.'),preparation:kind==='livingink'}]:[];
 const added=[...field,...directed.map(d=>({...d,preparation:kind==='livingink'&&['travel','flowDirection','eddyScale'].includes(d.key)||d.preparation})),...mode,...obstacle,...(kind==='caustic'||kind==='veils'?[]:material),...specific[kind]];
 INSTRUMENT_PARAMETERS[kind].push(...added.map(d=>({...d})));
 return [kind,added.map(d=>d.key)];
})) as Record<InstrumentKind,string[]>;
const cool=['#c5eee4','#79c8d5','#407eab','#7878af','#efd8b0','#071321'];
const warm=['#f2dbad','#d89762','#bd574f','#753a65','#d0a4a0','#160e21'];
const pearl=['#f1ead8','#c7d4d0','#84abb5','#527783','#d7b18c','#101b24'];
export interface InstrumentInfo {kind:InstrumentKind;name:string;description:string;palette:string[];looks:{id:string;name:string;params:Record<string,number>;palette?:string[]}[]}
export const INSTRUMENTS:InstrumentInfo[]=[
 {kind:'caustic',name:'Caustic Atlas',description:'Focused water light · spectral ridges',palette:cool,looks:[{id:'pool-at-midnight',name:'Pool at Midnight',params:{}},{id:'amber-lens',name:'Amber Lens',palette:warm,params:{scale:1.8,focus:.8,dispersion:.1,width:.1,depth:.3}},{id:'prism-rain',name:'Prism Rain',params:{scale:3.2,waves:7,dispersion:.65,focus:.7,motion:.5}}]},
 {kind:'livingink',name:'Living Ink',description:'Seeded cellular pigment · embossed lace',palette:pearl,looks:[{id:'ivory-coral',name:'Ivory Coral',params:{}},{id:'cobalt-fingerprints',name:'Cobalt Fingerprints',palette:cool,params:{pattern:1,branching:.3,scale:3.2,flow:.4,pigment:.4}},{id:'ember-cells',name:'Ember Cells',palette:warm,params:{pattern:2,branching:.65,scale:2.2,pigment:.55,relief:.85}}]},
 {kind:'magnetic',name:'Magnetic Skin',description:'Liquid metal · travelling magnetic peaks',palette:pearl,looks:[{id:'pearl-magnet',name:'Pearl Magnet',params:{scale:1.6,peaks:3}},{id:'mercury-garden',name:'Mercury Garden',palette:cool,params:{scale:1.8,peaks:3.5,pull:.8,sharpness:2,metallic:1,iridescence:.15}},{id:'obsidian-tide',name:'Obsidian Tide',palette:['#6e7b8f','#384b68','#92bfc9','#b9aaca','#e2c79d','#070a13'],params:{scale:1.8,peaks:3,pull:.5,roughness:.22,iridescence:.5}}]},
 {kind:'currents',name:'Velvet Currents',description:'Luminous fibres · coherent eddies',palette:cool,looks:[{id:'aurora-comb',name:'Aurora Comb',params:{scale:1.8,fibres:28,coherence:.65,width:.4}},{id:'copper-estuary',name:'Copper Estuary',palette:warm,params:{scale:1.5,fibres:32,curl:.4,coherence:.9,width:.4}},{id:'ivory-undertow',name:'Ivory Undertow',palette:pearl,params:{scale:1.8,fibres:40,curl:.8,trailLength:.85,width:.22,depth:.7}}]},
 {kind:'relief',name:'Kinetic Relief',description:'Hinged ceramic shutters · architectural depth',palette:pearl,looks:[{id:'porcelain-shutters',name:'Porcelain Shutters',params:{scale:1,columns:7}},{id:'copper-accordion',name:'Copper Accordion',palette:warm,params:{scale:1,columns:9,axis:1,opening:.8,bevel:.06,depth:.75}},{id:'basalt-scales',name:'Basalt Scales',palette:cool,params:{scale:1.3,columns:6,axis:2,opening:.45,depth:.8,roughness:.65}}]},
 {kind:'loom',name:'Holographic Loom',description:'Satin folds · woven interference · foil',palette:pearl,looks:[{id:'pearl-gauze',name:'Pearl Gauze',params:{scale:1.8,weave:32}},{id:'petrol-satin',name:'Petrol Satin',palette:cool,params:{folds:4,tension:.3,foil:.7,crossingAngle:.08,roughness:.25}},{id:'copper-interference',name:'Copper Interference',palette:warm,params:{weave:68,crossingAngle:.19,foil:.25,tension:.75}}]},
 {kind:'reef',name:'Crystal Reef',description:'Connected mineral veins · faceted growth',palette:cool,looks:[{id:'amethyst-veins',name:'Amethyst Veins',palette:['#dac5f0','#a781d0','#6b70b1','#7bb6bf','#e8d3b0','#110e23'],params:{scale:1.5,density:2.8}},{id:'porcelain-reef',name:'Porcelain Reef',palette:pearl,params:{scale:1.8,density:2.5,facetCount:5,height:.5,branchWidth:.14,emission:.08}},{id:'amber-fault',name:'Amber Fault',palette:warm,params:{scale:1.6,density:3.5,facetCount:4,height:.85,growth:.85,emission:.4}}]},
 {kind:'prism',name:'Prism Cathedral',description:'Mirrored vaults · optical architecture',palette:cool,looks:[{id:'smoked-glass-vault',name:'Smoked Glass Vault',params:{scale:1.8}},{id:'amber-arcade',name:'Amber Arcade',palette:warm,params:{scale:1.5,arches:8,aperture:.8,reflection:.5,dispersion:.1,spacing:1.3}},{id:'porcelain-infinity',name:'Porcelain Infinity',palette:pearl,params:{scale:2,arches:14,aperture:.65,reflection:.3,roughness:.6,dispersion:.05}}]},
 {kind:'resonance',name:'Resonant Sand',description:'Standing-wave figures · granular membranes',palette:pearl,looks:[{id:'salt-mandala',name:'Salt Mandala',params:{}},{id:'copper-modes',name:'Copper Modes',palette:warm,params:{modeA:4,modeB:7,modalBlend:.6,bandWidth:.12,relief:.5}},{id:'midnight-membrane',name:'Midnight Membrane',palette:cool,params:{modeA:2,modeB:5,grains:.3,relief:.8,bandWidth:.18}}]},
 {kind:'veils',name:'Volumetric Veils',description:'Backlit pigment · translucent atmosphere',palette:cool,looks:[{id:'milk-in-cobalt',name:'Milk in Cobalt',params:{}},{id:'rose-smoke',name:'Rose Smoke',palette:warm,params:{scale:1.8,density:.6,erosion:.25,scattering:.8,folds:2}},{id:'amber-veil',name:'Amber Veil',palette:pearl,params:{scale:3,density:.35,folds:5,erosion:.6,depth:2}}]},
];
export function isInstrument(kind:string):kind is InstrumentKind{return (INSTRUMENT_KINDS as readonly string[]).includes(kind);}

const explorations:Record<InstrumentKind,InstrumentInfo['looks'][number]>={
 caustic:{id:'lenticular-tide',name:'Lenticular Tide',params:{stretch:1.8,warp:.3,warpScale:1.6,waveBias:.6,refraction:1.2,halo:.3,waves:7,width:.05}},
 livingink:{id:'porcelain-estuary',name:'Porcelain Estuary',params:{pattern:3,seedCoverage:.5,development:1.3,edgeInk:.55,warp:.28,relief:.9,stretch:1.4,scale:2}},
 magnetic:{id:'ferrofluid-ridges',name:'Ferrofluid Ridges',params:{ridgeBlend:.65,peakHeight:1.7,valleyFill:.5,anisotropy:.7,clearcoat:.4,warp:.2,scale:1.5,peaks:3,metallic:1}},
 currents:{id:'vortex-filaments',name:'Vortex Filaments',params:{vortex:.6,braid:.35,stretch:.8,coherence:.8,curl:.8,anisotropy:.8,flowDetail:.3,width:.55,scale:1.4,fibres:18,fillLight:.4}},
 relief:{id:'phase-shutters',name:'Phase Shutters',params:{gap:.15,stagger:.65,roundness:.5,hingeBias:-.35,phaseSpread:.5,clearcoat:.35,scale:1,columns:7,opening:.85}},
 loom:{id:'iridescent-organza',name:'Iridescent Organza',params:{crossweave:.8,threadWidth:.22,foldDepth:1.6,anisotropy:.7,foil:.4,weftRatio:1.3,weave:28,scale:1.6,roughness:.25}},
 reef:{id:'opal-geode',name:'Opal Geode',params:{crystalSpread:.5,facetTwist:.5,cellIrregularity:.9,veinBias:.6,emission:.6,clearcoat:.6,warp:.18,density:2.7,scale:1.5}},
 prism:{id:'helical-arcade',name:'Helical Arcade',params:{twistDepth:.6,vanishX:.3,vanishY:-.15,archShape:.8,frameWidth:.035,anisotropy:.4,arches:15,scale:2.3}},
 resonance:{id:'orbital-cymatics',name:'Orbital Cymatics',params:{radialMix:.8,harmonic:.3,grainSize:180,nodalSoftness:.12,warp:.05,scale:2,bandWidth:.13}},
 veils:{id:'opalescent-smoke',name:'Opalescent Smoke',params:{ribbonWidth:.6,turbulence:.35,scatterBias:.45,absorption:1.7,lightHeight:.7,stretch:1.4,density:.55,scattering:.8,scale:2,banding:.8,quality:2}},
};
for(const info of INSTRUMENTS)info.looks.push(explorations[info.kind]);

// Authored behaviour studies within the existing instruments. References and
// original design decisions: docs/projection-media-direction-2026-11-10.md.
export const PROJECTION_LOOK_IDS=['silk-river','copper-confluence','gathering-light','ink-estuary','tidal-pigment','coral-development','breathing-facade','folding-copper','quiet-monument'];
const studies:Partial<Record<InstrumentKind,InstrumentInfo['looks']>>={
 currents:[
  {id:'silk-river',name:'Silk River',params:{flowMode:1,organic:.7,scale:1.4,fibres:72,width:.5,trailLength:.85,curl:.95,travel:.4,eddyScale:2,flowDetail:.5,surfaceHole:.32,motion:1,anisotropy:.8,backgroundOpacity:0,depth:.65}},
  {id:'copper-confluence',name:'Copper Confluence',palette:warm,params:{flowMode:1,organic:.8,scale:1.7,fibres:84,width:.5,trailLength:.95,curl:1,travel:.2,eddyScale:2.8,flowDirection:.35,motion:1,phrase:2,backgroundOpacity:0,depth:.8}},
  {id:'gathering-light',name:'Gathering Light',palette:pearl,params:{flowMode:1,scale:1.6,fibres:60,width:.3,trailLength:.65,curl:.8,travel:.65,eddyScale:1.2,flowDirection:-.4,motion:1,phrase:1,backgroundOpacity:0}},
 ],
 livingink:[
  {id:'ink-estuary',name:'Ink Estuary · Evolving',palette:cool,params:{inkMode:2,scale:2.2,travel:.55,pattern:3,motion:1,relief:.18,seedCoverage:.5,development:1.2,pigment:.6,edgeInk:.6,backgroundOpacity:0}},
  {id:'tidal-pigment',name:'Tidal Pigment · Loop',palette:warm,params:{inkMode:1,organic:.55,scale:1.8,pattern:1,motion:1,flow:.5,relief:.35,edgeInk:.5,flowDirection:.35,backgroundOpacity:0}},
  {id:'coral-development',name:'Coral Development · Evolving',palette:pearl,params:{inkMode:2,scale:2,travel:.2,pattern:2,motion:1,relief:.22,seedCoverage:.7,development:1.35,eddyScale:2.5,flowDirection:-.6,pigment:.65,edgeInk:.8,backgroundOpacity:0}},
 ],
 relief:[
  {id:'breathing-facade',name:'Breathing Facade',params:{reliefMode:1,scale:1,columns:7,motion:1,opening:.85,phaseSpread:.8,organic:.6,phrase:1,shadow:.7,backgroundOpacity:0}},
  {id:'folding-copper',name:'Folding Copper',palette:warm,params:{reliefMode:1,scale:1,columns:5,axis:1,motion:1,opening:.95,phaseSpread:1,organic:.8,phrase:2,shadow:.85,depth:.8,lightAngle:-.9,backgroundOpacity:0}},
  {id:'quiet-monument',name:'Quiet Monument',palette:cool,params:{reliefMode:1,scale:1.2,columns:9,axis:2,motion:.6,opening:.8,phaseSpread:.45,organic:.3,phrase:1,shadow:.9,roughness:.6,gap:.12,backgroundOpacity:0}},
 ],
};
for(const info of INSTRUMENTS)info.looks.push(...(studies[info.kind]??[]));
