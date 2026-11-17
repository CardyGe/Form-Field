import * as THREE from 'three';
import type { ReliefSettings } from './settings';

type GeometryData = { positions: number[]; normals: number[]; finishes: number[]; indices: number[]; instances: number[] };

export const scaleDimensions = {
  broad: { blades: 24, pitch: 1, radius: .47 },
  medium: { blades: 44, pitch: .5, radius: .30 },
  fine: { blades: 64, pitch: 1/3, radius: .21 },
};

function ribbons(data: GeometryData, woven: boolean, size: ReliefSettings['size']) {
  const pitch = woven ? scaleDimensions[size].pitch : 16 / scaleDimensions[size].blades;
  const rows = woven ? Math.ceil(16/pitch) * 6 : 72;
  const width = woven ? .69 : 1;
  const section = [[-.49,-.20],[-.49,.015],[-.45,.065],[0,.088],[.45,.065],[.49,.015],[.49,-.20]];
  const surfaces = [2, 1, 0, 0, 1, 2];
  for (const [face, finish] of surfaces.entries()) {
    const start = data.positions.length / 3;
    const [x0,z0] = section[face], [x1,z1] = section[face+1];
    for (let row = 0; row <= rows; row++) {
      for (const [x,z] of [section[face], section[face+1]]) {
        data.positions.push(x * width * pitch, row / rows - .5, z * pitch);
        data.normals.push(finish === 0 && x === 0 ? 0 : z0-z1, 0, (x1-x0)*width);
        data.finishes.push(finish);
      }
      if (row < rows) {
        const i = start + 2 * row;
        data.indices.push(i, i+1, i+2, i+2, i+1, i+3);
      }
    }
  }
  for (let i=0; i < Math.round(16/pitch); i++) data.instances.push((i+.5)*pitch-8, 0, 0);
  if (woven) for (let i=0; i<Math.round(9/pitch); i++) data.instances.push(0, (i+.5)*pitch-4.5, 1);
}

// A shallow six-sided stamping with a crowned face, polished rim and deep return.
function scales(data: GeometryData, radius: number) {
  const point = (i: number, r: number, z: number) => new THREE.Vector3(r*Math.cos(i*Math.PI/3), r*Math.sin(i*Math.PI/3), z);
  function triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, finish: number) {
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const v of [a,b,c]) {
      data.indices.push(data.finishes.length);
      data.positions.push(v.x, v.y, v.z);
      data.normals.push(normal.x, normal.y, normal.z);
      data.finishes.push(finish);
    }
  }
  for (let i=0; i<6; i++) {
    const a = point(i, radius*.90, radius*.117), b = point(i+1, radius*.90, radius*.117);
    const c = point(i, radius*.986, 0), d = point(i+1, radius*.986, 0);
    const e = point(i, radius*.986, -radius/3), f = point(i+1, radius*.986, -radius/3);
    triangle(new THREE.Vector3(0,0,radius*.157), a,b,0);
    triangle(a,c,b,1); triangle(c,d,b,1);
    triangle(c,e,d,2); triangle(e,f,d,2);
  }
  const spacing = radius * Math.sqrt(3);
  const nx = Math.ceil(8 / (radius*1.5)), ny = Math.ceil(4.5 / spacing) + 1;
  for (let col=-nx; col<=nx; col++) for (let row=-ny; row<=ny; row++) {
    data.instances.push(col * radius * 1.5, (row + (col & 1)*.5) * spacing, radius);
  }
}

export function reliefGeometry(surface: ReliefSettings['surface'], size: ReliefSettings['size']) {
  const data: GeometryData = { positions: [], normals: [], finishes: [], indices: [], instances: [] };
  if (surface === 'scales') scales(data, scaleDimensions[size].radius);
  else ribbons(data, surface === 'weave', size);
  const mesh = new THREE.InstancedBufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  mesh.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  mesh.setAttribute('aFinish', new THREE.Float32BufferAttribute(data.finishes, 1));
  mesh.setAttribute('aInstance', new THREE.InstancedBufferAttribute(new Float32Array(data.instances), 3));
  mesh.setIndex(data.indices);
  mesh.instanceCount = data.instances.length / 3;
  return mesh;
}
