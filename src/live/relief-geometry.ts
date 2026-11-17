import * as THREE from 'three';
import type { ReliefSettings } from './settings';

type GeometryData = { positions: number[]; normals: number[]; finishes: number[]; indices: number[]; instances: number[] };

export const scaleDimensions = {
  fine: { blades: 64, pitch: 1/3, radius: .21 },
  extraFine: { blades: 88, pitch: .25, radius: .14 },
  micro: { blades: 112, pitch: .20, radius: .085 },
  nano: { blades: 152, pitch: 1/6, radius: .060 },
};

function ribbons(data: GeometryData, woven: boolean, size: ReliefSettings['size'], horizontal: boolean) {
  const pitch = woven ? scaleDimensions[size].pitch : 16 / scaleDimensions[size].blades;
  const length = horizontal ? 16 : 9;
  const rows = woven ? Math.round(length/pitch) * 5 : 72;
  // Woven tape has a continuous, flattened crown and a narrow rolled selvedge.
  const section = woven ? [[-.44,-.035],[-.44,.015],[-.416,.045],[-.32,.063],[-.16,.070],
    [0,.073],[.16,.070],[.32,.063],[.416,.045],[.44,.015],[.44,-.035]]
    : [[-.49,-.20],[-.49,.015],[-.45,.065],[0,.088],[.45,.065],[.49,.015],[.49,-.20]];
  const surfaces = woven ? [2,1,0,0,0,0,0,0,1,2] : [2,1,0,0,1,2];
  for (const [face, finish] of surfaces.entries()) {
    const start = data.positions.length / 3;
    const [x0,z0] = section[face], [x1,z1] = section[face+1];
    for (let row = 0; row <= rows; row++) {
      for (const point of [face,face+1]) {
        const [x,z] = section[point];
        data.positions.push(x*pitch, row/rows-.5, z*pitch);
        if (woven && finish === 0) {
          const [leftX,leftZ] = section[point-1], [rightX,rightZ] = section[point+1];
          data.normals.push(leftZ-rightZ, 0, rightX-leftX);
        } else data.normals.push(finish === 0 && x === 0 ? 0 : z0-z1, 0, x1-x0);
        data.finishes.push(finish);
      }
      if (row < rows) {
        const i = start + 2 * row;
        data.indices.push(i, i+1, i+2, i+2, i+1, i+3);
      }
    }
  }
  const span = horizontal ? 9 : 16;
  for (let i=0; i<Math.round(span/pitch); i++) {
    const offset = (i+.5)*pitch-span/2;
    data.instances.push(horizontal ? 0 : offset, horizontal ? offset : 0, Number(horizontal));
  }
}

// A shallow six-sided stamping with a crowned face, polished rim and deep return.
function scales(data: GeometryData, radius: number) {
  const point = (i: number, r: number, z: number) => new THREE.Vector3(r*Math.cos(i*Math.PI/3), r*Math.sin(i*Math.PI/3), z);
  function face(vertices: THREE.Vector3[], finish: number) {
    const [a,b,c] = vertices;
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    const start = data.finishes.length;
    for (const v of vertices) {
      data.positions.push(v.x,v.y,v.z);
      data.normals.push(normal.x,normal.y,normal.z);
      data.finishes.push(finish);
    }
    data.indices.push(start,start+1,start+2);
    if (vertices.length === 4) data.indices.push(start,start+2,start+3);
  }
  for (let i=0; i<6; i++) {
    const a = point(i, radius*.93, radius*.086), b = point(i+1, radius*.93, radius*.086);
    const c = point(i, radius*.986, 0), d = point(i+1, radius*.986, 0);
    const e = point(i, radius*.986, -radius/3), f = point(i+1, radius*.986, -radius/3);
    face([new THREE.Vector3(0,0,radius*.112),a,b],0);
    face([b,a,c,d],1);
    face([d,c,e,f],2);
  }
  const spacing = radius * Math.sqrt(3);
  const nx = Math.ceil(8 / (radius*1.5)), ny = Math.ceil(4.5 / spacing) + 1;
  for (let col=-nx; col<=nx; col++) for (let row=-ny; row<=ny; row++) {
    data.instances.push(col * radius * 1.5, (row + (col & 1)*.5) * spacing, radius);
  }
}

function reliefGeometry(surface: ReliefSettings['surface'], size: ReliefSettings['size'], horizontal = false) {
  const data: GeometryData = { positions: [], normals: [], finishes: [], indices: [], instances: [] };
  if (surface === 'scales') scales(data, scaleDimensions[size].radius);
  else ribbons(data, surface === 'weave', size, horizontal);
  const mesh = new THREE.InstancedBufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  mesh.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  mesh.setAttribute('aFinish', new THREE.Float32BufferAttribute(data.finishes, 1));
  mesh.setAttribute('aInstance', new THREE.InstancedBufferAttribute(new Float32Array(data.instances), 3));
  mesh.setIndex(data.indices);
  mesh.instanceCount = data.instances.length / 3;
  return mesh;
}

export function reliefGeometries(surface: ReliefSettings['surface'], size: ReliefSettings['size']): THREE.InstancedBufferGeometry[] {
  const vertical = reliefGeometry(surface, size);
  // Use the actual lengths of the two ribbon directions when subdividing them.
  return surface === 'weave' ? [vertical, reliefGeometry(surface, size, true)] : [vertical];
}
