import test from 'node:test';
import assert from 'node:assert/strict';
import {createLayer,createProject,validateProject,parameterDefinitions,applyPreset,varyLayer,visibleParameterDefinitions} from '../src/core/project';
import {INSTRUMENT_KINDS,INSTRUMENT_UPGRADE_KEYS,PROJECTION_LOOK_IDS} from '../src/core/instruments';
import {evaluateLayer} from '../src/core/timeline';
import {isEvolving,playbackPhase} from '../src/core/playback';
import {flowStep,flowVelocity,phraseTime,smooth,TAU,type FlowSettings} from '../src/rendering/flow-field';
import {distanceGrid,isSimplePolygon,polygonDistance,sampleSurface} from '../src/core/surface-layout';
import {canvasAxes} from '../src/core/canvas-interaction';

const points=[{x:.3,y:.3},{x:.7,y:.3},{x:.7,y:.7},{x:.3,y:.7}];
test('new treatments shape useful live controls without rebuilding chemistry or changing framing',()=>{
 const locks={palette:false,structure:false,motion:false,material:false},ink=applyPreset(createLayer('livingink'),'ink-estuary');
 assert.deepEqual(canvasAxes(ink,locks).map(d=>d.key),['pigment','relief']);
 assert.ok(canvasAxes(ink,locks).every(d=>!d.preparation));assert.deepEqual(canvasAxes(ink,{...locks,material:true}).map(d=>d.key),[]);
});
test('original instruments migrate new motion settings neutrally and reject explicit corruption',()=>{
 for(const kind of INSTRUMENT_KINDS){const p={...createProject(),layers:[createLayer(kind)]};for(const key of INSTRUMENT_UPGRADE_KEYS[kind])delete p.layers[0].params[key];const result=validateProject(p);
  assert.equal(result.layers[0].params.organic,0);for(const key of ['flowMode','inkMode','reliefMode'])if(key in result.layers[0].params)assert.equal(result.layers[0].params[key],0);
  for(const d of parameterDefinitions(kind).filter(d=>['organic','travel','flowMode','inkMode','reliefMode','phrase'].includes(d.key))){const q=structuredClone(result);q.layers[0].params[d.key]=d.max+1;assert.throws(()=>validateProject(q),/params/);}
 }
});
test('projection studies are complete native layers and variation preserves treatment, phrase and surface',()=>{
 for(const id of PROJECTION_LOOK_IDS){const kind=id.includes('facade')||['folding-copper','quiet-monument'].includes(id)?'relief':'livingink';const layer=applyPreset(createLayer(kind),id);layer.surface={source:'polygon',role:'obstacle',influence:.8,points};
  const project={...createProject(),schemaVersion:2 as const,layers:[layer]};assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project);
  const varied=varyLayer(layer,1,{palette:false,structure:false,motion:false,material:false},42);for(const key of ['flowMode','inkMode','reliefMode','phrase','surfaceHole'])assert.equal(varied.params[key],layer.params[key]);assert.deepEqual(varied.surface,layer.surface);
 }
});
test('endpoint routes use their full bounded range with smooth turns and preserve legacy offset semantics',()=>{
 const layer=createLayer('surface');layer.params.warp=.98;layer.modulations.warp={kind:'sine',cycles:1,phase:0,amount:1,points:[],range:{min:.1,max:.85}};
 assert.throws(()=>validateProject({...createProject(),layers:[layer]}),/version 2/);
 const project={...createProject(),schemaVersion:2 as const,layers:[layer]};validateProject(project);
 assert.equal(evaluateLayer(layer,Math.PI/2).params.warp,.85);assert.equal(evaluateLayer(layer,3*Math.PI/2).params.warp,.1);
 const eps=1e-5;assert.ok(Math.abs(evaluateLayer(layer,Math.PI/2-eps).params.warp-.85)<1e-9);
 for(let i=0;i<1000;i++){const value=evaluateLayer(layer,i/1000*TAU).params.warp;assert.ok(value>=.1&&value<=.85);}
 const old=structuredClone(layer);delete old.modulations.warp.range;assert.equal(evaluateLayer(old,Math.PI/2).params.warp,1);
 for(const range of [{min:.8,max:.2},{min:NaN,max:.8},{min:-1,max:.8},{min:0,max:2}]){const q=structuredClone(project);q.layers[0].modulations.warp.range=range;assert.throws(()=>validateProject(q),/range/);}
});
test('finite evolving playback stops, replay is explicit, and hidden chemistry does not disable loops',()=>{
 const p={...createProject(),layers:[createLayer('livingink')]};assert.equal(isEvolving(p),false);p.layers[0].params.inkMode=2;assert.equal(isEvolving(p),false,'Loop return makes evolving chemistry loop');assert.ok(Math.abs(playbackPhase(TAU-.01,.1,p)-.09)<1e-9,'a looping clip wraps');p.layers[0].params.loopReturn=0;assert.equal(isEvolving(p),true);assert.equal(playbackPhase(TAU-.01,.1,p),TAU);assert.equal(playbackPhase(TAU,.1,p),TAU);
 p.layers[0].visible=false;assert.ok(playbackPhase(TAU-.01,.1,p)<.1);
 p.duration=61;assert.throws(()=>validateProject(p),/60 seconds/);
 p.duration=20;p.layers[0].modulations.scale={kind:'sine',cycles:1,phase:0,amount:.2,points:[]};assert.throws(()=>validateProject(p),/not supported/);
 assert.ok(visibleParameterDefinitions(p.layers[0]).find(d=>d.key==='scale')!.preparation);
});
test('directed RK2 trajectories remain finite and outside a central obstacle',()=>{
 const settings:FlowSettings={travel:.5,curl:1,eddy:2.4,detail:.7,direction:.4,obstacle:.4,seed:1729};
 for(let j=0;j<30;j++){let x=-1.8,y=(j/29-.5)*2.4;for(let i=0;i<128;i++){[x,y]=flowStep(x,y,i/128,1/128,settings);assert.ok(Number.isFinite(x)&&Number.isFinite(y));assert.ok(Math.hypot(x,y)>=.4-1e-8);}}
 const a=flowVelocity(.7,-.2,.3,settings),b=flowVelocity(.7,-.2,1.3,settings);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-12));
});
test('motion phrases advance monotonically and match speed through the loop boundary',()=>{
 for(const phrase of [0,1,2]){let previous=0;for(let i=1;i<1000;i++){const t=phraseTime(i/1000,1,phrase);assert.ok(t>previous);previous=t;}
  const e=1e-6,left=(1-phraseTime(1-e,1,phrase))/e,right=phraseTime(e,1,phrase)/e;assert.ok(Math.abs(left-right)<1e-4);
 }
 assert.equal(smooth(0),0);assert.equal(smooth(1),1);
});
test('surface geometry rejects crossings, duplicates and collapsed areas; distance signs and normals agree',()=>{
 assert.equal(isSimplePolygon(points),true);assert.equal(isSimplePolygon([points[0],points[2],points[1],points[3]]),false);assert.equal(isSimplePolygon([points[0],points[0],points[2]]),false);
 assert.ok(polygonDistance(.5,.5,points)<0);assert.ok(polygonDistance(.9,.5,points)>0);
 const size=64,coverage=new Float32Array(size*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++)coverage[y*size+x]=polygonDistance((x+.5)/size,(y+.5)/size,points)<0?1:0;
 const grid=distanceGrid(coverage,size);assert.ok(sampleSurface(grid,.5,.5).distance<0);const edge=sampleSurface(grid,.72,.5);assert.ok(edge.distance>0&&edge.nx>.9);assert.equal(sampleSurface(grid,-1,.5).coverage,0);
 const p={...createProject(),schemaVersion:2 as const,layers:[createLayer('livingink')]};p.layers[0].surface={source:'polygon',role:'obstacle',influence:1,points};validateProject(p);p.layers[0].surface.points=[points[0],points[2],points[1],points[3]];assert.throws(()=>validateProject(p),/simple polygon/);
});
