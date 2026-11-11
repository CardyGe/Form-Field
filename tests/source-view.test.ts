import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { sourceViewMatrix } from '../src/rendering/source-view';

test('unbounded source views agree with the compositor and invert without cropping',()=>{
  for(const aspect of [9/16,1,16/9,128])for(const scale of [.05,.25,1,8])for(const rotation of [-2.4,0,.75]) {
    const transform={x:.35,y:-.2,scale,rotation},m=sourceViewMatrix(transform,aspect),inverse=m.clone().invert();
    for(const [u,v] of [[0,0],[1,1],[.5,.5],[-2,3]]) {
      const x=(u-.5-transform.x)*aspect,y=v-.5+transform.y;
      const c=Math.cos(rotation),s=Math.sin(rotation);
      const expected=[(c*x-s*y)/scale/aspect+.5,(s*x+c*y)/scale+.5];
      const p=new Vector3(u,v,1).applyMatrix3(m);
      assert.ok(Math.abs(p.x-expected[0])<1e-10&&Math.abs(p.y-expected[1])<1e-10);
      p.applyMatrix3(inverse);assert.ok(Math.abs(p.x-u)<1e-10&&Math.abs(p.y-v)<1e-10);
    }
  }
  assert.deepEqual(sourceViewMatrix({x:0,y:0,scale:1,rotation:0},16/9).elements,[1,0,0,0,1,0,0,0,1]);
});
