import test from 'node:test';
import assert from 'node:assert/strict';
import { FRACTAL_PROJECTION_LOOK_IDS, PRESETS, applyPreset, createLayer, createProject, parameterDefinitions, varyLayer, validateProject } from '../src/core/project';
const unlocked = {palette:false,structure:false,motion:false,material:false};
const identity = ['style','variant','form','mode','colorMode','profile','fill','sweep','gateMode','substrate','quality','cycles','turns','backgroundOpacity','phaseOffset'];

test('the curated library keeps distinct presets on saturated palettes with a dark or light ground', () => {
  assert.equal(PRESETS.length,91 + FRACTAL_PROJECTION_LOOK_IDS.length);
  assert.equal(new Set(PRESETS.map(p=>p.id)).size,PRESETS.length);
  for (const preset of PRESETS) {
    const layer=applyPreset(createLayer(preset.kind),preset.id);
    const project={...createProject(),layers:[layer]};
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project);
    assert.equal(preset.palette.length,6,preset.id);
  }
  // Rule: no two presets of a family share both palette and structure.
  const shape=(p:typeof PRESETS[number])=>JSON.stringify([p.kind,p.palette,p.params.style,p.params.variant,p.params.form,p.params.mode,p.params.inkMode,p.params.flowMode,p.params.reliefMode,p.params.echo,p.params.slitShift]);
  assert.equal(new Set(PRESETS.map(shape)).size,PRESETS.length,'Palette twins');
});

test('smart variations preserve effect identity, coverage, composition and authored animation', () => {
  for (const preset of PRESETS) {
    let layer=applyPreset(createLayer(preset.kind),preset.id);
    layer.transform={x:.3,y:-.2,scale:.4,rotation:.75};
    layer.opacity=.7;layer.blend='screen';
    layer.modulations.exposure={kind:'noise',cycles:2,amount:.1,phase:.2,points:[]};
    const source=structuredClone(layer);
    for (let i=0;i<40;i++) {
      layer=varyLayer(layer,[.35,.65,1][i%3],unlocked,i*8419);
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
  for(const kind of ['surface','sculpture','fractal','oil','liquid','scope','super8','graphic','image'] as const) {
    const layer=createLayer(kind),locks={palette:true,structure:true,motion:true,material:false};
    const a=varyLayer(layer,.65,locks,123),b=varyLayer(layer,.65,locks,456);
    assert.equal(a.params.seed,layer.params.seed);assert.equal(b.params.seed,layer.params.seed);
    assert.notDeepEqual(a.params,b.params,kind+' must get a fresh variation');
    assert.deepEqual(varyLayer(layer,.65,locks,123),a);
  }
});

test('Colour from below saves and reopens on any layer kind', () => {
  for (const kind of ['surface', 'super8', 'oil', 'graphic', 'fractal'] as const) {
    const layer = createLayer(kind); layer.blend = 'source';
    const project = { ...createProject(), layers: [createLayer('image'), layer] };
    assert.equal(validateProject(JSON.parse(JSON.stringify(project))).layers[1].blend, 'source');
  }
  const bad = { ...createProject() }; (bad.layers[0] as { blend: string }).blend = 'overlay';
  assert.throws(() => validateProject(bad), /blend/);
});
