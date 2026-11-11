import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayer } from '../src/core/project';
import { graphicGridBounds, graphicRenderPlan } from '../src/rendering/graphic-view';
import { previewSize } from '../src/rendering/preview-size';

test('Retina previews use physical display pixels without changing CSS layout or exceeding the GPU budget', () => {
  for (const aspect of [9/16, 1, 16/9]) {
    const a=previewSize(1000,700,aspect,1), b=previewSize(1000,700,aspect,2);
    assert.equal(b.width,Math.round(a.cssWidth*2)); assert.equal(b.height,Math.round(a.cssHeight*2));
    assert.equal(a.cssWidth,b.cssWidth); assert.equal(a.cssHeight,b.cssHeight);
    const large=previewSize(20000,10000,aspect,4);
    assert.ok(Math.max(large.width,large.height)<=3840);
    assert.ok(large.width*large.height<=8_294_400);
    assert.ok(Math.abs(large.width/large.height-aspect)<.005);
  }
});

test('magnified repeating patterns render geometry in the view; minified patterns use filtered cells', () => {
  for(const style of [0,2,4])for(const rotation of [-1.2,0,.7])for(const scale of [1,2,4,8]) {
    const layer=createLayer('graphic'); Object.assign(layer.params,{style,size:1,stretch:1});
    layer.transform={x:.9,y:-.7,scale,rotation};
    for(const aspect of [9/16,1,16/9]) {
      const plan=graphicRenderPlan(layer,.7,Math.round(360*aspect),360,8192);
      assert.equal(plan.inView,true); assert.equal(plan.height,360);
      const bounds=graphicGridBounds(layer,.7,aspect);
      assert.ok(bounds.x0<=bounds.x1&&bounds.y0<=bounds.y1);
      assert.deepEqual(graphicGridBounds(layer,.7+Math.PI*2,aspect),bounds);
    }
  }
  const layer=createLayer('graphic'); layer.params.style=4; layer.transform.scale=.25;
  assert.equal(graphicRenderPlan(layer,.7,640,360,8192).inView,false);
  layer.transform.scale=8;
  const extreme=graphicRenderPlan(layer,.7,8192,64,8192);
  assert.ok(extreme.width<=8192&&extreme.height<=8192);
  assert.ok(extreme.width*extreme.height<=16_777_216);
});
