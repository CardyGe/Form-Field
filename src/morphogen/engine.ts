import type * as THREE from 'three';
import { ActivityGovernor, fieldActivity } from './activity';
import { DisplayBudget, QualityGovernor, type QualityState } from './governor';
import type { MorphParams } from './params';
import { MorphShade } from './shade';
import { MorphSolver, type GpuPasses, type MorphInput } from './solver';

const SIM_WIDTH = 1024, SIM_HEIGHT = 576, PROBE_WIDTH = 64, PROBE_HEIGHT = 36;
const SIM_HEIGHTS: QualityState['simHeight'][] = [432, 576, 720];

/** The whole generator: stripes in, finished linear picture out. Knows nothing about Live or Map. */
export class MorphEngine {
  private readonly solver: MorphSolver;
  private readonly shade: MorphShade;
  private readonly governor = new ActivityGovernor();
  private readonly quality = new QualityGovernor(576);
  private readonly budget = new DisplayBudget();
  private readonly probe: ReturnType<GpuPasses['pair']>;
  private readonly probeMaterial: THREE.ShaderMaterial;
  private seed = 0;
  private sinceProbe = 0;
  private probing = false;
  private disposed = false;
  private previous: Float32Array | null = null;
  private help = { driftBoost: 0, seedBurst: 0 };
  /** The last measured change per second: 0 frozen, 1 completely new. */
  activity = 1;

  constructor(private readonly passes: GpuPasses, width: number, height: number) {
    this.solver = new MorphSolver(passes, SIM_WIDTH, SIM_HEIGHT);
    this.shade = new MorphShade(passes, width, height);
    this.probe = passes.pair(PROBE_WIDTH, PROBE_HEIGHT, { float: true, nearest: true });
    this.probeMaterial = passes.material('uniform sampler2D uState;void main(){gl_FragColor=texture2D(uState,vUv);}', { uState: { value: null } });
  }

  get output(): THREE.Texture { return this.shade.output; }
  /** False while a fresh pattern is still forming. */
  get ready(): boolean { return this.solver.formed >= 1; }
  /** The quality the governor has chosen, for the operator and checks. */
  get qualityState(): QualityState { return this.quality.state; }

  step(seconds: number, time: number, params: MorphParams, input: MorphInput): void {
    this.seed = params.seed;
    this.quality.setBase(SIM_HEIGHTS[params.quality] ?? 576);
    const milliseconds = seconds * 1000, chosen = this.quality.update(milliseconds, this.budget.estimate(milliseconds));
    this.solver.setQuality(chosen.steps, chosen.simHeight);
    const { driftBoost, seedBurst } = this.help;
    this.help = { driftBoost, seedBurst: 0 };
    // Help works through the ordinary motion controls, and only ever adds to what the operator has set.
    const played = driftBoost > 0 ? { ...params, flowSpeed: Math.max(params.flowSpeed, driftBoost * .7), surge: Math.max(params.surge, driftBoost * .6) } : params;
    this.solver.step(seconds, time, played, { ...input, seedBurst: Math.max(input.seedBurst, seedBurst) }, driftBoost);
    // A fresh pattern fades up as it forms, so noise never reaches the wall.
    const fade = Math.max(0, Math.min(1, (this.solver.formed - .3) / .7));
    this.shade.draw(this.solver.texture, params, time, { widthScale: this.solver.widthScale, fade, bloom: chosen.bloom });
    this.measure(seconds, params);
  }

  /** Samples the field about once a second without ever waiting for the graphics card. A held pattern is left alone. */
  private measure(seconds: number, params: MorphParams): void {
    if (params.speed <= 0) { this.previous = null; this.sinceProbe = 0; return; }
    this.sinceProbe += seconds;
    if (this.sinceProbe < 1 || this.probing) return;
    const elapsed = this.sinceProbe;
    this.sinceProbe = 0;
    this.probing = true;
    this.probeMaterial.uniforms.uState.value = this.solver.texture;
    this.passes.draw(this.probeMaterial, this.probe.write);
    this.probe.swap();
    const rgba = new Float32Array(PROBE_WIDTH * PROBE_HEIGHT * 4);
    this.passes.renderer.readRenderTargetPixelsAsync(this.probe.read, 0, 0, PROBE_WIDTH, PROBE_HEIGHT, rgba).then(() => {
      if (this.disposed) return;
      const field = new Float32Array(PROBE_WIDTH * PROBE_HEIGHT);
      for (let i = 0; i < field.length; i++) field[i] = rgba[i * 4];
      if (this.previous) {
        this.activity = fieldActivity(this.previous, field);
        this.help = this.governor.update(this.activity, params.freezeFloor * .25, elapsed);
      }
      this.previous = field;
    }).catch(() => { this.previous = null; }).finally(() => { this.probing = false; });
  }

  /** The stripe field, for scripted checks. */
  readField(): Float32Array {
    const { width, height } = this.solver.target, rgba = new Float32Array(width * height * 4);
    this.passes.renderer.readRenderTargetPixels(this.solver.target, 0, 0, width, height, rgba);
    return rgba;
  }

  resize(width: number, height: number): void { this.shade.resize(width, height); }
  clear(): void { this.solver.reseed(this.seed); }
  dispose(): void {
    this.disposed = true;
    this.solver.dispose(); this.shade.dispose(); this.probe.dispose(); this.probeMaterial.dispose();
  }
}
