import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, applyPreset, createLayer, createProject, parameterDefinitions, varyLayer, validateProject } from '../src/core/project';
const unlocked = {palette:false,structure:false,motion:false,material:false};
const identity = ['style','variant','form','mode','colorMode','profile','fill','sweep','gateMode','substrate','quality','cycles','turns','backgroundOpacity','phaseOffset'];

test('twenty signature looks retain all original presets and use ordinary saved layers', () => {
  assert.equal(PRESETS.length,127);
  assert.equal(PRESETS.filter(p => !p.signature).length,107);
  const signatures=PRESETS.filter(p => p.signature);
  assert.equal(signatures.length,20);
  assert.equal(new Set(signatures.map(p => p.kind)).size,6);
  for (const preset of signatures) {
    const layer=applyPreset(createLayer(preset.kind),preset.id);
    const project={...createProject(),layers:[layer]};
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project);
    assert.equal('signature' in layer,false,'Collection metadata does not alter schema-1');
  }
});

test('smart variations preserve effect identity, coverage, composition and authored animation', () => {
  for (const preset of PRESETS) {
    let layer=applyPreset(createLayer(preset.kind),preset.id);
    layer.transform={x:.3,y:-.2,scale:.4,rotation:.75};
    layer.opacity=.7;layer.blend='screen';
    layer.modulations.exposure={kind:'noise',cycles:2,amount:.1,phase:.2,points:[]};
    const source=structuredClone(layer);
    for (let i=0;i<40;i++) {
      layer=varyLayer(layer,[.35,.65,1][i%3],unlocked,i*7919);
      assert.deepEqual(layer.transform,source.transform);
      assert.deepEqual(layer.mask,source.mask);
      assert.deepEqual(layer.modulations,source.modulations);
      assert.equal(layer.params.exposure,source.params.exposure);
      assert.equal(layer.opacity,.7);assert.equal(layer.blend,'screen');
      for(const key of identity) assert.equal(layer.params[key],source.params[key],`${preset.id}: ${key}`);
      assert.ok(PRESETS.some(p=>p.kind===layer.kind&&JSON.stringify(p.palette)===JSON.stringify(layer.palette)),'Complete authored palettes');
      for(const d of parameterDefinitions(layer.kind)) assert.ok(Number.isFinite(layer.params[d.key])&&layer.params[d.key]>=d.min&&layer.params[d.key]<=d.max,`${preset.id}: ${d.key}`);
    }
    assert.deepEqual(validateProject({...createProject(),layers:[layer]}).layers[0],layer);
  }
});

test('independent entropy changes unlocked material even while the source seed is locked', () => {
  for(const kind of ['surface','sculpture','fractal','oil','super8','graphic','image'] as const) {
    const layer=createLayer(kind),locks={palette:true,structure:true,motion:true,material:false};
    const a=varyLayer(layer,.65,locks,123),b=varyLayer(layer,.65,locks,456);
    assert.equal(a.params.seed,layer.params.seed);assert.equal(b.params.seed,layer.params.seed);
    assert.notDeepEqual(a.params,b.params,kind+' must get a fresh variation');
    assert.deepEqual(varyLayer(layer,.65,locks,123),a);
  }
});
