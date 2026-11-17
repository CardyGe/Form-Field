import * as THREE from 'three';
import type { Layer } from '../shared/types';

const SLICES = 32;
const ease = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Samples one continuous cross-section. The two unequal faces share a ridge.
 * The long and short faces retain their lengths as the pleat closes. */
function foldSection(angle: number, pitch: number) {
  const short = pitch * .36;
  const height = short * Math.sin(angle);
  const ridge = Math.sqrt((pitch - short) ** 2 - height ** 2);
  return { height, ridge, span: ridge + short * Math.cos(angle) };
}

export class ConcertinaSheet extends THREE.BufferGeometry {
  private folds = 0;

  private allocate(folds: number) {
    this.dispose();
    this.folds = folds;
    const count = folds * 4 * (SLICES + 1);
    for (const key of ['position', 'color']) {
      this.setAttribute(key, new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    }
    const uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
    const indices: number[] = [];
    for (let row = 0; row <= SLICES; row++) {
      for (let face = 0; face < folds * 2; face++) {
        const left = (row * folds * 2 + face) * 2;
        uv.setXY(left, 0, row / SLICES);
        uv.setXY(left + 1, 1, row / SLICES);
        if (row === SLICES) continue;
        const above = left + folds * 4;
        indices.push(left, left + 1, above, left + 1, above + 1, above);
      }
    }
    this.setAttribute('uv', uv);
    this.setIndex(indices);
    this.deleteAttribute('normal');
  }

  pose(layer: Layer, phase: number) {
    const p = layer.params;
    const folds = Math.round(p.columns);
    if (this.folds !== folds) this.allocate(folds);
    const positions = this.getAttribute('position'), colors = this.getAttribute('color');
    const palette = layer.palette.map(c => new THREE.Color(c));
    const width = 2.15, height = 1.24, pitch = width / folds;
    const t = THREE.MathUtils.euclideanModulo(phase / (2 * Math.PI) * p.cycles + p.phaseOffset, 1);
    const face = new THREE.Color(), lip = new THREE.Color();
    for (let row = 0; row <= SLICES; row++) {
      const v = row / SLICES;
      // A second, oblique crease crosses the pleats. Sample its displacement
      // at each shared vertex, independent of which face owns that vertex.
      const strengthAt = (u: number) => {
        const delay = (u * .67 + v * .33) * p.delaySpread * .24;
        const open = ease((t - delay) / .24);
        const release = ease((t - .50 - .09 * p.pause - delay) / .16);
        return open * (1 - release) * p.motion;
      };
      const bendAt = (u: number) =>
        strengthAt(u) * p.opening * (1 - 2 * Math.abs(v - (.26 + .43 * u)));
      let x = -width * .5 + .27 * (v - .5);
      let start = bendAt(0);
      for (let i = 0; i < folds; i++) {
        const amount = strengthAt((i + .5) / folds);
        const angle = (.12 + amount * 1.08) * p.opening;
        const section = foldSection(angle, pitch);
        face.copy(palette[0]).lerp(palette[2], .10 + .20 * v);
        lip.copy(palette[1]).lerp(palette[3], .40 * (1 - amount));
        const base = (row * folds + i) * 4;
        const y = (v - .5) * height;
        const peak = bendAt((i + .64) / folds);
        const end = bendAt((i + 1) / folds);
        positions.setXYZ(base, x + start * .37, y, start * .24);
        positions.setXYZ(base + 1, x + section.ridge + peak * .37, y, section.height + peak * .24);
        positions.setXYZ(base + 2, x + section.ridge + peak * .37, y, section.height + peak * .24);
        x += section.span;
        positions.setXYZ(base + 3, x + end * .37, y, end * .24);
        start = end;
        for (let j = 0; j < 4; j++) {
          const c = j < 2 ? face : lip;
          colors.setXYZ(base + j, c.r, c.g, c.b);
        }
      }
    }
    positions.needsUpdate = colors.needsUpdate = true;
    this.computeVertexNormals();
  }
}
