import * as THREE from 'three';
import type { MorphParams } from './params';
import type { GpuPasses } from './solver';
import { directorFragment } from './solver-shaders';

const WIDTH = 256, HEIGHT = 144;

/** The low-resolution field that tells stripes which way to run. */
export class MorphDirector {
  private readonly field: ReturnType<GpuPasses['pair']>;
  private readonly material: THREE.ShaderMaterial;
  private drift = 0;
  private started = false;

  constructor(private readonly passes: GpuPasses) {
    this.field = passes.pair(WIDTH, HEIGHT, {});
    this.material = passes.material(directorFragment, {
      uPrevious: { value: null }, uBlend: { value: 1 }, uType: { value: 0 }, uMix: { value: 0 }, uSpiral: { value: 0 }, uCurlAmount: { value: 0 }, uCurlScale: { value: 1 },
      uTime: { value: 0 }, uAspect: { value: 16 / 9 }, uCentre: { value: new THREE.Vector2() },
    });
  }

  get texture(): THREE.Texture { return this.field.read.texture; }

  update(seconds: number, params: MorphParams, aspect: number, driftBoost = 0): void {
    this.drift += seconds * (params.fieldDrift + driftBoost) * .6;
    const u = this.material.uniforms;
    u.uType.value = params.fieldType; u.uMix.value = params.fieldMix; u.uSpiral.value = params.spiral;
    u.uCurlAmount.value = params.curlAmount; u.uCurlScale.value = params.curlScale; u.uTime.value = this.drift; u.uAspect.value = aspect;
    (u.uCentre.value as THREE.Vector2).set(params.centreX, params.centreY);
    u.uPrevious.value = this.field.read.texture;
    u.uBlend.value = this.started ? 1 - Math.exp(-seconds / .7) : 1;
    this.started = true;
    this.passes.draw(this.material, this.field.write);
    this.field.swap();
  }

  dispose(): void { this.field.dispose(); this.material.dispose(); }
}
