import {FINISH_KEYS} from '../src/core/finishing';
import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, INSTRUMENT_KINDS, INSTRUMENT_UPGRADE_KEYS } from '../src/core/instruments';
import { createLayer, createProject, parameterDefinitions, PRESETS, applyPreset, validateProject, varyLayer, RETIRED_KINDS } from '../src/core/project';
import { evaluateLayer } from '../src/core/timeline';

const route={kind:'sine' as const,cycles:3,amount:.3,phase:.2,points:[]};
test('five instruments have complete original and motion-study looks and round-trip through the document schema',()=>{
 assert.equal(new Set(INSTRUMENT_KINDS).size,5);
 assert.deepEqual(INSTRUMENTS.map(i=>i.kind),[...INSTRUMENT_KINDS]);
 for(const info of INSTRUMENTS){
  const layer=createLayer(info.kind);assert.equal(layer.name,info.name);
  const looks=PRESETS.filter(p=>p.kind===info.kind);assert.equal(looks.length,info.looks.length);
  for(const p of looks){
   const saved={...createProject(),layers:[applyPreset(layer,p.id)]};
   assert.deepEqual(validateProject(JSON.parse(JSON.stringify(saved))),saved);
   assert.equal(Object.keys(p.params).length,parameterDefinitions(info.kind).length);
   assert.equal(p.palette.length,6);
  }
 }
});
test('preparation controls cannot be animated, while new continuous controls retain loop-safe routes',()=>{
 for(const kind of INSTRUMENT_KINDS){
  const layer=createLayer(kind),defs=parameterDefinitions(kind);
  for(const d of defs){
   layer.modulations={[d.key]:route};
   const p={...createProject(),layers:[layer]};
   if(d.preparation||d.step===1)assert.throws(()=>validateProject(p),/not supported/);
   else{
    validateProject(p);const a=evaluateLayer(layer,.7),b=evaluateLayer(layer,.7+2*Math.PI);
    assert.ok(Math.abs(a.params[d.key]-b.params[d.key])<1e-10);
    assert.ok(a.params[d.key]>=d.min&&a.params[d.key]<=d.max);
   }
  }
 }
});
test('new instruments reject malformed controls rather than silently changing the saved effect',()=>{
 for(const kind of INSTRUMENT_KINDS){
  const p={...createProject(),layers:[createLayer(kind)]};
  p.layers[0].params.unrecognised=1;assert.throws(()=>validateProject(p),/not supported/);
  delete p.layers[0].params.unrecognised;
  p.layers[0].params.scale=NaN;assert.throws(()=>validateProject(p),/finite number/);
  p.layers[0].params.scale=2;delete p.layers[0].params.motion;assert.throws(()=>validateProject(p),/finite number/);
 }
});
test('optical improvements migrate old projects with neutral defaults and preserve authored values',()=>{
 for(const kind of ['surface','oil'] as const){
  const p={...createProject(),layers:[createLayer(kind)]};
  const fields=kind==='oil'?['caustics','iridescence']:['iridescence'];
  for(const field of fields)delete p.layers[0].params[field];
  const migrated=validateProject(p);
  for(const field of fields){assert.equal(migrated.layers[0].params[field],0);migrated.layers[0].params[field]=.7;}
  assert.deepEqual(validateProject(migrated),migrated);
  assert.equal(Object.keys(p.layers[0].params).includes('iridescence'),false);
 }
});
test('new randomizers preserve growth family, hinge axis, coverage and authored routes under every lock combination',()=>{
 for(const kind of INSTRUMENT_KINDS)for(let flags=0;flags<16;flags++){
  const layer=createLayer(kind);layer.modulations.exposure=route;layer.transform={x:.2,y:-.3,scale:.25,rotation:.8};
  const locks={palette:!!(flags&1),structure:!!(flags&2),motion:!!(flags&4),material:!!(flags&8)};
  const varied=varyLayer(layer,1,locks,1729);
  assert.deepEqual(varyLayer(layer,1,locks,1729),varied);
  assert.deepEqual(varied.modulations,layer.modulations);assert.deepEqual(varied.transform,layer.transform);
  for(const key of ['pattern','axis','backgroundOpacity','cycles','quality','exposure'])assert.equal(varied.params[key],layer.params[key]);
  for(const d of parameterDefinitions(kind)){
   const held=d.section==='Motion'?locks.motion:d.section==='Material'?locks.material:locks.structure;
   if(held)assert.equal(varied.params[d.key],layer.params[d.key],`${kind} ${d.key}`);
  }
  if(locks.palette)assert.deepEqual(varied.palette,layer.palette);
  validateProject({...createProject(),layers:[varied]});
 }
});

test('0.9 instruments migrate only absent new controls and keep original required fields strict',()=>{
 for(const kind of INSTRUMENT_KINDS){
  const p={...createProject(),layers:[createLayer(kind)]},original=structuredClone(p);
  for(const key of INSTRUMENT_UPGRADE_KEYS[kind])delete p.layers[0].params[key];
  for(const key of FINISH_KEYS)delete p.layers[0].params[key];
  const migrated=validateProject(p);
  for(const key of [...INSTRUMENT_UPGRADE_KEYS[kind],...FINISH_KEYS])assert.equal(migrated.layers[0].params[key],parameterDefinitions(kind).find(d=>d.key===key)!.default);
  for(const key of Object.keys(p.layers[0].params))assert.equal(migrated.layers[0].params[key],original.layers[0].params[key]);
  delete p.layers[0].params.scale;assert.throws(()=>validateProject(p),/params.scale/);
 }
});
test('new finisher and advanced controls reject explicit corruption, without mutating saved state',()=>{
 for(const kind of ['surface','sculpture','fractal','oil','liquid','scope','super8','graphic','image','smokecloud','meridian',...INSTRUMENT_KINDS] as const){
  const p={...createProject(),layers:[createLayer(kind)]};
  for(const d of parameterDefinitions(kind).filter(d=>d.advanced||FINISH_KEYS.includes(d.key))){
   for(const value of [NaN,Infinity,d.min-1,d.max+1]){const q=structuredClone(p);q.layers[0].params[d.key]=value;assert.throws(()=>validateProject(q),new RegExp('params.'+d.key));}
  }
  assert.deepEqual(validateProject(p),p);
 }
});
test('smart variation holds loop phase and inactive support parameters but can vary productive chemical recipes',()=>{
 for(const kind of INSTRUMENT_KINDS){
  const layer=createLayer(kind);layer.params.phaseOffset=.37;
  const next=varyLayer(layer,1,{palette:false,structure:false,motion:false,material:false},1729);
  assert.equal(next.params.phaseOffset,.37);assert.equal(next.params.warpScale,layer.params.warpScale);
  if('sheenAngle' in layer.params&&!layer.params.anisotropy)assert.equal(next.params.sheenAngle,layer.params.sheenAngle);
  assert.equal(next.params.tonePivot,layer.params.tonePivot);
 }
 const ink=createLayer('livingink'),next=varyLayer(ink,1,{palette:true,structure:false,motion:true,material:true},42);
 assert.ok(next.params.branching!==ink.params.branching||next.params.development!==ink.params.development);
 assert.deepEqual(next.modulations,ink.modulations);
});

test('layers from retired effect families are dropped when an older project opens',()=>{
 const retired=(kind:string)=>({...createLayer('surface'),id:kind,kind});
 const mixed={...createProject(),layers:[createLayer('surface'),retired('prism'),retired('veils'),retired('currents')]};
 const opened=validateProject(JSON.parse(JSON.stringify(mixed)));
 assert.deepEqual(opened.layers.map(l=>l.kind),['surface']);
 assert.throws(()=>validateProject({...createProject(),layers:[retired('caustic')]}),/retired/);
 assert.deepEqual([...RETIRED_KINDS].sort(),['caustic','currents','loom','magnetic','prism','reef','veils']);
});
