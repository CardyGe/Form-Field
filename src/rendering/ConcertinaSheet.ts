import * as THREE from 'three';
import type { Layer } from '../shared/types';

const SLICES = 32;
const ease = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

// Wind up to a shallow angle, catch, then snap through. Later pleats
// follow the leader in close succession. The broad tip settles last.
function pull(t: number, u: number, v: number, spread: number, dwell: number) {
  const leader = 1 - ease((u - .08) / .20);
  const tip = ease((u - .68) / .25);
  const arrival = spread * (.06 * v + .19 * u);
  const local = t - arrival;
  const preload = .23 * ease(local / .078);
  const snap = .77 * ease((local - .083 - leader * .065) / (.070 + tip * .045));
  const release = .44 + .09 * dwell + arrival + .0625 * spread * tip;
  return (preload + snap) * (1 - ease((t - release) / (.11 + .038 * tip)));
}

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
    const width = 2.15, height = 1.24;
    const t = THREE.MathUtils.euclideanModulo(phase / (2 * Math.PI) * p.cycles + p.phaseOffset, 1);
    const face = new THREE.Color(), lip = new THREE.Color();
    for (let row = 0; row <= SLICES; row++) {
      const v = row / SLICES;
      // A second, oblique crease crosses the pleats. Sample its displacement
      // at each shared vertex, independent of which face owns that vertex.
      const strengthAt = (u: number) => p.motion * pull(t, u, v, p.delaySpread, p.pause);
      const y = (v - .5) * height;
      const point = (vertex: number, horizontal: number, z: number, u: number) => {
        const load = strengthAt(u) * p.opening;
        const bend = load * (1 - 2 * Math.abs(v - (.26 + .43 * u)));
        const swing = load * (.20 * v - .18 * u * (1 - v));
        const lift = load * (.40 * u * u * (1 - v) - .08 * (1 - u) * v);
        positions.setXYZ(vertex, horizontal + bend * .37 + swing, y + lift, z + bend * .24);
      };
      let x = -width * .5 + .27 * (v - .5);
      for (let i = 0; i < folds; i++) {
        const u = (i + .5) / folds;
        const amount = strengthAt(u);
        // These widths sum to the sheet width at every supported pleat count.
        const pitch = width / folds * (.55 + .90 * u);
        // A loaded pleat closes tightly at its foot and gently at its crown.
        // The shared cross-sections open into a fan with a fixed lower heel.
        const angle = (.12 + amount * (1.36 - .68 * ease(v))) * p.opening;
        const section = foldSection(angle, pitch);
        face.copy(palette[0]).lerp(palette[2], .10 + .20 * v);
        lip.copy(palette[1]).lerp(palette[3], .40 * (1 - amount));
        const base = (row * folds + i) * 4;
        point(base, x, 0, i / folds);
        point(base + 1, x + section.ridge, section.height, (i + .64) / folds);
        positions.setXYZ(base + 2, positions.getX(base + 1), positions.getY(base + 1), positions.getZ(base + 1));
        x += section.span;
        point(base + 3, x, 0, (i + 1) / folds);
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
