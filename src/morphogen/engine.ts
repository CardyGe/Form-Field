import type * as THREE from 'three';
import type { MorphParams } from './params';
import { MorphShade } from './shade';
import { MorphSolver, type GpuPasses, type MorphInput } from './solver';

const SIM_WIDTH = 1024, SIM_HEIGHT = 576;

/** The whole generator: stripes in, finished linear picture out. Knows nothing about Live or Map. */
export class MorphEngine {
  private readonly solver: MorphSolver;
  private readonly shade: MorphShade;
  private seed = 0;

  constructor(passes: GpuPasses, width: number, height: number) {
    this.solver = new MorphSolver(passes, SIM_WIDTH, SIM_HEIGHT);
    this.shade = new MorphShade(passes, width, height);
  }

  get output(): THREE.Texture { return this.shade.output; }

  step(seconds: number, time: number, params: MorphParams, input: MorphInput): void {
    this.seed = params.seed;
    this.solver.step(seconds, time, params, input);
    this.shade.draw(this.solver.texture, params, time);
  }

  resize(width: number, height: number): void { this.shade.resize(width, height); }
  clear(): void { this.solver.reseed(this.seed); }
  dispose(): void { this.solver.dispose(); this.shade.dispose(); }
}
