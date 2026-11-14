import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset,createLayer,createProject,PRESETS,validateProject,visibleParameterDefinitions,varyLayer } from '../src/core/project';
import { GRAPHIC_VARIANTS } from '../src/core/graphics';
import { generateGraphicLayout,graphicLayoutKey,GraphicLayoutCache,sampleGraphicGlyphs,graphicPatternExtent } from '../src/rendering/graphic-layout';
const looks=PRESETS.filter(p=>p.kind==='graphic');
const layerFor=(id:string)=>applyPreset(createLayer('graphic'),id);

test('all graphic looks are complete, persisted native layers with substantial family controls',()=>{
  assert.equal(looks.length,17);
  for(const look of looks){
    const layer=layerFor(look.id),project={...createProject(),layers:[layer]};
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project);
    assert.ok(layer.params.variant<GRAPHIC_VARIANTS[layer.params.style].length);
    assert.ok(visibleParameterDefinitions(layer).length>=24,look.id+' must have detailed relevant controls');
    const keys=new Set(visibleParameterDefinitions(layer).map(d=>d.key));
    assert.equal(keys.has('columns'),layer.params.style===0);
    assert.equal(keys.has('glyphCount'),layer.params.style===3);
    assert.equal(keys.has('pathLength'),layer.params.style===4);
    assert.equal(keys.has('innerRadius'),layer.params.style===4&&layer.params.variant===3);
  }
});

test('seeded tile packing covers the grid exactly once, stays in bounds, and is reproducible',()=>{
  const p=layerFor('packed-mosaic').params;
  for(const aspect of [9/16,1,16/9]){
    const layout=generateGraphicLayout(p,aspect),cells=new Uint8Array(layout.columnsCount*layout.rowsCount);
    assert.deepEqual(layout,generateGraphicLayout(p,aspect));
    for(const tile of layout.tiles){
      const x=Math.round((tile.x-tile.w/2+aspect/2)/aspect*layout.columnsCount);
      const y=Math.round((.5-tile.y-tile.h/2)*layout.rowsCount);
      const w=Math.round(tile.w/aspect*layout.columnsCount),h=Math.round(tile.h*layout.rowsCount);
      assert.ok(x>=0&&y>=0&&x<layout.columnsCount&&y<layout.rowsCount&&w<=layout.columnsCount&&h<=layout.rowsCount);
      for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)assert.equal(cells[(yy%layout.rowsCount)*layout.columnsCount+xx%layout.columnsCount]++,0);
    }
    assert.ok(cells.every(x=>x===1));
    assert.notDeepEqual(layout,generateGraphicLayout({...p,seed:p.seed+1},aspect));
  }
});

test('grid paths are bounded, adjacent and self-avoiding, including mirrored and ring layouts',()=>{
  for(const id of ['circuit-worms','circuit-channels','maze-carpet','radial-circuit'])for(const aspect of [9/16,1,16/9]){
    const p=layerFor(id).params,layout=generateGraphicLayout(p,aspect),seen=new Set<string>();
    assert.deepEqual(layout,generateGraphicLayout(p,aspect));
    for(const path of layout.paths){
      assert.ok(path.length<=p.pathLength);
      for(let i=0;i<path.length;i++){
        const pt=path[i];assert.ok(Number.isFinite(pt.x)&&Number.isFinite(pt.y));
        const cx=((Math.round((pt.x+aspect/2)/aspect*layout.columnsCount-.5)%layout.columnsCount)+layout.columnsCount)%layout.columnsCount;
        const cy=((Math.round((.5-pt.y)*layout.rowsCount-.5)%layout.rowsCount)+layout.rowsCount)%layout.rowsCount;
        const key=cx+':'+cy;assert.ok(!seen.has(key),id+' overlap');seen.add(key);
        if(i>0){const a=path[i-1];assert.ok((Math.abs(a.x-pt.x)<1e-9)!==(Math.abs(a.y-pt.y)<1e-9),'axis-aligned step');}
      }
    }
    assert.ok(seen.size<=layout.columnsCount*layout.rowsCount);
  }
});

test('all graphic frames are finite, periodic, independent of seek order, and stop with zero motion',()=>{
  for(const look of looks){
    const layer=layerFor(look.id),layout=generateGraphicLayout(layer.params,16/9);
    const a=sampleGraphicGlyphs(layer,.7,16/9,layout);
    sampleGraphicGlyphs(layer,4.9,16/9,layout);
    assert.deepEqual(a,sampleGraphicGlyphs(layer,.7,16/9,layout));
    const wrapped=sampleGraphicGlyphs(layer,.7+Math.PI*2,16/9,layout);
    assert.equal(a.length,wrapped.length);
    a.forEach((g,i)=>{for(const key of Object.keys(g) as (keyof typeof g)[]){if(typeof g[key]==='number'){assert.ok(Number.isFinite(g[key]));assert.ok(Math.abs((g[key] as number)-(wrapped[i][key] as number))<1e-9);}}});
    layer.params.motion=0;layer.params.turns=0;
    assert.deepEqual(sampleGraphicGlyphs(layer,0,16/9,layout),sampleGraphicGlyphs(layer,2,16/9,layout));
  }
});

test('layout cache ignores colour and motion but tracks structural changes',()=>{
  const p=layerFor('packed-mosaic').params,cache=new GraphicLayoutCache();
  const first=cache.get(p,1);
  assert.equal(cache.get({...p,colorOffset:.5,motion:0},1),first);
  assert.equal(graphicLayoutKey(p,1),graphicLayoutKey({...p,sweepAngle:1},1));
  assert.notEqual(cache.get({...p,tileResolution:22},1),first);
  assert.notEqual(cache.get(p,16/9),first);
  const radial=layerFor('radial-circuit').params;
  assert.equal(cache.get(radial,1),cache.get({...radial,innerRadius:.3,ringWidth:.2},1));
  const cols=layerFor('lava-columns').params;
  const data=generateGraphicLayout(cols,1);assert.ok(Math.abs(data.columns.reduce((a,b)=>a+b,0)-1)<1e-12);
});

test('graphic variation keeps selected algorithms, honours locks and stays valid',()=>{
  for(const look of looks){
    const layer=layerFor(look.id);
    const varied=varyLayer(layer,.35,{palette:false,structure:false,motion:false,material:false});
    for(const key of ['style','variant','profile','fill','sweep','corners'])assert.equal(varied.params[key],layer.params[key]);
    assert.doesNotThrow(()=>validateProject({...createProject(),layers:[varied]}));
    assert.deepEqual(varyLayer(layer,1,{palette:true,structure:true,motion:true,material:true}),layer);
  }
});

test('graphic family validation rejects mismatched looks and variation leaves inactive controls intact',()=>{
  const layer=layerFor('lava-columns');layer.params.variant=8;
  assert.throws(()=>validateProject({...createProject(),layers:[layer]}),/does not belong/);
  const path=layerFor('circuit-worms');path.params.turns=3;
  const varied=varyLayer(path,1,{palette:false,structure:false,motion:false,material:false});
  assert.equal(varied.params.turns,3);assert.equal(varied.params.columns,path.params.columns);
  assert.equal(varied.params.style,4);assert.equal(varied.params.variant,0);
  assert.doesNotThrow(()=>validateProject({...createProject(),layers:[varied]}));
});

test('extreme canvas aspect ratios retain bounded layout and glyph budgets',()=>{
  for(const id of ['packed-mosaic','maze-carpet','radial-circuit']){
    const layer=layerFor(id);layer.params.tileResolution=64;layer.params.pathResolution=64;
    for(const aspect of [1/128,128,4096]){
      const layout=generateGraphicLayout(layer.params,aspect);
      assert.ok(layout.columnsCount*layout.rowsCount<=12288);
      assert.ok(layout.tiles.length<=12288);
      assert.ok(layout.paths.reduce((n,p)=>n+p.length,0)<=12288);
      assert.ok(sampleGraphicGlyphs(layer,.7,aspect,layout).length<=32768);
    }
  }
});

test('radial pattern size adds outer geometry while retaining one centre and the original inner shapes',()=>{
  for(const id of ['circle-fans','beaded-spiral','web-rosette'])for(const aspect of [9/16,1,16/9]){
    const layer=layerFor(id),layout=generateGraphicLayout(layer.params,aspect);
    layer.params.turns=0;layer.params.orientation=0;layer.params.stretch=1;
    assert.equal(graphicPatternExtent(layer,.7,aspect),1);
    const original=sampleGraphicGlyphs(layer,.7,aspect,layout);
    layer.params.size=.25;
    assert.ok(Math.abs(graphicPatternExtent(layer,.7,aspect)-4)<1e-10);
    const small=sampleGraphicGlyphs(layer,.7,aspect,layout);
    assert.ok(small.length>original.length,id+' must add geometry instead of shrinking a finite object');
    for(const g of original)assert.ok(small.some(s=>s.x===g.x&&s.y===g.y&&s.hx===g.hx&&s.hy===g.hy),id+' inner geometry must remain in the same radial field');
    assert.ok(small.length<=(layer.params.style===1?12288:24576));
    layer.transform={x:.4,y:-.3,scale:.2,rotation:.7};
    const extent=graphicPatternExtent(layer,.7,aspect);
    assert.ok(extent>4);
    assert.ok(Math.abs(extent-graphicPatternExtent(layer,.7+Math.PI*2,aspect))<1e-9);
    assert.ok(sampleGraphicGlyphs(layer,.7,aspect,layout).length<=(layer.params.style===1?12288:24576));
  }
});


test('packed shapes and circuit paths cross repeat boundaries instead of stopping at a screenshot edge',()=>{
  for(const id of ['packed-mosaic','circuit-worms','circuit-channels','radial-circuit']) {
    const layer=layerFor(id),layout=generateGraphicLayout(layer.params,16/9);
    if(layer.params.style===2) {
      assert.ok(layout.tiles.some(t=>t.x+t.w/2>8/9));
      assert.ok(layout.tiles.some(t=>t.y-t.h/2<-.5));
    }else{
      assert.ok(layout.paths.some(path=>path.some(t=>Math.abs(t.x)>8/9)));
      assert.ok(layout.paths.some(path=>path.some(t=>Math.abs(t.y)>.5)));
    }
    const glyphs=sampleGraphicGlyphs(layer,1.3,16/9,layout);
    assert.ok(glyphs.some(g=>g.x-g.hx< -8/9||g.x+g.hx>8/9));
    assert.ok(glyphs.some(g=>g.y-g.hy< -.5||g.y+g.hy>.5));
  }
});
