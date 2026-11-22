import * as THREE from 'three';
import type { MorphParams } from './params';
import { MorphDirector } from './director';
import { seedFragment, stepFragment } from './solver-shaders';
import { accumulateSteps, stableStep } from './stability';

/** What the engine needs from the host's pass helper. The app's `Passes` class satisfies it. */
export interface GpuPasses {
  material(fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial;
  draw(material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget | null): void;
  pair(width: number, height: number, options: { float?: boolean; nearest?: boolean }): { read: THREE.WebGLRenderTarget; write: THREE.WebGLRenderTarget; swap(): void; setSize(width: number, height: number): void; dispose(): void };
}
export interface MorphInput { flow: THREE.Texture | null; people: THREE.Texture | null; impulse: number; seedBurst: number }

/** Simulation time per second of real time at Speed 1. */
const SIM_RATE = 40;
const MAX_STEPS = 12;

export class MorphSolver {
  private readonly state: ReturnType<GpuPasses['pair']>;
  private readonly director: MorphDirector;
  private readonly seedMaterial: THREE.ShaderMaterial;
  private readonly stepMaterial: THREE.ShaderMaterial;
  private carry = 0;
  private frame = 0;
  private seed: number | null = null;

  constructor(private readonly passes: GpuPasses, private width: number, private height: number) {
    this.state = passes.pair(width, height, { float: true, nearest: true });
    this.director = new MorphDirector(passes);
    this.seedMaterial = passes.material(seedFragment, { uSeed: { value: 0 } });
    this.stepMaterial = passes.material(stepFragment, {
      uState: { value: null }, uDirector: { value: null }, uK: { value: new THREE.Vector2() }, uDt: { value: .05 }, uDrive: { value: 0 }, uAsym: { value: 0 },
      uAlign: { value: 0 }, uTravel: { value: 0 }, uTime: { value: 0 }, uNoise: { value: 0 }, uFrame: { value: 0 }, uAspect: { value: width / height },
    });
  }

  get texture(): THREE.Texture { return this.state.read.texture; }
  /** The current field's render target, for measurement. */
  get target(): THREE.WebGLRenderTarget { return this.state.read; }

  reseed(seed: number): void {
    this.seed = seed;
    this.seedMaterial.uniforms.uSeed.value = seed;
    this.passes.draw(this.seedMaterial, this.state.read);
    this.carry = 0;
  }

  step(seconds: number, time: number, params: MorphParams, input: MorphInput, driftBoost = 0): void {
    if (this.seed !== params.seed) this.reseed(params.seed);
    this.director.update(seconds, params, this.width / this.height, driftBoost);
    const breath = 1 + params.breathing * .12 * Math.sin(time * .37), outer = params.wavelength * breath, inner = outer * params.formWavelength;
    const dt = Math.min(stableStep(outer, params.alignment, params.asymmetry), stableStep(inner, params.alignment, params.asymmetry));
    // Wide stripes grow more slowly, so they get more simulation time per second to settle as quickly as the default width.
    const widthRate = Math.min(4, (2 * Math.PI / 12) ** 2 / (2 * Math.PI / outer) ** 2);
    const owed = accumulateSteps(this.carry, seconds, params.speed * SIM_RATE * Math.max(1, widthRate), dt, MAX_STEPS);
    this.carry = owed.carry;
    const u = this.stepMaterial.uniforms;
    (u.uK.value as THREE.Vector2).set((2 * Math.PI / outer) ** 2, (2 * Math.PI / inner) ** 2);
    u.uDt.value = dt; u.uDrive.value = Math.min(.9, params.drive + input.impulse * .25); u.uAsym.value = params.asymmetry; u.uAlign.value = params.alignment;
    u.uTravel.value = params.travel; u.uTime.value = time; u.uAspect.value = this.width / this.height; u.uDirector.value = this.director.texture;
    u.uNoise.value = params.forkRate * .012 + input.seedBurst * .08;
    for (let i = 0; i < owed.steps; i++) {
      u.uState.value = this.state.read.texture;
      u.uFrame.value = this.frame = (this.frame + 1) % 65536;
      this.passes.draw(this.stepMaterial, this.state.write);
      this.state.swap();
    }
  }

  dispose(): void {
    this.state.dispose(); this.director.dispose();
    this.seedMaterial.dispose(); this.stepMaterial.dispose();
  }
}
